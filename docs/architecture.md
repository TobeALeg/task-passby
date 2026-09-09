# 架构：本地 Work Core 与桌面应用 Adapter

> 2026-09-09 待实施改造：通过执行者注册表、采集接口与交付接口统一历史读取、当前会话解析、记录、恢复、同步、交接及定义复用。具体应用协议仅保留在适配器中。已查明耦合位置、WorkBuddy 5.5.3 接口线索和未验证事项，见 [执行者接入方案](specs/executor-adapters-v1.md)；本文其余部分仍描述当前实现。

> 本文主体描述当前实现。沉淀、复用与 2026-09-09 增补的授权改进采集已实现，见末尾实现章节及 [Spec v1](specs/work-distillation-v1.md)。新功能的模型凭据、云端处理、固定资料及定义版本规则以 Spec 为准；现有采集与交接行为不因文档更新而改变。

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

- `WorkDefinition`：工作的本体定义和固定版本；当前仅有 ID、key、name、version，尚无可执行的定义内容；
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
- 未来若增加 WorkPattern，须与 WorkDefinition 明确区分；本次沉淀使用 WorkDefinition，不新增同义模板或模式实体，不反向修改历史 WorkRecord。

## MVP 后扩展 seam

- 新 Agent 应用：新增 Adapter，不修改 Work Core；
- 本地模型：新增 WorkStateExtractor Adapter；
- 文件快照：下一阶段为定义固定资料增加独立本地副本存储，不扩展成全文件历史；
- 工作沉淀：从用户主动选择的一条或多条记录生成 DefinitionDraft，确认后保存 WorkDefinition 固定版本；WorkPattern 暂不实现；
- 云同步：作为本地记录之外的显式能力，不改变本地优先原则。

### 多工作发现与持续记录

`recording-sources.ts → codex:list / codex:history → AppService → CodexAppServerClient.thread/list` 提供轻量来源目录。目录按会话 ID 附带已有 workId；发现来源不创建 WorkInstance。历史接口沿用 App Server nextCursor 分页；最近活动按 updatedAt 排序展示最近五个来源中未记录的聊天，不因长任务超过五分钟而隐藏入口，不依赖独立 App Server 的 notLoaded 状态，也不依赖前台唯一匹配。用户逐项点击后复用 work:create-from-codex，重复选择打开原工作。

主进程在启动后持续调用 syncRecordedCodexWorks，只同步 OPEN 且当前 ACTIVE Binding 为 Codex 的工作，各来源独立失败重试；串行周期避免定时任务重叠。Hook 仍即时补采，事件 externalId 保证幂等。异步读取返回后重查 Binding，完成、删除或交接期间不得把旧来源追加到新执行片段。面板可见时每五秒分别刷新来源和已有记录；来源读取失败不阻止已有记录显示。历史加载和导入错误在原入口显示，可直接重试。

来源目录的 agentName 由 Adapter 在 AppService 中声明，当前 Codex 来源固定为 Codex，不从项目目录或标题猜测。WorkSummaryView 的 agentName 来自活动 ExecutionEpisode，结束后取最后片段。waiting 领域状态保持原义，展示层统一转为“等待发送消息”，面板列表和详情共用 CAPTURE_WAITING_GUIDANCE，桌宠提示发送消息；样式与 recording 区分。

面板以 PanelTab（RECENT 或 WorkStatus）控制两个互斥 tabpanel：sources-panel 只负责来源选择，works-panel 展示当前生命周期的列表、通知和详情。Tab 是 UI 状态，不引入新的工作生命周期；刷新保留 Tab，用户执行记录或生命周期操作后跟随目标工作状态。

### 桌宠自由移动

桌宠 pointer capture 区分点击与拖动，经 preload 的 pet:drag IPC 通知主进程。主进程校验发送窗口，校验事件携带的有限桌面坐标，使用按下点与当前点的坐标差移动 BrowserWindow，拖动期间禁用鼠标穿透。desktop/pet-position.ts 负责工作区边界与本地 pet-position.json 的保存恢复；该偏好不进入工作记录。显示器变更触发可见性修正。

窗口 closed 事件清空引用；退出期间以及窗口已销毁时，activate / second-instance 不再调用窗口方法，避免 Object has been destroyed。

角色尺寸由 .pet 的 zoom: .75 统一控制，布局与命中区域同步缩放，内部动画继续使用原有 transform；透明窗口保留气泡和阴影所需空间。

## 沉淀与复用（已开发，真实验收待完成）

“沉淀”取代此前将复用能力混入归档的方向。沉淀产生定义对象；ARCHIVED 仍属于原工作生命周期，历史记录保留，主要入口调整为定义视图，归档退到次级区域。

### Module relationship

```text
Desktop UI → DistillationService → DefinitionRepository / Work Core → Local SQLite
                    │                        │
                    │                        └→ DefinitionMaterialStore
                    ▼
              WorketAIClient → Worket AI Service → ModelProvider

Work Core → WorkPackageBuilder → WorkBuddy Adapter / Markdown + JSON 导出
```

WorkDefinitionExtractor 与现有 WorkStateExtractor 独立：前者只在用户主动沉淀时工作，后者描述当前实例状态。它们可共用模型服务基础设施，不能因整理状态自动创建定义。

Worket AI Service 负责固定的提取、比较、泛化与校验流程，不提供 shell、任意文件读取或通用自主 Agent。供应商 Key 仅在服务端；工作库、定义权威版本和正式实例状态保存在本地。后台采用经用户授权的材料暂存和无正文的运行/用量记录，身份、幂等与限额为公开服务必要边界。

### Data flow

```text
用户选择记录 → 本地快照与范围确认 → 开始沉淀
    → Worket 后台模型抽象 → 候选定义与问题
    → 用户检查修改 → 固定定义版本与固定资料副本
    → 本次新输入 → 新 WorkInstance → 工作包 → 外部执行 → 用户验收
```

新实例创建必须与外部对话绑定分开。现有 createWork 的导入路径保留；新增 createWorkFromDefinition 可创建尚无 CaptureBinding 的工作。交接继续原 workId，复用创建新 workId。

### Status flow

沉淀任务、候选编辑与 WorkInstance 生命周期分别保存。沉淀任务从 PREPARED 经 RUNNING、AWAITING_REVIEW 到 SAVED；无关多选进入 NEEDS_SELECTION，失败和取消有独立状态。“已沉淀”查询定义集合，不新增 WorkStatus，也不将旧 ARCHIVED 数据解释为定义。

work_definitions 现有一行对应一个 key/version 的形式继续作为固定版本存储，扩展定义内容与确认来源；general-work 保持旧语义。模型结果先进入草稿，用户确认后才发布，运行中的实例固定引用原版本。详细契约、迁移、错误与验收见 [Spec](specs/work-distillation-v1.md)。

### 本次代码与持久化

`src/contracts/definition.ts` 为运行时内容/引用/覆盖契约；`src/distillation/service.ts` 固定来源、驱动异步请求并在后台轮询，模型不在 SQLite 事务内运行。`src/definitions/repository.ts` 与 Work Core 共用连接，保存候选 revision、用户审阅、定义版本、输入和命令幂等结果。`storage.ts` 写临时文件后校验并原子落位固定副本。

`server/workflow.mjs` 仅串行调用 Provider 做分块提取和聚合；`server/service.mjs` 负责主体验证、预占调用额度、元数据以及短时结果。服务器源码排除在桌面发布包外。客户端 `WorketAIClient` 只发请求内 source key、顺序、文本和显式附件范围，safeStorage 保护 Worket 访问令牌。管理员签发的 RS256 身份与撤销由 managed service 提供；公开用户自助登录与 HTTPS 部署仍待接入。

`createWorkFromDefinition` 在单个事务里创建无执行片段/无绑定的新工作，写入本地采用定义与输入事件。`pending_dispatches` 只表达交付意图，真实 Hook 到达后才建立 ExecutionEpisode/CaptureBinding；MCP 读取独立记证。`WorkPackageBuilder` 保留旧 Handoff 字段，以 `workPackage.packageVersion=1` 扩展 START/CONTINUE、固定定义、本次输入与本地资料。

数据库 `user_version=2` 升级前保存 `.before-distillation-v1.bak`。旧实例及 GENERAL 定义不改身份。未来更高版本的库被本应用拒绝；真实采集绑定表迁至 `capture_bindings_v2`，原表名保留升级屏障，使基线旧二进制初始化失败，回滚必须恢复备份。永久删除来源时一并移除工具管理的迁移备份，避免备份保留已删正文。取消和发布在本地事务串行裁决；删除来源还清理快照文件文本、来源摘录与失效草稿，并排队取消远端。

验证证据和未通过项见 [沉淀验收记录](acceptance/work-distillation-v1.md)。

### 可配置后台

`server/start.mjs → createManagedService → AdminStore + createAdminHandler + createAIService` 在同一个本机监听端口提供管理页面与模型服务。`build:server` 单独编译共享契约和存储序列化代码，服务器启动不依赖 Electron。旧环境变量部署入口保留为 `server/start-env.mjs`。

本机管理员密码最少 6 位；`/admin/` 页面通过密码会话及 CSRF 访问管理 API；管理入口校验 loopback 地址、Host、Origin 和转发来源头。`AdminStore` 原子保存配置、scrypt 密码哈希与接入元数据，供应商 Key 经 AES-256-GCM 加密。密钥与配置在同一私有目录，保护边界是系统账户权限，不能宣称系统账户失守后仍安全。

模型配置从未配置变为已配置；测试连接使用未保存表单和固定文本，单次调用不自动保存。保存用 revision 拒绝旧页面覆盖，并在没有运行中请求或连接测试时热更新 Provider 和限额。后台签发有期限的 RS256 令牌，客户端仅获取一次；运行服务每次验证已登记主体及撤销状态，接收完整上传后再次复核，避免撤销期间的迟到请求启动模型。撤销会取消任务并清理内存结果。

`settings.json`、签名私钥和加密主密钥共同构成可恢复配置；`metadata.sqlite` 继续仅保存请求和用量元数据。管理会话只存内存，重启后需重新登录，客户端身份有效期内可继续使用。默认 `.worket-server/` 不进入 Git 或桌面包。部署为单实例、代理仅开放 HTTPS 的 `/v1/` 和健康检查，服务器管理通过 SSH 隧道访问。

### 产品改进数据链（2026-09-09 已实现）

`Worket AI Service` 的分析输入和结果缓存保持内存暂存；新增 `ImprovementCollector` 与 `ImprovementStore` 形成独立采集链：客户端确认范围和改进用途授权 → 提交固定材料 → 关联模型候选及版本 → 追加用户实际修订和确认 → 经新范围授权关联复用反馈 → 管理员评审。真实效果评测留待下一阶段。

工作库与正式定义仍以客户端为权威；后台保存用于改进 Worket 的授权样本，不接管原工作的正式状态。改进样本、任务结果缓存、运行元数据使用独立生命周期：ack 清理任务结果缓存，样本由其授权、留存和删除规则管理。旧版 `worket-data-v1` 只表示模型处理授权，不能自动开启正文留存。

`src/contracts/improvement.ts` 集中定义协议与 90 天期限；`server/improvement.mjs` 在独立私有 `improvement.sqlite` 保存授权、事件、评审及接收开关，正文不会进入 `metadata.sqlite`。样本键从认证主体和客户端样本 ID 推导；同事件 ID 重传幂等，正文变化拒绝。客户端只可提交或删除自己的样本，读取正文与写评审须后台会话及 CSRF。Provider 无样本库查询权限，上传接口与模型配置、调用和 ack 无依赖。

`ImprovementCollector` 在工作库中维护明确授权的 subscriptions 与 outbox；仅排队固定范围，已收到的队列项清空正文。同步校验授权时的服务/凭据指纹；身份变化暂停发送。`DistillationService.collectFeedback` 从已授权任务、原始候选及持久化 `review_events` 补齐修改、发布、验收，因此应用在保存后退出也能恢复反馈。复用文件输入被替换为仅选择标记，不上传路径或内容；沉淀快照排除 `reasoning.summary`，本地旧记录不修改。

状态流：ACTIVE → STOPPED（停止并清空待发正文）或 DELETE_PENDING → DELETED（服务确认删除）。上传和删除串行；已发出的上传可能在停止之后到达，随后删除仍清除它。服务端删除原材料、候选、反馈、评审并保留只含哈希键的 tombstone，阻止迟到重传复活；SQLite 开启 secure_delete。90 天按授权时间固定，到期在服务启动、请求或定时清理时移除，不因反馈续期。首版不产生另存正文的评测派生副本。每主体最多 1000 份样本、每样本最多 1000 条事件，单事件包最多 4 MiB。

授权凭据到期或无法恢复时，可由后台管理员删除。原工作和正式定义仍独立保存。现有样本不导入；真实纠正案例评测尚未实施。

下一轮 [工作定义提取执行依据](work-object-extraction-execution-plan.md) 优先复用现有定义契约、提取流程与私有样本链，补充真实案例评审和版本对比。分块中间结果的信息保留属于待验证风险，只有真实错误支持时才调整提取流程；试点所需的评测工具、模型调用和新实例实验尚未执行，不新增已实现状态或扩大采集边界。
