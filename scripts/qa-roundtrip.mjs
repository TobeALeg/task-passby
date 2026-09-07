import { execFile } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtemp, readFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { _electron as electron } from "playwright";
import {
  ROUNDTRIP_SENTINEL,
  containsExactString,
  desktopRoundtripIssues,
  parseArchiveEvents
} from "./qa-support.mjs";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const testDirectory = await mkdtemp(join(tmpdir(), "workpet-desktop-roundtrip-"));
const bridgePath = join(testDirectory, "bridge.json");
const executablePath = join(root, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron");
const workBuddyCli = "/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy";
const mcpProxy = join(root, "integrations", "workbuddy-marketplace", "plugins", "workpet", "bridge", "mcp-proxy.mjs");
const proofToken = randomBytes(16).toString("hex");
const expectedReply = `${ROUNDTRIP_SENTINEL}:${proofToken}`;
const sharedEnvironment = {
  ...process.env,
  CODEBUDDY_CONFIG_DIR: join(homedir(), ".workbuddy"),
  WORKPET_BRIDGE_CONFIG: bridgePath,
  WORKPET_DATA_DIR: testDirectory
};
const electronEnvironment = { ...sharedEnvironment, WORKPET_QA_PROOF_TOKEN: proofToken };

const electronApp = await electron.launch({ executablePath, args: ["."], cwd: root, env: electronEnvironment });
try {
  await new Promise((resolve) => setTimeout(resolve, 900));
  const panel = electronApp.windows().find((page) => page.url().endsWith("/panel.html"));
  if (!panel) throw new Error("Worket panel 未启动");
  const imported = await panel.evaluate(async () => {
    const threads = await window.workpet.listCodexThreads();
    if (!threads.length) throw new Error("没有可用于验收的 Codex 任务");
    return window.workpet.createWorkFromCodex({ threadId: threads[0].id, allowCloudExtraction: false });
  });
  const workId = imported.selectedWorkId;
  if (!workId || !imported.selectedWork) throw new Error("Codex 工作没有被记录");
  const beforeEventCount = imported.selectedWork.eventCount;
  await panel.evaluate((id) => window.workpet.handoffToWorkBuddy(id), workId);

  const prompt = [
    `[WORKPET:${workId}]`,
    `这是 Worket 桌面闭环验收。请调用 get_work_context，参数 work_id=${workId}。`,
    `读取返回字段 qaProofToken 后，只回复 ${ROUNDTRIP_SENTINEL}:<qaProofToken>；不要猜测 token。`
  ].join("\n");
  const { stdout, stderr } = await execFileAsync(workBuddyCli, [
    "-p",
    "--output-format", "json",
    "--mcp-config", JSON.stringify({ mcpServers: { workpet: { command: "node", args: [mcpProxy] } } }),
    "--strict-mcp-config",
    "--allowedTools", "mcp__workpet__get_work_context",
    "--max-turns", "3",
    "--effort", "minimal",
    prompt
  ], { cwd: root, env: sharedEnvironment, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });
  const cliOutput = JSON.parse(stdout);
  if (!containsExactString(cliOutput, expectedReply)) {
    throw new Error("WorkBuddy 没有在成功读取 MCP 后返回精确验收口令");
  }

  const dashboard = await panel.evaluate((id) => window.workpet.getDashboard(id), workId);
  const work = dashboard.selectedWork;
  const bridge = JSON.parse(await readFile(bridgePath, "utf8"));
  const archiveResponse = await fetch(`http://${bridge.host}:${bridge.port}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-WorkPet-Token": bridge.token },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: 99,
      method: "tools/call",
      params: { name: "get_work_archive", arguments: { work_id: workId } }
    })
  });
  const archive = await archiveResponse.json();
  const archiveEvents = parseArchiveEvents(archive);
  const issues = desktopRoundtripIssues({ work, archiveEvents, beforeEventCount, proofToken });
  if (issues.length) throw new Error(issues.join("；"));
  const workBuddyBinding = work.bindings.find(
    (binding) => binding.adapter === "workbuddy" && binding.status === "ACTIVE" && !binding.conversationId.startsWith("pending:")
  );

  console.log(JSON.stringify({
    passed: true,
    workId,
    beforeEventCount,
    afterEventCount: work.eventCount,
    workBuddyConversationId: workBuddyBinding?.conversationId,
    workBuddyEpisodeCount: work.episodes.filter((episode) => episode.environment === "WorkBuddy Desktop").length,
    cliResult: stdout.slice(0, 1_000),
    cliWarnings: stderr.slice(0, 1_000)
  }, null, 2));
} finally {
  await electronApp.close();
}
