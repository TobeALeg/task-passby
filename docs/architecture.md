# 架构：本地 Work Core 与桌面应用 Adapter

待讨论的“工作授权与可替换执行者”方向见 [BP 素材 B001](bp/benefits-and-insights.md#b001--工作授权与可替换执行者)。该条目尚未形成架构决策或实现，不改变当前授权与交接规则。

> 2026-09-09：记录、历史选择、同步、恢复、交接与定义复用已通过执行者注册表路由。具体应用协议在适配器内；接口与验证见 [执行者接入方案](specs/executor-adapters-v1.md)。

> 本文主体描述当前实现。沉淀、复用与 2026-09-09 增补的授权改进采集已实现，见末尾实现章节及 [Spec v1](specs/work-distillation-v1.md)。新功能的模型凭据、云端处理、固定资料及定义版本规则以 Spec 为准；现有采集与交接行为不因文档更新而改变。

## Module architecture

```text
Pet / Panel → generic IPC → AppService → Work Core → SQLite
                              │            ├── WorkStateExtractor
                              │            └── ArtifactTracker
                              ▼
                       ExecutorRegistry
                         ├── Codex Adapter → App Server / Hook / native new-chat URL
                         ├── WorkBuddy Adapter → read-only extension socket / Hook / Deep Link
                         └── future adapters
MCP → Work Core work package + read audit
```

注册表装配点为 `src/executors/defaults.ts`。`types.ts` 定义来源读取、当前会话解析、接入安装、可用性检查与交付回执。来源以 `(executorId, conversationId)` 唯一识别；渲染层只使用通用元数据与能力，不写应用名分支。原生前台 Helper 的受支持 bundle ID 通过注册表参数传入。

### Work Core

唯一拥有领域规则的深 Module。其 Interface 负责创建、更新、分割、完成、恢复、归档、删除和交接 WorkInstance。Codex 与 WorkBuddy 的具体数据格式不得进入该 Interface。

核心对象：

- `WorkDefinition`：工作的本体定义和固定版本；包括记录型定义与已确认的可复用定义版本；
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

面板将品牌与 Tab 放入同一个 sticky header。应用服务通过 `executors/project-label.ts` 生成会话的 `projectLabel` 展示字段，最近活动和历史选择共用；原始 `cwd` 保留用于记录与交接。

采集状态从 OPEN 工作的活动绑定推导：真实会话为 recording，`pending:<deliveryId>` 为 waiting，无活动绑定为 stopped。复用工作还需 MCP 工作包读取证据。旧版 `waiting:` 记录保留历史状态，不再用于新会话授权。PetView 与 Dashboard 使用相同全局状态，真实记录优先于等待确认。

桌宠明确解析当前会话后提供记录或打开入口；无法解析则打开执行者会话选择，不猜 WorkBuddy 最新会话。面板负责多来源发现、历史分页、工作状态、交接、完成和归档。原始窗口标题只用于匹配；来源接口提供的应用标题保存为 `conversation.title`，首条消息不冒充标题。未命名会话可显式选择。

保留原有桌宠拖动、位置持久化、75% 缩放、Dock 和单实例恢复。内部 workpet 标识、用户数据目录与 bundle ID 不迁移。

### Foreground Context Detector

macOS Helper 返回应用身份和可用窗口标题。只有前台 PID 为 Worket 自身时才向后寻找注册表列出的工作窗口。具体标题后缀处理和解析属于适配器：Codex 保留唯一标题匹配及无标题容器的唯一近期活动规则；WorkBuddy 无法读取准确当前会话时返回需要选择。第三方执行者不需要修改原生 Helper。

### Codex Adapter

App Server 提供列表与完整可见历史；共享连接初始化，单请求超时 30 秒。Hook 仅触发已绑定来源同步或确认本次交付。交付使用官方 `codex://new?prompt=...&path=...` 打开预填新聊天，用户在 Codex 确认发送，不由 Worket 启动独立模型执行进程。用户级 Worket MCP 提供工作包读取。

### WorkBuddy Adapter

5.5.3 内部扩展安装在 `~/.workbuddy/extensions/worket-capture`，声明 onStartup 与 resident，避免空闲回收后失去读取入口。仅授权 conversations.list/get/requestEntries/requests，通过同用户 0600 Unix socket 提供 list/read/status。历史加载等待 historyReady，分页完整读取并去重；不完整分页失败，不把部分历史当完整导入。

归一化仅接受可见 text、tool 与资料引用，丢弃 reasoning/未知块；回复完成后入库，避免流式首个片段永久占用事件 ID。内部协议不是外部兼容承诺，升级不兼容时应显示接入错误。

用户级 Hook 通知会话身份与变化，Deep Link 创建目标任务。安装逻辑位于各适配器的 install.ts，通用 IntegrationInstaller 分别调用；失败不阻止 Worket 窗口或其他执行者。打包资源通过 asar.unpacked 提供普通文件路径；升级扩展后需要重启 WorkBuddy。

### 通用交付

交付前刷新源状态并核验资料；生成不可变工作包和 deliveryId，结束旧绑定并建立 pending 目标执行片段。短启动指令包含 WORKPET 工作标记、DELIVERY 本次交付标记及 MCP 读取指令，完整包留在 Worket。

Hook 只在工作 OPEN、目标执行者和两个标记均匹配时确认真实 session；重复点击和已待确认的交付不得重复打开目标。失败补偿恢复原来源；取消需要确认未接手，恢复前一真实绑定。旧标记不能绑定下一轮交付。恢复工作使用最后一个真实执行者。切换不取消外部应用已经执行的任务。

MCP 成功读取审计使用当前 Binding、Episode 与环境，工作包读取和目标会话确认是分开的证据。通用服务每轮同步全部真实活动绑定；异步读取完成后重新检查生命周期和 binding ID，避免旧来源写入新执行片段。事件序号跨执行片段递增，externalId 去重。

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
  → 适配器解析会话，不能确定时由用户选择
  → 统一来源接口读取完整可见历史
  → Work Core 创建 WorkInstance / WorkRecord / Episode
  → 来源会话标题作为 conversation.title 与历史一同落盘
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
用户点击“交接”并选择执行者
  → Work Core 更新 Work State
  → HandoffCoordinator 生成 Handoff Package
  → 适配器打开目标新会话，提交工作与本次交付 marker
  → 首条指令携带 WorkInstance ID
  → 目标执行者通过 MCP 读取 Work State 与当前资料
  → 确认目标 CaptureBinding / ExecutionEpisode
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

时间间隔、应用关闭、Mac 重启和 Executor 变化都不改变 WorkInstance 状态。取消记录通过 `cancelRecording` / `work:cancel-recording` 撤销记录授权并清理本地副本，需要二次确认，不新增生命周期状态。底层 `deleteWorkPermanently` 仅负责 Worket 本地数据清理；执行者接口不提供原对话删除能力。清理关联证据时按显式主键 `id` 更新，避免 Electron SQLite 的隐式行标识返回差异。

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
- 取消记录不得波及用户原始文件和外部应用对话；
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

桌宠 pointer capture 区分点击与拖动，经 preload 的 pet:drag IPC 通知主进程。主进程校验发送窗口，校验事件携带的有限桌面坐标，使用按下点与当前点的坐标差移动 BrowserWindow，拖动期间禁用鼠标穿透。desktop/pet-layout.ts 提供吸附阈值、尺寸及纯几何计算；desktop/pet-position.ts 的 PetPosition 统一负责拖动、贴边状态、工作区边界与本地 pet-position.json 的保存恢复；该偏好不进入工作记录。显示器变更触发可见性修正。

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

数据库 `user_version=2` 升级前保存 `.before-distillation-v1.bak`。旧实例及 GENERAL 定义不改身份。未来更高版本的库被本应用拒绝；真实采集绑定表迁至 `capture_bindings_v2`，原表名保留升级屏障，使基线旧二进制初始化失败，回滚必须恢复备份。取消记录时一并移除工具管理的迁移备份，避免备份保留已删正文。取消和发布在本地事务串行裁决；删除来源还清理快照文件文本、来源摘录与失效草稿，并排队取消远端。

验证证据和未通过项见 [沉淀验收记录](acceptance/work-distillation-v1.md)。

### 可配置后台

`server/start.mjs → createManagedService → AdminStore + createAdminHandler + createAIService` 在同一个本机监听端口提供管理页面与模型服务。`build:server` 单独编译共享契约和存储序列化代码，服务器启动不依赖 Electron。旧环境变量部署入口保留为 `server/start-env.mjs`。

管理页模型与额度共用 `config-form` 和 `PUT /admin/api/config`；两个卡片各提供提交按钮，额度卡片就近显示修改、保存和失败状态。保存与连接测试共用按钮禁用控制，保持现有 revision、CSRF 和完整配置校验。

本机管理员密码最少 6 位；`/admin/` 页面通过密码会话及 CSRF 访问管理 API；管理入口校验 loopback 地址、Host、Origin 和转发来源头。`AdminStore` 原子保存配置、scrypt 密码哈希与接入元数据，供应商 Key 经 AES-256-GCM 加密。密钥与配置在同一私有目录，保护边界是系统账户权限，不能宣称系统账户失守后仍安全。

模型配置从未配置变为已配置；测试连接使用未保存表单和固定文本，单次调用不自动保存。保存用 revision 拒绝旧页面覆盖，并在没有运行中请求或连接测试时热更新 Provider 和限额。后台签发有期限的 RS256 令牌，客户端仅获取一次；运行服务每次验证已登记主体及撤销状态，接收完整上传后再次复核，避免撤销期间的迟到请求启动模型。撤销会取消任务并清理内存结果。

`settings.json`、签名私钥和加密主密钥共同构成可恢复配置；`metadata.sqlite` 继续仅保存请求和用量元数据。管理会话只存内存，重启后需重新登录，客户端身份有效期内可继续使用。默认 `.worket-server/` 不进入 Git 或桌面包。部署为单实例、代理仅开放 HTTPS 的 `/v1/` 和健康检查，服务器管理通过 SSH 隧道访问。

### 产品改进数据链（2026-09-09 已实现）

`Worket AI Service` 的分析输入和结果缓存保持内存暂存；新增 `ImprovementCollector` 与 `ImprovementStore` 形成独立采集链：客户端确认范围和改进用途授权 → 提交固定材料 → 关联模型候选及版本 → 追加用户实际修订和确认 → 经新范围授权关联复用反馈 → 管理员评审。真实效果评测留待下一阶段。

工作库与正式定义仍以客户端为权威；后台保存用于改进 Worket 的授权样本，不接管原工作的正式状态。改进样本、任务结果缓存、运行元数据使用独立生命周期：ack 清理任务结果缓存，样本由其授权、留存和删除规则管理。旧版 `worket-data-v1` 只表示模型处理授权，不能自动开启正文留存。

`src/contracts/improvement.ts` 集中定义协议与 90 天期限；`server/improvement.mjs` 在独立私有 `improvement.sqlite` 保存授权、事件、评审及接收开关，正文不会进入 `metadata.sqlite`。样本键从认证主体和客户端样本 ID 推导；同事件 ID 重传幂等，正文变化拒绝。客户端只可提交或删除自己的样本，读取正文与写评审须后台会话及 CSRF。Provider 无样本库查询权限，上传接口与模型配置、调用和 ack 无依赖。

`ImprovementCollector` 在工作库中维护明确授权的 subscriptions 与 outbox，以及单行 `improvement_preferences` 持久偏好（缺省开启）；桌面通过 `improvementPreference` / `setImprovementPreference` 读取和修改。取消勾选或停止全部时，以同一事务保存关闭偏好、停止全部活动订阅并清空待发正文；停止单个样本不改变全局偏好，重新开启不复活旧订阅。范围页直接展示选项，提交前等待设置保存，重启后从工作库恢复；仅排队固定范围，已收到的队列项清空正文。同步校验授权时的服务/凭据指纹；身份变化暂停发送。`DistillationService.collectFeedback` 从已授权任务、原始候选及持久化 `review_events` 补齐修改、发布、验收，因此应用在保存后退出也能恢复反馈。复用文件输入被替换为仅选择标记，不上传路径或内容；沉淀快照排除 `reasoning.summary`，本地旧记录不修改。

状态流：ACTIVE → STOPPED（停止并清空待发正文）或 DELETE_PENDING → DELETED（服务确认删除）。上传和删除串行；已发出的上传可能在停止之后到达，随后删除仍清除它。服务端删除原材料、候选、反馈、评审并保留只含哈希键的 tombstone，阻止迟到重传复活；SQLite 开启 secure_delete。90 天按授权时间固定，到期在服务启动、请求或定时清理时移除，不因反馈续期。首版不产生另存正文的评测派生副本。每主体最多 1000 份样本、每样本最多 1000 条事件，单事件包最多 4 MiB。

授权凭据到期或无法恢复时，可由后台管理员删除。原工作和正式定义仍独立保存。现有样本不导入；真实纠正案例评测尚未实施。

下一轮 [工作定义提取执行依据](work-object-extraction-execution-plan.md) 优先复用现有定义契约、提取流程与私有样本链，补充真实案例评审和版本对比。分块中间结果的信息保留属于待验证风险，只有真实错误支持时才调整提取流程；试点所需的评测工具、模型调用和新实例实验尚未执行，不新增已实现状态或扩大采集边界。

### 桌面应用更新

`desktop/app-updates.ts` 管理检查并发、下载确认、提示及 Finder 定位；`desktop/github-release.ts` 读取公开 GitHub `releases/latest`，比较稳定版本，按严格文件名选择本机架构 ZIP 和 SHA256。主进程注入 Electron net.fetch，下载流式写入系统下载目录中的独立临时文件夹，大小和 SHA256 校验通过后才将 .part 改名为 ZIP。失败清理，不解压或执行附件。

状态流：闲置 → 检查 → 用户确认 → 下载校验 → Finder 定位；稍后、无更新或失败返回闲置。用户自行退出、替换和重开应用；不存在 autoUpdater 或原生安装调用。开发模式不检查。`scripts/release-mac.mjs` 负责免费 ad-hoc 签名、打包及解压 QA，不要求 Apple 公证，不自动发布。GitHub token 不进入客户端，数据目录和 bundle ID 保持稳定。

### VPS 安装身份与自动连接

`AutomaticConnection` 使用 `ServiceCredentials` 保存每安装 32 字节随机秘密，`WorketAIClient` 在请求前确保接入就绪。后台 `/v1/installations` 只存秘密的 SHA256，签发 RS256 令牌并按原安装续期；撤销后同秘密不能重建身份。客户端改进队列以服务地址和安装秘密的哈希标识目的地，令牌续期不改变目的地；手动凭据仍按原指纹规则处理。网络请求进行中若手动切换服务，迟到注册结果不能覆盖新配置。

自动接入由服务端显式环境开关开启；单 IP 每小时最多 60 次注册/续期请求、服务每小时最多 1000 次、最多 1000 个接入主体。公网代理覆盖来源地址头，服务仅在配置为信任本机代理时使用该头。模型调用按全局滚动 24 小时默认 200 次限额预占，保留原每主体限额和并发限制；这是调用次数限额，不是固定金额承诺。后台默认绑定 loopback，VPS 部署用独立 `worket` 和 `worket-edge` 服务。

当前 VPS 代码由 `/opt/worket/current` 指向版本目录，数据独立放在 `/var/lib/worket/data`。Caddy 仅代理 HTTPS `/v1/*` 和 `/health`，管理员从 SSH 隧道访问 loopback。Certbot 的 IP 证书经部署 hook 复制到 Caddy 的只读证书目录，每日两次检查续期，已通过带 hook 的续期演练。IP 客户端不发 SNI 时通过 `default_sni` 选取证书；客户端保持正常证书校验。模型密钥迁移与管理员初始化分开执行，前者需明确迁移授权。实测范围和待完成项目见 [VPS 部署记录](deployment/vps-operation.md)。

2026-09-11 已获用户授权迁移 DeepSeek 配置。实测发现模型可将 `content.purpose` 返回为字符串，并把中间层改写文本当作原始引文。`work-definition-v1.2` 明确目标必须是带来源依据的 Item 对象，聚合阶段只引用真实来源/事件键，不生成缺少原文验证条件的 excerpt；既有对象、引用和证据校验保持严格，不自动补造来源依据。

### 记录触发的对话样本（2026-09-11）

`AppService` 在主动创建、拆分和恢复记录成功后发出记录开始回调，完成、归档、取消记录时发出停止回调；桌面主进程将其接入 `RecordingCollection`。该模块用 `recording_samples` 关联工作与独立样本 ID，并复用 `ImprovementCollector` 的偏好、持久队列、身份绑定、重试与删除，不依赖沉淀或模型。只有明确登记的工作参与扫描；旧工作不迁移为采集范围。拆分成功才停止原采集并登记新范围，失败时保持原记录。

协议增加 `RECORDING` 范围与独立授权版本 `worket-recording-v1`，`RECORDING` 首事件建立来源工作关联，`MESSAGE` 事件仅含消息 ID、序号、发言类型、时间、分片编号与正文。长文本按 16000 UTF-16 单元分片，无截断；客户端按来源事件 ID 和分片去重，服务器按样本事件 ID 幂等。服务端白名单拒绝工具、推理事件及额外元数据。现有每样本 1000 事件额度仍生效，达到额度后停止该样本并显示 `QUOTA_EXCEEDED`；90 天期限由本次登记开始，后续消息不续期。

`DistillationService.collectFeedback` 同时推进已登记记录的对话队列，并跳过这些订阅的沉淀任务查找。退出采集后不自动恢复，主动恢复记录生成新的授权样本；取消记录后后台已有样本保留至用户删除或到期。管理页增加工作记录与对话事件标签，沿用管理员鉴权、评审和删除接口。服务端须随新协议升级；本轮尚未部署、打包或发布。

记录提示频率：`recording_notice` 在本机工作库保存已确认的说明版本。`RecordingCollection.noticeRequired()` 根据参与改进偏好与当前 `recordingVersion` 决定是否展示；只有主动记录成功登记后写入版本，不根据历史订阅、页面打开或启动推断。桌宠和面板通过同一应用层状态控制首次提示，后续记录及重启共享确认状态。关闭再开启参与改进不重置同版提示，版本变化会重新展示；此状态只控制提示频率，不扩大上传范围，也不恢复已停止的订阅。

桌宠贴边状态为 free/left/right/top/bottom；保存窗口坐标、可见角色中心 center 与 edge，兼容旧版坐标配置。自由状态由 placeFloatingPet 约束角色边界，并计算角色在透明窗口内的位置；pet:placement 与 pet:get-view 传递相同 placement，气泡靠近顶部时向下展开。底部吸附使用 display.bounds，其他边缘使用 workArea。dock-space.ts 只读 Dock plist 中的图标数量、尺寸和方向，估算中央避让宽度；失败时保守预留中央 80% 屏宽，不请求辅助功能权限。无边框桌宠启用 enableLargerThanScreen，避免 macOS 将底部窗口推回 Dock 上方，实际可见性仍由 PetPosition 约束。重启及显示器变化恢复角色中心和吸附状态；点击和拖动保持分离。

2026-09-11 用户确认 B「双爪偷看」：四向吸附统一采用小圆头、两只眼睛和贴边爪尖，隐藏嘴巴，露出约 19 像素；保留状态点、点击打开和拖离恢复。原生点击窗口仍为 32×68 / 68×32。

2026-09-11 双爪造型微调：露出轮廓改为宽圆角，眼睛向中间和边缘内侧收拢，保持约 19 像素露出高度及原点击窗口尺寸。

2026-09-11 贴边头部进一步调整为 48×34 椭圆，取消平底圆角，保持 19 像素露出高度、内收眼睛和贴边双爪。

2026-09-11 拖动与底部吸附统一空白区域规则：petMovementArea 按完整角色宽度判断 Dock 两侧通道，将通道内可移动区域延伸到 display.bounds 底部，中央仍用 workArea。renderer 用 requestAnimationFrame 合并 pointermove，结束拖动前同步发送最后坐标；主进程跳过相同 bounds 的原生窗口更新。qa-pet-drag 在松手前验证底部通道中的角色中心跟随指针，防止两套边界再次产生跳跃。

2026-09-11 PetPosition.absorb 暂时扩展原生窗口覆盖起始与目标位置，placement.motion 传递起点、终点、时长及动作 ID；renderer/pet-motion.ts 用 Web Animations 执行缩入与显露，完成后移除临时角色。320 毫秒后主进程收小窗口，保存仍使用最终坐标。新拖动和显示器恢复会结束未完成收纳，拖出通过 emerge 做短展开；中间状态不写入偏好。

2026-09-11 记录呼吸仅由 .docked .pet.awake .status-dot 控制，复用全局记录状态映射，不增加计时器或轮询；waiting、carrying、alert 与 sleeping 不使用记录呼吸。

### 渲染层一致性（2026-09-11）

`src/renderer/panel.css` 集中定义系统字体、纸色与棕金颜色、30px 控件、8px 圆角、焦点与禁用状态；所有动态沉淀 / 服务弹窗使用同一基础控件规则。弹窗自身约束宽高，内部卡片不再设置冲突宽度。桌宠气泡与后台样式沿用相同字体和暖黄 / 棕金操作体系。

`panel.ts` 以当前标签、详情是否打开和批量选择集合管理视图。主进程 `panel:shown` 可携带工作 ID，使桌宠记录入口准确进入详情；普通打开面板保留当前位置。工作操作采用防重复提交和可见错误反馈；轮询在弹窗、菜单和表单操作时暂停，工作数据未变化时保留 DOM。更多菜单支持点击外部 / Escape 收起，并在短窗口内调整位置。候选编辑的局部重绘保留问题处理内容，保存修改保留已选固定资料。

验收使用 `scripts/qa-interface.mjs` 的合成页面与临时后台，以及现有 Electron、记录提示、沉淀流程脚本。截图为开发证据，独立于真实模型、外部执行者与发布包验收。

2026-09-11 视觉复核：面板默认窗口调整为 400×660；纸纹通过低对比度内嵌 SVG 噪声平铺实现，不引入图片请求、动画或额外依赖。详情交接状态使用内联文字，移除黄色横幅和重复上传说明；错误提示仍有独立可访问反馈。
