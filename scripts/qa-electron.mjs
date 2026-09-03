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
    bubble: document.querySelector("#context-bubble")?.getBoundingClientRect().toJSON(),
    bodyShadow: document.querySelector("#pet-body") ? getComputedStyle(document.querySelector("#pet-body")).boxShadow : null
  }));
  const shadowInsets = petMetrics.body
    ? {
        right: petMetrics.width - petMetrics.body.right,
        bottom: petMetrics.height - petMetrics.body.bottom
      }
    : null;
  const minimumShadowInsets = { right: 32, bottom: 40 };
  if (!shadowInsets || shadowInsets.right < minimumShadowInsets.right || shadowInsets.bottom < minimumShadowInsets.bottom) {
    throw new Error(`桌宠阴影安全区不足，窗口边缘会裁切阴影：${JSON.stringify({ shadowInsets, bodyShadow: petMetrics.bodyShadow })}`);
  }
  const characterVisuals = await pet.evaluate(() => {
    const character = document.querySelector("#pet");
    const body = document.querySelector("#pet-body");
    const eye = document.querySelector(".eye");
    const mouth = document.querySelector(".mouth");
    const statusDot = document.querySelector(".status-dot");
    if (!character || !body || !eye || !mouth || !statusDot) throw new Error("桌宠角色元素不完整");
    const originalClassName = character.className;
    const originalEyeTransition = eye.style.transition;
    eye.style.transition = "none";
    const states = ["sleeping", "awake", "carrying", "alert"].map((state) => {
      character.className = `pet ${state}`;
      const bodyStyle = getComputedStyle(body);
      const eyeStyle = getComputedStyle(eye);
      const mouthStyle = getComputedStyle(mouth);
      return {
        state,
        bodyBackground: bodyStyle.backgroundImage,
        bodyRadius: bodyStyle.borderRadius,
        animationName: bodyStyle.animationName,
        eyeWidth: Number.parseFloat(eyeStyle.width),
        eyeHeight: Number.parseFloat(eyeStyle.height),
        mouthBorderTop: Number.parseFloat(mouthStyle.borderTopWidth),
        mouthBorderBottom: Number.parseFloat(mouthStyle.borderBottomWidth),
        mouthRadius: mouthStyle.borderRadius,
        statusDotBackground: getComputedStyle(statusDot).backgroundColor
      };
    });
    character.className = originalClassName;
    eye.style.transition = originalEyeTransition;
    return { states, statusDotCount: character.querySelectorAll(".status-dot").length };
  });
  const sleepingVisual = characterVisuals.states[0];
  const activeVisuals = characterVisuals.states.slice(1);
  if (!sleepingVisual || sleepingVisual.eyeWidth < 10 || sleepingVisual.eyeHeight > 4) {
    throw new Error(`空闲状态没有闭眼：${JSON.stringify(characterVisuals)}`);
  }
  if (activeVisuals.some((state) => state.eyeWidth > 9 || state.eyeHeight < 8)) {
    throw new Error(`工作状态没有统一睁眼：${JSON.stringify(characterVisuals)}`);
  }
  if (characterVisuals.states.some((state) => state.mouthBorderTop !== 0 || state.mouthBorderBottom < 2)) {
    throw new Error(`所有状态都应保持笑嘴：${JSON.stringify(characterVisuals)}`);
  }
  const characterGeometry = new Set(characterVisuals.states.map((state) => `${state.bodyRadius}|${state.mouthRadius}`));
  const bodyColors = new Set(characterVisuals.states.map((state) => state.bodyBackground));
  const statusColors = new Set(characterVisuals.states.map((state) => state.statusDotBackground));
  const expectedAnimations = ["none", "breathe", "carry", "nudge"];
  if (characterGeometry.size !== 1 || bodyColors.size !== 4 || statusColors.size !== 4 || characterVisuals.statusDotCount !== 1) {
    throw new Error(`桌宠应保持同一轮廓，并保留原有状态颜色与状态点：${JSON.stringify(characterVisuals)}`);
  }
  if (characterVisuals.states.some((state, index) => state.animationName !== expectedAnimations[index])) {
    throw new Error(`桌宠没有保留原有状态动作：${JSON.stringify(characterVisuals)}`);
  }
  if (!petMetrics.body || !petMetrics.paper || petMetrics.body.width <= petMetrics.body.height || petMetrics.paper.x < petMetrics.body.x + petMetrics.body.width * .55) {
    throw new Error(`桌宠轮廓或便利贴位置没有对齐 Logo：${JSON.stringify(petMetrics)}`);
  }
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
    shadowInsets,
    characterVisuals,
    panelMetrics,
    editableControlCount,
    screenshots: ["01-pet.png", "02-panel-empty.png"]
  }, null, 2));
} finally {
  await electronApp.close();
}
