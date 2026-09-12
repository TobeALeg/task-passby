import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readdir, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { AppUpdates } from "../../src/desktop/app-updates.ts";
import { isNewer, latestRelease, downloadRelease } from "../../src/desktop/github-release.ts";

const bytes = Buffer.from("synthetic archive");
const name = "Worket-0.2.0-darwin-arm64.zip";
const asset = (name: string) => ({ name, size: bytes.length,
  browser_download_url: `https://github.com/TobeALeg/worket/releases/download/v0.2.0/${name}` });
const release = { version: "0.2.0", archive: asset(name), checksum: asset(`${name}.sha256`) };
const metadata = { tag_name: "v0.2.0", draft: false, prerelease: false, assets: [release.archive, release.checksum] };
const json = (value: unknown) => new Response(JSON.stringify(value));
const sha = createHash("sha256").update(bytes).digest("hex");

test("stable numeric version comparison rejects downgrade and prerelease", () => {
  assert.equal(isNewer("0.10.0", "0.9.0"), true);
  for (const version of ["0.1.0", "0.0.9", "0.2.0-beta.1", "bad"]) assert.equal(isNewer(version, "0.1.0"), false);
});
test("release selection excludes prerelease, missing/wrong architecture and foreign URL", async () => {
  assert.equal((await latestRelease(async () => json(metadata), "0.1.0", "darwin", "arm64"))?.version, "0.2.0");
  assert.equal(await latestRelease(async () => json({ ...metadata, prerelease: true }), "0.1.0", "darwin", "arm64"), null);
  assert.equal(await latestRelease(async () => new Response(null, { status: 404 }), "0.1.0", "darwin", "arm64"), null);
  await assert.rejects(latestRelease(async () => json(metadata), "0.1.0", "darwin", "x64"), /缺少/);
  await assert.rejects(latestRelease(async () => json({ ...metadata, assets: [release.archive] }), "0.1.0", "darwin", "arm64"), /缺少/);
  await assert.rejects(latestRelease(async () => json({ ...metadata, assets: [{ ...release.archive, browser_download_url: "https://example.com/app.zip" }, release.checksum] }), "0.1.0", "darwin", "arm64"), /地址/);
});

test("release selection supports Windows portable packages", async () => {
  const windowsName = "Worket-0.2.0-win32-x64.zip";
  const windows = {
    ...metadata,
    assets: [asset(windowsName), asset(`${windowsName}.sha256`)],
  };
  assert.equal(
    (await latestRelease(async () => json(windows), "0.1.0", "win32", "x64"))?.archive.name,
    windowsName,
  );
  assert.equal(await latestRelease(async () => json(windows), "0.1.0", "linux", "x64"), null);
});
test("streamed download verifies size and checksum and removes failed files", async () => {
  const directory = await mkdtemp(join(tmpdir(), "worket-download-test-"));
  try {
    const fetcher = async (url: string) => url.endsWith(".sha256") ? new Response(`${sha}  ${name}\n`) : new Response(bytes);
    const path = await downloadRelease(fetcher, release, directory);
    assert.deepEqual(await readFile(path), bytes);
    const before = await readdir(directory);
    await assert.rejects(downloadRelease(async url => url.endsWith(".sha256") ? new Response(`${"0".repeat(64)}  ${name}`) : new Response(bytes), release, directory), /校验失败/);
    assert.deepEqual(await readdir(directory), before);
    await assert.rejects(downloadRelease(async url => url.endsWith(".sha256") ? new Response(`${sha}  ${name}`) : new Response("truncated"), release, directory), /校验失败/);
    assert.deepEqual(await readdir(directory), before);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
function harness(enabled = true) {
  const messages: string[] = [];
  const revealed: string[] = [];
  let choice = 0;
  let downloads = 0;
  let checks = 0;
  let source: () => Promise<typeof release | null> = async () => release;
  const updates = new AppUpdates({ enabled, version: "0.1.0",
    latest: () => { checks++; return source(); },
    download: async () => { downloads++; return "/tmp/worket-fake.zip"; },
    reveal: path => { revealed.push(path); },
    showDialog: async options => { messages.push(options.message); return { response: choice, checkboxChecked: false }; },
  });
  return { updates, messages, revealed, choose: (value: number) => { choice = value; },
    source: (value: typeof source) => { source = value; }, downloads: () => downloads, checks: () => checks };
}
test("developer mode never checks and dismissing a release never downloads", async () => {
  const dev = harness(false); dev.updates.start(); await dev.updates.check(true); assert.equal(dev.checks(), 0);
  const h = harness(); await h.updates.check(); await h.updates.check();
  assert.equal(h.downloads(), 0); assert.equal(h.messages.length, 1);
  await h.updates.check(true); assert.equal(h.messages.length, 2);
});
test("only explicit download consent downloads and reveals archive", async () => {
  const h = harness(); h.choose(1); await h.updates.check();
  assert.equal(h.downloads(), 1); assert.deepEqual(h.revealed, ["/tmp/worket-fake.zip"]);
  assert.ok(h.messages.includes("新版已下载"));
});
test("duplicate checks coalesce and failures permit retries; background errors stay quiet", async () => {
  const h = harness(); let finish!: (value: null) => void;
  h.source(() => new Promise(resolve => { finish = resolve; }));
  const first = h.updates.check(); await h.updates.check(true); assert.equal(h.checks(), 1);
  finish(null); await first;
  h.source(async () => { throw new Error("offline"); });
  h.messages.length = 0; await h.updates.check(); assert.equal(h.messages.length, 0);
  await h.updates.check(true); assert.deepEqual(h.messages, ["更新失败"]);
  h.source(async () => null); await h.updates.check(true); assert.equal(h.messages.at(-1), "暂无可用更新");
});
