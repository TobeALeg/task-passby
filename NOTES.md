# 术语与已确认背景

## 产品定位

- 产品核心是记录和建模用户正在进行的工作，不是 Agent，也不是 Agent 编排平台。
- Codex、WorkBuddy、Claude 等只是工作发生的来源或接力目标；工作对象不绑定任何一个产品、Skill 或会话。
- 跨 Agent 交接是 Work Record 可被独立描述后的额外价值，不是唯一价值。
- 长期方向是从多次相似 Work Record 中提炼属于用户自己的 Work Pattern，并可跨 Agent 使用。

## 规范术语

- **WorkDefinition**：工作的本体定义，相当于 Class；描述一类工作如何被独立表达，不包含某一次工作的聊天和文件。
- **WorkInstance**：一次真实发生的工作，相当于 Object；身份独立于应用、对话和 Agent。
- **WorkRecord**：WorkInstance 的持久事实表达，由原始档案、结构化状态及执行历史组成，不是另一种工作。
- **Source Archive**：用户 Prompt、可见 Agent 回复、可读取的工具调用与结果、上传资料及其时序。
- **Work State**：从 Source Archive 中提炼的目标、约束、事实、决定、进度、待办和产物。
- **Capture Binding**：某个应用中的具体对话与 Work 的持久绑定关系。
- **ExecutionEpisode**：WorkInstance 在某个 ExecutionEnvironment 中由某个 Executor 执行的一段经历。
- **Executor**：可替换的执行者，类型可以是 HUMAN、AGENT、TOOL 或 SAAS。
- **ExecutionEnvironment**：执行发生的应用环境，例如 Codex Desktop 或 WorkBuddy Desktop；它不等于 Executor。
- **Handoff Package**：面向目标 Agent，从 Work Record 生成的交接视图。
- **Work Pattern**：从多份相似 Work Record 中提炼的个人工作方式，不反向修改历史 Work Record。
- **ArtifactRef**：WorkRecord 对资料或产物的引用；MVP 只保存原路径、角色、文件元数据和 Hash，使用时重新校验。

不创建含义模糊的 `WorkObject` 实体。正式关系为：`WorkDefinition` 是 Class，`WorkInstance` 是 Object，`WorkRecord` 是 Object 的持久事实，`Executor` 是可替换执行者。

## 已确认边界

- MVP 只做本地 Codex 到 WorkBuddy。
- 桌宠是用户主动触发的记录入口，默认不记录。
- 点击桌宠并确认后，导入所选 Codex 对话从第一轮开始的完整历史，不提供逐条预览。
- 不记录 Agent 隐藏思维；用户可见的回复和推理摘要可作为普通历史内容保存。
- 同一对话默认持续归属于同一个 Work，时间间隔不改变 Work 身份。
- 用户可以从指定消息主动新建 Work；系统不自动分割，只能提示。
- Work 不因应用关闭或长期无活动而自动结束。
- 交接不会结束 Work，只会新增 Work Episode、Capture Binding 和 Handoff 记录。
- Work State 中每一条目标、约束、事实、决定和偏好都保留 `origin + sourceMessageIds`。
- Codex 整段对话的初始目标使用 App Server 生成的 `thread.name`，以 `conversation.title` 来源事件追溯并标记为 `SYSTEM_INFERRED`；不得用首次 Prompt 或报错正文代替。
- `origin` 至少区分 `USER_STATED`、`AGENT_PROPOSED` 和 `SYSTEM_INFERRED`。
- MVP 自动生成 Work State，不要求用户逐条确认。
- MVP 的通用 Work State 固定为 `objective`、`successCriteria`、`constraints`、`facts`、`decisions`、`completedActions`、`pendingActions`、`artifacts` 八部分。
- Codex 和 WorkBuddy 的专属字段不得进入 Work State 核心模型。
- Handoff Package 默认只把结构化 Work State、下一步和当前所需资料注入目标 Agent 的主上下文。
- 完整 Source Archive 作为可查阅附件提供，不默认塞进目标 Agent 的主 Prompt。
- MVP 在完成 Codex 到 WorkBuddy 的交接后，继续捕获 WorkBuddy 中的用户 Prompt、Agent 可见回复和资料，并写回同一个 Work Record。
- MVP 首次把 WorkInstance 交给 WorkBuddy 时，总是创建一个新的 WorkBuddy 对话，并登记为新的 ExecutionEpisode。
- MVP 接受一次性配置 WorkBuddy 自定义 MCP Connector；之后通过 WorkBuddy 官方 Deep Link 提供一键接力，不模拟键盘输入。
- WorkBuddy Adapter 优先实现为包含 MCP 与 Hook 的本地插件；若本机兼容性验证失败，降级为用户点击桌宠时主动同步当前 WorkBuddy 对话。
- WorkBuddy 降级同步不得读取应用私有数据库。
- MVP 的 Source Archive、ArtifactRef、WorkRecord、WorkDefinition 和 ExecutionEpisode 只存本机。
- 用户首次确认后，允许把生成 Work State 所必需的对话内容发送给用户配置的云端模型；默认不上传原始文件。
- Work State 提炼通过 `WorkStateExtractor` seam 接入，核心模型不依赖具体云端或本地模型。
- Source Archive 在新 Prompt、回复或资料出现时增量归档，不调用模型。
- Work State 只在首次创建、用户点击桌宠查看、发起交接或主动刷新时按需提炼；没有新历史时不调用模型。
- 增量提炼使用“上一个 Work State + 新增消息”，不重复处理全部历史。
- Work State 在桌宠面板中只读展示；内容有误时回到来源对话修正，再刷新提炼结果。
- Work Core 只读取并保护早期数据库已有的 `USER_EDITED` 和删除标记，不再暴露新增它们的写入口。
- MVP UI 为常驻桌宠加点击展开的轻量侧边面板，不另做完整 Dashboard。
- 侧边面板承载当前 Work、全部 Work、只读 Work State、刷新、分割、交接、完成和归档。
- MVP 的 ArtifactRef 只保存原路径、角色、文件元数据和 Hash；在查看、刷新或交接时重新校验。
- MVP 不监听文件变化、不自动保存文件副本，也不保留历史文件版本。
- WorkInstance 进入 `COMPLETED` 后停止 Capture Binding 自动写入并结束当前 ExecutionEpisode。
- 已完成工作的原对话再次活动时，用户必须明确选择“继续原工作”或“从当前消息新建工作”；继续会重开 WorkInstance 并创建新 ExecutionEpisode。
- WorkPattern 是独立、版本化的用户习惯层，描述用户如何完成一类工作，不修改 WorkDefinition。
- WorkPatternCandidate 必须保存来源 WorkInstance 和置信度，经用户确认后才能成为生效的 WorkPatternVersion。
- WorkInstance 记录采用的 WorkDefinition 版本和 WorkPattern 版本；Handoff Package 携带已确认的 WorkPattern。
- MVP 支持经过二次确认的取消记录；只删除本工具持有的数据，不删除用户原始文件或 Codex、WorkBuddy 原对话。
