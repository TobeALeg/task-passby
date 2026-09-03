import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);

try {
  const payload = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  const configPath = process.env.WORKPET_BRIDGE_CONFIG || join(homedir(), ".workpet", "bridge.json");
  const config = JSON.parse(await readFile(configPath, "utf8"));
  if (config.host !== "127.0.0.1") throw new Error("Worket bridge 只能使用 loopback");
  const response = await fetch(`http://${config.host}:${config.port}/hooks/codex`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-WorkPet-Token": config.token },
    body: JSON.stringify(payload)
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  process.stdout.write(JSON.stringify({ continue: true }));
} catch (error) {
  process.stderr.write(`Worket Codex hook 未同步：${error instanceof Error ? error.message : String(error)}\n`);
  process.stdout.write(JSON.stringify({ continue: true }));
}
