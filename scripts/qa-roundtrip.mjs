import { execFile } from "node:child_process";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { promisify } from "node:util";

import { _electron as electron } from "playwright";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const testDirectory = await mkdtemp(join(tmpdir(), "workpet-desktop-roundtrip-"));
const bridgePath = join(testDirectory, "bridge.json");
const executablePath = join(root, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron");
const workBuddyCli = "/Applications/WorkBuddy.app/Contents/Resources/app.asar.unpacked/cli/bin/codebuddy";
const environment = {
  ...process.env,
  CODEBUDDY_CONFIG_DIR: "/Users/dandi/.workbuddy",
  WORKPET_AUTO_SEND: "0",
  WORKPET_BRIDGE_CONFIG: bridgePath,
  WORKPET_DATA_DIR: testDirectory
};

const electronApp = await electron.launch({ executablePath, args: ["."], cwd: root, env: environment });
try {
  await new Promise((resolve) => setTimeout(resolve, 900));
  const panel = electronApp.windows().find((page) => page.url().endsWith("/panel.html"));
  if (!panel) throw new Error("WorkPet panel 未启动");
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
    `这是 WorkPet 桌面闭环验收。请调用 get_work_context，参数 work_id=${workId}。`,
    "确认你读到了同一项工作的结构化上下文后，只回复 WORKBUDDY_ROUNDTRIP_OK。"
  ].join("\n");
  const { stdout, stderr } = await execFileAsync(workBuddyCli, [
    "-p",
    "--output-format", "json",
    "--tools", "",
    "--allowedTools", "mcp__workpet__get_work_context",
    "--max-turns", "3",
    "--effort", "minimal",
    prompt
  ], { cwd: root, env: environment, timeout: 180_000, maxBuffer: 4 * 1024 * 1024 });

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
  const archiveText = JSON.stringify(archive);
  const workBuddyBinding = work?.bindings.find((binding) => binding.adapter === "workbuddy" && binding.status === "ACTIVE");
  if (!workBuddyBinding || workBuddyBinding.conversationId.startsWith("pending:")) throw new Error("WorkBuddy Hook 没有绑定真实会话");
  if (!work || work.eventCount <= beforeEventCount) throw new Error("WorkBuddy 对话没有写回 WorkRecord");
  if (!archiveText.includes("WORKBUDDY_ROUNDTRIP_OK")) throw new Error("WorkBuddy 可见回复没有进入 Source Archive");

  console.log(JSON.stringify({
    passed: true,
    workId,
    beforeEventCount,
    afterEventCount: work.eventCount,
    workBuddyConversationId: workBuddyBinding.conversationId,
    workBuddyEpisodeCount: work.episodes.filter((episode) => episode.environment === "WorkBuddy Desktop").length,
    cliResult: stdout.slice(0, 1_000),
    cliWarnings: stderr.slice(0, 1_000)
  }, null, 2));
} finally {
  await electronApp.close();
}
