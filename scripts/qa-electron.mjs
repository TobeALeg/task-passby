import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron as electron } from "playwright";

const root = process.cwd();
const output = join(root, "output", "playwright");
await mkdir(output, { recursive: true });
const testDirectory = await mkdtemp(join(tmpdir(), "workpet-ui-qa-"));
const packagedExecutable = process.env.WORKPET_EXECUTABLE_PATH;

const electronApp = await electron.launch({
  executablePath: packagedExecutable ?? join(root, "node_modules", "electron", "dist", "Electron.app", "Contents", "MacOS", "Electron"),
  args: packagedExecutable
    ? [`--user-data-dir=${testDirectory}`]
    : [".", `--user-data-dir=${testDirectory}`],
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
  if (!pet || !panel) throw new Error(`窗口不完整：${pages.map((page) => page.url()).join(", ")}`);
  const dockVisible = await electronApp.evaluate(({ app }) =>
    process.platform !== "darwin" || Boolean(app.dock?.isVisible())
  );
  if (!dockVisible) throw new Error("WorkPet 已启动但 Dock 图标被隐藏，用户无法确认程序正在运行");
  await electronApp.evaluate(({ app }) => app.emit("second-instance", {}, [], process.cwd()));
  await panel.waitForTimeout(100);
  const secondInstanceRestored = await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some((window) => window.webContents.getURL().endsWith("/panel.html") && window.isVisible())
  );
  if (!secondInstanceRestored) throw new Error("再次双击 WorkPet 时没有把已有窗口带回前台");
  await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().find((window) => window.webContents.getURL().endsWith("/panel.html"))?.hide()
  );

  await pet.screenshot({ path: join(output, "01-pet.png") });
  const petMetrics = await pet.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    body: document.querySelector("#pet-body")?.getBoundingClientRect().toJSON(),
    paper: document.querySelector("#paper-action")?.getBoundingClientRect().toJSON(),
    bubble: document.querySelector("#context-bubble")?.getBoundingClientRect().toJSON()
  }));
  await pet.locator("#pet-body").click();
  await panel.waitForTimeout(250);
  const panelVisible = await electronApp.evaluate(({ BrowserWindow }) =>
    BrowserWindow.getAllWindows().some((window) => window.webContents.getURL().endsWith("/panel.html") && window.isVisible())
  );
  if (!panelVisible) throw new Error("点击桌宠后侧栏没有显示");

  await panel.screenshot({ path: join(output, "02-panel-empty.png") });
  const panelMetrics = await panel.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    clientWidth: document.documentElement.clientWidth,
    clientHeight: document.documentElement.clientHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    filters: document.querySelector(".filters")?.getBoundingClientRect().toJSON()
  }));
  const editableControlCount = await panel.locator("textarea[data-item-id], [data-remove-item]").count();
  if (editableControlCount) throw new Error("Work State 面板仍暴露编辑或删除控件");

  console.log(JSON.stringify({
    passed: true,
    dockVisible,
    secondInstanceRestored,
    petMetrics,
    panelMetrics,
    editableControlCount,
    screenshots: ["01-pet.png", "02-panel-empty.png"]
  }, null, 2));
} finally {
  await electronApp.close();
}
