import { randomBytes } from "node:crypto";
import { access, chmod, mkdtemp, readFile, unlink, writeFile } from "node:fs/promises";
import { homedir, tmpdir } from "node:os";
import { join } from "node:path";
import { createInterface } from "node:readline/promises";

import { _electron as electron } from "playwright";

import { desktopRoundtripIssues, parseArchiveEvents, qualificationIssues } from "./qa-support.mjs";

const root = process.cwd();
const packagedExecutable = join(root, "release", "Worket-darwin-arm64", "Worket.app", "Contents", "MacOS", "Worket");
const defaultBridgePath = join(homedir(), ".workpet", "bridge.json");
const listOnly = process.argv.includes("--list");
const selectedThreadId = process.env.WORKPET_QA_THREAD_ID;
const explicitConsent = process.env.WORKPET_QA_CONFIRM === "SEND_TO_CURRENT_WORKBUDDY_ACCOUNT";

await access(packagedExecutable).catch(() => {
  throw new Error("缺少打包后的 Worket.app；请先运行 npm run package:mac");
});

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function readBridge(path) {
  const raw = await readFile(path, "utf8");
  const config = JSON.parse(raw);
  if (config.host !== "127.0.0.1" || !Number.isInteger(config.port) || typeof config.token !== "string") {
    throw new Error("Worket bridge 配置无效");
  }
  return config;
}

async function bridgeRequest(config, name, workId) {
  const response = await fetch(`http://${config.host}:${config.port}/mcp`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-WorkPet-Token": config.token },
    body: JSON.stringify({
      jsonrpc: "2.0",
      id: `desktop-qa-${Date.now()}`,
      method: "tools/call",
      params: { name, arguments: { work_id: workId } }
    })
  });
  if (!response.ok) throw new Error(`Worket bridge 返回 HTTP ${response.status}`);
  return response.json();
}

async function isLiveBridge(path) {
  try {
    const config = await readBridge(path);
    const response = await fetch(`http://${config.host}:${config.port}/mcp`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "X-WorkPet-Token": config.token },
      body: JSON.stringify({ jsonrpc: "2.0", id: "desktop-qa-probe", method: "initialize" })
    });
    return response.ok;
  } catch {
    return false;
  }
}

async function launchWorkPet({ bridgePath, dataDirectory, proofToken }) {
  const app = await electron.launch({
    executablePath: packagedExecutable,
    args: [],
    cwd: root,
    env: {
      ...process.env,
      WORKPET_BRIDGE_CONFIG: bridgePath,
      WORKPET_DATA_DIR: dataDirectory,
      ...(proofToken ? { WORKPET_QA_PROOF_TOKEN: proofToken } : {})
    }
  });
  await delay(1_000);
  const panel = app.windows().find((page) => page.url().endsWith("/panel.html"));
  if (!panel) {
    await app.close();
    throw new Error("Worket panel 未启动");
  }
  return { app, panel };
}

async function listCandidates() {
  const directory = await mkdtemp(join(tmpdir(), "workpet-desktop-list-"));
  const { app, panel } = await launchWorkPet({
    bridgePath: join(directory, "bridge.json"),
    dataDirectory: directory
  });
  try {
    const candidates = await panel.evaluate(async () => {
      const threads = await window.workpet.listConversations("codex");
      const output = [];
      for (const thread of threads) output.push(await window.workpet.previewConversation("codex", thread.id));
      return output;
    });
    console.log(JSON.stringify(candidates.map((preview) => ({
      threadId: preview.id,
      title: preview.title,
      userPromptCount: preview.userPromptCount,
      agentResponseCount: preview.agentResponseCount,
      artifactCount: preview.artifactCount,
      eligible: qualificationIssues(preview).length === 0,
      issues: qualificationIssues(preview)
    })), null, 2));
  } finally {
    await app.close();
  }
}

if (listOnly) {
  await listCandidates();
  process.exit(0);
}

if (!selectedThreadId) {
  throw new Error("请先运行 npm run qa:desktop-roundtrip:list，再通过 WORKPET_QA_THREAD_ID 指定任务");
}
if (!explicitConsent) {
  throw new Error("本验收会把所选工作的结构化上下文发送到当前登录的 WorkBuddy 账号；确认后设置 WORKPET_QA_CONFIRM=SEND_TO_CURRENT_WORKBUDDY_ACCOUNT");
}
if (await isLiveBridge(defaultBridgePath)) {
  throw new Error("检测到另一个 Worket 正在运行；请先退出它，避免桌面 Hook 写入错误实例");
}

const originalBridge = await readFile(defaultBridgePath).catch(() => null);
const testDirectory = await mkdtemp(join(tmpdir(), "workpet-desktop-roundtrip-"));
const proofToken = randomBytes(16).toString("hex");
const terminal = createInterface({ input: process.stdin, output: process.stdout });
let app = null;

try {
  const launched = await launchWorkPet({ bridgePath: defaultBridgePath, dataDirectory: testDirectory, proofToken });
  app = launched.app;
  const panel = launched.panel;
  const preview = await panel.evaluate((threadId) => window.workpet.previewConversation("codex", threadId), selectedThreadId);
  const qualification = qualificationIssues(preview);
  if (qualification.length) throw new Error(`所选 Codex 任务不满足严格验收：${qualification.join("；")}`);

  const imported = await panel.evaluate((threadId) => window.workpet.createWorkFromConversation({executorId: "codex",  threadId, allowCloudExtraction: false }), selectedThreadId);
  const workId = imported.selectedWorkId;
  if (!workId || !imported.selectedWork) throw new Error("Codex 工作没有被记录");
  const refreshedBeforeContinuation = await panel.evaluate((id) => window.workpet.refreshWork(id), workId);
  const beforeCodexContinuation = refreshedBeforeContinuation.selectedWork?.eventCount ?? 0;
  console.log(`已导入：${preview.title}；${preview.userPromptCount} 轮用户输入；${preview.artifactCount} 份附件。`);
  await terminal.question("请在这个 Codex 任务中新增一轮对话，等回复完成后回到终端按回车：");
  const afterCodexContinuation = await panel.evaluate((id) => window.workpet.refreshWork(id), workId);
  if ((afterCodexContinuation.selectedWork?.eventCount ?? 0) <= beforeCodexContinuation) {
    throw new Error("没有观察到 Codex 新内容增量写入同一个 WorkInstance");
  }

  const beforeWorkBuddy = afterCodexContinuation.selectedWork?.eventCount ?? 0;
  await panel.evaluate((id) => window.workpet.handoff(id, "workbuddy"), workId);
  console.log("已唤起 WorkBuddy 接力任务，无需手动发送；正在等待真实 Conversation、MCP 与 Hook 回写证据。");

  const deadline = Date.now() + 10 * 60_000;
  let finalEvidence = null;
  while (Date.now() < deadline) {
    await delay(2_000);
    const dashboard = await panel.evaluate((id) => window.workpet.getDashboard(id), workId);
    const bridge = await readBridge(defaultBridgePath);
    const archive = await bridgeRequest(bridge, "get_work_archive", workId);
    const archiveEvents = parseArchiveEvents(archive);
    const issues = desktopRoundtripIssues({
      work: dashboard.selectedWork,
      archiveEvents,
      beforeEventCount: beforeWorkBuddy,
      proofToken
    });
    if (!issues.length) {
      finalEvidence = { dashboard, archiveEvents };
      break;
    }
  }
  if (!finalEvidence) throw new Error("十分钟内没有获得完整的 WorkBuddy 桌面 MCP/Hook 回写证据");

  const completed = await panel.evaluate((id) => window.workpet.completeWork(id), workId);
  if (completed.selectedWork?.status !== "COMPLETED" || completed.selectedWork.bindings.some((binding) => binding.status === "ACTIVE")) {
    throw new Error("完成工作后仍存在自动捕获 Binding");
  }

  const realBinding = finalEvidence.dashboard.selectedWork.bindings.find(
    (binding) => binding.adapter === "workbuddy" && !binding.conversationId.startsWith("pending:")
  );
  console.log(JSON.stringify({
    passed: true,
    workId,
    codexThreadId: selectedThreadId,
    codexUserPromptCount: preview.userPromptCount,
    artifactCount: preview.artifactCount,
    workBuddyConversationId: realBinding?.conversationId,
    finalEventCount: finalEvidence.dashboard.selectedWork.eventCount,
    workBuddyEpisodeCount: finalEvidence.dashboard.selectedWork.episodes.filter((episode) => episode.environment === "WorkBuddy Desktop").length,
    proofTokenVerified: true,
    persistedLocallyAt: join(testDirectory, "workpet.sqlite")
  }, null, 2));
} finally {
  terminal.close();
  try {
    if (app) await app.close();
  } finally {
    if (originalBridge) {
      await writeFile(defaultBridgePath, originalBridge, { mode: 0o600 });
      await chmod(defaultBridgePath, 0o600);
    } else {
      await unlink(defaultBridgePath).catch((error) => {
        if (error?.code !== "ENOENT") throw error;
      });
    }
  }
}
