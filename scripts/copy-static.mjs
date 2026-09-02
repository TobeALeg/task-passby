import { cp, mkdir } from "node:fs/promises";

const source = new URL("../src/renderer", import.meta.url);
const target = new URL("../dist/renderer", import.meta.url);
await mkdir(target, { recursive: true });
await cp(source, target, { recursive: true });
await cp(new URL("../src/preload.cjs", import.meta.url), new URL("../dist/preload.cjs", import.meta.url));
