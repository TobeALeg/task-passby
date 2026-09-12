import { execFileSync } from "node:child_process";
import { join } from "node:path";

const dev = process.argv.includes("--dev");
const target = process.platform === "darwin" ? "mac" : process.platform === "win32" ? "win" : null;
if (!target) throw new Error(`Worket 桌面版暂不支持 ${process.platform}`);
execFileSync("npm", ["run", `package:${target}`], {
  stdio: "inherit",
  shell: process.platform === "win32",
});
const executable = process.platform === "darwin"
  ? join("release", "Worket-darwin-arm64", "Worket.app", "Contents", "MacOS", "Worket")
  : join("release", "Worket-win32-x64", "Worket.exe");
execFileSync(executable, dev ? ["--dev"] : [], { stdio: "inherit" });
