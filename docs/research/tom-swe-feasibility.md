# ToM-SWE 本机可行性与 WorkDefinition 提取算法

核实日期：2026-09-10。范围：官方论文与源码审阅、当前 Mac 配置检查；未安装 ToM-SWE、未发送用户对话、未调用模型、未运行论文实验。

## 结论

当前 M4 Mac mini（10 核、16 GB 内存）足以作为 **本地编排 + 远程模型 API** 的对话提取实验机，无需为第一版购买 GPU。这里的“足以”是根据工作负载和源码依赖作出的工程判断，不是官方最低硬件承诺。ToM-SWE 的生成代码通过 LiteLLM 调用模型接口；核心依赖没有本地模型推理框架，也没有 CUDA 要求。[生成客户端](https://github.com/OpenHands/ToM-SWE/blob/main/tom_swe/generation/generate.py)、[安装元数据](https://github.com/OpenHands/ToM-SWE/blob/main/pyproject.toml)

该研究值得借鉴的是会话分析、分层记忆和按需回查证据。用户目标是形成可复用的 WorkDefinition，需要重新设计输出对象和验证方法；运行原项目只能证明原项目可运行。

## 运行范围决定配置

| 范围 | 依赖与资源 | 当前机器判断 |
| --- | --- | --- |
| 单独运行 ToM 会话分析/建议 | Python、模型 API、文件存储；本地主要处理文本与 JSON | 可以做；模型额度、上下文长度及延迟比本机 GPU 更相关 |
| 基于真实对话开发 WorkDefinition 提取器 | 同上，加结构校验、证据索引、人工标注与评估 | 推荐起点；先低并发记录 token、耗时和错误类型 |
| 完整复现 SWE 实验 | SWE 执行器、代码沙箱、测试镜像、模拟用户、数据集、多个模型角色 | 不是当前算法验证的必要步骤；26 GiB 可用磁盘不适合直接铺开 |
| 全部模型也在本地运行 | 取决于所选模型大小、量化、上下文及并发 | 不等价于 API 方案；换小模型后的效果需独立测量 |

核心环境应使用隔离的 **Python 3.12**。本机默认 Python 是 3.14.5，已安装 uv；当前 `pyproject.toml` 要求 `>=3.10,<3.14`，所以默认解释器不兼容。README 仍写 Python 3.8+，应以安装元数据为准。[pyproject.toml](https://github.com/OpenHands/ToM-SWE/blob/main/pyproject.toml)、[README](https://github.com/OpenHands/ToM-SWE#requirements)

完整 SWE-bench 评测的官方参考配置是 x86_64、至少 120 GB 空闲存储、16 GB 内存、8 个 CPU 核，ARM 支持仍标为实验性。**这是 SWE-bench 的评测建议，不是 ToM 核心模块的最低配置**；低并发少量任务可能资源更少，但本轮没有测量。[SWE-bench 官方运行说明](https://github.com/SWE-bench/SWE-bench#-usage)

## 研究与开源实现的真实边界

最新论文为 **v2，2026-01-29**。其 ToM Agent 在会话结束后分析历史、聚合用户模型，在执行中检索历史并给 SWE Agent 建议。实验涉及模拟用户与 SWE 代码任务，不能将其中的成功率直接当作真实对话提取 WorkDefinition 的准确率。[论文 v2，第 3–5 节](https://arxiv.org/html/2510.21903v2)

论文 v2 的摘要与第 5.2 节报告 Stateful SWE 的 59.7% 对 18.1%，但引言仍出现另一组数值；需要引用结果时明确章节，避免混用。这里不以这些指标为 Worket 效果承诺。[论文 v2](https://arxiv.org/html/2510.21903v2)

官方仓库在 2026-08-03 已归档。README 的 `TomModule` 演示与当前源码入口有差异，当前源码提供 `ToMAgent`、`ToMAgentConfig` 和 `ToMAnalyzer`；实施时应固定代码版本，按源码写小型适配器，不能承诺照贴 README 即可成功。[仓库状态](https://github.com/OpenHands/ToM-SWE)、[Agent 入口](https://github.com/OpenHands/ToM-SWE/blob/main/tom_swe/tom_agent.py)、[分析器](https://github.com/OpenHands/ToM-SWE/blob/main/tom_swe/tom_module.py)

当前会话分析保留整段上下文和重点用户消息，再输出会话意图、消息偏好等结构；跨会话输出聚合到用户描述与偏好列表。这些结构没有 WorkDefinition 所需的输入、产出、适用条件、验收规则及执行边界。[分析器](https://github.com/OpenHands/ToM-SWE/blob/main/tom_swe/tom_module.py)、[数据结构](https://github.com/OpenHands/ToM-SWE/blob/main/tom_swe/generation/dataclass.py)

两个值得在适配前处理的源码细节：会话分析默认跳过消息索引 0；文本截断使用英语字符/token 近似并从中间截断。直接接入中文用户对话可能漏掉首条目标或中间纠正，应该改成适配输入格式后的真实 token 分段与证据定位。[分析器实现](https://github.com/OpenHands/ToM-SWE/blob/main/tom_swe/tom_module.py)

## 第一版算法建议（设计提案，尚未实现）

沿用分层处理思路，将中间表示从“这个用户是什么样的人”改成“这项工作有哪些经对话支持的定义”。

1. **整理工作范围内的真实消息。** 保留角色、时间、会话/消息标识和原文位置；区分用户明说、用户确认的 Agent 建议、未确认建议、用户纠正与本次例外。只处理用户选定或授权记录的工作数据。
2. **按证据提取定义要素。** 抽取目标、输入、产出、步骤/决策、约束、验收条件；每个要素带出处与作用范围。推断单独标记，不能把 Agent 自己的建议当成用户要求。
3. **重建要求的变化。** 区分“替换旧要求”“新增要求”“仅适用于这次”“互相冲突且未解决”；不能简单用最后一句覆盖一切。
4. **跨同类工作泛化。** 保留稳定规则，把客户名、日期、具体文件改为变量；跨多个实例检查适用性，保留例外。一般交流偏好独立存放，只有与工作产出有关的要求才进入定义。
5. **证据回查与候选生成。** 每条候选回到原文核查，必要时检索更多上下文；缺证据或无法泛化则不提升为稳定规则。用户确认后形成可用定义。

Worket 当前提取已有 `requirements{id,text,scope,sourceKeys,replacedBy}` 和 `reconcile-and-generalize` 两阶段基础；建议增量加强上面的中间表示，而不是首先接入整套 SWE 执行器。当前实现证据见 [server/workflow.mjs](../../server/workflow.mjs)；代码范围由本轮主任务核实。

例如用户说“每篇文章都要先核查数据”，随后说“这次只写观点，不需要数据”，候选定义应保留通用核查规则及其适用条件，并将后一句记录为本次例外；不能总结成“用户不喜欢核查数据”。这是验证作用范围判断的样例，不是已测结果。

## 怎么证明值得采用

建议将当前 Worket 提取器作为基线，在同一批经授权的真实对话上比较增强方案。先用两次同类工作形成候选，保留未参与提取的第三次检查遗漏和误泛化，再使用新输入验证复用。该样本安排是首轮工程实验建议，不是统计充分性的保证。

重点记录：无依据规则比例、关键要求遗漏、纠正/例外判断、出处是否正确、用户需要修改的内容、复用时新增澄清次数，以及成本/耗时。模型自评分只作辅助；结构 JSON 合法也不代表语义正确。真实用户修订和新工作结果才是最终证据。

本轮交付是可行性与算法设计依据。下一阶段可交付一个离线可比较的提取实验，完成版本固定、输入适配、证据结构、真实样本评测后，再决定是否进入产品。
