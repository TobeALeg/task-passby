import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { AppUpdates, updateFeed } from "../../src/desktop/app-updates.ts";

function harness(enabled = true) {
  const emitter = new EventEmitter();
  let checks = 0;
  let installs = 0;
  let response = 0;
  const messages: string[] = [];
  let prepare: () => Promise<void> = async () => {};
  const updater = Object.assign(emitter, {
    setFeedURL: () => {}, checkForUpdates: () => { checks++; },
    quitAndInstall: () => { installs++; },
  });
  const updates = new AppUpdates({ enabled, updater: updater as never,
    version: "0.1.1", arch: "arm64",
    beforeInstall: () => prepare(),
    showDialog: async (options) => {
      messages.push(options.message);
      return { response, checkboxChecked: false };
    },
  });
  return { updates, emitter, messages, checks: () => checks, installs: () => installs,
    choose: (value: number) => { response = value; },
    prepare: (fn: () => Promise<void>) => { prepare = fn; },
  };
}
const settle = () => new Promise(resolve => setImmediate(resolve));

test("feed identifies repository, architecture and installed version", () => {
  assert.equal(updateFeed("0.1.1", "arm64"), "https://update.electronjs.org/TobeALeg/worket/darwin-arm64/0.1.1");
});
test("development build does not contact update service", async () => {
  const h = harness(false); h.updates.start(); h.updates.check(true);
  await settle(); assert.equal(h.checks(), 0); assert.equal(h.messages.length, 1);
});
test("concurrent checks are coalesced, network error permits retry", async () => {
  const h = harness(); h.updates.check(); h.updates.check();
  assert.equal(h.checks(), 1);
  h.emitter.emit("error", new Error("offline"));
  assert.equal(h.messages.length, 0);
  h.updates.check(true); h.emitter.emit("error", new Error("offline"));
  await settle(); assert.equal(h.checks(), 2); assert.equal(h.messages[0], "更新失败");
  h.updates.check(true); assert.equal(h.checks(), 3);
});
test("later keeps app running; retrying downloaded update waits for capture before install", async () => {
  const h = harness(); h.emitter.emit("update-downloaded");
  await settle(); assert.equal(h.installs(), 0);
  let finish!: () => void;
  h.prepare(() => new Promise<void>(resolve => { finish = resolve; }));
  h.choose(1); h.updates.check(true); await settle();
  assert.equal(h.installs(), 0); assert.equal(h.checks(), 0);
  h.updates.check(true); finish(); await settle();
  assert.equal(h.installs(), 1);
});
test("failed preparation does not quit the app", async () => {
  const h = harness(); h.choose(1);
  h.prepare(async () => { throw new Error("capture failed"); });
  h.emitter.emit("update-downloaded"); await settle();
  assert.equal(h.installs(), 0); assert.ok(h.messages.includes("暂时无法重启更新"));
});
