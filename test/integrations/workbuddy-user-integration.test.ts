import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { installWorkBuddyUserIntegration } from "../../dist/adapters/workbuddy/install.js";

test("WorkBuddy 用户级接入保留现有配置并可幂等安装", async () => {
  const configDirectory = await mkdtemp(join(tmpdir(), "workpet-workbuddy-"));
  await writeFile(join(configDirectory, "settings.json"), JSON.stringify({
    sandbox: { enabled: true },
    enabledPlugins: { "workpet@workpet-local": true, "other@market": true },
    hooks: {
      Stop: [{ hooks: [{ type: "command", command: "node /existing/stop.mjs" }] }]
    }
  }));
  await writeFile(join(configDirectory, ".mcp.json"), JSON.stringify({
    mcpServers: { existing: { command: "existing-mcp" } }
  }));

  const first = await installWorkBuddyUserIntegration(process.cwd(), configDirectory);
  const second = await installWorkBuddyUserIntegration(process.cwd(), configDirectory);

  const settings = JSON.parse(await readFile(join(configDirectory, "settings.json"), "utf8")) as Record<string, any>;
  const mcp = JSON.parse(await readFile(join(configDirectory, ".mcp.json"), "utf8")) as Record<string, any>;
  assert.equal(first, "installed");
  assert.equal(second, "already-installed");
  assert.deepEqual(settings.sandbox, { enabled: true });
  assert.equal(settings.enabledPlugins["other@market"], true);
  assert.equal(settings.enabledPlugins["workpet@workpet-local"], undefined);
  assert.equal(settings.hooks.Stop.length, 2);
  assert.equal(settings.hooks.UserPromptSubmit.length, 1);
  assert.equal(settings.hooks.SessionStart.length, 1);
  assert.equal(settings.hooks.SessionEnd.length, 1);
  assert.match(settings.hooks.Stop[1].hooks[0].command, /hook-proxy\.mjs/u);
  assert.deepEqual(mcp.mcpServers.existing, { command: "existing-mcp" });
  assert.equal(mcp.mcpServers.workpet.command, "node");
  assert.match(mcp.mcpServers.workpet.args[0], /mcp-proxy\.mjs/u);
});
