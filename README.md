# WorkPet

WorkPet 是一个本地 macOS 工作记录工具。用户主动点击桌宠后，它识别当前前台的 Codex 或 WorkBuddy 工作上下文，把可见 Prompt、回复、工具记录与资料引用整理成独立的 `WorkInstance` / `WorkRecord`，并可交给另一端继续。

它不是 Agent，也不替用户执行任务。Codex 与 WorkBuddy 都只是可替换的执行环境。

## 本地运行

要求：macOS arm64、已安装 ChatGPT/Codex Desktop 与 WorkBuddy Desktop、Node.js 24。

```bash
npm ci
npm start
```

WorkPet 每次启动都会静默、幂等地安装 Codex Hook 与 WorkBuddy 用户级 MCP/Hook；不再提供“设置接入”按钮。它们都是本机配置：Codex Hook 用于已绑定任务的增量通知；WorkBuddy Hook 提供真实 `session_id` 与可见 transcript，MCP 则让接力任务读取 WorkRecord。没有 WorkPet 服务端需要部署。首次安装或更新接入后，重启 Codex 和 WorkBuddy 使其加载新配置。

接入安装是启动前提：自动安装失败时 WorkPet 会显示错误并退出，不会在半接入状态下开始记录。

开发中的最新版本固定从 [scripts/run-latest.command](/Users/dandi/YanGuan/scripts/run-latest.command) 启动：双击它，或在终端运行该路径。它会先停止本项目已运行的开发版，再编译当前源码并启动 Electron，不使用 `release/` 下的旧打包版；首次从打包版切换时仍请先退出 `WorkPet.app`。

日常使用时，先聚焦目标聊天，再点击桌宠：

- Codex 会通过前台窗口标题与 App Server 中唯一的任务标题匹配当前任务；首次使用需在 macOS“隐私与安全性 → 辅助功能”中允许 WorkPet 读取窗口标题。
- WorkBuddy 会在你点击“记录当前工作”后，等待该聊天的下一次提交，从官方 Hook 取得真实 `session_id`，并用同一窗口标题校验后绑定；不会用最近会话猜测当前聊天。

WorkPet 默认提炼 Work State，且默认使用本地规则，不会外发数据。只有本机同时配置 `WORKPET_LLM_API_KEY` 和 `WORKPET_CLOUD_EXTRACTION=true`，才会把必要的可见对话发送给所配置的 OpenAI-compatible 模型。

## 打包

```bash
npm run package:mac
```

产物位于 `release/WorkPet-darwin-arm64/WorkPet.app`。启动打包产物时会自动安装或更新本机接入配置，使 WorkBuddy 指向该稳定路径；随后重启 Codex 与 WorkBuddy 使新配置生效。

## 验证

```bash
npm test
npm run typecheck
npm run qa:package
npm run qa:desktop-roundtrip:list
```

`qa:package` 验证打包后的真实 Electron 窗口、Codex 导入确认、人工编辑保护和继续原工作。`qa:desktop-roundtrip:list` 只读取本机 Codex 任务并列出哪些任务满足“至少二十轮用户输入、两份不同附件”，不向 WorkBuddy 发送内容。

如果当前验收任务只有一份附件，可把无敏感信息的 [第二验收资料](test/fixtures/desktop-acceptance-second-artifact.md) 作为新附件发到该 Codex 任务，再重新运行候选扫描。

严格桌面验收会向当前登录的 WorkBuddy 账号提交接力任务。取得用户对本次具体数据的授权后，先退出正在运行的 WorkPet，再从上一步结果选择一个 `threadId`：

```bash
WORKPET_QA_THREAD_ID='<thread-id>' \
WORKPET_QA_CONFIRM=SEND_TO_CURRENT_WORKBUDDY_ACCOUNT \
npm run qa:desktop-roundtrip
```

脚本会使用临时 WorkPet 数据库，验证人工编辑保护，并等待用户在 Codex 新增一轮对话。随后它通过 Deep Link 新建并提交 WorkBuddy 接力任务；成功条件同时要求真实桌面 Conversation ID、同一 Binding/ExecutionEpisode 内成对的 `get_work_context` 成功审计、MCP 返回的随机 proof token 出现在可见回复中，以及 WorkBuddy 用户 Prompt 和回复经 Hook 写回同一 WorkInstance。WorkBuddy 页面可能短暂显示空白，验收器不会据此判定成功。`qa:roundtrip` 是额外的 CLI 接入检查，会主动调用当前 WorkBuddy 账号，不能替代桌面同会话验收，也不应在没有具体数据发送授权时运行。

## 数据边界

- SQLite、Source Archive、ArtifactRef 与 Work State 默认只保存在本机；
- 未点击“记录当前工作”前不归档用户活动；前台识别只读取应用身份和窗口标题，不读取或保存窗口内容；
- 不读取、推断或保存 Agent 隐藏思维；
- ArtifactRef 保存原路径与元数据，不复制或修改原文件；
- 默认进行本地 Work State 提炼；仅当本机同时配置 API Key 与云端提炼开关时，必要的可见对话才会发送给 OpenAI-compatible 接口；
- WorkBuddy Hook 会看到事件，但只接受带 WorkPet marker 且已绑定到 `OPEN` WorkInstance 的会话，其他会话不会落盘。

完整产品与领域定义见 [docs/product.md](docs/product.md) 和 [docs/architecture.md](docs/architecture.md)。
