# 执行者平等接入与 WorkBuddy 直接记录

日期：2026-09-09。

状态：实现调查与改造设计；尚未实现、未做真实桌面验收。WorkBuddy 内部扩展接入方式待用户选择，不把安装包内存在某个方法视为接入成功。

## 要解决的问题

Worket 持有工作，外部执行者承担工作。Codex 与 WorkBuddy 在产品里应具有相同地位：已有聊天可以被记录，已记录工作可以交给其他执行者，换执行者不改变 WorkInstance 身份。

当前核心领域已基本表达这一点，但应用层仍把 Codex 当作固定来源、WorkBuddy 当作固定目标。改按钮文字不足以解决问题；记录、历史选择、恢复、同步、交接、定义复用及接手证据都要经过通用接口。

## 已核实的实现事实

### 历史实现

- `ad8fbdb` 建立 WorkBuddy transcript 解析与 Hook 回写。
- `1c276a2` 增加当前前台工作记录。该版本 WorkBuddy 点击记录后建立等待绑定，仍需下次提交取得真实会话 ID；没有发现该版本具备无须提交的历史会话读取入口。
- `a2df40a` 允许 WorkBuddy 不暴露窗口标题时出现桌宠入口。
- `9322af1` 收紧无标题绑定边界；后续增加过期处理与明确等待状态。
- 上述历史支持“可以记录”，不能据此证明曾经实现“和 Codex 一样立即读取选中会话”。

### 当前 Worket

| 位置 | 当前耦合 | 改造责任 |
| --- | --- | --- |
| `src/adapters/foreground/context.ts` | 应用表和类型只列两个应用，只有 Codex 会话解析 | 系统检测只提供应用元数据；会话解析交给适配器 |
| `src/app/app-service.ts` | 历史、导入、分割、刷新、恢复、定时同步偏向 Codex；交接固定 WorkBuddy | 按执行者 ID 路由；保持工作规则与接入协议分离 |
| `src/ui-contract.ts`、`src/preload.cjs`、`src/main.ts` | `listCodexHistory`、`createWorkFromCodex`、`handoffToWorkBuddy` | 改成执行者无关的 IPC 与视图契约 |
| `src/renderer/recording-sources.ts` | 列表只读取 Codex | 统一来源选择；每条来源携带执行者 ID |
| `src/renderer/pet.ts` | 二选一标识及 WorkBuddy 专属等待提示 | 展示注册表元数据及采集状态 |
| `src/renderer/panel.ts` | 固定“交给 WorkBuddy” | “交接”打开执行者选择 |
| `src/distillation/desktop.ts` | 新实例派发直接构造 WorkBuddy Deep Link | 复用相同的交付接口，保留 START 与 CONTINUE 区别 |
| `src/bridge/mcp-handler.ts` | 读取成功审计只接受 WorkBuddy，环境名称写死 | 审计关联实际交付、绑定与执行片段 |
| `src/integrations/installer.ts` | 两应用安装串联，单方失败阻止启动 | 分别检查可用性；单一执行者失败不应阻断其他执行者 |

当前 WorkBuddy transcript 解析器跳过 `tool_use`、`tool_result`、`thinking` 和 `reasoning`。可见工具调用与结果需要独立规范化，不能因过滤隐藏思维而一并漏掉可见工具记录。

### 当前安装的 WorkBuddy

只读检查 `/Applications/WorkBuddy.app/Contents/Resources/app.asar` 的 `package.json`：版本为 **5.5.3**。仓库旧文档基于 **5.4.7**。

安装包中观察到：

- `main/node.js` 的 `createConversationsBridgeService` 暴露 `list`、`get`、`create` 等会话接口。
- `main/contract2.js` 有 `session:list`、`session:get`、`session:event` 等协议声明。
- `main/daemon-bootstrap.js` 实现扩展扫描、独立子进程及受权限检查的消息桥；用户扩展目录包含 `~/.workbuddy/extensions/` 与 `~/.workbuddy/extensions-dev/`。
- 扩展清单缺少权限配置时默认没有授权；验证应使用明确列举的读取权限，不伪装内置扩展、不授予通配权限。
- 集合实现存在 `current`、`setCurrent` 和 `onCurrentChange`，但尚未证实它们可跨进程提供桌面当前聊天身份；桥接集合并未直接列出对应读取方法。
- 尚未安装 Worket 扩展、调用真实会话接口或向 WorkBuddy 发送消息。源码存在与真实可调用之间仍有验证缺口。

[官方 Hook 文档](https://www.codebuddy.cn/docs/cli/hooks) 描述 `session_id` 与 `transcript_path`。这是既有 Hook 路线的协议依据，不能作为桌面内部扩展兼容性的承诺。[官方开放平台](https://open.workbuddy.cn/docs/openapi) 的搜索摘要涉及云任务、助理和 ACP；本次正文抓取失败，未确认其覆盖本机已打开聊天，不能以它替代桌面接入验证。

## 产品操作

### 记录

1. 桌宠识别执行应用，由相应适配器解析精确会话。
2. 已有精确会话身份：点击“记录”导入该聊天已有的可见历史，绑定并持续同步。
3. 身份不明确：打开该执行者的会话选择，用户选一项后立即导入；不默认要求再发送一条消息，不用最近更新的一项冒充当前聊天。
4. “最近活动”“记录沉睡工作”共用来源接口，支持按执行者筛选。列表读取只做发现，点击记录才持久保存内容。
5. 每个已确认会话独立绑定，多项记录可以并行；错误和重试互不阻塞。

WorkBuddy 内部扩展是待验证的首选路线：由 WorkBuddy 自己提供会话列表、可见历史及增量事件，再由本机桥返回 Worket。旧 Hook 可以作为适配器内的兼容方式，但只能展示其真实能力，不能无提示地退回“等待发送消息”并声称立即记录已完成。

### 交接与复用

“交接” → 选择执行者 → 交付同一工作的工作包 → 确认真实目标会话 → 持续记录。

目标列表来自注册表和运行时能力检查，不在 UI 中硬编码。Codex 和 WorkBuddy 都是候选目标；尚未接入的未来执行者不作为可用选项展示。可以切回之前的执行者，也可以选同类执行者的新会话。

继续同一工作使用 `CONTINUE`，保留 WorkInstance；从已确认定义开展下一次工作使用 `START`，创建新 WorkInstance。两者共用交付接口，但不混淆工作身份和工作包内容。

## 通用接口设计

注册表只在装配入口列出实际适配器。UI、AppService、交付协调逻辑不得通过应用名字分支。

```ts
type ExecutorId = string;

interface ConversationRef {
  executorId: ExecutorId;
  conversationId: string;
}

interface ExecutorAdapter {
  readonly descriptor: ExecutorDescriptor;
  inspect(): Promise<ExecutorAvailability>;
  capture?: CapturePort;
  delivery?: DeliveryPort;
  close(): Promise<void>;
}

interface CapturePort {
  resolveCurrent(application: ForegroundApplication): Promise<ContextResolution>;
  list(query: ConversationQuery): Promise<ConversationPage>;
  read(ref: ConversationRef, cursor?: string): Promise<VisibleEventBatch>;
  watch(ref: ConversationRef, onChange: () => void): Promise<() => void>;
}

interface DeliveryPort {
  deliver(request: DeliveryRequest): Promise<DeliveryReceipt>;
}
```

这是接口语义草案，不是已存在的 TypeScript 定义。具体约定：

- `ExecutorDescriptor` 包含稳定 ID、名称、应用身份与显示标识；业务层不依赖固定字符串联合类型。
- `ExecutorAvailability` 区分未安装、接入不可用与可用，以及历史读取、当前会话解析、增量、交付等能力；不把“应用已安装”当作“接入已就绪”。
- `ContextResolution` 明确区分精确身份、需要选择、不可用。来源选择以 `{executorId, conversationId}` 为键，避免不同应用相同会话 ID 冲突。
- `VisibleEventBatch` 只包括用户可见消息、可见工具调用/结果、资料引用及明确游标；保留来源 ID、顺序、时间和环境。快照与增量必须去重，处理流式更新、重连及分割起点。
- `watch` 可由适配器内部使用订阅、Hook 或轮询实现；调用方不关心是哪一种。
- `DeliveryRequest` 包含一次交付 ID、目标执行者、本次工作包及 START/CONTINUE 用途；重复请求必须幂等。
- `DeliveryReceipt` 区分启动失败、已打开但待确认、已取得真实会话身份。启动回执不代表目标已读取工作包；工作包读取与后续可见记录分别保留证据。
- 工作生命周期、授权范围、工作 ID、记录入库、绑定唯一性和交接恢复属于 Worket；应用路径、协议、Hook 格式、Deep Link、SDK 和版本检测属于各适配器。
- 交付前检查目标能力，交付失败保留或恢复来源记录；迟到事件不能写进错误执行片段。执行者切换不自动取消外部应用正在运行的任务。

## 改造顺序与完成标准

1. 验证 WorkBuddy 接入：不发送工作指令，证明扩展可按最小权限列出会话、读取用户选定会话、取得稳定 ID；单独验证当前聊天定位和可见事件过滤。失败则先修正路线，不先把半成品接入 UI。
2. 引入注册表及记录接口；Codex 与 WorkBuddy 都通过相同接口进入来源列表、导入、刷新、恢复、分割和多会话同步。
3. 引入通用交付；交接和定义复用都选择目标执行者，清理固定按钮、IPC、类型、审计和安装逻辑的耦合。
4. 在一个完整功能点做完后运行相关检查并提交；最终打包验证目标应用。

验收必须包括：

- WorkBuddy 的已有静止聊天可以选择并导入，不发送新消息、不消耗一次模型执行。
- 精确前台身份可用时，桌宠点击直接记录；不可用时明确选择会话，无误绑。
- Codex 与 WorkBuddy 各两项工作同时记录，跨应用重复会话 ID 不冲突。
- 用户消息、可见回复、可见工具记录和资料引用保留；隐藏思维不进入 WorkRecord。
- 完成、归档、停止、重启、网络/应用不可用和重复增量不造成越界写入或重复记录。
- Codex → WorkBuddy → Codex 保持同一 WorkInstance；每次交付和真实目标会话有对应执行片段，工作包读取和后续消息可验证。
- 复用时可选择执行者，创建新实例；同一交付重试不重复执行。
- 用第三个测试适配器验证注册后列表与交接可用，无须修改应用服务或渲染层的执行者分支。
- 打包后的真实 Worket 完成 UI 验证；任何会触发外部模型执行或发送工作数据的验收另行使用用户明确授权的工作范围。

## 待选择项

是否接受本机 WorkBuddy 内部扩展接入，并承担版本兼容检测与修复成本。已向用户提出该选择；此文档不代表已获授权安装扩展。
