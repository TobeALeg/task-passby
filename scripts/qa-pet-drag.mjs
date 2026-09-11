import assert from "node:assert/strict";
import { mkdtemp, readFile, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron } from "playwright";

const directory = await mkdtemp(join(tmpdir(), "worket-drag-qa-"));
const unpackaged = process.argv.includes("--unpackaged");
const output = join(process.cwd(), "output", "pet-docking");
await mkdir(output, { recursive: true });
const options = {
  executablePath: join(process.cwd(), unpackaged ? "node_modules/electron/dist/Electron.app/Contents/MacOS/Electron" : "release/Worket-darwin-arm64/Worket.app/Contents/MacOS/Worket"),
  args: [...(unpackaged ? ["."] : []), `--user-data-dir=${directory}`],
  env: { ...process.env, WORKPET_SKIP_INTEGRATIONS: "1", WORKPET_DATA_DIR: directory, WORKPET_BRIDGE_CONFIG: join(directory, "bridge.json") }
};
let application;
async function launch() {
  application = await _electron.launch(options);
  await application.firstWindow();
  for (let attempt = 0; attempt < 100; attempt++) {
    const pet = application.windows().find(page => page.url().endsWith("/pet.html"));
    if (pet) { await pet.waitForSelector("#pet-body"); return pet; }
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error("Pet window did not load");
}
async function bounds() {
  return application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("/pet.html")).getBounds());
}
try {
  let pet = await launch();
  await application.evaluate(({ BrowserWindow, screen }) => {
    const area = screen.getPrimaryDisplay().workArea;
    BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("/pet.html")).setPosition(area.x + 120, area.y + 120);
  });
  const before = await bounds();
  const body = await pet.locator("#pet-body").boundingBox();
  await pet.mouse.move(body.x + 25, body.y + 45);
  await pet.mouse.down();
  await pet.mouse.move(body.x + 45, body.y + 55);
  await pet.mouse.up();
  await pet.waitForTimeout(150);
  const after = await bounds();
  assert.equal(after.x, before.x + 20);
  assert.equal(after.y, before.y + 10);
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("/panel.html")).isVisible()), false, "Drag must not open panel");
  const savedFree = JSON.parse(await readFile(join(directory, "pet-position.json"), "utf8"));
  assert.equal(savedFree.x, after.x); assert.equal(savedFree.y, after.y);
  await pet.locator("#pet-body").click({ position: { x: 25, y: 45 } });
  await pet.waitForTimeout(100);
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("/panel.html")).isVisible()), true, "Click still opens panel");
  await application.close();
  pet = await launch();
  assert.deepEqual(await bounds(), after, "Restart restores saved position");
  await application.evaluate(({ BrowserWindow, screen }) => {
    BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("/pet.html")).setPosition(-10000, -10000);
    screen.emit("display-removed", {}, {});
  });
  const recovered = await bounds();
  const area = await application.evaluate(({ screen }, rectangle) => screen.getDisplayMatching(rectangle).workArea, recovered);
  assert.ok(recovered.x >= area.x && recovered.y >= area.y, "Disconnected display recovers pet");
  const center = { x: area.x + area.width / 2, y: area.y + area.height / 2 };
  let absorptionSamples = 0;
  async function dragVisiblePetTo(to, expectAbsorption = false) {
    const b = await bounds();
    const body = await pet.locator("#pet").boundingBox();
    const from = { x: b.x + body.x + body.width / 2, y: b.y + body.y + body.height / 2 };
    await pet.evaluate(({ from, to }) => {
      window.workpet.dragPet("start", from); window.workpet.dragPet("move", to); window.workpet.dragPet("end");
    }, { from, to });
    await pet.waitForTimeout(100);
    if (expectAbsorption) {
      const sample = await pet.evaluate(() => {
        const ghost = document.querySelector(".pet-motion-ghost");
        return { settling: document.querySelector("#pet-root").dataset.settling,
          scale: ghost ? new DOMMatrix(getComputedStyle(ghost).transform).a : null };
      });
      assert.equal(sample.settling, "true", "The full animation stage remains until absorption completes");
      assert.ok(sample.scale > .18 && sample.scale < 1, "The character visibly shrinks through intermediate frames");
      absorptionSamples++;
    }
    await pet.waitForFunction(() => document.querySelector("#pet-root").dataset.settling !== "true");
    assert.equal(await pet.locator(".pet-motion-ghost").count(), 0, "Finished animation removes its temporary visual");
  }
  for (const target of [{ x: area.x + 80, y: area.y + 50 }, { x: area.x + 48, y: area.y + 170 }]) {
    await dragVisiblePetTo(target);
    const b = await bounds(); const body = await pet.locator("#pet").boundingBox();
    assert.ok(Math.abs(b.x + body.x + body.width / 2 - target.x) <= 1, "No invisible left margin");
    assert.ok(Math.abs(b.y + body.y + body.height / 2 - target.y) <= 1, "No invisible upper margin");
  }
  await pet.screenshot({ path: join(output, "upper-left-free.png") });
  async function dock(edge) {
    const b = await bounds();
    const target = edge === "left" ? { x: area.x + 2, y: center.y }
      : edge === "right" ? { x: area.x + area.width - 2, y: center.y }
      : { x: center.x, y: area.y - 10 };
    await dragVisiblePetTo(target, true);
    await pet.waitForFunction(edge => document.querySelector("#pet-root").dataset.edge === edge, edge);
    const compact = await bounds();
    assert.equal(compact.width, edge === "top" ? 68 : 32);
    assert.equal(compact.height, edge === "top" ? 32 : 68);
    assert.equal(await pet.locator("#paper-action").isVisible(), false);
    assert.equal(await pet.locator("#context-bubble").isVisible(), false);
    const saved = JSON.parse(await readFile(join(directory, "pet-position.json"), "utf8"));
    assert.equal(saved.edge, edge);
    await pet.screenshot({ path: join(output, `${edge}.png`) });
    return compact;
  }
  for (const edge of ["left", "right", "top"]) await dock(edge);
  const topBounds = await bounds();
  // Native pointer click on the exposed face must not undock or start dragging.
  await pet.mouse.click(34, 12);
  await pet.waitForTimeout(150);
  assert.deepEqual(await bounds(), topBounds);
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("/panel.html")).isVisible()), true);
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("/panel.html")).hide());
  await application.close();
  pet = await launch();
  await pet.waitForFunction(() => document.querySelector("#pet-root").dataset.edge === "top");
  assert.deepEqual(await bounds(), topBounds, "Restart restores compact edge and native bounds");
  // Real renderer pointer capture detaches the pet; resizing must not break the gesture.
  await pet.mouse.move(34, 12);
  await pet.mouse.down();
  await pet.mouse.move(120, 160, { steps: 5 });
  await pet.mouse.up();
  await pet.waitForFunction(() => document.querySelector("#pet-root").dataset.edge === "free");
  assert.equal((await bounds()).width, 304);
  assert.equal((await bounds()).height, 270);
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("/panel.html")).isVisible()), false, "Detach drag must not open panel");
  await pet.screenshot({ path: join(output, "detached.png") });
  const fullDisplay = await application.evaluate(({ screen }, point) => screen.getDisplayNearestPoint(point).bounds, center);
  // Approach the physical bottom through the empty Dock lane before releasing.
  await dragVisiblePetTo({ x: fullDisplay.x + 80, y: fullDisplay.y + fullDisplay.height - 160 });
  const approachBounds = await bounds();
  const approachBody = await pet.locator("#pet").boundingBox();
  const approachFrom = { x: approachBounds.x + approachBody.x + approachBody.width / 2, y: approachBounds.y + approachBody.y + approachBody.height / 2 };
  const approachTarget = { x: approachFrom.x, y: fullDisplay.y + fullDisplay.height - 50 };
  await pet.evaluate(({ from, to }) => {
    window.workpet.dragPet("start", from); window.workpet.dragPet("move", to);
  }, { from: approachFrom, to: approachTarget });
  await pet.waitForTimeout(100);
  const approaching = await bounds();
  const approachingBody = await pet.locator("#pet").boundingBox();
  assert.ok(Math.abs(approaching.y + approachingBody.y + approachingBody.height / 2 - approachTarget.y) <= 1,
    "Bottom approach must follow pointer through the empty Dock lane before release");
  await pet.evaluate(() => window.workpet.dragPet("end"));
  for (const x of [fullDisplay.x + 80, fullDisplay.x + fullDisplay.width - 80]) {
    await dragVisiblePetTo({ x, y: fullDisplay.y + fullDisplay.height - 1 }, true);
    await pet.waitForFunction(() => document.querySelector("#pet-root").dataset.edge === "bottom");
    assert.equal((await bounds()).y + (await bounds()).height, fullDisplay.y + fullDisplay.height);
  }
  await pet.screenshot({ path: join(output, "bottom.png") });
  const bottomBounds = await bounds();
  await application.close();
  pet = await launch();
  await pet.waitForFunction(() => document.querySelector("#pet-root").dataset.edge === "bottom");
  assert.deepEqual(await bounds(), bottomBounds, "Restart preserves physical bottom docking");
  await dragVisiblePetTo({ x: fullDisplay.x + fullDisplay.width / 2, y: fullDisplay.y + fullDisplay.height - 1 });
  assert.equal(await pet.locator("#pet-root").getAttribute("data-edge"), "free", "Dock center remains protected");
  const interruptedBounds = await bounds();
  const interruptedBody = await pet.locator("#pet").boundingBox();
  const interruptedFrom = { x: interruptedBounds.x + interruptedBody.x + interruptedBody.width / 2,
    y: interruptedBounds.y + interruptedBody.y + interruptedBody.height / 2 };
  const interruptedTarget = { x: fullDisplay.x + 80, y: fullDisplay.y + fullDisplay.height - 1 };
  await pet.evaluate(({ from, to }) => {
    window.workpet.dragPet("start", from); window.workpet.dragPet("move", to); window.workpet.dragPet("end");
  }, { from: interruptedFrom, to: interruptedTarget });
  await pet.waitForFunction(() => document.querySelector("#pet-root").dataset.settling === "true");
  await pet.evaluate(to => {
    window.workpet.dragPet("start", to);
    window.workpet.dragPet("move", { x: to.x, y: to.y - 150 });
    window.workpet.dragPet("end");
  }, interruptedTarget);
  await pet.waitForTimeout(400);
  assert.equal(await pet.locator("#pet-root").getAttribute("data-edge"), "free", "A new drag interrupts absorption without a stale timer snapping back");
  assert.equal(await pet.locator(".pet-motion-ghost").count(), 0);
  await dock("left");
  await application.evaluate(({ BrowserWindow, screen }) => {
    BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("/pet.html")).setPosition(-10000, -10000);
    screen.emit("display-removed", {}, {});
  });
  const dockRecovered = await bounds();
  const recoveredArea = await application.evaluate(({ screen }, rectangle) => screen.getDisplayMatching(rectangle).workArea, dockRecovered);
  assert.equal(dockRecovered.x, recoveredArea.x);
  assert.ok(dockRecovered.y >= recoveredArea.y);
  assert.equal(dockRecovered.width, 32);
  await application.evaluate(({ BrowserWindow, app }) => {
    BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("/pet.html")).destroy();
    app.emit("activate");
    app.emit("second-instance", {}, [], process.cwd());
  });
  const report = { destroyedWindowActivationSafe: true, passed: true, before, after, restartRestored: true, recovered,
    absorptionSamples, absorptionInterruptible: true, edgeDocking: ["left", "right", "top", "bottom"], visibleBodyBoundaries: true, bottomApproachFollowsPointer: true, bottomRestart: true, dockCenterProtected: true, compactRestart: true, nativePointerDetach: true, dockedClick: true, dockRecovered,
    unpackaged, cursor: "Playwright pointer events and placement IPC; native Electron window and renderer" };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await application?.close();
}
