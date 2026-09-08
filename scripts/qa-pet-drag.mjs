import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { _electron } from "playwright";

const directory = await mkdtemp(join(tmpdir(), "worket-drag-qa-"));
const options = {
  executablePath: join(process.cwd(), "release/Worket-darwin-arm64/Worket.app/Contents/MacOS/Worket"),
  args: [`--user-data-dir=${directory}`],
  env: { ...process.env, WORKPET_DATA_DIR: directory, WORKPET_BRIDGE_CONFIG: join(directory, "bridge.json") }
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
  await application.evaluate(({ BrowserWindow, app }) => {
    BrowserWindow.getAllWindows().find(w => w.webContents.getURL().endsWith("/pet.html")).destroy();
    app.emit("activate");
    app.emit("second-instance", {}, [], process.cwd());
  });
  console.log(JSON.stringify({ destroyedWindowActivationSafe: true, passed: true, before, after, restartRestored: true, recovered, cursor: "Playwright pointer events; native window and renderer" }, null, 2));
} finally {
  await application?.close();
}
