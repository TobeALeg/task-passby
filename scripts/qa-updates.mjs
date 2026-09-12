import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { _electron as electron } from "playwright";

const directory = await mkdtemp(join(tmpdir(), "worket-updates-qa-"));
const archive = Buffer.from("Worket synthetic update download QA");
const platform = process.platform === "win32" ? "win32" : "darwin";
const arch = process.platform === "win32" ? "x64" : "arm64";
const name = `Worket-99.0.0-${platform}-${arch}.zip`;
const sha = createHash("sha256").update(archive).digest("hex");
let downloads = 0;
const server = createServer((request, response) => {
  if (request.url?.endsWith("/latest")) {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ tag_name: "v99.0.0", draft: false, prerelease: false,
      assets: [name, `${name}.sha256`].map(filename => ({ name: filename, size: archive.length,
        browser_download_url: `https://github.com/TobeALeg/worket/releases/download/v99.0.0/${filename}`,
      })),
    }));
  } else if (request.url?.endsWith(".sha256")) response.end(`${sha}  ${name}\n`);
  else { downloads++; response.end(archive); }
});
await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
const address = server.address();
let desktop;
try {
  desktop = await electron.launch({
    executablePath: process.env.WORKPET_EXECUTABLE_PATH ??
      (process.platform === "win32"
        ? join(process.cwd(), "release/Worket-win32-x64/Worket.exe")
        : join(process.cwd(), "release/Worket-darwin-arm64/Worket.app/Contents/MacOS/Worket")),
    args: [
      "--dev",
      `--user-data-dir=${directory}`,
      ...(process.platform === "win32" ? ["--disable-gpu", "--no-sandbox"] : []),
    ],
    env: { ...process.env, WORKPET_SKIP_INTEGRATIONS: "1", WORKPET_DATA_DIR: directory,
      WORKPET_BRIDGE_CONFIG: join(directory, "bridge.json") },
  });
  const result = await desktop.evaluate(async ({ app, net, Menu }, { directory, base }) => {
    const require = process.getBuiltinModule("module").createRequire(`${app.getAppPath()}/package.json`);
    const { AppUpdates } = require("./dist/desktop/app-updates.js");
    const { latestRelease, downloadRelease } = require("./dist/desktop/github-release.js");
    const messages = [];
    const revealed = [];
    let choice = 0;
    const fetcher = (url, init) => net.fetch(base + new URL(url).pathname, init);
    const updates = new AppUpdates({ enabled: true, version: app.getVersion(),
      latest: () => latestRelease(fetcher, app.getVersion(), process.platform, process.arch),
      platform: process.platform,
      download: release => downloadRelease(fetcher, release, directory),
      showDialog: async options => { messages.push(options); return { response: choice }; },
      reveal: path => revealed.push(path),
    });
    await updates.check(true);
    const beforeConsent = revealed.length;
    choice = 1;
    await updates.check(true);
    await updates.check(true);
    return { messages, revealed, beforeConsent,
      menu: Menu.getApplicationMenu()?.items[0]?.submenu?.items.some(item => item.label === "检查更新…"),
    };
  }, { directory, base: `http://127.0.0.1:${address.port}` });
  assert.equal(result.menu, true);
  assert.equal(result.beforeConsent, 0);
  assert.equal(downloads, 1);
  assert.equal(result.revealed.length, 2);
  assert.equal(result.revealed[0], result.revealed[1]);
  assert.deepEqual(await readFile(result.revealed[0]), archive);
  assert.ok(result.messages.some(message => message.message === "新版已下载"));
  assert.ok(result.messages.every(message => !message.buttons?.includes("重启更新")));
  console.log("PASS: packaged Electron menu, consent, HTTP download, checksum, reuse and manual replacement text");
  console.log("Native dialog choices and file reveal are intercepted; no application is replaced.");
} finally {
  await desktop?.close();
  await new Promise(resolve => server.close(resolve));
  await rm(directory, { recursive: true, force: true });
}
