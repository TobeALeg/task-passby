# π-Bench 能力校准：现有结果汇总（2026-09-13）

本报告按用户指令在当前 Qwen 返回后暂停新增运行，只汇总已经存在的数据。它不是预注册的完整 72-run 校准，也不能替代 [评测方案 v1](pi-bench-cross-model-handoff-evaluation-v1.md) 的进入门槛判定。

## 1. 数据边界

- 预注册计划：12 个任务 × 2 个模型 × 3 repeats = 72 条。
- 可评分结果：57 条，其中 DeepSeek `deepseek-flash` 36/36，Qwen `qwen3.8-max-0902` 21/36。
- Qwen 的 21 条可评分结果全部来自原 DashScope 兼容端点，服务端响应 ID 均为 `qwen3.8-max-0902`。
- 正确鉴权的新 Token Plan 端点只暴露 `qwen3.8-max`。其首条正式任务产生 23 个、服务端 ID 为 `qwen3.8-max` 的模型响应，但任务在提交首个完整 turn 前超时，随后因无轨迹产生 `FileNotFoundError`，没有 COMP/PROC 文件。该条作为未评分失败单列，不进入均值。
- 运行器跳过所有带 `exclusion.json` 的工程试跑。无 checklist/tool evaluator 的冻结任务继续记为 `COMP=N/A`，不按 0 分处理。
- 本报告没有读取、保存或打印任何 key 内容。

## 2. 描述性结果

| 数据集 | 可评分运行 | COMP 适用运行 | 平均 COMP | 平均 PROC | 任务状态 |
|---|---:|---:|---:|---:|---|
| DeepSeek 全部现有数据 | 36 | 18 | 59.420% | 69.907% | SUCCESS 35，ERROR 1 |
| Qwen 全部现有数据 | 21 | 11 | 66.640% | 71.032% | SUCCESS 15，ERROR 5，TIMEOUT 1 |
| 公平配对子集中的 DeepSeek | 21 | 11 | 72.903% | 84.524% | 仅对应现有 Qwen 的相同 task/repeat |
| 公平配对子集中的 Qwen | 21 | 11 | 66.640% | 71.032% | 同上 |

DeepSeek 的 36 条总体均值与 Qwen 的 21 条总体均值不具有直接可比性，因为缺失的 Qwen 样本并非随机缺失。门槛观察只使用 21 条相同 `persona × task × repeat` 的配对子集。

## 3. 配对子集门槛观察

| 门槛 | 观察值 | 暂定阈值 | 现有子集结果 |
|---|---:|---:|---|
| 平均 COMP 绝对差 | 6.263pp | ≤5pp | 超出 |
| 平均 PROC 绝对差 | 13.492pp | ≤7pp | 超出 |
| Financier COMP 绝对差 | 2.222pp | ≤10pp | 未超出 |
| marketer COMP 绝对差 | 13.333pp | ≤10pp | 超出 |
| researcher COMP 绝对差 | N/A | ≤10pp | 无可比较 COMP 样本 |
| 工具/运行环境失败率差 | 未闭合 | ≤5pp | 无法判定 |
| 稳定支配比例 | 未闭合 | ≤2/3 | 无法判定 |

只有 6/12 个任务具备双方各 3 次的完整配对块。现有子集在 COMP、PROC 和 marketer persona 三项上超过阈值，但不能据此完成预注册 gate：剩余 15 条 Qwen 结果缺失，工具/环境失败归因尚未完成，稳定支配规则也没有足够完整任务块。

## 4. 校准结论

结论为 `INCONCLUSIVE_PARTIAL_CALIBRATION`（部分校准、无法闭合）。不能声称 Qwen Max 已通过能力接近门槛，也不能把它形式化判为完整校准失败。现有配对子集显示明显能力/执行差异风险，因此后续若直接进入 B/C，`C−B` 仍可比较同一目标模型下的 Worket 增益，但 `A−B` 不得主要解释为交接损失。

用户要求在当前 Qwen 返回后暂停，因此本轮不启动剩余 Qwen、不启用 Qwen Flash 回退，也不进入 P4/P5。恢复实验前必须先决定：继续补齐冻结的旧 `qwen3.8-max-0902` 队列，还是将 Token Plan 的 `qwen3.8-max` 作为新候选并建立独立校准块；两种响应 ID 不得静默混合。

机器可读汇总位于忽略目录 `output/pi-bench-handoff/calibration-summary-existing.json`；可入库的脱敏快照为 `experiments/pi-bench-handoff/calibration-existing-data-2026-09-13.json`，包含冻结 manifest、环境/模型/快照/真实 Worket MCP 预检摘要、57 条案例级指标、1 条未评分失败和 91 条 exclusion sidecar 的路径与原因。两者都可由 `experiments/pi-bench-handoff/summarize_calibration.py` 从本机现有运行重新生成。
