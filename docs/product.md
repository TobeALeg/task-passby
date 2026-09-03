# 产品定义：个人工作记录与跨 Agent 接力工具

## Production

### 用户是谁

在 Codex、WorkBuddy 等桌面 AI 应用中持续完成真实工作的个人用户。他们的工作散落在多轮 Prompt、Agent 回复、文件和操作中，并且不希望工作上下文被某个 Agent、应用、Skill 或会话锁定。

### 核心价值

用户在桌宠头顶展开的便利贴上点击“记录”后，系统识别前台 Codex 或 WorkBuddy 的工作上下文，把松散的 AI 协作过程记录并抽象为独立的 WorkInstance 和 WorkRecord。记录能够持续跨越不同 Executor 与 ExecutionEnvironment，并在需要时生成可直接接力的 Handoff Package。

产品的核心是记录与建模“工作”本身。跨 Agent 接力是 WorkRecord 能够独立描述工作的直接价值。长期价值是从多次相似 WorkInstance 中提炼可跨 Agent 使用、属于用户自己的 WorkPattern。

### 产品原则

- 工作属于用户，不属于 Agent、应用、Skill 或会话；
- 用户主动触发后才归档；前台识别只读取应用身份和窗口标题，不读取或保存窗口内容；
- WorkInstance ID 是工作身份，对话 ID 只是来源引用；
- 原始档案与结构化 Work State 分离；
- 每条结构化信息必须可追溯到来源；
- 自动提取结果是可追溯的只读投影；用户回到来源对话修正事实后，再触发重新整理；
- 前台检测到的原始窗口标题不落盘；Codex 仅把 App Server 返回的应用总结标题作为可追溯来源保存，WorkBuddy 仅保存不可逆标题指纹用于重启后恢复关联；
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

1. 用户在 Codex 或 WorkBuddy 中进行工作；
2. 桌宠上方只在识别到支持的前台聊天时显示应用生成的会话标题，不把首次用户消息当标题；WorkBuddy 不提供标题时显示明确的通用标题；
3. 用户悬浮桌宠，头顶便利贴展开为“记录”；便利贴是开始记录当前工作的唯一入口，桌宠身体和侧边面板只打开、管理已有工作；
4. 系统识别前台应用及当前聊天，不展示应用或任务选择器；Codex 容器没有窗口标题时，仅在唯一近期活动任务成立时自动绑定；
5. Codex 在唯一标题匹配后立即导入完整既有历史，并用 App Server 的总结标题生成只读目标，不把首条消息或报错正文当目标；WorkBuddy 即使不暴露窗口标题也会显示通用前台对话气泡，在下一次真实提交中取得 session ID 后绑定并归档 transcript；无标题模式仅支持一份 WorkBuddy 活动记录，界面表达应用级记录状态，不伪造当前聊天的精确匹配；
6. 桌宠进入清醒状态，同一张便利贴变为“打开”，Source Archive 持续增量归档；
7. 用户通过便利贴或桌宠身体打开只读 Work State 面板；
8. 用户可以重新整理、从当前消息新建 Work、完成、归档或永久删除；
9. 工作完成或归档后保留当前聊天的“打开”入口，但气泡改为“已完成”或“已归档”，不再显示“正在记录”；
10. 用户点击“交给 WorkBuddy”；
11. 系统创建全新 WorkBuddy 对话，通过 MCP 交付 Handoff Package；
12. WorkBuddy 的后续协作继续写回同一个 WorkRecord；
13. 用户明确完成后停止自动写入；再次活动时选择继续原工作或新建工作。

## UX

### 设计原则如何回应以上要求

- **可见的授权状态**：桌宠用睡眠、清醒、搬运、提醒四种状态表达当前是否记录和是否需要处理；
- **可发现的运行入口**：MVP 保留与桌宠一致的圆土豆加便利贴 Dock 图标；开发中固定使用 `scripts/run-latest.command` 启动当前源码；再次双击应用会把已有桌宠和侧边面板带回前台；
- **单次授权，不逐条打扰**：悬浮桌宠后点击便利贴即授权记录当前工作，不预览全部历史，也不要求逐项确认 Work State；
- **当前来源可见**：只在确认支持的前台聊天后显示窄气泡，标题直接使用来源应用生成的会话标题；
- **提取结果只读**：面板展示来源数量与提取结果，但不提供就地编辑或删除，避免投影与来源事实分叉；
- **交接是一键动作**：接入配置随 WorkPet 启动自动安装或更新，日常交接只需一个动作；
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
- `OPEN`、`COMPLETED`、`ARCHIVED` 生命周期、继续原工作、来源可追溯的只读 Work State 和永久删除；
- 默认以本地规则提炼 Work State；只有用户在本机显式启用云端提炼并配置 API Key 时才调用 OpenAI-compatible 模型；
- arm64 macOS `.app` 打包与启动时自动、幂等的本机接入安装。
