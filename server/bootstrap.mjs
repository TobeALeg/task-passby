// Run once over SSH with configuration supplied on stdin, never command-line secrets.
import { AdminStore } from "./admin/store.mjs";
import { resolve } from "node:path";
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = JSON.parse(Buffer.concat(chunks));
const store = new AdminStore(resolve(process.env.WORKET_SERVER_DATA_DIR));
if (store.initialized()) throw new Error("ALREADY_INITIALIZED");
store.setup(input.adminPassword);
store.save({ revision: 0, provider: input.provider, serviceUrl: input.serviceUrl,
  limits: { ...store.view().limits, dailyCalls: 20 } });
console.log("Worket 后台已初始化；模型与管理员配置已加密保存。");
