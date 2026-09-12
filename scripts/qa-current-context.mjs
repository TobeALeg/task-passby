import { execFile } from "node:child_process";
import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { promisify } from "node:util";

import { _electron as electron } from "playwright";

const execFileAsync = promisify(execFile);
const root = process.cwd();
const outputDirectory = join(root, "output", "playwright");
const testDirectory = await mkdtemp(join(tmpdir(), "workpet-current-context-"));
const screenshotPath = join(outputDirectory, "current-context-panel.png");
const petScreenshotPath = join(outputDirectory, "current-context-pet-hover.png");
const completedPetScreenshotPath = join(outputDirectory, "current-context-pet-completed.png");

await mkdir(outputDirectory, { recursive: true });

const packagedExecutable = process.env.WORKPET_EXECUTABLE_PATH;
const developmentExecutable = process.platform === "darwin"
  ? join(root, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron")
  : join(root, "node_modules", "electron", "dist", "electron.exe");
const electronApp = await electron.launch({
  executablePath: packagedExecutable ?? developmentExecutable,
  args: [
    ...(packagedExecutable ? [] : ["."]),
    `--user-data-dir=${testDirectory}`,
    "--dev",
    ...(process.platform === "win32" ? ["--disable-gpu", "--no-sandbox"] : []),
  ],
  cwd: root,
  env: {
    ...process.env,
    WORKPET_SKIP_INTEGRATIONS: "1",
    WORKPET_BRIDGE_CONFIG: join(testDirectory, "bridge.json"),
    WORKPET_DATA_DIR: testDirectory
  }
});

try {
  const deadline = Date.now() + 10_000;
  let pages = electronApp.windows();
  while (
    Date.now() < deadline &&
    !pages.some((page) => page.url().endsWith("/pet.html"))
  ) {
    await new Promise((resolve) => setTimeout(resolve, 100));
    pages = electronApp.windows();
  }
  const pet = pages.find((page) => page.url().endsWith("/pet.html"));
  const panel = pages.find((page) => page.url().endsWith("/panel.html"));
  if (!pet || !panel) throw new Error(`Worket 窗口不完整：${pages.map((page) => page.url()).join(", ")}`);
  const rendererErrors = [];
  const panelErrors = [];
  pet.on("pageerror", (error) => rendererErrors.push(error.message));
  panel.on("pageerror", (error) => panelErrors.push(error.message));

  await electronApp.evaluate(({ BrowserWindow }) => {
    const panelWindow = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith("/panel.html"));
    panelWindow?.show();
    panelWindow?.focus();
  });
  await panel.waitForTimeout(200);
  const paperAction = pet.locator("#paper-action");
  await paperAction.waitFor({ state: "visible", timeout: 5_000 });
  await pet.waitForFunction(() => !document.querySelector("#paper-action")?.hasAttribute("disabled"), undefined, { timeout: 15_000 });
  let conversationTitle = await pet.locator("#context-title").innerText();

  const foregroundHelper = packagedExecutable
    ? join(
        dirname(packagedExecutable),
        "resources",
        process.platform === "win32" ? "foreground-context.exe" : "foreground-context",
      )
    : join(
        root,
        "dist",
        process.platform === "win32" ? "foreground-context.exe" : "foreground-context",
      );
  const mainProcessId = await electronApp.evaluate(() => process.pid);
  const foregroundBeforeClick = JSON.parse(
    (
      await execFileAsync(
        foregroundHelper,
        process.platform === "win32"
          ? [String(mainProcessId), "Codex.exe", "ChatGPT.exe", "WorkBuddy.exe"]
          : [],
      )
    ).stdout.trim(),
  );
  const collapsedPaper = await paperAction.evaluate((element) => element.getBoundingClientRect().toJSON());
  await paperAction.hover();
  if (process.platform !== "win32")
    await pet.waitForFunction(() => {
      const paper = document.querySelector("#paper-action");
      const label = document.querySelector("#paper-label");
      if (!paper || !label) return false;
      return paper.getBoundingClientRect().width >= 60 && Number.parseFloat(getComputedStyle(label).opacity) >= 0.95;
    }, undefined, { timeout: 2_000 });
  const hoverMetrics = await pet.evaluate(() => ({
    paper: document.querySelector("#paper-action")?.getBoundingClientRect().toJSON(),
    face: document.querySelector(".face")?.getBoundingClientRect().toJSON(),
    label: document.querySelector("#paper-label")?.textContent,
    labelOpacity: getComputedStyle(document.querySelector("#paper-label")).opacity
  }));
  if (
    !hoverMetrics.paper ||
    hoverMetrics.label !== "记录" ||
    (process.platform !== "win32" &&
      hoverMetrics.paper.width < collapsedPaper.width + 20)
  ) {
    throw new Error(`便利贴悬浮后没有展开为“记录”：${JSON.stringify({ collapsedPaper, hoverMetrics })}`);
  }
  if (process.platform !== "win32" && (!hoverMetrics.face || hoverMetrics.paper.bottom > hoverMetrics.face.top)) {
    throw new Error(`展开后的便利贴遮住了小土豆的脸：${JSON.stringify(hoverMetrics)}`);
  }
  if (process.platform !== "win32")
    await pet.screenshot({ path: petScreenshotPath });
  await paperAction.click();
  let dashboard = await pet.evaluate(() => window.workpet.getDashboard());
  for (let attempt = 0; attempt < 120 && !dashboard.works.length; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    dashboard = await pet.evaluate(() => window.workpet.getDashboard());
  }
  let selectionFallback = false;
  if (!dashboard.selectedWork) {
    const recent = await pet.evaluate(() => window.workpet.listRecentConversations());
    const source = recent.threads.find(
      (thread) => thread.executorId === "codex" && !thread.workId,
    );
    if (!source)
      throw new Error(
        `Windows 会话选择中没有可记录的 Codex 任务：${recent.errors.join(" | ") || "无来源"}`,
      );
    dashboard = await pet.evaluate(
      (request) => window.workpet.createWorkFromConversation(request),
      { executorId: source.executorId, threadId: source.id },
    );
    conversationTitle = source.title ?? conversationTitle;
    selectionFallback = true;
  }
  if (process.platform !== "win32")
    await panel.screenshot({ path: screenshotPath });

  if (!dashboard.selectedWork || dashboard.selectedWork.bindings[0]?.adapter !== "codex") {
    throw new Error(
      `点击桌宠后没有创建当前 Codex 工作：${dashboard.notice ?? "无提示"}；点击前台=${JSON.stringify(foregroundBeforeClick)}；渲染错误=${rendererErrors.join(" | ") || "无"}`
    );
  }
  if (!selectionFallback)
    await pet.waitForFunction(() => document.querySelector("#paper-action")?.getAttribute("data-action") === "open", undefined, { timeout: 10_000 });
  if (!conversationTitle.trim()) throw new Error("当前会话气泡没有展示应用生成的标题");
  if (dashboard.selectedWork.title !== conversationTitle || dashboard.selectedWork.state.objective[0]?.text !== conversationTitle) {
    throw new Error(`工作目标没有使用 Codex 总结标题：${JSON.stringify({ conversationTitle, workTitle: dashboard.selectedWork.title, objective: dashboard.selectedWork.state.objective[0] })}`);
  }
  if (dashboard.selectedWork.state.objective[0]?.origin !== "SYSTEM_INFERRED") {
    throw new Error(`Codex 总结标题没有标记为系统推断：${JSON.stringify(dashboard.selectedWork.state.objective[0])}`);
  }
  if (await panel.locator("textarea[data-item-id], [data-remove-item]").count()) {
    throw new Error("只读 Work State 中仍存在编辑或删除控件");
  }
  await pet.evaluate((workId) => window.workpet.completeWork(workId), dashboard.selectedWork.id);
  if (!selectionFallback)
    await pet.waitForFunction(() => {
      const label = document.querySelector("#context-label")?.textContent;
      const paper = document.querySelector("#paper-action");
      return label === "已完成 · Codex"
        && document.querySelector("#paper-label")?.textContent === "打开"
        && paper?.getAttribute("data-action") === "open"
        && document.querySelector("#pet")?.classList.contains("sleeping")
        && !document.querySelector("#pet-root")?.classList.contains("recording-context");
    }, undefined, { timeout: 10_000 });
  const completedDashboard = await pet.evaluate((workId) => window.workpet.getDashboard(workId), dashboard.selectedWork.id);
  if (completedDashboard.selectedWork?.status !== "COMPLETED") {
    throw new Error(`已完成工作重新打开面板失败：${JSON.stringify(completedDashboard.selectedWork)}`);
  }
  await panel.evaluate(() => window.workpet.closePanel());
  await pet.locator("#pet-body").click();
  let panelVisible = false;
  for (let attempt = 0; attempt < 40 && !panelVisible; attempt += 1) {
    panelVisible = await electronApp.evaluate(({ BrowserWindow }) => Boolean(
      BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith("/panel.html"))?.isVisible()
    ));
    if (!panelVisible) await new Promise((resolve) => setTimeout(resolve, 50));
  }
  if (!panelVisible || panelErrors.length) {
    throw new Error(`已完成工作无法通过桌宠重新打开面板：visible=${panelVisible}；错误=${panelErrors.join(" | ") || "无"}`);
  }
  if (process.platform !== "win32")
    await pet.screenshot({ path: completedPetScreenshotPath });

  console.log(JSON.stringify({
    passed: true,
    foregroundBeforeClick,
    workId: dashboard.selectedWork.id,
    title: dashboard.selectedWork.title,
    conversationTitle,
    selectionFallback,
    hoverMetrics,
    binding: dashboard.selectedWork.bindings[0],
    screenshots: process.platform === "win32"
      ? []
      : [petScreenshotPath, screenshotPath, completedPetScreenshotPath],
    database: join(testDirectory, "workpet.sqlite")
  }, null, 2));
} finally {
  await electronApp.close();
}
