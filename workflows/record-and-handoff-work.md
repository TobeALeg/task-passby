# 记录并接力一项工作

## 状态

产品规格已确认。尚未开始实现。

## 目标

把用户在 Codex 中松散发生的工作抽象成独立、持久、可追溯的 Work Record，并在需要时将同一个 Work 交给 WorkBuddy 继续。

产品首先是工作记录与建模工具。跨 Agent 接力是 Work Record 的一个输出能力。

## 用户

在多个桌面 AI 应用中完成真实工作，希望保留完整工作历史、形成个人工作模式，并避免工作上下文被某个 Agent 或会话锁定的个人用户。

## 首版范围

- 本地 macOS 桌面工具，采用桌宠形态提供入口和状态提示。
- 来源只支持 Codex 桌面应用。
- 接力目标只支持 WorkBuddy 桌面应用。
- 用户主动触发，不在未授权状态下记录其他窗口或应用活动。
- 工作类型通用，不绑定固定业务场景。
- UI 仅包含常驻桌宠和点击展开的轻量侧边面板，不开发完整 Dashboard。

## 桌宠与侧边面板

桌宠至少表达以下状态：

- 睡眠：当前对话尚未绑定 WorkInstance；
- 清醒：当前对话已绑定 WorkInstance；
- 搬运：正在同步或交接；
- 提醒：同步失败或需要用户处理。

侧边面板至少提供：当前 Work 标题与状态、八部分 Work State、Source Archive 与资料数量、刷新、编辑、从当前消息新建 Work、交给 WorkBuddy、完成、归档，以及按 `OPEN`、`COMPLETED`、`ARCHIVED` 查看全部 Work。

用户可以对 WorkInstance 执行永久删除。删除必须经过二次确认，并删除本工具持有的 WorkRecord、Source Archive、Work State、Capture Binding、ExecutionEpisode、Handoff 和相关本地元数据。不得删除用户原始文件，也不得删除 Codex 或 WorkBuddy 中的原对话。删除后不可恢复。

## 主流程

1. 用户在 Codex 中进行工作。
2. 用户点击桌宠，请求记录当前 Codex 对话。
3. 系统显示一次简洁确认，至少说明对话身份、历史消息数量、附件数量和工作目录。
4. 用户确认后，系统依据 WorkDefinition 创建 WorkInstance 及其 WorkRecord。
5. 系统从第一轮开始导入该 Codex 对话的完整可见历史。
6. 系统建立 Codex 对话到 WorkInstance 的 Capture Binding，并保存增量同步位置。
7. 用户以后在同一对话继续工作时，新内容仍归属于同一个 WorkInstance，不受间隔时间影响。
8. 用户需要交接时，系统更新 Work Record，并生成面向 WorkBuddy 的 Handoff Package。
9. 系统唤起 WorkBuddy，交付交接说明和相关资料。
10. 系统为目标 WorkBuddy 对话建立新的 Capture Binding 和 ExecutionEpisode。
11. WorkBuddy 中后续的用户 Prompt、Agent 可见回复和资料继续写回同一个 WorkRecord，而不是创建新 WorkInstance。

## 核心领域关系

- `WorkDefinition`：工作的本体定义，相当于 Class；
- `WorkInstance`：一次真实发生的工作，相当于 Object；
- `WorkRecord`：WorkInstance 的持久事实表达；
- `Executor`：HUMAN、AGENT、TOOL 或 SAAS 等可替换执行者；
- `ExecutionEnvironment`：Codex Desktop、WorkBuddy Desktop 等执行环境，不等于 Executor；
- `ExecutionEpisode`：某个 Executor 在某个 ExecutionEnvironment 中执行 WorkInstance 的一段经历。

不创建含义模糊的 `WorkObject` 实体。切换 Agent 或应用只新增 ExecutionEpisode，不更换 WorkInstance。

## WorkRecord 内容

### Source Archive

- 用户 Prompt；
- Agent 的完整可见回复；
- Codex 能合法提供的工具调用及结果；
- 用户上传的资料及 ArtifactRef；
- 消息、资料和产物的原始顺序与时间；
- 用户可见的推理摘要可以作为普通历史内容保存；
- 不记录、推断或依赖 Agent 隐藏思维。

### Work State

Work State 必须从 Source Archive 派生，并能独立描述当前工作，而不是把原始聊天直接当作工作状态。MVP 固定为以下八部分：

- `objective`：工作要解决什么；
- `successCriteria`：什么结果算完成；
- `constraints`：用户要求、限制和不可做事项；
- `facts`：已确认的信息及证据；
- `decisions`：已做决定及理由；
- `completedActions`：已经完成的步骤；
- `pendingActions`：待办、阻塞和下一步；
- `artifacts`：输入资料、中间产物和最终产物。

Work 另有 `workId`、`title`、`status`、`createdAt`、`updatedAt`、`lastActivityAt` 等系统字段。MVP 不增加行业专属字段、复杂任务树或 Codex、WorkBuddy 专属业务字段。

Work State 中每一条目标、约束、事实、决定和偏好都必须保存：

- `origin`：至少区分 `USER_STATED`、`AGENT_PROPOSED`、`SYSTEM_INFERRED`；
- `sourceMessageIds`：指向支持该结构化信息的原始消息。

MVP 自动生成 Work State，不要求用户逐条确认。来源信息用于核验、重新提炼以及防止后续 Work Pattern 把 Agent 建议误判为用户习惯。

用户可以在桌宠面板编辑或删除 Work State 内容。人工修改使用 `USER_EDITED` 来源类型并保存编辑时间；后续自动提炼不得覆盖。用户删除的内容保留 tombstone，防止模型再次从历史中提取同一内容。

## 工作身份规则

- WorkInstance ID 是工作身份；Codex Thread ID 和 WorkBuddy Conversation ID 只是来源引用。
- 同一 Codex 对话默认绑定同一个 WorkInstance。
- 一周或更长时间没有活动不会自动结束或切分 WorkInstance。
- 应用关闭、Mac 重启和 Agent 变化都不会改变 WorkInstance 身份。
- 如果同一对话开始了另一项工作，由用户明确选择从某条消息新建 WorkInstance。
- 系统未来可以提示目标可能变化，但 MVP 不自动切分。

## Handoff Package

默认注入 WorkBuddy 主上下文的内容：

- Work ID；
- 八部分结构化 Work State；
- 当前任务说明；
- 下一步；
- 当前步骤需要使用的资料。

完整 Source Archive、工具调用记录和全部 ArtifactRef 作为可查阅附件提供，不默认塞进主 Prompt。WorkBuddy 可以在需要核验来源时读取附件。

MVP 首次把 WorkInstance 交给 WorkBuddy 时必须创建全新的 WorkBuddy 对话，并将其登记为新的 ExecutionEpisode。MVP 不允许绑定已有 WorkBuddy 对话，以避免混入其他工作的历史上下文。

首次设置允许要求用户：

- 在 WorkBuddy 中配置本地 Work Record MCP Connector；
- 为桌宠授予 macOS 辅助功能权限。

完成一次性设置后，日常交接必须是一键操作。MCP 负责让 WorkBuddy 读取 Work Record；macOS 辅助功能只负责拉起 WorkBuddy、新建对话和输入首条接力指令。

WorkBuddy Adapter 优先实现为包含 MCP 与 Hook 的本地插件：MCP 读取 Handoff Package，Hook 捕获用户提交、Agent 停止和会话结束等事件并增量回写 WorkRecord。实施前必须验证本机 WorkBuddy 版本支持的实际 Hook 契约。

若本机兼容性验证失败，MVP 降级为用户点击桌宠时主动同步当前 WorkBuddy 对话。降级方案不得读取 WorkBuddy 私有数据库。

## 生命周期

- `OPEN`：工作仍可能继续，无论多久没有活动。
- `COMPLETED`：用户明确确认工作完成。
- `ARCHIVED`：从主要列表隐藏，但保留完整历史。

Capture Binding 的启停与 WorkInstance 生命周期相互独立。解除绑定不等于结束或删除 WorkInstance。

用户明确点击完成后：WorkInstance 进入 `COMPLETED`，当前 Work State 固化，Capture Binding 停止自动写入，当前 ExecutionEpisode 结束。原对话以后再次活动时不得自动修改已完成记录；用户必须明确选择“继续原工作”或“从当前消息新建工作”。继续原工作会把 WorkInstance 重新置为 `OPEN` 并创建新的 ExecutionEpisode。

## 同步与资源原则

- 每份 Work 不启动独立后台进程。
- 保存来源对话、同步游标和最后活动时间，按增量导入新内容。
- 原始历史可以确定性归档；结构化 Work State 不要求每条消息后立即调用模型。
- 没有新内容时不发生模型调用。
- Work State 只在首次创建、用户点击桌宠查看、发起交接或用户主动刷新时提炼；
- 增量提炼使用“上一个 Work State + 新增 Source Archive 内容”，不重复处理全部历史。

## 数据与模型处理

- Source Archive、ArtifactRef、WorkRecord、WorkDefinition 和 ExecutionEpisode 只存本机；
- 用户首次创建 WorkRecord 时，确认是否允许把必要对话发送给其配置的云端模型生成 Work State；
- 默认不向模型上传原始文件；需要理解文件时必须明确把相应内容纳入本次提炼；
- Work State 提炼位于 `WorkStateExtractor` seam 后，Work 核心模型不依赖具体云端或本地模型实现；
- 未来允许替换为本地模型，但不作为 MVP 要求。

## 资料处理

- Work Record 使用 ArtifactRef 表示资料和产物。
- ArtifactRef 保存原路径、角色、文件名、MIME、大小、SHA-256、最后修改时间和可用状态；
- 在用户查看、刷新或交接时重新校验；Hash 变化时记录 `artifact.changed` 并更新为新 ArtifactRef 版本；
- 文件移动或删除时标记为 `MISSING` 并要求用户重新选择；
- MVP 不监听文件变化、不自动保存文件副本，也不保留历史文件版本；
- 无论采用哪种实现，Work 核心模型不依赖具体文件存储方式。

## 非目标

- 创建或运行自有 Agent；
- 获取或迁移 Agent 隐藏思维；
- 自动判断并切分工作；
- 第一版支持所有 AI 应用；
- 持续记录用户所有桌面活动；
- 第一版提炼或自动应用 Work Pattern。

## WorkPattern 的未来边界

WorkPattern 描述“这个用户通常怎样完成这类工作”，与描述“这类工作是什么”的 WorkDefinition 分离。未来从多份相似 WorkInstance 生成的 WorkPatternCandidate 必须保存来源 WorkInstance、建议习惯和置信度；经用户确认后才成为生效的 WorkPatternVersion。

WorkPattern 不修改 WorkDefinition，不反向修改历史 WorkRecord，也不绑定 Codex、WorkBuddy、Executor 或 Skill。WorkInstance 记录自己采用的 WorkDefinition 版本和 WorkPattern 版本，Handoff Package 携带已确认的 WorkPattern。MVP 只保留模型位置和数据关系，不实现候选提炼与应用。

## MVP 验收

只有以下真实桌面闭环全部通过，MVP 才算完成：

1. 用户在真实 Codex 桌面任务中已经对话二十轮，并上传至少两个文件；
2. 用户点击桌宠并完成一次简洁确认；
3. 系统创建 `GeneralWorkDefinition v1`、WorkInstance、WorkRecord 和 Codex ExecutionEpisode；
4. 系统从第一轮开始导入完整 Prompt、可见回复、可读取工具记录和 ArtifactRef；
5. WorkStateExtractor 生成八部分 Work State，每条内容带 `origin + sourceMessageIds`；
6. 用户修改一条约束后，它变为 `USER_EDITED`，刷新后不被模型覆盖；
7. 用户继续在 Codex 对话，Source Archive 增量更新；长时间无活动不切分 WorkInstance；
8. 用户点击“交给 WorkBuddy”；
9. 系统真实打开 WorkBuddy、创建全新对话，并建立新的 ExecutionEpisode；
10. WorkBuddy 通过 MCP 读取 Work State、当前所需资料和已确认内容，完整历史不进入主 Prompt；
11. WorkBuddy 中新的用户 Prompt、Agent 可见回复和资料通过 Hook 或主动同步写回同一个 WorkRecord；
12. WorkRecord 能明确展示同一个 WorkInstance 下的 Codex Episode 与 WorkBuddy Episode；
13. 用户完成 Work 后停止自动写入，再次活动时必须选择“继续原工作”或“新建工作”；
14. 所有持久数据只存本机，只有经首次授权的提炼内容可以发往配置的云端模型。

验收必须使用真实安装的 Codex 与 WorkBuddy，不以 Mock、Swagger、接口返回或静态页面代替端到端桌面验证。

## 实施前事实验证

以下是实施 Spike，不是未决产品问题：

- 验证本机 WorkBuddy 5.4.7 实际支持的 Hook 事件和 transcript 数据；
- 验证 WorkBuddy 新建对话的 Deep Link 或 macOS 辅助功能路径；
- 验证 Codex App Server 对当前任务历史、附件和增量事件的实际覆盖范围；
- 验证 WorkBuddy Hook 不兼容时的主动同步降级路径。
