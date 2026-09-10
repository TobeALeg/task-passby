import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { existsSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import { AdminStore } from "../server/admin/store.mjs";

const ssh = ["-i", "/Users/dandi/Desktop/idd_tecent_dstui.pem", "-o", "IdentitiesOnly=yes", "-o", "BatchMode=yes", "ubuntu@124.223.223.215"];
const output = resolve(".worket-server/vps-admin-access.json");
if (existsSync(output)) throw new Error("管理员交付文件已存在，请检查已初始化状态，不自动覆盖。");
const local = new AdminStore(resolve(".worket-server"));
const view = local.view();
if (!view.provider.hasKey) throw new Error("请先在本机后台配置模型。");
const password = randomBytes(24).toString("base64url");
// Save before the remote request so a lost SSH response never loses administrator access.
writeFileSync(output, JSON.stringify({ url: "http://127.0.0.1:8789/admin/", password,
  tunnel: "ssh -i /Users/dandi/Desktop/idd_tecent_dstui.pem -o IdentitiesOnly=yes -N -L 8789:127.0.0.1:8788 ubuntu@124.223.223.215" }, null, 2), { mode: 0o600, flag: "wx" });
try {
  execFileSync("ssh", [...ssh, "sudo -n -u worket env WORKET_SERVER_DATA_DIR=/var/lib/worket/data /opt/worket/runtime/node /opt/worket/current/server/bootstrap.mjs"], {
    input: JSON.stringify({ adminPassword: password, serviceUrl: "https://124.223.223.215",
      provider: { ...view.provider, apiKey: local.apiKey() } }),
    stdio: ["pipe", "pipe", "pipe"],
  });
} catch {
  throw new Error("远程初始化未确认，请检查服务端状态；管理员交付文件已保留，未输出密钥。");
}
console.log(`后台配置完成。管理员凭据仅保存在 ${output}`);
