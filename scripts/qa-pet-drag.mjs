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
  assert.deepEqual(JSON.parse(await readFile(join(directory, "pet-position.json"), "utf8")), { x: after.x, y: after.y });
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
  async function dock(edge) {
    const b = await bounds();
    const target = edge === "left" ? { x: area.x + 2, y: center.y }
      : edge === "right" ? { x: area.x + area.width - 2, y: center.y }
      : { x: center.x, y: area.y - 10 };
    await pet.evaluate(({ from, to }) => {
      window.workpet.dragPet("start", from);
      window.workpet.dragPet("move", to);
      window.workpet.dragPet("end");
    }, { from: { x: b.x + b.width / 2, y: b.y + b.height / 2 }, to: target });
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
  await pet.mouse.click(34, 20);
  await pet.waitForTimeout(150);
  assert.deepEqual(await bounds(), topBounds);
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("/panel.html")).isVisible()), true);
  await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("/panel.html")).hide());
  await application.close();
  pet = await launch();
  await pet.waitForFunction(() => document.querySelector("#pet-root").dataset.edge === "top");
  assert.deepEqual(await bounds(), topBounds, "Restart restores compact edge and native bounds");
  // Real renderer pointer capture detaches the pet; resizing must not break the gesture.
  await pet.mouse.move(34, 20);
  await pet.mouse.down();
  await pet.mouse.move(120, 160, { steps: 5 });
  await pet.mouse.up();
  await pet.waitForFunction(() => document.querySelector("#pet-root").dataset.edge === "free");
  assert.equal((await bounds()).width, 304);
  assert.equal((await bounds()).height, 270);
  assert.equal(await application.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("/panel.html")).isVisible()), false, "Detach drag must not open panel");
  await pet.screenshot({ path: join(output, "detached.png") });
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
    edgeDocking: ["left", "right", "top"], compactRestart: true, nativePointerDetach: true, dockedClick: true, dockRecovered,
    unpackaged, cursor: "Playwright pointer events and placement IPC; native Electron window and renderer" };
  await writeFile(join(output, "report.json"), JSON.stringify(report, null, 2));
  console.log(JSON.stringify(report, null, 2));
} finally {
  await application?.close();
}
