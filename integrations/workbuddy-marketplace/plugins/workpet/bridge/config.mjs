import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";

export async function readBridgeConfig() {
  const path = process.env.WORKPET_BRIDGE_CONFIG || join(homedir(), ".workpet", "bridge.json");
  const parsed = JSON.parse(await readFile(path, "utf8"));
  if (parsed.host !== "127.0.0.1" || !Number.isInteger(parsed.port) || typeof parsed.token !== "string") {
    throw new Error("Worket bridge 配置无效");
  }
  return parsed;
}

export async function postToWorkPet(path, body) {
  const config = await readBridgeConfig();
  const response = await fetch(`http://${config.host}:${config.port}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "X-WorkPet-Token": config.token },
    body: JSON.stringify(body)
  });
  if (!response.ok) throw new Error(`Worket bridge 返回 HTTP ${response.status}`);
  if (response.status === 204) return null;
  return response.json();
}
