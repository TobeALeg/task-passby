# Worket AI Service

单进程、有限并发、正文仅内存的工作定义抽象服务。客户端只访问此服务；供应商凭据不得放到桌面环境、preload、renderer 或发布包。

## 本地开发

先 `npm run build`。在服务进程环境中安全设置以下变量，再运行 `node server/start.mjs`：

| 变量 | 用途 |
|---|---|
| WORKET_PROVIDER_URL | 服务端配置的 OpenAI-compatible chat/completions 基地址 |
| WORKET_PROVIDER_MODEL | 固定评测所用模型 |
| WORKET_PROVIDER_KEY | 仅服务端持有的供应商凭据 |
| WORKET_DEV_AUTH_SECRET | 仅开发模式的签名密钥；不可配置到生产 |
| WORKET_AUTH_ISSUER / WORKET_AUTH_AUDIENCE | Worket 访问令牌的签发者与受众；本地默认 worket-local / worket-ai |
| WORKET_AI_METADATA_DB | 仅运行/用量元数据的 SQLite 路径 |
| WORKET_PROVIDER_NAME / WORKET_PROVIDER_POLICY_URL | 数据处理方及准确留存政策 |
| PORT | 默认 8788，仅监听 127.0.0.1 |

开发客户端的“更多 → Worket 服务”接收服务 URL 和 Worket 用户令牌。开发令牌须是 HS256 签名、具有 sub/iss/aud/exp 的 JWT；不能把供应商 Key 当作此令牌。明文令牌不进入 renderer 持久存储；主进程用 safeStorage 加密。打包应用仅带 `--dev` 时允许本机 HTTP 服务。

## 部署边界

`NODE_ENV=production` 必须提供 `WORKET_AUTH_PUBLIC_KEY_FILE`（RS256 PEM），不允许开发签名密钥；身份签发系统和产品登录尚待接入。生产 URL 为 HTTPS，由反向代理终止 TLS。代理须禁用请求/响应正文日志、转储及正文异常上报。提供用户自助登录和撤销前不能公开发布此服务。

服务不接受客户端指定模型供应商地址或模型 Key。`src/contracts/definition.ts` 集中定义默认限额；`createAIService({limits})` 可覆盖运行限制。每用户每日调用额度按滚动 24 小时统计；开始前预占串行分块+聚合最大调用数，结束后记录实际调用数和可获取用量，未知用量单独标识。不在未知供应商超时后自动重试。

请求正文、候选和文件内容不持久化。结果内存最多 10 分钟，ack/取消即清理。元数据默认 30 天；同一主体和幂等键在元数据保留期限内返回同一个请求，异载荷返回冲突。重启将丢失内存内容的请求置为 INTERRUPTED，不自动重新调用。仅支持单实例服务；不能直接水平扩容。

## 验证

- `npm test`：核心事务和本机 HTTP 契约验证，测试 Provider 不代表模型质量。
- `node scripts/qa-distillation.mjs`：需要已打包 app；独立临时数据库，合成模型的桌面闭环和重启。
- `node server/evaluate.mjs`：8 类合成固定集；未配置模型时退出码 2 并记录 BLOCKED。配置模型后保存调用、耗时、用量和结果，人工按标注审查；禁止把 JSON 合法视为质量通过。

部署和真实用户验收参见 `docs/acceptance/work-distillation-v1.md`。
