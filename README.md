# Worket

Worket 是一个本地 macOS 工作记录工具。用户悬浮桌宠并点击头顶展开的便利贴后，它识别当前前台的 Codex 或 WorkBuddy 工作上下文，把可见 Prompt、回复、工具记录与资料引用整理成独立的 `WorkInstance` / `WorkRecord`，并可交给另一端继续。

它不是 Agent，也不替用户执行任务。Codex 与 WorkBuddy 都只是可替换的执行环境。

## 本地运行

要求：macOS arm64、已安装 ChatGPT/Codex Desktop 与 WorkBuddy Desktop、Node.js 24。

```bash
npm ci
npm start
```

Worket 启动后分别安装已接入执行者的本机配置：Codex Hook/MCP，WorkBuddy 用户级 Hook/MCP 和最小读取权限扩展。单个执行者不可用不阻止应用启动。WorkBuddy 历史读取已在 5.5.3 验证；内部扩展接口未来升级可能需要适配。更新后重启目标应用使配置生效。

接入安装是启动前提：自动安装失败时 Worket 会显示错误并退出，不会在半接入状态下开始记录。

开发中的最新版本固定从 [scripts/run-latest.command](scripts/run-latest.command) 启动：双击它，或在终端运行该路径。它会先停止本项目已运行的开发版，再构建最新源码并启动名为 `Worket` 的 macOS 应用包，不会再以 `Electron` 的名称出现在系统界面中。

日常使用时，先聚焦目标聊天。识别成功后，桌宠上方会显示来源应用生成的会话标题；悬浮小土豆，让头顶便利贴展开为“记录”，再点击便利贴。记录后同一张便利贴变为“打开”，点击桌宠身体也可以打开面板。即使 Worket 面板仍在前台，桌宠也会识别它后方最近的受支持工作窗口；侧边面板只读展示和管理已有工作，不是新的记录入口。

- Codex 优先通过前台窗口标题与 App Server 中唯一的任务标题匹配当前任务；容器不提供窗口标题时，只接受唯一的近期活动任务。
- Codex 的工作目标直接使用 App Server 已总结的任务标题；首条 Prompt 或报错正文只进入来源档案，不会再充当目标。
- WorkBuddy 支持历史列表与直接导入；无法明确定位当前聊天时，桌宠点击打开该执行者的会话选择。两端都可多会话记录，“交接”从注册表选择目标，Codex 原生入口需要确认发送。

Worket 默认提炼 Work State，且默认使用本地规则，不会外发数据。只有本机同时配置 `WORKPET_LLM_API_KEY` 和 `WORKPET_CLOUD_EXTRACTION=true`，才会把必要的可见对话发送给所配置的 OpenAI-compatible 模型。

## 打包

```bash
npm run package:mac
```

产物位于 `release/Worket-darwin-arm64/Worket.app`。启动打包产物时会自动安装或更新本机接入配置，使 WorkBuddy 指向该稳定路径；随后重启 Codex 与 WorkBuddy 使新配置生效。应用继续使用原来的 `.workpet` 配置键与 `WorkPet` 用户数据目录，已有本地工作不会因显示名称调整而迁移或丢失。

## 验证

```bash
npm test
npm run typecheck
npm run qa:current-context
npm run qa:package
npm run qa:desktop-roundtrip:list
```

`qa:current-context` 使用临时数据库启动真实 Electron 应用，强制让 Worket 面板保持前台，再通过便利贴识别并记录真实 Codex 任务，同时检查应用标题气泡、记录后“打开”和只读 Work State。`qa:package` 验证打包后的真实 Worket 应用名称、窗口、桌宠入口与面板基本布局。`qa:desktop-roundtrip:list` 只读取本机 Codex 任务并列出哪些任务满足“至少二十轮用户输入、两份不同附件”，不向 WorkBuddy 发送内容。

`qa:workbuddy-context` 使用临时数据库验证实际 WorkBuddy 历史读取、重复导入与增量去重，不发送消息。`node scripts/qa-parallel-recording.mjs` 在打包应用中用三个合成适配器验证列表、分页、多会话记录、执行者选择和取消交接。

如果当前验收任务只有一份附件，可把无敏感信息的 [第二验收资料](test/fixtures/desktop-acceptance-second-artifact.md) 作为新附件发到该 Codex 任务，再重新运行候选扫描。

严格桌面验收会向当前登录的 WorkBuddy 账号提交接力任务。取得用户对本次具体数据的授权后，先退出正在运行的 Worket，再从上一步结果选择一个 `threadId`：

```bash
WORKPET_QA_THREAD_ID='<thread-id>' \
WORKPET_QA_CONFIRM=SEND_TO_CURRENT_WORKBUDDY_ACCOUNT \
npm run qa:desktop-roundtrip
```

脚本会使用临时 Worket 数据库，并等待用户在 Codex 新增一轮对话。随后它通过 Deep Link 新建并提交 WorkBuddy 接力任务；成功条件同时要求真实桌面 Conversation ID、同一 Binding/ExecutionEpisode 内成对的 `get_work_context` 成功审计、MCP 返回的随机 proof token 出现在可见回复中，以及 WorkBuddy 用户 Prompt 和回复经只读接口写回同一 WorkInstance。WorkBuddy 页面可能短暂显示空白，验收器不会据此判定成功。旧 CLI 验收已移除：它产生的 CLI 会话不能代表当前桌面会话读取链。

## 数据边界

- SQLite、Source Archive、ArtifactRef 与 Work State 默认只保存在本机；
- 未点击便利贴“记录”前不归档用户活动；前台识别只读取应用身份和窗口标题，不读取或保存窗口内容；
- 不读取、推断或保存 Agent 隐藏思维；
- ArtifactRef 保存原路径与元数据，不复制或修改原文件；
- 默认进行本地 Work State 提炼；仅当本机同时配置 API Key 与云端提炼开关时，必要的可见对话才会发送给 OpenAI-compatible 接口；
- WorkBuddy Hook 会看到事件，但只接受带 Worket marker 且已绑定到 `OPEN` WorkInstance 的会话，其他会话不会落盘。

完整产品与领域定义见 [docs/product.md](docs/product.md) 和 [docs/architecture.md](docs/architecture.md)。

## 半自动更新与 GitHub 发布

无需 Apple 付费开发者会员。应用直接读取公开仓库 `TobeALeg/worket` 的 GitHub 最新稳定 Release。入口位于 macOS 的 **Worket → 检查更新…** 和桌宠右键菜单。

正常启动的打包应用会在启动时检查，此后每小时检查。发现新版后提示“稍后 / 下载新版”；只有点击下载才下载安装包。同一版本选择稍后后，本次运行不再自动提醒，仍可手动检查。开发启动 `npm run dev` 或 `--dev` 不检查更新。

### 用户如何更新

1. 点击“下载新版”，等待下载与 SHA256 校验完成。下载期间可以继续使用 Worket；失败后可以手动重试。
2. 应用自动在 Finder 中选中下载好的 ZIP，位置为系统“下载”目录下独立的 `Worket-update-*` 文件夹。
3. **保存尚未提交的编辑，退出 Worket**，双击 ZIP 解压，将 `Worket.app` 拖到“应用程序”文件夹，确认替换。
4. 重新打开 `/Applications/Worket.app`；如接入配置更新，按提示重启 Codex / WorkBuddy。

应用不会自动解压、替换、安装或重启。已保存的工作和设置继续保存在 `~/Library/Application Support/WorkPet`，替换应用包不删除此目录。重启间隙暂停录制，重新启动后按原有绑定继续同步；未提交表单需自行保存。

已有旧版仍需先手动安装一次带本功能的版本。免费发布包采用 ad-hoc 临时签名，**不是 Apple Developer ID 签名，也没有 Apple 公证**，macOS 可能提示无法验证开发者；仅在确认来源可信后，按系统“隐私与安全性”的提示允许打开。半自动更新不会绕过系统检查。

### 发布者每次发布

保持 `dev.workpet.desktop` bundle ID 和现有用户数据目录不变。递增 `package.json` 与 `package-lock.json` 的版本，例如 `npm version 0.1.1 --no-git-tag-version`，然后提交。使用递增的 `x.y.z` 稳定版本，不覆盖同版本附件。

```bash
npm run release:mac
```

脚本要求 macOS ARM64 和干净工作区，执行测试、打包、ad-hoc 签名、ZIP 打包、解压签名验证、真实应用 QA，最后生成 SHA256。不需要证书、Apple 账号或公证凭据；不会自动上传或公开发布。

必须同时上传以下两个附件，名称须严格匹配版本和架构：

- `Worket-<版本>-darwin-arm64.zip`
- `Worket-<版本>-darwin-arm64.zip.sha256`

SHA256 文件内容为 `哈希值  ZIP文件名`。校验用于检测下载损坏，不等同于 Apple 公证或独立发布者身份认证。缺失附件、校验失败或网络中断时不会向用户交付不完整安装包。

先用本机 `gh auth status`、`gh api user --jq .login` 确认发布账号；未登录时执行 `gh auth login`。编写 `/tmp/worket-release-notes.md` 后，以版本 `0.1.1` 为例：

```bash
git tag v0.1.1
git push origin v0.1.1
gh release create v0.1.1 \
  release/Worket-0.1.1-darwin-arm64.zip \
  release/Worket-0.1.1-darwin-arm64.zip.sha256 \
  --repo TobeALeg/worket --verify-tag --draft \
  --title 'Worket 0.1.1' --notes-file /tmp/worket-release-notes.md
```

检查草稿附件后，在 GitHub 发布为稳定版并标记为 Latest。当前只读取 `releases/latest`，**草稿和 prerelease 不会提示更新**。只推代码、只建 tag 或只上传 GitHub 自动生成的源码 ZIP 都不够。用户无需登录 GitHub，客户端不包含 token；网络或 GitHub 限流会导致检查失败，稍后可重试。

### 验收与故障处理

发布后用旧版本验证：发现新版 → 稍后不下载 → 手动检查并下载 → SHA256 一致 → Finder 选中 ZIP → 退出并拖动替换 → 新版本正常启动 → 原有记录和设置保留。首次发布前可用合成 Release 验证下载链，不能把它当成生产 Release 已上线。真实 Electron 下载验收脚本为 `node scripts/qa-updates.mjs`（使用本机合成 HTTP 服务和临时下载目录，不访问真实工作数据）。

下载中断会清理此次临时文件夹；若进程被强制结束，可能留下 `.part` 文件，可删除后重试。发现错误发布时撤回 Release，并用更高版本发布修复；已下载文件不会自动撤回。数据结构变更须另行验证迁移和恢复。

实现见 `src/desktop/app-updates.ts`、`src/desktop/github-release.ts`、`scripts/release-mac.mjs`。[GitHub Releases API 文档](https://docs.github.com/en/rest/releases/releases#get-the-latest-release)。
