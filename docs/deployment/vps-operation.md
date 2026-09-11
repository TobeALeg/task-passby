# Worket VPS 部署与验收

2026-09-10：后台已部署，HTTPS、自动安装身份、合成样本收集与桌面取消持久化通过实测。2026-09-11 用户明确同意后，已有 DeepSeek Key 经 SSH stdin 迁移并在 VPS 加密保存，后台已载入 `deepseek-v4-pro` 配置。桌面端未打包、未发布，现有用户不会因此自动升级。

## 入口与管理

- 客户端地址：`https://124.223.223.215`，系统正常验证 IP 证书，不需要关闭 TLS 校验。
- 公网 `/health` 返回 200，未带凭据的 `/v1/capabilities` 返回 401；`/admin/` 返回 404。
- 后台仅监听 `127.0.0.1:8788`。管理页通过本机 SSH 隧道访问，8788、3080、8080 不向公网开放。

```sh
ssh -i /Users/dandi/Desktop/idd_tecent_dstui.pem -o IdentitiesOnly=yes -o ExitOnForwardFailure=yes -N -L 127.0.0.1:8789:127.0.0.1:8788 ubuntu@124.223.223.215
```

保持该终端运行，打开 `http://127.0.0.1:8789/admin/`。密码保存在本机 `.worket-server/vps-admin-access.json`，权限 600，未提交 Git。管理员可以查看安装接入、撤销凭据，在“改进样本”中展开来源与修改证据、添加评审备注、暂停接收或删除样本。测试样本明确标记为 `WORKET-SYNTHETIC-*`，不应计入真实使用数据。

## 服务器布局

| 路径或服务 | 用途 |
| --- | --- |
| `/opt/worket/releases/<commit>`、`/opt/worket/current` | 已编译的后台版本与当前链接；当前业务代码版本 `c8dd3e7` |
| `/opt/worket/runtime/node` | Node v24.19.0 独立可执行文件 |
| `/var/lib/worket/data` | 管理配置、签名身份、加密主密钥、用量元数据及样本 SQLite；仅 worket 用户访问 |
| `worket.service` | 独立 worket 用户运行后台，异常退出自动重启 |
| `worket-edge.service`、`/etc/worket/Caddyfile` | 独立 Caddy HTTPS 入口，管理端口 127.0.0.1:2020 |
| `/opt/worket-certbot` | Certbot 5.8.0 独立 Python 环境 |
| `/etc/letsencrypt/live/worket-ip` | Let's Encrypt IP 证书与续期配置 |
| `/var/lib/worket-edge/tls` | Caddy 可读的证书副本，由部署 hook 更新 |
| `worket-certificate.timer` | 每日 00:00、12:00 各检查一次，随机延迟不超过一小时 |

既有 `deepseek-harness.service` 和 `dsh-auth-caddy.service` 保持运行。模板见 `server/deploy/`。该部署未配置异机备份或故障转移；当前是单 VPS 单实例。

首次签发证书有效期到 `2026-09-17 05:55:32 UTC`。已完成 `certbot renew --dry-run --run-deploy-hooks`：公网挑战与证书复制、Caddy 重载链路通过；之后由 timer 检查续期。IP 无 SNI 连接由 Caddy 的 `default_sni` 选择证书。

模型 Key 只通过 SSH stdin 传输，由远端 `AdminStore` 加密保存；迁移命令、日志和 Git 不包含 Key。载入配置后的公网健康检查为 `{"ok":true,"configured":true}`。

## 配置与更新

2026-09-11 管理页补丁 `b880496`：调用额度卡片增加“保存并启用”按钮及就近保存状态。已验证保存后刷新保留数值、失败保留编辑、提交时按钮互斥及窄屏显示。本次仅热更新当前后台的 `server/admin/index.html` 与 `admin.js`，没有重启服务或修改线上额度；补丁和旧文件保存在 `/opt/worket/admin-ui/b880496/new`、`previous`。SSH 隧道实际返回文件与本机验证源码完全一致。后台模型逻辑仍为 `c8dd3e7`，当前目录另包含此页面补丁。

新建管理员与迁移已有模型密钥是两个独立步骤，见 [后台说明](../../server/README.md)。当前管理员已初始化，不要再次运行 `--admin-only`。模型可以直接在 SSH 隧道中的管理页填写；若采用脚本迁移，需要用户明确授权 `--allow-model-key-transfer`，不把密码或 Key 放入命令行、Git 或日志。

脚本写入配置后需 `sudo systemctl restart worket` 载入；管理页面保存模型时会直接更新运行时。重启会结束管理会话，需要重新登录。更新业务代码采用新版本目录再切换 current，只重启 Worket；回滚链接也只影响代码，不回滚已有样本与身份。

```sh
sudo systemctl status worket worket-edge --no-pager
sudo systemctl list-timers worket-certificate.timer --no-pager
sudo journalctl -u worket -n 50 --no-pager
sudo journalctl -u worket-certificate -n 50 --no-pager
```

自动接入最多 1000 个安装主体；每 IP 每小时最多 60 次注册/续期，总计每小时 1000 次。模型调用全局滚动 24 小时预占限额 200 次，仍受每主体限额和并发限制。管理员可撤销单个安装；签发令牌或续期不会重置客户端的参与改进选择。

## 验收证据

`npm test`：107/107 通过。`scripts/qa-distillation.mjs --improvement --unpackaged`：本机完整桌面工作链路通过，模型和材料均为合成夹具。

`node scripts/qa-vps-samples.mjs`：真实 HTTPS、安装注册/续期主体稳定、采集器上传六类合成事件、SSH 管理页可查看、不同安装不能删除对方样本、停止后不继续上报、删除同步和桌面重启保留取消选择。结果与截图位于 `output/vps-samples/`。这项测试不调用模型，也不代表真实用户使用验证。

随后重启 `worket.service` 并重新登录管理页，安装身份、样本与评审均保留；首轮保留一份已标记和评审的合成来源样本，其他该轮合成测试样本已清理。

2026-09-11 真实模型验收：`node --experimental-strip-types scripts/qa-vps.mjs --live-model` 使用独立 Electron 数据目录，经公网 HTTPS 调用 `deepseek-v4-pro`。修复前模型将目标输出为字符串，返回 `INVALID_MODEL_OUTPUT`；诊断复现还发现中间改写文本被当作原文摘录。提示版本 `work-definition-v1.2` 明确 Item 对象结构和聚合阶段只引用来源/事件键，保持原有校验规则；107/107 回归通过。

修复后真实提取返回无待确认问题的候选，保留两个必填文本输入、来源依据、约束与验收标准。桌面修改名称、发布定义、输入新项目、创建实例、附加合成成果并逐项验收；后台收到 SOURCE、CANDIDATE、EDIT、PUBLISH、REUSE、ACCEPTANCE 六类事件。后半段因测试脚本将两个“更多”菜单混淆而中断；修正定位后以 `--resume-feedback` 继续同一数据目录，未重复模型调用，完成后台查看、停止、删除和重启后保持取消选择。

结果：`output/vps-live/report.json` 为 `passed:true`、`realModel:true`、`syntheticSource:true`、`realExecutor:false`、`desktopPackaged:false`。当前保留 `WORKET-QA-f37ca63a` 的已评审来源/候选/修改/发布样本，测试复用样本按删除流程移除，初次失败样本已清理。正式版本目录切换后再次重启，模型配置、安装身份与成功样本仍在，公网健康检查通过。

此结果证明真实供应商与当前应用数据闭环可运行；材料和成果为合成 QA，不能计作真实执行者交付、真实用户数据到账、广泛模型质量或沉淀收益验收。完整新测试使用 `--live-model`；仅在前半程已经完成并保留 `run.json` 时使用 `--resume-feedback` 续测后半程。
