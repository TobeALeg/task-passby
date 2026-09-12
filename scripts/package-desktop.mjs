import { packager } from "@electron/packager";
import { resolve } from "node:path";

const argument = (name) => {
  const prefix = `--${name}=`;
  return process.argv.find((value) => value.startsWith(prefix))?.slice(prefix.length);
};

const platform = argument("platform") ?? process.platform;
const arch = argument("arch") ?? process.arch;
if (!["darwin", "win32"].includes(platform))
  throw new Error(`Worket 桌面包暂不支持 ${platform}`);
if (platform === "darwin" && arch !== "arm64")
  throw new Error("当前 macOS 发布目标仅支持 arm64");
if (platform === "win32" && arch !== "x64")
  throw new Error("当前 Windows 发布目标仅支持 x64");

const options = {
  dir: ".",
  name: "Worket",
  executableName: "Worket",
  platform,
  arch,
  out: "release",
  overwrite: true,
  prune: true,
  asar: {
    unpackDir: "integrations",
  },
  extraResource: [
    resolve("assets", "WorkPet.png"),
    resolve(
      "dist",
      platform === "win32" ? "foreground-context.exe" : "foreground-context",
    ),
  ],
  icon: resolve("assets", platform === "darwin" ? "WorkPet.icns" : "WorkPet.ico"),
  ignore: [
    /^\/(?:experiments|research|test|output|release|server)(?:$|\/)/u,
    /^\/\.worket-server(?:$|\/)/u,
  ],
  ...(platform === "darwin"
    ? { appBundleId: "dev.workpet.desktop" }
    : {
        win32metadata: {
          CompanyName: "Worket",
          FileDescription: "Worket desktop",
          InternalName: "Worket",
          OriginalFilename: "Worket.exe",
          ProductName: "Worket",
        },
      }),
};

const paths = await packager(options);
for (const path of paths) console.log(`已生成：${path}`);
