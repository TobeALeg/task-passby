import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const run = (command, args) => execFileSync(command, args, { stdio: "inherit" });
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("需要 macOS arm64 构建机");
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("自动更新只发布稳定版，请使用 x.y.z 版本号");
if (execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim())
  throw new Error("发布前请提交工作区改动，确保安装包可追溯到提交");
run("npm", ["test"]);
run("npm", ["run", "package:mac"]);
const app = "release/Worket-darwin-arm64/Worket.app";
// Ad-hoc signing preserves Electron metadata; this is not Apple notarization.
run("codesign", ["--force", "--deep", "--sign", "-", "--timestamp=none",
  "--preserve-metadata=identifier,entitlements,requirements,flags,runtime", app]);
run("codesign", ["--verify", "--deep", "--strict", app]);
const archive = `release/Worket-${version}-darwin-arm64.zip`;
rmSync(archive, { force: true });
run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, archive]);
const extracted = mkdtempSync(join(tmpdir(), "worket-release-"));
try {
  run("ditto", ["-x", "-k", archive, extracted]);
  const finalApp = join(extracted, "Worket.app");
  run("codesign", ["--verify", "--deep", "--strict", finalApp]);
  for (const script of ["scripts/qa-electron.mjs", "scripts/qa-updates.mjs"])
    execFileSync("node", [script], {
    stdio: "inherit", env: { ...process.env,
      WORKPET_EXECUTABLE_PATH: join(finalApp, "Contents/MacOS/Worket"),
    },
  });
} finally { rmSync(extracted, { recursive: true, force: true }); }
const checksum = createHash("sha256").update(readFileSync(archive)).digest("hex");
writeFileSync(`${archive}.sha256`, `${checksum}  ${archive.split("/").at(-1)}\n`);
console.log(`已验证：${archive}。按 README 创建草稿 Release，完成跨版本验收后发布。`);
