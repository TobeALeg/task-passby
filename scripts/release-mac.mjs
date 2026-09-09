import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { sign } from "@electron/osx-sign";
import { notarize } from "@electron/notarize";

const run = (command, args) => execFileSync(command, args, { stdio: "inherit" });
const { version } = JSON.parse(readFileSync("package.json", "utf8"));
const identity = process.env.WORKET_SIGN_IDENTITY;
const keychainProfile = process.env.WORKET_NOTARY_PROFILE;
if (process.platform !== "darwin" || process.arch !== "arm64") throw new Error("需要 macOS arm64 构建机");
if (!/^\d+\.\d+\.\d+$/.test(version)) throw new Error("自动更新只发布稳定版，请使用 x.y.z 版本号");
if (!identity?.startsWith("Developer ID Application:") || !keychainProfile)
  throw new Error("请设置 WORKET_SIGN_IDENTITY（Developer ID Application）和 WORKET_NOTARY_PROFILE（钥匙串公证凭据名称）");
if (execFileSync("git", ["status", "--porcelain"], { encoding: "utf8" }).trim())
  throw new Error("发布前请提交工作区改动，确保安装包可追溯到提交");
run("npm", ["test"]);
run("npm", ["run", "package:mac"]);
const app = "release/Worket-darwin-arm64/Worket.app";
writeFileSync(join(app, "Contents/Resources/worket-update-enabled.json"), JSON.stringify({ version }));
await sign({ app, identity, platform: "darwin", type: "distribution",
  optionsForFile: () => ({ hardenedRuntime: true }),
});
// osx-sign recursively signs Mach-O resources as well as Electron helper bundles.
run("codesign", ["--verify", "--deep", "--strict", app]);
await notarize({ appPath: app, keychainProfile });
run("xcrun", ["stapler", "validate", app]);
run("spctl", ["--assess", "--type", "execute", "--verbose=2", app]);
const archive = `release/Worket-${version}-darwin-arm64.zip`;
rmSync(archive, { force: true });
run("ditto", ["-c", "-k", "--sequesterRsrc", "--keepParent", app, archive]);
const extracted = mkdtempSync(join(tmpdir(), "worket-release-"));
try {
  run("ditto", ["-x", "-k", archive, extracted]);
  const finalApp = join(extracted, "Worket.app");
  run("codesign", ["--verify", "--deep", "--strict", finalApp]);
  run("xcrun", ["stapler", "validate", finalApp]);
  execFileSync("node", ["scripts/qa-electron.mjs"], {
    stdio: "inherit", env: { ...process.env,
      WORKPET_EXECUTABLE_PATH: join(finalApp, "Contents/MacOS/Worket"),
    },
  });
} finally { rmSync(extracted, { recursive: true, force: true }); }
const checksum = createHash("sha256").update(readFileSync(archive)).digest("hex");
writeFileSync(`${archive}.sha256`, `${checksum}  ${archive.split("/").at(-1)}\n`);
console.log(`已验证：${archive}。按 README 创建草稿 Release，完成跨版本验收后发布。`);
