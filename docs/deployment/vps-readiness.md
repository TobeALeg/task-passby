# Worket VPS 基础条件检查

**当前部署状态已更新：** 后续已完成公网 HTTPS 与 Worket 后台部署，详见 [部署与验收](vps-operation.md)。下文保留首次只读检查时点的记录，不代表当前未部署。

检查日期：2026-09-10 22:23–22:26（Asia/Shanghai）。目标：`124.223.223.215`。仅执行只读检查，未安装软件、部署 Worket、重启进程或改动服务器配置；客户端未打包或发布。

## 结论

符合 Worket 当前 Node.js 单实例后台的小规模试用基础要求。此结论基于资源余量、运行时兼容性与出站网络检查，不是并发压测结果或对外上线验收。

| 项目 | 本次实测 |
| --- | --- |
| 登录 | `ubuntu`，SSH 22，使用 AGENTS.md 指定密钥；免密 sudo 可用 |
| 系统 | Ubuntu 24.04.4 LTS，Linux x86_64 |
| CPU | 4 个 vCPU，AMD EPYC 7K62 虚拟机 |
| 内存 | 系统报告总计 3.6 GiB，已用约 641 MiB，可用约 3.0 GiB |
| Swap | 1.9 GiB，未使用 |
| 根磁盘 | ext4，总计 40 GiB，已用约 6.2 GiB，剩余约 32 GiB |
| 负载 | 1/5/15 分钟约 0.00 / 0.01 / 0.00；短时 vmstat 显示资源空闲 |
| Node.js | `/home/ubuntu/.local/node/bin/node`，v24.19.0 |
| npm | 同目录，11.17.0；非交互 SSH 的默认 PATH 不含该目录 |
| SQLite | Node.js `node:sqlite` 内存数据库读取成功，SQLite 3.53.3 |
| 时间 | NTP 已同步 |
| 出站 HTTPS | nodejs.org 返回 307，npm registry 返回 200，DeepSeek API 返回 401；TLS 校验均成功 |

DeepSeek 的 401 来自不带凭据的请求，仅证明网络与 TLS 可达；未读取现有服务的模型密钥，未执行真实模型调用，也未验证模型额度。

## 已有服务与部署边界

- `deepseek-harness.service`：DeepSeek Harness Web UI，本机 `127.0.0.1:3080`，检查时主进程约占 170 MiB RSS。
- `dsh-auth-caddy.service`：现有 Caddy，本机 `127.0.0.1:8080`。
- SSH 监听 22。未发现 80、443 或 Worket 默认 8788 的监听，部署应为 Worket 建立独立进程与持久数据目录，并保留上述现有服务。
- UFW 状态为 inactive；未读取腾讯云控制台，云安全组、入口防护和公网 80/443 可达性尚未验证。端口未被占用不代表已允许公网访问。
- 当前登录环境中未找到 Docker 或 Nginx；Worket 可以直接使用现有 Node.js，由独立 systemd 服务管理，无须为了运行后台安装 Docker。配置服务时明确指定 Node.js 绝对路径与 PATH。

对外接入仍需配置 HTTPS 入口、云安全组、独立后台数据备份与客户端首次凭据签发。域名不是必要条件：客户端允许 HTTPS IP 地址，可为 `124.223.223.215` 配置受信任的 IP 证书后直接连接。2026-09-10 核实 [Let's Encrypt 官方说明](https://letsencrypt.org/2026/01/15/6day-and-ip-general-availability.html)：IP 证书已开放申请，有效期 160 小时，部署需自动续期。当前尚未申请证书或验证公网 HTTPS 入口；先前将域名列为必需项的表述在此更正。公开路由仅开放业务 API 和健康检查，管理页通过 SSH 隧道访问，具体约定见 [后台部署说明](../../server/README.md)。默认自动接入尚未实现，不能将服务器检查通过等同于真实用户数据已开始采集。

## 登录核实

桌面文件实际名为 `idd_tecent_dstui.pem`。本次将本机文件权限从 `0644` 收紧为 `0600`，未改动密钥内容；服务器主机密钥首次按 SSH 信任首次使用规则登记，后续连接启用严格校验。用户在控制台完成密钥绑定后，`ubuntu` 登录成功；`root` 未接受此密钥，后续使用 `ubuntu`。
