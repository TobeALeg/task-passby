import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";

const run = (command, args, options = {}) =>
  execFileSync(command, args, { stdio: "inherit", ...options });
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
if (process.platform !== "win32" || process.arch !== "x64")
  throw new Error("需要 Windows x64 构建机");
if (!/^\d+\.\d+\.\d+$/.test(version))
  throw new Error("自动更新只发布稳定版，请使用 x.y.z 版本号");
if (execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim())
  throw new Error("发布前请提交工作区改动，确保安装包可追溯到提交");

run("npm", ["test"], { shell: true });
run("npm", ["run", "package:win"], { shell: true });
const directory = resolve("release", "Worket-win32-x64");
const archive = resolve("release", `Worket-${version}-win32-x64.zip`);
rmSync(archive, { force: true });
run("powershell.exe", [
  "-NoProfile",
  "-NonInteractive",
  "-Command",
  "Compress-Archive -LiteralPath $env:WORKET_ARCHIVE_SOURCE -DestinationPath $env:WORKET_ARCHIVE_TARGET -CompressionLevel Optimal",
], {
  env: {
    ...process.env,
    WORKET_ARCHIVE_SOURCE: directory,
    WORKET_ARCHIVE_TARGET: archive,
  },
});
const extracted = mkdtempSync(join(tmpdir(), "worket-release-"));
try {
  run("powershell.exe", [
    "-NoProfile",
    "-NonInteractive",
    "-Command",
    "Expand-Archive -LiteralPath $env:WORKET_ARCHIVE_SOURCE -DestinationPath $env:WORKET_ARCHIVE_TARGET",
  ], {
    env: {
      ...process.env,
      WORKET_ARCHIVE_SOURCE: archive,
      WORKET_ARCHIVE_TARGET: extracted,
    },
  });
  const executable = join(extracted, "Worket-win32-x64", "Worket.exe");
  for (const script of ["scripts/qa-electron.mjs", "scripts/qa-updates.mjs"])
    run("node", [script], {
      env: { ...process.env, WORKPET_EXECUTABLE_PATH: executable },
    });
} finally {
  rmSync(extracted, { recursive: true, force: true });
}
const checksum = createHash("sha256").update(readFileSync(archive)).digest("hex");
writeFileSync(`${archive}.sha256`, `${checksum}  Worket-${version}-win32-x64.zip\n`);
console.log(`已验证：${archive}。Windows 包未进行代码签名，发布前需明确 SmartScreen 提示。`);
