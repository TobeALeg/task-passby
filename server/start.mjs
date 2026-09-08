import { resolve } from "node:path";
import { createManagedService } from "./managed.mjs";
const port = Number(process.env.PORT ?? 8788);
if (!Number.isInteger(port) || port < 1 || port > 65535)
  throw new Error("PORT 必须是有效端口");
const directory = resolve(
  process.env.WORKET_SERVER_DATA_DIR ?? ".worket-server",
);
const service = createManagedService({ directory });
service.server.on("error", (error) => {
  console.error(
    error.code === "EADDRINUSE"
      ? `端口 ${port} 已在使用；可通过 PORT 指定其他端口。`
      : "后台启动失败，请检查监听端口与目录权限。",
  );
  process.exitCode = 1;
  void service.close();
});
service.server.listen(port, "127.0.0.1", () => {
  console.log(`Worket 后台已启动：http://127.0.0.1:${port}/admin/`);
  console.log(`配置和身份数据目录：${directory}`);
  console.log(
    service.store.initialized()
      ? "使用管理员密码登录。"
      : "首次打开页面后设置管理员密码，再填写模型配置。",
  );
});
for (const signal of ["SIGINT", "SIGTERM"])
  process.on(signal, () => void service.close().then(() => process.exit()));
