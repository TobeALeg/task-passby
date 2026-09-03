import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { _electron as electron } from "playwright";

const root = process.cwd();
const outputDirectory = join(root, "output", "playwright");
const testDirectory = await mkdtemp(join(tmpdir(), "workpet-workbuddy-context-"));
const screenshotPath = join(outputDirectory, "workbuddy-current-context.png");

await mkdir(outputDirectory, { recursive: true });

const electronApp = await electron.launch({
  executablePath: join(root, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron"),
  args: [".", `--user-data-dir=${testDirectory}`],
  cwd: root,
  env: {
    ...process.env,
    WORKPET_BRIDGE_CONFIG: join(testDirectory, "bridge.json"),
    WORKPET_DATA_DIR: testDirectory
  }
});

try {
  await new Promise((resolve) => setTimeout(resolve, 700));
  const pages = electronApp.windows();
  const pet = pages.find((page) => page.url().endsWith("/pet.html"));
  const panel = pages.find((page) => page.url().endsWith("/panel.html"));
  if (!pet || !panel) throw new Error(`WorkPet 窗口不完整：${pages.map((page) => page.url()).join(", ")}`);

  await electronApp.evaluate(({ BrowserWindow }) => {
    const panelWindow = BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith("/panel.html"));
    panelWindow?.show();
    panelWindow?.focus();
  });
  const paperAction = pet.locator("#paper-action");
  await paperAction.waitFor({ state: "visible", timeout: 5_000 });
  await pet.waitForFunction(() => !document.querySelector("#paper-action")?.hasAttribute("disabled"), undefined, { timeout: 15_000 });

  const before = await pet.evaluate(() => window.workpet.getPetView());
  if (before.currentConversation?.adapter !== "workbuddy" || before.currentConversation.title !== "当前 WorkBuddy 对话") {
    throw new Error(`没有识别到无窗口标题的前台 WorkBuddy：${JSON.stringify(before)}`);
  }
  await pet.screenshot({ path: screenshotPath });
  await paperAction.click();

  let dashboard = await pet.evaluate(() => window.workpet.getDashboard());
  for (let attempt = 0; attempt < 120 && !dashboard.works.length; attempt += 1) {
    await new Promise((resolve) => setTimeout(resolve, 250));
    dashboard = await pet.evaluate(() => window.workpet.getDashboard());
  }
  const binding = dashboard.selectedWork?.bindings[0];
  if (binding?.adapter !== "workbuddy" || !binding.conversationId.startsWith("waiting:")) {
    throw new Error(`点击记录后没有建立 WorkBuddy 待确认绑定：${JSON.stringify(dashboard.selectedWork)}`);
  }

  console.log(JSON.stringify({
    passed: true,
    conversation: before.currentConversation,
    workId: dashboard.selectedWork?.id,
    binding,
    screenshot: screenshotPath,
    database: join(testDirectory, "workpet.sqlite")
  }, null, 2));
} finally {
  await electronApp.close();
}
