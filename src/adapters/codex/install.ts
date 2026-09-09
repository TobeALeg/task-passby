import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { join } from "node:path";
const execFileAsync = promisify(execFile);

export async function installCodexIntegration(
  appPath: string,
): Promise<string> {
  const binary = "/Applications/ChatGPT.app/Contents/Resources/codex";
  const marketplace = join(appPath, "integrations", "codex-marketplace");
  let status = "installed";
  for (const args of [
    ["plugin", "marketplace", "add", marketplace, "--json"],
    ["plugin", "add", "workpet-capture@workpet-local", "--json"],
  ]) {
    try {
      await execFileAsync(binary, args, { timeout: 30000 });
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
    { timeout: 30000 },
  );
  return status;
}
