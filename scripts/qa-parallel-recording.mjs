import assert from "node:assert/strict";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron } from "playwright";
const root = process.cwd(),
  directory = await mkdtemp(join(tmpdir(), "worket-executors-")),
  output = join(root, "output/playwright");
await mkdir(output, { recursive: true });
const application = await electron.launch({
  executablePath: join(
    root,
    "release/Worket-darwin-arm64/Worket.app/Contents/MacOS/Worket",
  ),
  args: [`--user-data-dir=${directory}`],
  cwd: root,
  env: {
    ...process.env,
    WORKPET_SKIP_INTEGRATIONS: "1",
    WORKPET_DATA_DIR: directory,
    WORKPET_BRIDGE_CONFIG: join(directory, "bridge.json"),
  },
});
try {
  let page;
  for (let i = 0; i < 100 && !page; i++) {
    page = application.windows().find((p) => p.url().endsWith("panel.html"));
    if (!page) await new Promise((r) => setTimeout(r, 100));
  }
  assert.ok(page);
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  await application.evaluate(
    async ({ app, ipcMain, BrowserWindow }, directory) => {
      const require = process
        .getBuiltinModule("module")
        .createRequire(`${app.getAppPath()}/package.json`);
      const { AppService } = require("./dist/app/app-service.js");
      const peers = ["codex", "workbuddy", "third"].map((id, i) => {
        const name = ["Codex", "WorkBuddy", "第三执行者"][i];
        const threads = [0, 1].map((n) => ({
          threadId: `${id}-${n}`,
          title: `${name} ${n ? "历史工作" : "活动工作"}`,
          applicationTitle: `${name} ${n ? "历史工作" : "活动工作"}`,
          cwd: "/tmp/qa",
          createdAt: new Date().toISOString(),
          updatedAt: new Date(
            Date.now() - n * 86400000 - i * 1000,
          ).toISOString(),
          events: [
            {
              externalId: `${id}-${n}:prompt`,
              id: `${id}-${n}:prompt`,
              sequence: 1,
              kind: "user.prompt",
              content: "整理合成验收材料",
              timestamp: new Date().toISOString(),
              executorType: "HUMAN",
              environmentType: id,
            },
          ],
        }));
        return {
          id,
          name,
          threads,
          mark: name[0],
          bundleIds: [`app.${id}`],
          environment: { type: id, name },
          async inspect() {},
          async resolveCurrent() {
            return null;
          },
          async deliver() {
            return {};
          },
          source: {
            async listThreadPage(_limit, cursor) {
              return {
                threads: threads
                  .slice(cursor ? 1 : 0, cursor ? 2 : 1)
                  .map((t) => ({
                    id: t.threadId,
                    title: t.title,
                    cwd: t.cwd,
                    updatedAt: t.updatedAt,
                    preview: "",
                    status: "idle",
                  })),
                nextCursor: cursor ? null : "older",
              };
            },
            async readThread(id) {
              return structuredClone(threads.find((t) => t.threadId === id));
            },
            close() {},
          },
        };
      });
      const service = new AppService({
        databasePath: `${directory}/fixture.sqlite`,
        executors: peers,
        foreground: {
          async detect() {
            return {
              bundleId: "app.workbuddy",
              name: "WorkBuddy",
              windowTitle: null,
            };
          },
        },
      });
      const handlers = {
        "dashboard:get": (_e, id) => service.dashboard(id),
        "pet:get-view": () => service.getPetView(),
        "executors:list": () => service.listExecutors(),
        "conversations:recent": () => service.listRecentConversations(),
        "conversations:history": (_e, id, cursor) =>
          service.listConversationHistory(id, cursor),
        "conversations:selection": () => service.consumeSourceSelection(),
        "work:create-from-conversation": (_e, input) =>
          service.createWorkFromConversation(input),
        "work:handoff": (_e, id, target) => service.handoff(id, target),
        "work:cancel-handoff": (_e, id, confirmation) =>
          service.cancelHandoff(id, confirmation),
        "work:complete": (_e, id) => service.completeWork(id),
        "work:archive": (_e, id) => service.archiveWork(id),
      };
      for (const [name, handler] of Object.entries(handlers)) {
        ipcMain.removeHandler(name);
        ipcMain.handle(name, handler);
      }
      globalThis.recordingQa = { service, peers };
      BrowserWindow.getAllWindows()
        .find((w) => w.webContents.getURL().endsWith("panel.html"))
        ?.show();
    },
    directory,
  );
  await page.reload();
  await page.locator("#tab-recent").click();
  await page.waitForFunction(
    () => document.querySelectorAll("#recent-sources .source-row").length === 3,
  );
  assert.deepEqual(
    await page.locator("#recent-sources .agent-label").allTextContents(),
    ["Codex", "WorkBuddy", "第三执行者"],
  );
  await page.screenshot({ path: join(output, "executors-01-sources.png") });
  for (const id of ["codex-0", "workbuddy-0"]) {
    await page.locator("#tab-recent").click();
    await page.locator(`[data-thread-id="${id}"] button`).click();
    await page.waitForFunction(
      (id) =>
        !document.querySelector(`#recent-sources [data-thread-id="${id}"]`),
      id,
    );
  }
  await page.locator("#tab-recent").click();
  await page.locator("#record-history").click();
  await page.locator("#history-executor").selectOption("workbuddy");
  await page.locator("#history-more").click();
  await page.locator("#history-search").fill("历史");
  await page.waitForFunction(
    () =>
      document.querySelectorAll("#history-sources .source-row").length === 1,
  );
  assert.equal(
    await page.locator("#history-sources .agent-label").innerText(),
    "WorkBuddy",
  );
  await page.screenshot({ path: join(output, "executors-02-history.png") });
  await page
    .locator('#history-sources [data-thread-id="workbuddy-1"] button')
    .click();
  await page.waitForFunction(
    () => document.querySelectorAll("#work-list .work-row").length === 3,
  );
  await application.evaluate(async () => {
    const { service, peers } = globalThis.recordingQa;
    for (const peer of peers)
      for (const t of peer.threads)
        t.events.push({
          ...t.events[0],
          externalId: `${t.threadId}:next`,
          id: `${t.threadId}:next`,
          sequence: 2,
          kind: "agent.response",
          content: "新增合成回复",
          executorType: "AGENT",
        });
    await service.syncRecordedWorks();
  });
  await page.waitForFunction(
    () =>
      [...document.querySelectorAll("#work-list .counts")].every((el) =>
        el.textContent.startsWith("3 条记录"),
      ),
    undefined,
    { timeout: 15000 },
  );
  await page.locator('#work-detail [data-action="handoff"]').click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll("dialog[open] button")].some((el) =>
      el.textContent.includes("第三执行者"),
    ),
  );
  await page.screenshot({ path: join(output, "executors-03-handoff.png") });
  await page.getByRole("button", { name: "第三执行者", exact: false }).click();
  await page.waitForFunction(
    () =>
      !!document.querySelector('#work-detail [data-action="cancel-handoff"]'),
  );
  const workId = await page.evaluate(
    async () => (await window.workpet.getDashboard()).selectedWorkId,
  );
  page.once("dialog", (dialog) => dialog.accept());
  await page.locator('#work-detail [data-action="cancel-handoff"]').click();
  await page.waitForFunction(
    () =>
      !document.querySelector('#work-detail [data-action="cancel-handoff"]'),
  );
  const state = await application.evaluate((_electron, id) => {
    const w = globalThis.recordingQa.service.core().getWork(id);
    return {
      id: w.instance.id,
      executor: w.activeBinding.adapter,
      count: globalThis.recordingQa.service.dashboard().works.length,
    };
  }, workId);
  assert.equal(state.id, workId);
  assert.equal(state.executor, "workbuddy");
  assert.equal(state.count, 3);
  assert.ok(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  );
  assert.deepEqual(errors, []);
  console.log(
    JSON.stringify(
      {
        passed: true,
        executors: 3,
        parallelWorks: 3,
        historyPagination: true,
        genericHandoffPicker: true,
        cancelRestoresSource: true,
        screenshots: [
          "executors-01-sources.png",
          "executors-02-history.png",
          "executors-03-handoff.png",
        ],
      },
      null,
      2,
    ),
  );
} finally {
  await application
    .evaluate(() => globalThis.recordingQa?.service.close())
    .catch(() => {});
  await application.close();
}
