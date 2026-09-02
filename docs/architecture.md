# 架构：本地 Work Core 与桌面应用 Adapter

## Module architecture

```text
Desktop Pet Interface
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
       └── Deep Link + macOS Accessibility
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

只调用 Work Core Interface，不承担领域判断。负责桌宠状态、一次确认、轻量侧边面板、Work 列表、编辑、交接、完成、归档和永久删除。

### Codex Adapter

位于外部应用 seam。首选通过 Codex App Server 获取任务身份、完整历史、附件和增量事件，并转换成 Work Core 接受的统一 Source Event。

### WorkBuddy Adapter

位于外部应用 seam。MVP 通过 WorkBuddy 官方支持的用户级配置提供：

- MCP：让 WorkBuddy 按 WorkInstance ID 读取 Handoff Package；
- Hook：把用户 Prompt、Agent 停止、会话结束和资料变化转换成统一 Source Event；
- Deep Link：负责唤起 WorkBuddy、创建全新对话并预填首条接力指令；
- macOS 辅助功能：用户授权后只代为按下发送，不读取屏幕或其他对话。

本机 WorkBuddy 5.4.7 的目录型 marketplace 会误报安装成功但不生成桌面主进程要求的版本化 cache record。为避免伪安装，MVP 不手工篡改其插件 registry，而是原子合并 `~/.workbuddy/.mcp.json` 与 `~/.workbuddy/settings.json` 中的官方用户级 MCP/Hook 配置。Hook 对所有会话可见，但 Bridge 只接受带有 WorkInstance marker 且存在 OPEN pending binding 的会话；其他会话立即忽略。整个 Adapter 不读取 WorkBuddy 私有数据库。

### WorkStateExtractor

隐藏具体模型实现的 seam。输入为上一版 Work State 与新增 Source Event，输出八部分 Work State 变更。它不得覆盖 `USER_EDITED` 内容或重新创建已有 tombstone 的内容。

### ArtifactTracker 与 ArtifactResolver

`ArtifactTracker` 统一负责编排 Codex 与 WorkBuddy 的资料挂接和使用前复核，避免两个 Adapter 产生不同语义；`ArtifactResolver` 隐藏具体文件存储策略。MVP 只维护原路径与元数据，并在查看、刷新或交接时校验 Hash 和可用性。发生变化时写入新的 ArtifactRef 版本与 `artifact.changed` 来源事件。Work Core 不依赖未来是否加入副本或版本存储。

### Local Persistence

只在本机持久化 WorkDefinition、WorkInstance、WorkRecord、Source Archive、Work State 版本、Capture Binding、ExecutionEpisode、Handoff Package、ArtifactRef、同步游标和 tombstone。实现阶段优先选择单机事务数据库；MVP 不需要云数据库。Handoff Package 是不可变快照，交接完成后 MCP 读取最近一次已提交版本；目标应用启动失败时，来源 Binding 与 Episode 在同一补偿流程中恢复。

## Data flow

### 创建记录

```text
用户点击桌宠
  → Codex Adapter 识别当前任务并读取完整历史
  → 用户一次确认
  → Work Core 创建 WorkInstance / WorkRecord / Episode
  → Source Archive 本地落盘
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
  → Deep Link 创建全新 WorkBuddy 对话并预填 marker
  → 已授权时 Accessibility 代为发送；否则保留草稿供用户按回车
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
- `USER_EDITED` 和用户删除 tombstone 不得被模型覆盖；
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
