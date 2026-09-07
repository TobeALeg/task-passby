# 架构：本地 Work Core 与桌面应用 Adapter

## Module architecture

```text
Desktop Pet Interface
        │
        ▼
Foreground Context Detector
        │
        ▼
Work Core ─────────────── Local Persistence
   │  │                         │
   │  ├── WorkStateExtractor    └── WorkRecord / Source Archive
   │  ├── ArtifactTracker ─── ArtifactResolver
   │  └── HandoffCoordinator
   │
   ├── Codex Adapter ───── Codex App Server
   │
   └── WorkBuddy Adapter
       ├── User-scoped MCP Connector
       ├── User-scoped visible-event Hooks
       └── WorkBuddy Deep Link
```

### Work Core

唯一拥有领域规则的深 Module。其 Interface 负责创建、更新、分割、完成、恢复、归档、删除和交接 WorkInstance。Codex 与 WorkBuddy 的具体数据格式不得进入该 Interface。

核心对象：

- `WorkDefinition`：工作的本体定义和固定版本；
- `WorkInstance`：一次真实工作；
- `WorkRecord`：WorkInstance 的持久事实；
- `WorkState`：八部分结构化当前状态；
- `Executor`：HUMAN、AGENT、TOOL 或 SAAS；
- `ExecutionEnvironment`：Codex Desktop、WorkBuddy Desktop 等应用环境；
- `ExecutionEpisode`：某个 Executor 在某个环境中执行一段工作的记录；
- `CaptureBinding`：外部对话与 WorkInstance 的绑定；
- `ArtifactRef`：对原始资料与产物的轻量引用；
- `HandoffPackage`：面向目标 Executor 的交接投影。

### Desktop Pet Interface

采集状态由 OPEN 工作的活动绑定统一推导：真实会话为 recording，WorkBuddy 的 pending: 交接和有效 waiting: 授权为 waiting，过期授权或无活动绑定为 stopped。PetView 与 Dashboard 使用同一全局状态计算，recording 优先于 waiting；瞬时 carrying/alert 反馈保持原有行为。选中工作和进程重启不改变全局采集状态。待绑定不再视为当前会话正在记录。

只调用 Work Core Interface，不承担领域判断。PetView 轮询只返回受支持前台聊天的 Adapter、App Server 应用总结标题、已绑定 WorkInstance、`workStatus` 与记录状态，不写入 notice 或持久数据；`workId` 只表达“可以打开历史工作”，不能代替活动记录状态。Helper 原始窗口标题只用于识别，二者在 Context 类型中分开表达。未识别到唯一聊天时隐藏气泡并禁用便利贴操作。用户点击便利贴后重新检测并创建记录，避免使用可能过期的预览缓存；便利贴在已有绑定时改为打开对应工作。Codex 气泡只在当前聊天拥有匹配的 ACTIVE CaptureBinding 时显示“正在记录”；不提供聊天标题的 WorkBuddy 则明确采用应用级单一活动记录，不能伪装成会话级匹配。完成与归档分别显示“已完成”“已归档”。`PetState` 保留四种反馈：`sleeping` 闭眼静止，`awake` 睁眼呼吸，`carrying` 睁眼跳动，`alert` 睁眼摇晃，并继续用体色与状态点辅助区分；四种状态共用与 Dock 图标一致的圆土豆轮廓、右上便利贴和微笑嘴型。透明桌宠窗口固定使用与定位共用的 `304 × 206` 画布，右侧和底部保留足以容纳主体阴影及状态动画的安全区，并通过鼠标穿透避免遮挡来源应用。侧边面板负责 Codex 最近活动来源、可分页的历史聊天选择、Work 列表、只读 Work State、重新整理、交接、完成、归档和永久删除；面板读取已有工作时会幂等同步当前 Codex 聊天的应用总结标题，用于纠正早期版本以首条 Prompt 生成的目标。MVP 保留 macOS Dock 入口；开发与发布都从打包后的 `Worket.app` 启动，以确保 macOS 使用产品名而不是底层 `Electron` 运行时名称；`assets/WorkPet.png` 与 `assets/WorkPet.icns` 仍作为稳定内部资源名提供同一品牌图标。显示名称变更不迁移内部 `workpet` 标识、bundle ID 或原 `WorkPet` 用户数据目录，已有接入配置与本地记录保持兼容。单实例锁拦截重复进程后，重复启动事件必须恢复并聚焦已有窗口，不能静默退出。

### Foreground Context Detector

通过随应用构建的原生 macOS Helper 读取前台应用 bundle ID 与可用窗口标题，且不持久化 Helper 取得的原始窗口标题或内容，不依赖 `osascript` 的辅助功能授权。若桌宠点击时 Worket 面板本身仍是前台，Helper 只在确认前台 PID 是自己的父进程后，向后选择最近的受支持工作窗口；其他不受支持的前台应用不会被跳过。它先把应用归类为 Adapter（同时支持 Codex 的 `com.openai.codex` 与 DOVE 桌面容器），再由 Adapter 解析会话身份：Codex 有窗口标题时只接受与 App Server 应用任务标题的唯一精确匹配，匹配失败不得回退到最近任务；只有容器不提供窗口标题时，才在最近任务处于五分钟活动窗口且领先第二新任务至少五秒、并且存在应用生成标题时绑定。WorkBuddy 5.4.7 的 CoreGraphics 主窗口没有标题，因此前台识别只要求 bundle ID，并把状态限定为 WorkBuddy 应用级单一活动记录；用户点击记录后创建唯一的五分钟待确认 Binding，由下一条官方 `UserPromptSubmit` 的真实 `session_id` 完成绑定。只有 Hook 实际提供窗口标题时才追加指纹校验并持久化不可逆 SHA-256 `sourceLocator`；Hook 没有标题时依靠唯一待确认 Binding 完成授权，不请求辅助功能权限。

### Codex Adapter

位于外部应用 seam。首选通过 Codex App Server 获取任务身份、应用生成的 `thread.name`、完整历史、附件和增量事件，并转换成 Work Core 接受的统一 Source Event。整段对话创建 Work 时，`thread.name` 作为 `conversation.title` 来源事件进入 Source Archive，并成为 `SYSTEM_INFERRED` 的唯一初始目标；首条 Prompt 仍被归档，但不再承担工作命名。若 App Server 尚未生成 `thread.name`，创建动作明确失败，不得回退到 preview、首条 Prompt 或 Helper 窗口标题。旧版整段对话记录在面板读取或用户点击当前聊天的“打开”时执行同一幂等纠正；从指定消息拆出的 Work 不继承整段会话标题。

### WorkBuddy Adapter

位于外部应用 seam。MVP 通过 WorkBuddy 官方支持的用户级配置提供：

- MCP：让 WorkBuddy 按 WorkInstance ID 读取 Handoff Package；
- Hook：把用户 Prompt、Agent 停止、会话结束和资料变化转换成统一 Source Event；
- Deep Link：负责唤起 WorkBuddy、创建全新对话并提交首条接力指令；

`IntegrationInstaller` 在 Worket 每次启动时幂等地合并这些用户级配置；安装不是面板中的手动步骤，且安装失败会阻止 Worket 启动。开发态从项目根目录读取接入资源；打包态通过 `asar.unpackDir` 把 `integrations/` 保留在 `Contents/Resources/app.asar.unpacked` 的实体目录中，供只接受普通文件系统路径的外部 CLI 与 Hook 使用，不把 `app.asar` 内部路径泄漏给外部进程。首次写入或更新配置后，Codex 与 WorkBuddy 需要重启以加载新 Hook/MCP。

本机 WorkBuddy 5.4.7 的目录型 marketplace 会误报安装成功但不生成桌面主进程要求的版本化 cache record。为避免伪安装，MVP 不手工篡改其插件 registry，而是原子合并 `~/.workbuddy/.mcp.json` 与 `~/.workbuddy/settings.json` 中的官方用户级 MCP/Hook 配置。Hook 对所有会话可见，但 Bridge 只接受带有 WorkInstance marker 且存在 OPEN pending binding 的会话；其他会话立即忽略。整个 Adapter 不读取 WorkBuddy 私有数据库。

每次 WorkBuddy 成功读取 `get_work_context` 或 `get_artifact_refs` 后，Bridge 才在当前 WorkBuddy Binding 和 ExecutionEpisode 中原子追加一对不含返回正文的 `tool.call + tool.result` 审计事件，并记录 conversationId、bindingId 与同一 auditId。桌面验收还会在 MCP 返回中加入仅本次运行可见的随机 proof token，并要求同一会话的可见回复带回该值；因此工具失败、旧 Episode 或 Agent 自称“读过”都不能冒充成功。

### WorkStateExtractor

隐藏具体模型实现的 seam。输入为上一版 Work State 与新增 Source Event，输出八部分 Work State 变更。当前 UI 只读展示结果；为兼容早期数据库，它仍不得覆盖历史 `USER_EDITED` 内容或重新创建已有 tombstone 的内容。

### ArtifactTracker 与 ArtifactResolver

`ArtifactTracker` 统一负责编排 Codex 与 WorkBuddy 的资料挂接和使用前复核，避免两个 Adapter 产生不同语义；`ArtifactResolver` 隐藏具体文件存储策略。MVP 只维护原路径与元数据，并在查看、刷新或交接时校验 Hash 和可用性。发生变化时写入新的 ArtifactRef 版本与 `artifact.changed` 来源事件。Work Core 不依赖未来是否加入副本或版本存储。

### Local Persistence

只在本机持久化 WorkDefinition、WorkInstance、WorkRecord、Source Archive、Work State 版本、Capture Binding、ExecutionEpisode、Handoff Package、ArtifactRef、同步游标，以及早期版本可能已有的 tombstone。实现阶段优先选择单机事务数据库；MVP 不需要云数据库。Handoff Package 是不可变快照，交接完成后 MCP 读取最近一次已提交版本；目标应用启动失败时，来源 Binding 与 Episode 在同一补偿流程中恢复。

## Data flow

### 创建记录

```text
用户聚焦 Codex / WorkBuddy
  → PetView 只读识别前台应用和应用生成的会话标题
  → 用户悬浮桌宠并点击展开的便利贴
  → Foreground Context Detector 重新确认前台应用
  → Codex：唯一标题匹配当前任务并读取完整历史
  → WorkBuddy：下一次提交由 Hook 提供真实 session ID
  → Work Core 创建 WorkInstance / WorkRecord / Episode
  → Codex 的 thread.name 作为 conversation.title 与完整历史一同落盘
  → conversation.title 生成可追溯的只读目标
  → WorkStateExtractor 生成八部分 Work State
```

### 增量记录

```text
Codex 或 WorkBuddy 产生新事件
  → 对应 Adapter 转换为统一 Source Event
  → Source Archive 增量落盘并推进同步游标
  → 不自动调用模型
  → 用户查看、刷新或交接时按需更新 Work State
```

### 跨应用接力

```text
用户点击“交给 WorkBuddy”
  → Work Core 更新 Work State
  → HandoffCoordinator 生成 Handoff Package
  → Deep Link 创建全新 WorkBuddy 对话并提交 marker
  → 首条指令携带 WorkInstance ID
  → WorkBuddy 通过 MCP 读取 Work State 与当前资料
  → 建立 WorkBuddy CaptureBinding / ExecutionEpisode
  → 后续事件继续写回同一个 WorkRecord
```

## Status flow

### WorkInstance

```text
OPEN ──用户完成──> COMPLETED
  │                    │
  └──用户归档──> ARCHIVED
                       │
COMPLETED ──继续原工作──> OPEN
```

时间间隔、应用关闭、Mac 重启和 Executor 变化都不改变 WorkInstance 状态。永久删除是经过二次确认的破坏性命令，不是状态。

### ExecutionEpisode

```text
ACTIVE ──交接/完成/解除绑定──> ENDED
```

交接会结束或保留来源 Episode 的历史，并创建目标环境的新 Episode；它不会创建新的 WorkInstance。

### CaptureBinding

```text
ACTIVE ──完成/用户解除──> INACTIVE
INACTIVE ──继续原工作──> ACTIVE
```

## 不可违反的约束

- 核心领域模型不得依赖 Codex、WorkBuddy 或模型供应商字段；
- Source Archive 与 Work State 必须分层保存；
- 每条结构化信息必须保存 origin 与 sourceMessageIds；
- 早期版本已有的 `USER_EDITED` 和 tombstone 不得被模型覆盖，新版 UI 不得新增二者；
- Handoff 主 Prompt 不默认包含完整 Source Archive；
- WorkBuddy 首次接手必须使用全新对话；
- WorkBuddy 用户级 Hook 必须先校验 marker 与 OPEN binding，未绑定会话不得落盘；
- 永久删除不得波及用户原始文件和外部应用对话；
- WorkPattern 未来独立版本化，不修改 WorkDefinition 或历史 WorkRecord。

## MVP 后扩展 seam

- 新 Agent 应用：新增 Adapter，不修改 Work Core；
- 本地模型：新增 WorkStateExtractor Adapter；
- 文件快照：新增 ArtifactResolver Adapter；
- WorkPattern：从已完成 WorkInstance 生成 Candidate，用户确认后形成 Version；
- 云同步：作为本地记录之外的显式能力，不改变本地优先原则。

### 多工作发现与持续记录

`recording-sources.ts → codex:list / codex:history → AppService → CodexAppServerClient.thread/list` 提供轻量来源目录。目录按会话 ID 附带已有 workId；发现来源不创建 WorkInstance。历史接口沿用 App Server nextCursor 分页；最近活动按 updatedAt 排序展示最近五个来源中未记录的聊天，不因长任务超过五分钟而隐藏入口，不依赖独立 App Server 的 notLoaded 状态，也不依赖前台唯一匹配。用户逐项点击后复用 work:create-from-codex，重复选择打开原工作。

主进程在启动后持续调用 syncRecordedCodexWorks，只同步 OPEN 且当前 ACTIVE Binding 为 Codex 的工作，各来源独立失败重试；串行周期避免定时任务重叠。Hook 仍即时补采，事件 externalId 保证幂等。异步读取返回后重查 Binding，完成、删除或交接期间不得把旧来源追加到新执行片段。面板可见时每五秒分别刷新来源和已有记录；来源读取失败不阻止已有记录显示。历史加载和导入错误在原入口显示，可直接重试。

来源目录的 agentName 由 Adapter 在 AppService 中声明，当前 Codex 来源固定为 Codex，不从项目目录或标题猜测。WorkSummaryView 的 agentName 来自活动 ExecutionEpisode，结束后取最后片段。waiting 领域状态保持原义，展示层统一转为“等待发送消息”，面板列表和详情共用 CAPTURE_WAITING_GUIDANCE，桌宠提示发送消息；样式与 recording 区分。
