# π-Bench 跨模型接力实验：执行检查点（2026-09-12）

这份记录用于跨 Codex 窗口继续执行。完整、冻结的实验定义仍以 [评测方案 v1](pi-bench-cross-model-handoff-evaluation-v1.md) 为准；本文只记录已经做过的工程工作、被排除的试跑、当前断点和下一步，不替代预注册方案。

## 1. 当前结论与边界

- 用户已明确：不要求 Docker。实验改为 Windows 本机原生 Python/AppWorld/NanoBot 环境；Docker Desktop 的未完成安装进程已停止，残留安装包已删除。
- π-Bench 官方仓库和完整 AppWorld 数据已经在本机就绪，真实 AppWorld 加载与包测试已通过。
- DeepSeek 与千问 API key 均由运行器从桌面文件读取并完成最小调用验证；任何 key 内容都没有写入仓库、本文或实验输出。2026-09-13 用户将 Qwen 主端点切换为阿里云 Token Plan，原 DashScope 端点保留为备用。
- 真实 Worket Core/MCP 预检和 A/B/C AppWorld 快照同源分叉预检已经通过。
- P0、P1 与 P2 已于 2026-09-13 完成。P3 按用户指令在当前 Qwen 返回后暂停：现有可评分结果为 57/72（DeepSeek 36/36、Qwen 21/36），另有 1 条 Token Plan 未评分超时；此前明确排除的工程试跑仍不能引用其分数。
- AppWorld 默认完整工具集偏差已经修复。首对有效样本均实际注册 469 个 AppWorld 工具（10 个应用），没有因 schema 规模触发上下文或 API 失败。
- P2 发现校准驱动器错误读取单任务结果中的用户级总体字段；现已改为读取任务级 COMP/PROC。无 checklist/tool evaluator 的任务保留 `COMP=null`（不适用），不能记为 0；两条 P2 运行本身协议有效，无需重跑。
- 现有 21 条公平配对子集的 COMP 差为 6.263pp、PROC 差为 13.492pp，marketer COMP 差为 13.333pp，均超过对应暂定门槛；但只有 6/12 个完整任务块，故正式判定为 `INCONCLUSIVE_PARTIAL_CALIBRATION`，不是完整 gate 通过或失败。详见 [现有结果汇总](pi-bench-calibration-existing-results-2026-09-13.md)。

## 2. 已完成的工作

### 2.1 冻结方案与样本

- 方案：`docs/design/pi-bench-cross-model-handoff-evaluation-v1.md`
- π-Bench 上游冻结 commit：`383910b1698758a198b86037c63a111c8edc32ad`（2026-06-04）
- 上游位置（忽略输出）：`output/pi-bench-upstream`
- 已逐条语义复核 11 条依赖链，确认同一 WorkInstance 连续性；4 条 marketer 链先作 pilot，正式实验为 11 条链 × 3 repeats。
- A/B/C 的共同控制：只运行一次 DeepSeek 前缀，冻结对话、工具、文件和 AppWorld 状态，再从同一快照分叉。
- A：DeepSeek 不换手继续；B：Qwen 接收完整可见原文；C：Qwen 经真实 Worket Handoff Package、Work State、Source Archive、ArtifactRef 和标准 MCP 接手。
- 主比较为 `C−B`，另报 `A−B` 与 `A−C`；C 若未真实调用 Worket 标准读取路径，不得作为产品效果。

### 2.2 原生环境

- Python 虚拟环境：`output/pi-bench-native/.venv`，Python 3.14.3。
- 已安装官方 π-Bench、AppWorld、NanoBot；AppWorld 完整数据版本 0.2.0，共约 14,885 个文件。
- AppWorld 全部包测试结果：1,651 passed，1 skipped。
- 原生运行器：`experiments/pi-bench-handoff/native_harness.py`
- JavaScript 编排与环境预检：`experiments/pi-bench-handoff/run.mjs`
- 当前 `environment-preflight` 已通过，结果位于 `output/pi-bench-handoff/environment-preflight.json`。

### 2.3 模型与 API 预检及运行中端点切换

- 来源模型：DeepSeek 官方 `deepseek-flash`。
- 冻结目标候选：阿里云百炼 `qwen3.8-max-0902`；预注册回退模型：`qwen3.8-flash`，仅在完整 Max 校准不匹配时启用。
- DeepSeek key 文件：桌面 `dskey.txt`；Qwen key 文件：桌面 `aliapikey.txt`。只保存文件路径，不保存 key。
- DeepSeek 官方 `/models` 返回包含 `deepseek-flash`、`deepseek-v4-pro`。
- 三个模型的文本与 function-call 最小调用均通过，服务端返回模型 ID 已记录在 `output/pi-bench-handoff/model-preflight.json`。
- 用户随后订阅 Token Plan 并更新同一桌面 Qwen 配置文件。状态码级探测确认新端点为 `https://token-plan.cn-beijing.maas.aliyuncs.com/compatible-mode/v1`，第二个凭据槽可鉴权；`/models` 仅提供 `qwen3.8-max` 而非冻结 ID `qwen3.8-max-0902`。运行器现把实验候选标签与实际请求模型分开记录，旧端点、旧模型 ID 和第一个凭据槽保留为显式备用。
- 新端点最小 `qwen3.8-max` 请求成功且服务端同样返回 `qwen3.8-max`。首条真实任务产生 23 个模型响应，但任务超时且没有评分文件，因此没有与原 Qwen cohort 混入均值。

### 2.4 真实 Worket MCP 预检

- MCP 服务：`experiments/pi-bench-handoff/worket_mcp_server.mjs`，直接使用项目构建产物 `dist/core/index.js` 和 `dist/bridge/mcp-handler.js`，不是提示词模拟。
- 预检脚本：`experiments/pi-bench-handoff/worket_mcp_preflight.py`。
- 已创建包含 8 个 Work State 分区、immutable handoff、ArtifactRef、Source Archive 和 DeepSeek→Qwen episode 的真实 WorkInstance。
- Qwen 在无 shell/文件系统工具的情况下，实际各调用一次：
  - `mcp_worket_get_work_context`
  - `mcp_worket_get_artifact_refs`
  - `mcp_worket_get_work_archive`
- Qwen 返回 `MCP_PREFLIGHT_OK`；context 与 artifact 读取均有审计事件。结果：`output/pi-bench-handoff/worket-mcp-preflight/result.json`。

### 2.5 同源快照预检

- 脚本：`experiments/pi-bench-handoff/snapshot_preflight.py`。
- 使用真实 AppWorld API DB save/load 写盘，再建立 A/B/C 三个隔离分支。
- 三个分支加载前 Hash 均等于冻结快照，加载后 Hash 彼此一致；测试 note 的 id/title/content 完全一致。
- 首次预检只因把“源快照 Hash”与 AppWorld load 后会确定性变更的磁盘 Hash 直接比较而失败；修正为分别记录 pre-load/post-load 后通过。
- 结果：`output/pi-bench-handoff/snapshot-preflight.json`。

### 2.6 已修正的运行器偏差

所有修正均登记在 `experiments/pi-bench-handoff/runtime-amendments.json`：

1. `NATIVE_DIRECT_CHANNEL_PROTOCOL_FIX`：原生 DirectAgentChannel 起初未连接 MCP，且 `/new` acknowledgement 会进入任务回复队列。现已初始化 MCP、异步 dispatch、消费 outbound bus、吸收 reset acknowledgement，并在断开前等待 Agent 任务结束。
2. `MODEL_RETRY_CEILING_FIX`：上游 provider 默认最多 16 次请求，不符合方案“初始请求 + 最多 2 次瞬时重试”。现在来源/目标模型、用户模拟器与 judge 的上限均为 3 次。
3. `CALIBRATION_MODALITY_LABEL_CORRECTION`：初始 manifest 中若干 text/file 标签与冻结 YAML 不符。未查看任何有效校准分数前，按 YAML、依赖、assets 和 evaluator 声明做了显式 overlay，保留原 manifest 不覆盖。overlay：`experiments/pi-bench-handoff/calibration-selection-amendment.json`。
4. `APPWORLD_DEFAULT_TOOLSET_PARITY_FIX`：官方 π-Bench 让 AppWorld 暴露默认完整应用集，而原生 harness 曾错误缩到 evaluator 声明子集。现已让实验运行传 `app_names=None` 并省略 CLI 的 `--app-names`；快照预检仍显式限定 `simple_note`。
5. `CALIBRATION_TASK_LEVEL_SCORE_EXTRACTION_FIX`：单任务评测中，用户级总体字段在无 COMP criteria 时可以为空，即使任务级 PROC 有效。校准驱动器现读取嵌套任务分数、要求真实结果文件和匹配 task ID，并显式区分 COMP 不适用与失败。
6. `CALIBRATION_PARALLEL_SCHEDULING`、`PARALLEL_APPWORLD_SERVICE_STABILITY_FIX`、`PARALLEL_APPWORLD_STARTUP_TIMEOUT_FIX`、`CONCURRENCY_TEN_LOCAL_STARTUP_LIMIT`：加入独立模型线程池、父进程唯一端口分配与可恢复 retry 目录。满 10 实例冷启动曾在 120 秒和 300 秒窗口出现 AppWorld readiness timeout；后续稳定供电复测因 DeepSeek 只剩 1 条，实际峰值为 6，随后 Qwen 侧 5 并发连续产出，不足以推翻或完整复现此前的满 10 结论。
7. `TOKEN_PLAN_ENDPOINT_AND_MODEL_ALIAS_SWITCH`：新 Token Plan 使用凭据槽 1 和请求模型 `qwen3.8-max`；旧 DashScope 使用凭据槽 0 和 `qwen3.8-max-0902`，保留为备用。任何凭据内容均未进入日志或仓库。
8. `ZERO_MODEL_RESPONSE_VALIDITY_GUARD`：有真实评分文件但模型响应数为 0 的鉴权/中断型运行不得计作可评分模型结果；已有真实模型响应但任务 `ERROR/TIMEOUT` 的轨迹仍按协议保留，不因低质量选择性重跑。
9. `USER_REQUESTED_PARTIAL_CALIBRATION_STOP`：当前 Qwen 返回后停止新增样本，仅以现有结果完成描述性校准，正式 gate 标记为不确定。

## 3. 被排除的工程试跑

以下运行都不能进入校准或正式结论：

- `deepseek-direct-native-smoke-02`：DirectAgentChannel 尚未连接 MCP，协议无效。
- `deepseek-native-calibration-r1`：虽然调用了 4 个 AppWorld MCP 工具并得到结果，但模型请求用了第 5 次尝试，超过冻结重试上限。
- `qwen-max-native-calibration-r1`：在重试上限修正前启动，并遇到本地代理连接错误。
- marketer / `marketer_task_010` / `deepseek-cal-valid-r1`：只暴露 Gmail，未暴露任务取上下文所需 Spotify；运行被中止并写入 `exclusion.json`。

排除记录采用 sidecar `exclusion.json`，而不是删除试跑目录，以保留审计轨迹。

## 4. 当前精确断点

当前断点位于 P3 部分校准汇总完成后，新增运行已暂停：

- `output/pi-bench-handoff/calibration-summary-existing.json`：`plannedRuns=72`、`scoredRuns=57`、`missingScoredRuns=15`、`entryGateDecision=INCONCLUSIVE_PARTIAL_CALIBRATION`。
- 可入库脱敏数据快照：`experiments/pi-bench-handoff/calibration-existing-data-2026-09-13.json`；包含冻结 manifest、四类预检摘要、57 条案例级指标、1 条未评分失败和 91 条 exclusion 记录，不含对话正文、工具返回、workspace/AppWorld 状态或凭据。
- DeepSeek 36/36 可评分；Qwen 21/36 可评分，且这 21 条全部属于旧 DashScope / `qwen3.8-max-0902` cohort。所有 server-returned ID 与各自请求模型相符。
- 公平配对子集：21 条；COMP 适用配对 11 条；完整的双方三重复任务块 6/12。COMP/PROC/persona 观察值见 `docs/design/pi-bench-calibration-existing-results-2026-09-13.md`。
- 最新 Token Plan / `qwen3.8-max` 运行是 Financier / `Financier_task_007` / repeat 2：23 个模型响应、任务 `TIMEOUT`、0 个完成 turn、评测 `FileNotFoundError`、无 score 文件。该条单列为未评分失败，不进入 COMP/PROC 均值，也没有因结果差而重跑。
- 所有因并发切换、休眠、AppWorld readiness timeout、错误 Token Plan 凭据槽或调度器中断而产生的工程目录均保留 `exclusion.json`；汇总器不会读取其分数。
- 下一步不是自动补跑。恢复前需由用户决定继续旧冻结 cohort，还是把 Token Plan `qwen3.8-max` 作为新候选建立独立校准块；不得静默混合两个 server-returned model ID。

## 5. 下一步执行计划

执行状态（2026-09-13）：P0、P1、P2 已完成；P3 以 57 条可评分结果完成“现有数据汇总”并暂停，正式完整 gate 未闭合；P4、P5 未启动。下列步骤保留为审计清单。

### P0：修正官方工具集一致性

1. 将 `appworld_services` 的 `app_names` 改为 `list[str] | None`。
2. 无论 `app_names` 是否为 `None` 都启动 AppWorld；仅当它是非空列表时向 MCP CLI 追加 `--app-names`。
3. 实验 `run_task()` 调用传 `None`，metadata 同时保留 evaluator 声明应用，并新增 `appworldToolScope: official-default-all`。
4. 保持 snapshot preflight 显式限定 `simple_note`。
5. 把 calibration run ID 升为 `cal-valid-v2`。

### P1：静态与环境回归

依次运行：

```powershell
E:\Worket\output\pi-bench-native\.venv\Scripts\python.exe -m py_compile experiments\pi-bench-handoff\native_harness.py experiments\pi-bench-handoff\run_calibration.py
node --check experiments\pi-bench-handoff\run.mjs
node experiments\pi-bench-handoff\run.mjs environment-preflight
```

确认：环境预检仍通过、选择 overlay 的 12 个 YAML Hash 全匹配、没有读取或输出 key。

### P2：只跑一对有界校准

先执行两个新样本（DeepSeek 与 Qwen 各一个），不要直接启动全部 72 次：

```powershell
$env:PYTHONUTF8='1'
E:\Worket\output\pi-bench-native\.venv\Scripts\python.exe experiments\pi-bench-handoff\run_calibration.py --limit 2
```

检查每个 run 的：MCP 工具可见性、真实 tool calls、最多 3 次 provider 请求、无 proxy 污染、COMP/PROC 文件、server-returned model IDs、workspace 和 trace 完整性。若全量 AppWorld schema 对 DeepSeek 构成上下文/API 限制，应如实登记为模型/环境能力结果，不能再次私自缩工具集。

### P3：完整能力校准

- 12 个任务 × 2 个模型 × 3 repeats = 72 个主校准运行。
- 阈值：总体 COMP 差 ≤5pp、PROC 差 ≤7pp；persona COMP 差 ≤10pp；工具环境失败差 ≤5pp；不得有某模型在同任务稳定支配超过 2/3。
- Qwen Max 通过则冻结为目标模型；不通过才按预注册启用 Qwen Flash 回退校准。
- 校准只验证接收模型能力相近，不测试 handoff，不能混入主结论。
- 当前实际状态：未完成 72 条；按用户指令不再新增运行。机器汇总脚本为 `experiments/pi-bench-handoff/summarize_calibration.py`，结论为 `INCONCLUSIVE_PARTIAL_CALIBRATION`。

### P4：实现真实 A/B/C 后缀运行

1. 把一次 DeepSeek 前缀的会话、工具轨迹、workspace 与 AppWorld DB 保存为不可变块。
2. 由同一块克隆 A/B/C，写入 Hash 和 lineage。
3. A 继续原 DeepSeek；B 为同一 Qwen + 完整可见原文；C 为同一 Qwen，只通过真实 Worket MCP 的 progressive disclosure 读取 context → artifact refs → archive。
4. 禁止把提示词摘要伪装成 C；每次 C 均检查 Worket 读取审计。

### P5：pilot、正式实验与报告

- 先跑 4 条 marketer pilot，只修工程协议，不看方向性结果改方法。
- 冻结 pilot 后执行 11 条链 × 3 repeats 的 A/B/C 正式后缀。
- 汇总 π-Bench COMP/PROC、连续性盲评、关键错误、恢复步骤、重复询问、token/成本。
- 输出案例级配对结果与置信区间；明确区分产品证据、工程失败和模型能力差异。
- 更新结果报告与 `docs/bp/benefits-and-insights.md`，未经正式数据支持不得把设计方向写成已实现收益。

## 6. 继续执行时优先阅读的文件

1. `docs/design/pi-bench-execution-checkpoint-2026-09-12.md`（本文）
2. `docs/design/pi-bench-cross-model-handoff-evaluation-v1.md`
3. `experiments/pi-bench-handoff/runtime-amendments.json`
4. `experiments/pi-bench-handoff/calibration-selection-amendment.json`
5. `experiments/pi-bench-handoff/native_harness.py`
6. `experiments/pi-bench-handoff/run_calibration.py`
7. `experiments/pi-bench-handoff/summarize_calibration.py`
8. `docs/design/pi-bench-calibration-existing-results-2026-09-13.md`
9. `experiments/pi-bench-handoff/README.md`

建议新窗口的第一条指令：

> 继续执行 `docs/design/pi-bench-execution-checkpoint-2026-09-12.md`。从 P0 开始，不重跑已通过的安装和预检，不纳入文中列出的 excluded runs，不读取或打印 key 内容。
