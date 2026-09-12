import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
import { CODEX_BINARY_CANDIDATES, findCodexBinary } from "./app-server-client.js";
const execFileAsync = promisify(execFile);
const commandOptions = {
  timeout: 30000,
  env: {
    ...process.env,
    ...(process.platform === "win32" && !process.env.HOME
      ? { HOME: process.env.USERPROFILE }
      : {}),
  },
};

export async function installCodexIntegration(
  appPath: string,
): Promise<string> {
  const binary = await findCodexBinary(CODEX_BINARY_CANDIDATES);
  const marketplace = join(appPath, "integrations", "codex-marketplace");
  let status = "installed";
  for (const args of [
    ["plugin", "marketplace", "add", marketplace, "--json"],
    ["plugin", "add", "workpet-capture@workpet-local", "--json"],
  ]) {
    try {
      await execFileAsync(binary, args, commandOptions);
    } catch (error) {
      const message =
        typeof error === "object" && error && "stderr" in error
          ? String(error.stderr)
          : String(error);
      if (!/(already|exists|installed|已存在|已安装)/iu.test(message))
        throw error;
      status = "already-installed";
    }
  }
  await execFileAsync(
    binary,
    [
      "mcp",
      "add",
      "worket",
      "--",
      "node",
      join(
        appPath,
        "integrations",
        "workbuddy-marketplace",
        "plugins",
        "workpet",
        "bridge",
        "mcp-proxy.mjs",
      ),
    ],
    commandOptions,
  );
  return status;
}
