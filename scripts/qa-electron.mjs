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
  args: packagedExecutable ? [] : ["."],
  cwd: root,
  env: {
    ...process.env,
    WORKPET_AUTO_SEND: "0",
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

  await pet.screenshot({ path: join(output, "01-pet.png") });
  const petMetrics = await pet.evaluate(() => ({
    width: innerWidth,
    height: innerHeight,
    scrollWidth: document.documentElement.scrollWidth,
    scrollHeight: document.documentElement.scrollHeight,
    button: document.querySelector("#pet")?.getBoundingClientRect().toJSON()
  }));
  await pet.locator("#pet").click();
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
    primaryAction: document.querySelector("#record-codex")?.getBoundingClientRect().toJSON(),
    filters: document.querySelector(".filters")?.getBoundingClientRect().toJSON()
  }));

  await panel.locator("#record-codex").click();
  await panel.locator("#import-dialog[open]").waitFor({ state: "visible", timeout: 15_000 });
  await panel.screenshot({ path: join(output, "03-import-confirmation.png") });
  const previewText = await panel.locator("#import-preview").innerText();
  const optionCount = await panel.locator("#codex-thread option").count();
  if (!optionCount) throw new Error("Codex App Server 没有返回候选任务");
  if (!/条消息/u.test(previewText)) throw new Error(`确认摘要缺少消息计数：${previewText}`);

  await panel.locator("#confirm-import").click();
  await panel.locator("#import-dialog").waitFor({ state: "hidden", timeout: 30_000 });
  await panel.locator("#work-detail").waitFor({ state: "visible", timeout: 10_000 });
  await panel.screenshot({ path: join(output, "04-work-detail.png") });
  const detailText = await panel.locator("#work-detail").innerText();
  if (!detailText.includes("执行片段") || !detailText.includes("Codex Desktop")) {
    throw new Error("Work Detail 没有展示 Codex ExecutionEpisode");
  }

  const editable = panel.locator("textarea[data-item-id]").first();
  const editedText = "QA 人工修改：后续提炼不得覆盖";
  await editable.fill(editedText);
  await editable.blur();
  await panel.waitForTimeout(150);
  if ((await editable.inputValue()) !== editedText) throw new Error("Work State 人工编辑没有保存");

  await panel.getByRole("button", { name: "完成", exact: true }).click();
  await panel.getByRole("button", { name: "已完成", exact: true }).click();
  await panel.getByRole("button", { name: "继续原工作", exact: true }).waitFor({ state: "visible" });
  await panel.getByRole("button", { name: "继续原工作", exact: true }).click();
  await panel.getByRole("button", { name: "进行中", exact: true }).click();
  await panel.getByRole("button", { name: "完成", exact: true }).waitFor({ state: "visible" });
  const episodeCount = await panel.locator(".episode").count();
  if (episodeCount < 2) throw new Error("继续原工作没有创建新的 ExecutionEpisode");
  await panel.screenshot({ path: join(output, "05-resumed-work.png") });

  console.log(JSON.stringify({
    passed: true,
    petMetrics,
    panelMetrics,
    optionCount,
    previewText,
    episodeCount,
    screenshots: ["01-pet.png", "02-panel-empty.png", "03-import-confirmation.png", "04-work-detail.png", "05-resumed-work.png"]
  }, null, 2));
} finally {
  await electronApp.close();
}
