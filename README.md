# WorkPet

WorkPet 是一个本地 macOS 工作记录工具。用户主动点击桌宠后，它把 Codex 中松散的 Prompt、可见回复、工具记录与资料引用整理成独立的 `WorkInstance` / `WorkRecord`，并可交给 WorkBuddy 在同一项工作上继续。

它不是 Agent，也不替用户执行任务。Codex 与 WorkBuddy 都只是可替换的执行环境。

## 本地运行

要求：macOS arm64、已安装 ChatGPT/Codex Desktop 与 WorkBuddy Desktop、Node.js 24。

```bash
npm ci
npm start
```

首次打开侧边面板后点击“设置接入”，确认安装 Codex Hook 与 WorkBuddy 用户级 MCP/Hook，然后重启 Codex 和 WorkBuddy。点击“交给 WorkBuddy”后，WorkPet 使用 WorkBuddy 官方 Deep Link 新建并提交接力任务，不模拟键盘，也不需要 macOS“辅助功能”权限。

## 打包

```bash
npm run package:mac
```

产物位于 `release/WorkPet-darwin-arm64/WorkPet.app`。启动打包产物后，需要在它自己的“设置接入”入口再执行一次接入安装，使 WorkBuddy 配置指向打包后的稳定路径。

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
- 未点击“记录 Codex”前不监听用户活动；
- 不读取、推断或保存 Agent 隐藏思维；
- ArtifactRef 保存原路径与元数据，不复制或修改原文件；
- 只有用户在创建记录时勾选云端提炼，且配置了 API Key，必要的可见对话才会发送给 OpenAI-compatible 接口；
- WorkBuddy Hook 会看到事件，但只接受带 WorkPet marker 且已绑定到 `OPEN` WorkInstance 的会话，其他会话不会落盘。

完整产品与领域定义见 [docs/product.md](docs/product.md) 和 [docs/architecture.md](docs/architecture.md)。
