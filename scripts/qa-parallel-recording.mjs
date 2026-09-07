import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron } from "playwright";

const root = process.cwd();
const directory = await mkdtemp(join(tmpdir(), "worket-parallel-"));
const output = join(root, "output", "playwright");
await mkdir(output, { recursive: true });
const application = await electron.launch({
  executablePath: join(root, "release/Worket-darwin-arm64/Worket.app/Contents/MacOS/Worket"),
  args: [`--user-data-dir=${directory}`], cwd: root,
  env: { ...process.env, WORKPET_DATA_DIR: directory, WORKPET_BRIDGE_CONFIG: join(directory, "bridge.json") }
});
try {
  let page;
  for (let attempt = 0; attempt < 100 && !page; attempt++) {
    page = application.windows().find((candidate) => candidate.url().endsWith("panel.html"));
    if (!page) await new Promise((resolve) => setTimeout(resolve, 100));
  }
  assert.ok(page, "面板已创建");
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await application.evaluate(async ({ app, ipcMain, BrowserWindow }, directory) => {
    const require = process.getBuiltinModule("module").createRequire(`${app.getAppPath()}/package.json`);
    const { AppService } = require("./dist/app/app-service.js");
    const now = Date.now();
    const threads = ["并行活动工作 A", "并行活动工作 B", "沉睡的历史工作 C"].map((title, i) => ({
      threadId: `qa-${i}`, title, applicationTitle: title, cwd: `/tmp/project-${i}`,
      createdAt: new Date(now - 86_400_000).toISOString(), updatedAt: new Date(now - (i === 2 ? 86_400_000 : i * 1000)).toISOString(),
      events: [{ id: `prompt-${i}`, externalId: `prompt-${i}`, sequence: 1, kind: "user.prompt", content: `请处理${title}`, timestamp: new Date(now).toISOString(), executorType: "HUMAN", environmentType: "CODEX_DESKTOP" }]
    }));
    const summary = (t) => ({ id: t.threadId, title: t.title, cwd: t.cwd, updatedAt: t.updatedAt, preview: "", status: { type: "notLoaded" } });
    let failHistory = false;
    let foreground = { bundleId: "DOVE.tauri", name: "Codex", windowTitle: null };
    const service = new AppService({ databasePath: `${directory}/fixture.sqlite`,
      codex: {
        async listRecentThreads() { return threads.slice(0, 2).map(summary); },
        async listThreadPage(_limit, cursor) {
          if (failHistory) throw new Error("历史列表暂时不可用");
          return { threads: (cursor ? threads.slice(2) : threads.slice(0, 2)).map(summary), nextCursor: cursor ? null : "older" };
        },
        async readThread(id) { return threads.find((t) => t.threadId === id); }, close() {}
      },
      foreground: { async detect() { return foreground; } },
      launcher: { async openNewConversation() { return "opened"; } }
    });
    const handlers = {
      "dashboard:get": (_event, workId) => service.dashboardWithVerification(workId),
      "pet:get-view": () => service.getPetView(),
      "codex:list": () => service.listCodexThreads(),
      "codex:history": (_event, cursor) => service.listCodexHistory(cursor),
      "work:create-from-codex": (_event, request) => service.createWorkFromCodex(request)
    };
    for (const [name, handler] of Object.entries(handlers)) { ipcMain.removeHandler(name); ipcMain.handle(name, handler); }
    globalThis.recordingQa = { service, threads, setHistoryError(value) { failHistory = value; }, useWorkBuddy() { foreground = { bundleId: "com.tencent.workbuddy.mac", name: "WorkBuddy", windowTitle: null }; } };
    BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith("panel.html"))?.show();
  }, directory);
  await page.reload();
  await page.waitForFunction(() => document.querySelectorAll("#recent-sources .source-row").length === 2);
  assert.deepEqual(await page.locator("#recent-sources .agent-label").allTextContents(), ["Codex", "Codex"]);
  await page.screenshot({ path: join(output, "parallel-01-discovery.png") });
  for (const id of ["qa-0", "qa-1"]) {
    await page.locator(`#recent-sources [data-thread-id='${id}'] button`).click();
    await page.waitForFunction((id) => !document.querySelector(`#recent-sources [data-thread-id='${id}']`), id);
  }
  assert.equal(await page.locator("#work-list .work-row").count(), 2);
  await page.locator("#record-history").click();
  await page.locator("#history-more").click();
  await page.locator("#history-search").fill("沉睡");
  await page.waitForFunction(() => document.querySelectorAll("#history-sources .source-row").length === 1);
  assert.equal(await page.locator("#history-sources .agent-label").innerText(), "Codex");
  await page.screenshot({ path: join(output, "parallel-02-history.png") });
  await page.locator("#history-sources [data-thread-id='qa-2'] button").click();
  await page.waitForFunction(() => document.querySelectorAll("#work-list .work-row").length === 3);
  await application.evaluate(async () => {
    const { threads, service } = globalThis.recordingQa;
    for (const thread of threads) thread.events.push({ ...thread.events[0], id: `next-${thread.threadId}`, externalId: `next-${thread.threadId}`, sequence: 2, content: "后续可见回复", kind: "agent.response", executorType: "AGENT" });
    await service.syncRecordedCodexWorks();
  });
  await page.waitForFunction(() => [...document.querySelectorAll("#work-list .counts")].every((element) => element.textContent.startsWith("3 条记录")), undefined, { timeout: 15_000 });
  await page.screenshot({ path: join(output, "parallel-03-recording.png") });
  await page.locator("#record-history").click();
  await page.locator("#history-sources [data-thread-id='qa-0'] button").click();
  assert.equal(await page.locator("#work-list .work-row").count(), 3, "重复选择不创建新记录");
  await application.evaluate(() => globalThis.recordingQa.setHistoryError(true));
  await page.locator("#record-history").click();
  await page.waitForFunction(() => !document.querySelector("#history-error").hidden);
  await application.evaluate(() => globalThis.recordingQa.setHistoryError(false));
  await page.locator("#history-retry").click();
  await page.waitForFunction(() => document.querySelector("#history-error").hidden && document.querySelectorAll("#history-sources .source-row").length === 2);
  await page.locator("#history-close").click();
  const waitingId = await application.evaluate(async () => {
    const qa = globalThis.recordingQa;
    qa.useWorkBuddy();
    return (await qa.service.recordCurrentContext()).selectedWorkId;
  });
  await page.waitForFunction(() => document.querySelector(".status-waiting")?.textContent === "等待发送消息", undefined, { timeout: 15_000 });
  const waitingRow = page.locator(`[data-work-id='${waitingId}']`);
  assert.equal(await waitingRow.locator(".agent-label").innerText(), "WorkBuddy");
  assert.match(await waitingRow.locator(".capture-guidance").innerText(), /尚未开始记录。请在对应的 WorkBuddy 聊天中发送一条消息/u);
  await waitingRow.click();
  assert.match(await page.locator("#work-detail .capture-guidance").innerText(), /尚未开始记录/u);
  const pet = application.windows().find((candidate) => candidate.url().endsWith("pet.html"));
  await pet.waitForFunction(() => document.querySelector("#context-label")?.textContent === "请在 WorkBuddy 发送消息");
  await page.screenshot({ path: join(output, "parallel-04-waiting.png") });
  await application.evaluate(async () => {
    const { service } = globalThis.recordingQa;
    await service.syncWorkBuddyHook({ hook_event_name: "UserPromptSubmit", session_id: "qa-real-workbuddy-session", prompt: "请继续处理工作" });
  });
  await page.waitForFunction(() => !document.querySelector(".status-waiting") && !document.querySelector(".capture-guidance"), undefined, { timeout: 15_000 });
  await pet.waitForFunction(() => document.querySelector("#context-label")?.textContent === "正在记录 · WorkBuddy");
  assert.equal(await page.locator("#notice").innerText(), "已识别 WorkBuddy 聊天，正在记录。");
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), "面板无横向溢出");
  assert.deepEqual(errors, []);
  console.log(JSON.stringify({ passed: true, parallelWorks: 3, automaticPanelRefresh: true, historyPagination: true, errorRecovery: true, agentLabels: true, waitingGuidanceAndTransition: true, screenshots: ["parallel-01-discovery.png", "parallel-02-history.png", "parallel-03-recording.png", "parallel-04-waiting.png"] }, null, 2));
} finally {
  await application.evaluate(() => globalThis.recordingQa?.service.close()).catch(() => {});
  await application.close();
}
