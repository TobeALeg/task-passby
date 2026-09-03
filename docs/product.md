# 产品定义：个人工作记录与跨 Agent 接力工具

## Production

### 用户是谁

在 Codex、WorkBuddy 等桌面 AI 应用中持续完成真实工作的个人用户。他们的工作散落在多轮 Prompt、Agent 回复、文件和操作中，并且不希望工作上下文被某个 Agent、应用、Skill 或会话锁定。

### 核心价值

用户主动点击桌宠后，系统把松散的 AI 协作过程记录并抽象为独立的 WorkInstance 和 WorkRecord。记录能够持续跨越不同 Executor 与 ExecutionEnvironment，并在需要时生成可直接接力的 Handoff Package。

产品的核心是记录与建模“工作”本身。跨 Agent 接力是 WorkRecord 能够独立描述工作的直接价值。长期价值是从多次相似 WorkInstance 中提炼可跨 Agent 使用、属于用户自己的 WorkPattern。

### 产品原则

- 工作属于用户，不属于 Agent、应用、Skill 或会话；
- 用户主动触发后才记录，默认不监听其他活动；
- WorkInstance ID 是工作身份，对话 ID 只是来源引用；
- 原始档案与结构化 Work State 分离；
- 每条结构化信息必须可追溯到来源；
- 用户编辑优先于系统推断，后续模型不得覆盖；
- 持久数据只存本机，云端提炼需要首次明确授权；
- 完整记录不等于把完整聊天塞进目标 Agent；
- WorkDefinition、WorkInstance、WorkRecord、Executor 和 ExecutionEpisode 必须分离；
- 用户可以永久删除本工具持有的数据。

### 不做什么

- 不创建或运行自有 Agent；
- 不读取或推断 Agent 隐藏思维；
- 不持续记录所有桌面活动；
- 不自动判断并切分工作；
- MVP 不支持 Claude、ChatGPT 等其他 Adapter；
- MVP 不实现 WorkPattern 自动提炼与应用；
- 不做完整 Dashboard、云同步、多用户协作或文件历史版本；
- 不把 Codex、WorkBuddy 专属字段放入核心 Work State。

### 用户体验路径

1. 用户在 Codex 中进行工作；
2. 用户点击常驻桌宠；
3. 系统展示当前对话、消息数、附件数和工作目录的一次确认；
4. 用户确认后，系统导入完整既有历史并创建 WorkInstance；
5. 桌宠进入清醒状态，Source Archive 持续增量归档；
6. 用户点击桌宠查看或更新八部分 Work State；
7. 用户可以修正 Work State、从当前消息新建 Work、完成、归档或永久删除；
8. 用户点击“交给 WorkBuddy”；
9. 系统创建全新 WorkBuddy 对话，通过 MCP 交付 Handoff Package；
10. WorkBuddy 的后续协作继续写回同一个 WorkRecord；
11. 用户明确完成后停止自动写入；再次活动时选择继续原工作或新建工作。

## UX

### 设计原则如何回应以上要求

- **可见的授权状态**：桌宠用睡眠、清醒、搬运、提醒四种状态表达当前是否记录和是否需要处理；
- **单次确认，不逐条打扰**：创建 WorkRecord 时只确认一次，不预览全部历史，也不要求逐项确认 Work State；
- **纠错永远可达**：点击桌宠即可查看和编辑 Work State，人工修改受到保护；
- **交接是一键动作**：首次完成 Connector 设置后，日常交接只需一个动作；
- **小而完整**：采用桌宠加轻量侧边面板，不建立复杂管理后台；
- **隐私可撤销**：用户可以完成、归档或永久删除本工具的数据；
- **来源清楚**：Work State 内容可以定位回原始消息，Codex 与 WorkBuddy 内容按 ExecutionEpisode 区分。

## MVP 完成定义

以 [工作流规格](../workflows/record-and-handoff-work.md) 中的十四步真实桌面验收为唯一完成标准。Mock、静态页面、健康检查或接口成功不能代替真实 Codex 到 WorkBuddy 的端到端接力。

## 当前交付

- macOS 桌宠与轻量侧边面板；
- 本地 SQLite Work Core 与八部分 Work State；
- Codex Desktop 真实历史导入、增量 Hook 与 ArtifactRef；
- WorkBuddy 新对话 Deep Link、用户级 MCP、可见事件 Hook 与同一 WorkInstance 回写；
- `OPEN`、`COMPLETED`、`ARCHIVED` 生命周期、继续原工作、人工编辑保护、tombstone 和永久删除；
- 默认本地规则提炼；只有用户勾选且配置 API Key 时才调用 OpenAI-compatible 云端模型；
- arm64 macOS `.app` 打包与一次性接入安装入口。
