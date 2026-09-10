import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AdminStore } from "../server/admin/store.mjs";

const ssh = ["-i", "/Users/dandi/Desktop/idd_tecent_dstui.pem", "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "ubuntu@124.223.223.215"];
const output = resolve(".worket-server/vps-admin-access.json");
const adminOnly = process.argv.includes("--admin-only");
const modelOnly = process.argv.includes("--allow-model-key-transfer");
if (adminOnly === modelOnly) throw new Error("选择 --admin-only；模型密钥迁移获得用户明确授权后使用 --allow-model-key-transfer。");
let input;
if (adminOnly) {
  if (existsSync(output)) throw new Error("管理员交付文件已存在，不自动覆盖。");
  const password = randomBytes(24).toString("base64url");
  // Save before SSH so a lost response never loses administrator access.
  writeFileSync(output, JSON.stringify({ url: "http://127.0.0.1:8789/admin/", password,
    tunnel: "ssh -i /Users/dandi/Desktop/idd_tecent_dstui.pem -o IdentitiesOnly=yes -N -L 8789:127.0.0.1:8788 ubuntu@124.223.223.215" }, null, 2), { mode: 0o600, flag: "wx" });
  input = { adminPassword: password };
} else {
  const local = new AdminStore(resolve(".worket-server"));
  const view = local.view();
  if (!view.provider.hasKey) throw new Error("请先在本机后台配置模型。");
  input = { serviceUrl: "https://124.223.223.215", provider: { ...view.provider, apiKey: local.apiKey() } };
}
try {
  execFileSync("ssh", [...ssh, "sudo -n -u worket env WORKET_SERVER_DATA_DIR=/var/lib/worket/data /opt/worket/runtime/node /opt/worket/current/server/bootstrap.mjs"], {
    input: JSON.stringify(input),
    stdio: ["pipe", "pipe", "pipe"],
  });
} catch {
  throw new Error("远程初始化未确认，请检查服务端状态；管理员交付文件已保留，未输出密钥。");
}
console.log(adminOnly ? `管理员配置完成，凭据仅保存在 ${output}` : "模型配置已通过 SSH 安全保存到 VPS。");
