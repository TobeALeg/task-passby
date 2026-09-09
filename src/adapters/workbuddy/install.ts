import { randomUUID } from "node:crypto";
import { cp, mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

type JsonObject = Record<string, unknown>;

const WORKPET_PLUGIN_KEY = "workpet@workpet-local";
const WORKPET_HOOK_EVENTS = [
  "SessionStart",
  "UserPromptSubmit",
  "Stop",
  "SessionEnd",
] as const;

async function readJsonObject(path: string): Promise<JsonObject> {
  try {
    const parsed: unknown = JSON.parse(await readFile(path, "utf8"));
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed))
      throw new Error(`配置文件不是 JSON object: ${path}`);
    return parsed as JsonObject;
  } catch (error) {
    if (
      typeof error === "object" &&
      error &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return {};
    throw error;
  }
}

async function writeJsonAtomic(path: string, value: JsonObject): Promise<void> {
  const temporaryPath = `${path}.${randomUUID()}.tmp`;
  await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
    mode: 0o600,
  });
  await rename(temporaryPath, path);
}

function record(value: unknown): JsonObject {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonObject)
    : {};
}

function hookCommand(appPath: string): string {
  const proxy = join(
    appPath,
    "integrations",
    "workbuddy-marketplace",
    "plugins",
    "workpet",
    "bridge",
    "hook-proxy.mjs",
  );
  return `node ${JSON.stringify(proxy)}`;
}

function isWorkPetHook(value: unknown): boolean {
  return JSON.stringify(value).includes(
    "/plugins/workpet/bridge/hook-proxy.mjs",
  );
}

function hasHookCommand(value: unknown, command: string): boolean {
  const entry = record(value);
  const commands = Array.isArray(entry.hooks) ? entry.hooks : [];
  return commands.some((hook) => record(hook).command === command);
}

/**
 * WorkBuddy 5.4.7 的目录型 marketplace 会误报安装成功但不写 cache registry。
 * 用户级 MCP 与 Hook 是 WorkBuddy 官方支持的同等接入点，且更适合本地 MVP。
 */
export async function installWorkBuddyUserIntegration(
  appPath: string,
  configDirectory = join(homedir(), ".workbuddy"),
): Promise<"installed" | "already-installed"> {
  await mkdir(configDirectory, { recursive: true });
  const extensionDirectory = join(
    configDirectory,
    "extensions",
    "worket-capture",
  );
  await mkdir(extensionDirectory, { recursive: true });
  await cp(
    join(appPath, "integrations", "workbuddy-extension"),
    extensionDirectory,
    { recursive: true },
  );
  const settingsPath = join(configDirectory, "settings.json");
  const mcpPath = join(configDirectory, ".mcp.json");
  const settings = await readJsonObject(settingsPath);
  const mcp = await readJsonObject(mcpPath);
  const command = hookCommand(appPath);
  const mcpProxy = join(
    appPath,
    "integrations",
    "workbuddy-marketplace",
    "plugins",
    "workpet",
    "bridge",
    "mcp-proxy.mjs",
  );

  const hooks = record(settings.hooks);
  const enabledPlugins = record(settings.enabledPlugins);
  const mcpServers = record(mcp.mcpServers);
  const expectedMcp = { command: "node", args: [mcpProxy] };
  const alreadyInstalled =
    WORKPET_HOOK_EVENTS.every((event) => {
      const entries = Array.isArray(hooks[event]) ? hooks[event] : [];
      const workPetEntries = entries.filter((entry) => isWorkPetHook(entry));
      return (
        workPetEntries.length === 1 &&
        hasHookCommand(workPetEntries[0], command)
      );
    }) &&
    JSON.stringify(mcpServers.workpet) === JSON.stringify(expectedMcp) &&
    !(WORKPET_PLUGIN_KEY in enabledPlugins);

  for (const event of WORKPET_HOOK_EVENTS) {
    const entries = Array.isArray(hooks[event])
      ? (hooks[event] as unknown[])
      : [];
    hooks[event] = [
      ...entries.filter((entry) => !isWorkPetHook(entry)),
      {
        hooks: [
          {
            type: "command",
            command,
            description: "只把已由用户交接给 Worket 的会话写回本地 WorkRecord",
            timeout: 10,
          },
        ],
      },
    ];
  }
  delete enabledPlugins[WORKPET_PLUGIN_KEY];
  settings.hooks = hooks;
  settings.enabledPlugins = enabledPlugins;
  mcpServers.workpet = expectedMcp;
  mcp.mcpServers = mcpServers;

  if (!alreadyInstalled) {
    await writeJsonAtomic(settingsPath, settings);
    await writeJsonAtomic(mcpPath, mcp);
  }
  return alreadyInstalled ? "already-installed" : "installed";
}
