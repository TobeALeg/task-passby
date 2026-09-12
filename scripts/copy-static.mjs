import { access, cp, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const source = new URL("../src/renderer", import.meta.url);
const target = new URL("../dist/renderer", import.meta.url);
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
await cp(new URL("../src/preload.cjs", import.meta.url), new URL("../dist/preload.cjs", import.meta.url));

if (process.platform === "darwin") {
  await execFileAsync("xcrun", [
    "clang",
    "-fobjc-arc",
    new URL("../src/adapters/foreground/macos-context.m", import.meta.url).pathname,
    "-framework",
    "Cocoa",
    "-framework",
    "CoreGraphics",
    "-o",
    new URL("../dist/foreground-context", import.meta.url).pathname,
  ]);
} else if (process.platform === "win32") {
  const candidates = [
    join(process.env.WINDIR ?? "C:\\Windows", "Microsoft.NET", "Framework64", "v4.0.30319", "csc.exe"),
    join(process.env.WINDIR ?? "C:\\Windows", "Microsoft.NET", "Framework", "v4.0.30319", "csc.exe"),
  ];
  let compiler;
  for (const candidate of candidates) {
    try {
      await access(candidate);
      compiler = candidate;
      break;
    } catch {
      // Try the 32-bit framework compiler next.
    }
  }
  if (!compiler) throw new Error("未找到 Windows C# 编译器，无法构建前台窗口识别助手");
  await execFileAsync(compiler, [
    "/nologo",
    "/optimize+",
    "/target:exe",
    `/out:${fileURLToPath(new URL("../dist/foreground-context.exe", import.meta.url))}`,
    fileURLToPath(new URL("../src/adapters/foreground/windows-context.cs", import.meta.url)),
  ]);
}
