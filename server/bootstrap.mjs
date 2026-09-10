// Run once over SSH with configuration supplied on stdin, never command-line secrets.
import { AdminStore } from "./admin/store.mjs";
import { resolve } from "node:path";
const chunks = [];
for await (const chunk of process.stdin) chunks.push(chunk);
const input = JSON.parse(Buffer.concat(chunks));
const store = new AdminStore(resolve(process.env.WORKET_SERVER_DATA_DIR));
if (input.adminPassword) {
  if (store.initialized()) throw new Error("ALREADY_INITIALIZED");
  store.setup(input.adminPassword);
}
if (input.provider) {
  if (!store.initialized()) throw new Error("ADMIN_REQUIRED");
  store.save({ revision: store.view().revision, provider: input.provider, serviceUrl: input.serviceUrl,
    limits: { ...store.view().limits, dailyCalls: 20 } });
}
console.log("Worket 后台配置已保存。");
