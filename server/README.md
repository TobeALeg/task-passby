# Worket 后台

为桌面 Worket 的工作沉淀提供模型调用、额度与接入凭据管理。管理页面可以在尚未配置供应商时直接启动；供应商密钥仅由后台保存。

## 启动和填写

需要 Node.js 24+ 和 npm。首次安装依赖执行 `npm ci`；已有依赖时直接运行：

```sh
npm run ai:serve
```

macOS 也可双击 `scripts/run-ai-backend.command`。打开 **http://127.0.0.1:8788/admin/**，首次设置至少 6 字符的管理员密码，本机使用支持简单数字密码。后台运行期间保持启动它的终端打开；重新运行同一命令恢复配置。

1. 在“模型配置”填写 API 基地址、模型名称和 API Key。支持 OpenAI-compatible Chat Completions JSON 输出；基地址例如 `https://供应商域名/v1`，不包含 `/chat/completions`。供应商名称与数据政策链接用于向使用者说明处理方，公开使用前应填写准确内容。
2. 点击“测试连接”。只向当前填写的供应商发送固定检测文本，会产生一次模型调用，不发送工作记录，也不会自动保存。此检测只验证可访问和 JSON 输出，不代表沉淀质量通过。
3. 点击“保存并启用”，配置立即生效。已保存密钥不回显，留空会保留；更换 API 地址时必须重新填写密钥。有沉淀任务或连接测试运行时，后台拒绝更改配置。
4. 在“Worket 接入”填写接入名称与有效期，生成仅显示一次的凭据。桌面 App 的“更多 → Worket 服务”填写服务地址和此凭据。**不要把供应商 API Key 填到桌面接入凭据中。**

本机 HTTP 服务需配合 Worket 开发模式，可执行 `npm run dev`（会重新打包）。已有本次打包应用时，可在正常退出 Worket 后直接运行：

```sh
./release/Worket-darwin-arm64/Worket.app/Contents/MacOS/Worket --dev
```

生产桌面模式要求 HTTPS。在“模型配置”填写“对外 HTTPS 服务地址”仅保存连接信息，不会部署服务器或配置域名。后台适用于管理员分配凭据的私有使用；公开产品的注册、登录和账户恢复仍未实现。

## 运行和数据

| 项目 | 行为 |
|---|---|
| `PORT` | 默认 8788；只监听 127.0.0.1 |
| `WORKET_SERVER_DATA_DIR` | 默认当前工作目录下 `.worket-server`；重启应保持同一路径 |
| 管理页面 | `/admin/`；仅本机访问，密码登录、8 小时会话、CSRF 及跨站来源检查 |
| 模型接口 | `/v1/*`；独立 RS256 签名、主体/受众/期限验证，每次请求检查撤销状态 |
| 健康检查 | `/health`；只返回存活与是否已配置，不调用模型 |
| 调用额度 | 每个凭据按滚动 24 小时统计；预占分块+聚合最大调用数，完成后记录实际次数 |
| 运行记录 | 最近 30 个请求；时间、接入、状态、调用次数，无工作正文；连接测试不计入用户沉淀额度 |
| 撤销接入 | 立即拒绝后续请求，取消正在运行的请求，清除等待领取的结果；供应商已执行的调用可能仍计费 |

后台是单实例服务。不要让多个进程共享同一数据目录，也不要直接水平扩容。启动脚本的构建只编译共享服务契约，不依赖 Electron 或 macOS 编译工具。运行中的模型请求结束前不能热换模型或限额。

配置目录权限为 `0700`；管理员密码使用 scrypt 哈希；供应商 Key 使用 AES-256-GCM 加密，签名私钥和加密主密钥文件权限为 `0600`。**主密钥在同一目录，无法抵御已取得该系统账户或完整目录访问权的攻击者。** 完整备份此目录才能恢复配置和已签发身份；丢失主密钥时必须恢复备份。没有默认密码或密码找回入口。

`.worket-server/` 被 Git 和桌面打包规则排除。若自定义存储目录，放在仓库之外。服务端代码排除在桌面包外；桌面 safeStorage 仅保存 Worket 接入令牌。

未获得单独改进授权的请求正文、文件内容和候选不写数据库。所有请求正文都不写运行日志。结果仅存内存最多 10 分钟，客户端确认收取（ack）或取消后清除。无正文元数据默认保留 30 天。重启后内存请求转为 `INTERRUPTED`，不自动重试或重新计费。供应商自己的数据留存另以其政策为准。

## 在服务器运行

使用 Node.js 24+，运行 `npm ci --ignore-scripts`、`npm run ai:serve`；在进程管理器中设置持久化的工作目录和 `WORKET_SERVER_DATA_DIR`。HTTPS 反向代理仅转发 `/v1/` 与 `/health`，明确拒绝 `/admin`，不要启用请求/响应正文日志或异常正文上报。

管理员通过 SSH 隧道访问服务器的本机管理页：

```sh
ssh -L 8789:127.0.0.1:8788 your-server
```

随后打开 `http://127.0.0.1:8789/admin/`。管理接口拒绝公网 Host、跨站 Origin 和转发来源头，不能通过公网反向代理直接开放管理页。

本次交付已启动本机服务；没有远程服务器部署、域名配置或开机自启动。

## 环境变量兼容模式

已有外部身份系统时使用 `npm run ai:serve:env`，保留旧版无管理页面的入口：

| 变量 | 用途 |
|---|---|
| WORKET_PROVIDER_URL / MODEL / KEY | 模型供应商基地址、模型和密钥 |
| WORKET_PROVIDER_NAME / POLICY_URL | 数据处理方及政策 |
| WORKET_DEV_AUTH_SECRET | 仅开发模式 HS256 签名密钥 |
| WORKET_AUTH_ISSUER / AUDIENCE | 默认 worket-local / worket-ai |
| WORKET_AUTH_PUBLIC_KEY_FILE | `NODE_ENV=production` 必填的 RS256 公钥 PEM 文件 |
| WORKET_AI_METADATA_DB | 运行元数据 SQLite 路径 |

生产兼容模式拒绝开发签名密钥，凭据签发与撤销由外部身份系统负责。图形后台模式不读取这些供应商和身份环境变量，以页面配置为准。

## 改进样本

后台“改进样本”查看材料、来源证据、候选、修改和验收，保存评审备注，或删除整份样本。管理开关只控制接收，不能代替用户授权；暂停期间客户端保留已授权待同步项，恢复后重试。

桌面端沉淀与创建复用工作直接展示“参与改进 Worket”，默认勾选，沿用用户保存的选择。取消后跨页面及重启保持关闭，并停止全部已有样本的后续采集；重新开启仅用于此后提交的范围。历史记录不会因升级自动上传。2026-09-10 此默认行为已修改源码，尚未打包发布。保存期限在 `src/contracts/improvement.ts` 定义为授权起 90 天。使用者从“更多 → Worket 服务 → 改进数据”停止和删除。采集不会增加模型调用，模型未配置也可独立接收已授权样本。

`improvement.sqlite` 保存正文、授权和评审；`metadata.sqlite` 仍只有运行元数据。删除及到期清理包含事件正文和评审备注，保留无正文的哈希删除标记防止重传恢复。无需额外依赖，首次启动自动建立私有样本库。凭据变更时客户端暂停同步，旧凭据无法恢复时由管理员删除。

## 验证

`npm test` 包含后台 HTTP、配置恢复、真实 HTTP 模拟供应商、密钥处理、撤销并发请求与原有桌面领域回归。测试供应商只验证协议，不代表真实模型质量。

`node scripts/qa-distillation.mjs` 使用已打包应用和隔离数据验证桌面闭环。`node server/evaluate.mjs` 使用单独的环境配置执行 8 类固定质量样例，不自动读取后台保存的 Key；模型质量仍需人工逐项审查。

`node --experimental-strip-types scripts/qa-distillation.mjs --improvement` 验证打包桌面的授权、自动采集、复用验收、重启、停止与删除；只使用合成模型和临时数据库。

详细证据见 `docs/acceptance/worket-backend-admin.md` 和 `docs/acceptance/work-distillation-v1.md`。

## VPS 自动接入

设置 `WORKET_AUTOMATIC_ENROLLMENT=true` 开放 `/v1/installations`。每个安装用自己的 32 字节随机秘密领取/续期 30 天令牌，服务仅保存秘密哈希；管理员可在原接入列表撤销。默认最多 1000 个主体，注册/续期每 IP 60 次/小时、总计 1000 次/小时。`WORKET_GLOBAL_DAILY_CALLS` 默认 200，控制所有主体合计的滚动 24 小时模型调用预占。自动接入不等于正式账户注册或设备归属验证。

`WORKET_TRUST_LOOPBACK_PROXY=true` 仅用于本机反向代理已覆盖 `X-Worket-Client-IP` 的部署，禁止直接把该头作为公网客户端自报来源。部署模板见 `server/deploy/`；服务运行在独立系统用户下，IP 证书由 Certbot 签发并通过专用 timer 自动续期，管理页仅通过 SSH 隧道访问。

首次执行 `node scripts/configure-worket-vps.mjs --admin-only`，通过 SSH 在 VPS 创建独立管理员密码；交付文件保存在被 Git 忽略的 `.worket-server/vps-admin-access.json`，权限 600。此步骤不读取或迁移本机模型密钥，重复初始化拒绝覆盖。模型可在远程管理页配置；获得用户对密钥迁移的明确授权后，才可执行 `node scripts/configure-worket-vps.mjs --allow-model-key-transfer`，将本机 Worket 已配置的模型参数通过 SSH stdin 传输并在 VPS 加密保存。两种模式均不导入本地工作记录。

IP 地址客户端可能不发送 TLS SNI，且 VPS 的公网地址可能经过 NAT；Caddy 配置中的 `default_sni 124.223.223.215` 保证这种连接仍选择正确的 IP 证书。不要通过关闭客户端证书校验绕过证书选择问题。
