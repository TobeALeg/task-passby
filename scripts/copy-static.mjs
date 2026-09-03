import { cp, mkdir } from "node:fs/promises";
import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

const source = new URL("../src/renderer", import.meta.url);
const target = new URL("../dist/renderer", import.meta.url);
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
await cp(new URL("../src/preload.cjs", import.meta.url), new URL("../dist/preload.cjs", import.meta.url));
await execFileAsync("xcrun", [
  "clang",
  "-fobjc-arc",
  new URL("../src/adapters/foreground/macos-context.m", import.meta.url).pathname,
  "-framework",
  "Cocoa",
  "-framework",
  "CoreGraphics",
  "-o",
  new URL("../dist/foreground-context", import.meta.url).pathname
]);
