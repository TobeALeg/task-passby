# 任务定义、Memory 与执行协议的产品现状

“业界只研究如何解决任务”已经不是一个成立的定位前提。规格生成、交互澄清、研究计划审核、经验归纳和执行审批，都已有第一方产品或开源实现。更值得验证的方向是：能否低成本地把零散表达及其背景，变成用户认可、可供不同执行者使用、可检验且有授权边界的工作定义。

本笔记覆盖至 2026-09-10，比较 8 个任务相关方案与 4 类 Memory 实现。仅核查公开第一方文档与仓库，未安装、运行或做产品实测；能力描述代表官方陈述，不代表准确率、用户采用或实际效果。“未验证”不表示产品没有该能力。除明确标注外，产品页面采用访问时版本，统一访问日期为 2026-09-10。

## 已有方案覆盖了什么

| 方案 | 输入与定义交互 | 形成的输出 | 文档中的质量机制 | 执行与授权边界 |
|---|---|---|---|---|
| GitHub Spec Kit | 从需求描述生成规格；`clarify` 最多提出 5 个高价值澄清问题，回答写回规格 | 规格、计划、任务与检查表；可接不同 coding agent | 需求完整性、清晰度、一致性检查；跨文档分析 | 规格流程本身不能代替宿主工具权限策略[^1][^2] |
| Kiro Feature Specs | Requirements-First 从 prompt 生成需求，用户审核后进入设计与任务阶段 | `requirements.md`、`design.md`、`tasks.md`；包含 EARS 行为与验收条件 | Analyze Requirements 检查冲突、歧义、隐含假设及遗漏；回答可改写需求 | 用户确认需求、设计后推进；这是流程确认，不足以证明任意外部操作已获许可[^3][^4] |
| Claude Code Plan / Agent SDK | 读取项目探索；提出计划；`AskUserQuestion` 提供结构化问题和选项 | 计划、对话选择及后续执行上下文 | 由用户反馈澄清；文档未提供意图保真度的通用评测 | Plan 用于先探索和规划，源代码编辑阻断受 bypass 会话设置影响；SDK 区分工具审批与澄清，等待 `canUseTool` 返回[^5][^6] |
| Gemini Deep Research | 选择研究来源，提出主题，审核或编辑研究计划，再点击开始 | 可继续修订、导出至 Docs 的研究报告 | 研究计划预览与用户反馈；文档未给出任务定义正确率 | 开始研究与后续分享、导出是不同操作；选择来源不是通用业务执行授权[^7] |
| Microsoft PromptWizard | 给定任务描述、基础指令、答案格式；支持有训练例、合成例及无训练例路径 | 针对任务与模型优化的 prompt 和示例 | 迭代批评、改写与数据集评估；评估方式随任务设定 | 研究框架；终端用户的意图确认与业务授权流程未在所读文档中验证[^8] |
| DSPy | 开发者提供程序、评分函数和训练输入，优化模块指令、示例或模型参数 | 可保存、加载的优化后程序 | 最大化开发者给定的 metric，迭代评估候选 | 评分目标的正确性仍需外部定义；工具权限由应用承担[^9] |
| MCP Elicitation | 服务端请求补充输入；客户端展示表单或外部 URL，并回传决定 | 结构化回答，或外部交互的同意信号 | JSON Schema 校验输入结构；不保证回答真实、目标正确 | 区分 accept / decline / cancel；敏感凭证走 URL；UI 与安全边界由实现落实[^10][^11] |
| A2A Task | 客户端与远端 agent 交换消息；任务可暂停等待输入或授权 | 有 ID、状态、消息历史与 artifacts 的 Task | 生命周期和互操作约束；不是业务结果验收器 | `TASK_STATE_INPUT_REQUIRED` 与 `TASK_STATE_AUTH_REQUIRED` 分开；授权可协商、纠正或拒绝[^12] |

这个比较包含三种容易混为一谈的能力。Spec Kit、Kiro 和 Plan mode 帮人明确要做什么；PromptWizard、DSPy 改善模型怎样完成一个已给定的目标；MCP、A2A 规定参与者怎样补充输入、暂停、恢复与交换结果。它们可以组合，不能互相代替。尤其是“评分提高”并不能证明评分函数表达了用户真正想要的结果，这是从优化问题的输入要求得出的分析判断。[^8][^9]

Spec Kit 当前 README 还有独立的 assess 扩展：从原始想法出发，经历 intake、research、define、shape、decide；define 包含问题、目标与成功指标，结果允许继续、澄清或放弃，且官方明确它不必最终成为软件。因而连“发现值得做的问题”也不是完全未被覆盖的空间。[^1]

Kiro 则暴露了另一项有用设计：歧义不一定是错误。Analyze Requirements 允许用户选择建议修正、自填答案，或者保留有意的歧义。对创作、探索与商业判断，提前锁死所有细节可能降低定义质量；定义系统需要识别“尚待探索”，不能把每个空格都强行填满。后一句是产品设计推论，而非 Kiro 效果评估。[^4]

## Memory 已经在做“说出未说出的话”

不能用“Memory 只存储、Abstract 才推理”来区分产品。以下实现已经涉及选择、压缩、归纳、冲突处理和行为更新。差异应比较其输出所承载的责任：它是历史证据、关于用户的推断、以后可参考的经验，还是这一次工作已经接受的目标与约束。

| 实现及版本范围 | 抽取、推理与更新 | 来源与时效 | 确认与授权的已知边界 |
|---|---|---|---|
| Mem0 Platform V3 + Dream | V3 `add` 默认推断抽取，`infer=false` 可原文写入；Dream 可将多条记忆归纳为高阶模式，也处理重复与新旧冲突 | 模式保留原记忆并链接来源；支持 superseded 状态、显式到期日 | Synthesis 是按项目开启的后台能力；本次未验证每条模式都经最终用户确认。开启归纳不等于授权依据推断执行当前任务[^13][^14] |
| Letta 当前 Agent SDK / MemFS | agent 可修改自身记忆；Dreaming 在后台回顾对话、归纳经验并更新记忆；可保存偏好及工作规则 | MemFS 用 Git 保留版本，记忆可随 agent 跨模型、机器使用；逐条结论到原始证据的内建映射未验证 | SDK 有权限模式和 `canUseTool` 审批、拒绝、修改工具输入；存在审批机制，不应断言 Memory 无权限控制；逐条学习结论的确认语义未验证[^15][^16][^17] |
| Graphiti / Zep v3 文档 | Graphiti 从结构化与非结构化数据抽取实体、关系，处理变化和事实失效；Zep 在其上提供托管能力 | Graphiti 有双时间模型；Zep facts 带有效期，episode 保留来源原文，衍生事实可追溯关联 episode | 文档有来源、时间与数据治理能力；从抽取事实到本次任务要求的逐条确认，未验证为默认流程。不得把 Zep 云能力整体等同于 Graphiti OSS[^18][^19][^20][^21] |
| LangMem 当前开源文档 | Memory Manager 可提取、删改、合并与泛化；Prompt Optimizer 可从轨迹与反馈更新行为规则；支持即时或后台形成 | 支持 profile、collection、自定义结构及 namespace；所读概念页未验证统一的逐条来源、有效期字段 | 核心变换返回新状态且无存储副作用，应用可决定何时落库；高层集成可自动持久化。用户逐条确认属于应用契约，本次未验证统一默认语义[^22] |

Mem0 的 V3 ADD-only 与 Dream 的 supersede/merge 并不矛盾：前者描述写入接口的单次抽取路径，后者描述后续记忆生命周期。版本与层次必须区分，否则会把“只新增”误读为整个产品不能处理冲突。[^13][^14]

Letta 同样提示了比较时的陷阱：旧链接仍可跳转到标有 legacy 的 V1 SDK 文档，当前 Agent SDK 又采用 MemFS 与 Dreaming。若只按 MemGPT 早期印象描述它，会漏掉版本历史、跨模型延续和工具审批。这里比较的是所引用的当前产品文档，不据此断言与早期论文实现完全一致。[^15][^16][^17]

Zep 的 Observations 更直接进入定义语义：自动归纳跨实体的决定、承诺、约束与长期模式，再随证据更新。官方规定这些衍生观察为只读，不能直接编辑，另可配置新观察的生成方向。这给出了一个具体的产品对照：基于证据生成的观察，与用户能够改写并接受的任务约定，具有不同的修订方式。该功能属于 Zep 的指定付费方案，不应扩展为 Graphiti OSS 能力。[^24]

**对 Worket Abstract 的建议边界**是从候选理解走向当前工作约定。这包含四个不同判断：历史中有什么证据；证据可以支持什么推断；推断是否适用于当前场景；用户是否接受其成为要求。Memory 可以提供前两步，也可能参与第三步；Abstract 同样需要 Memory。把二者画成互斥模块，会掩盖真正需要解决的“推断如何获得效力”。这是定位假设，需要实验验证。

例如，“你以前偏好简短汇报”可以成为参考证据；“这次交付一页汇报”是具体任务约束；“可以自动发给客户”是另一个授权决定。即使前两项可信，第三项也无法仅由偏好推出。一个好定义应该能表示这些差别，而不只是生成一段更完整、更像专业人士写的 prompt。

## 协议的版本与语义边界

MCP 的 `/specification/latest` 在访问时重定向到 **2026-07-28**，本笔记采用这个版本。此版通过 `InputRequiredResult` 携带 `elicitation/create`；客户端在重试请求时提供 `inputResponses`。这与旧版的消息流程不同，不能用 2025-11-25 的交互图替代当前契约。[^10][^11]

URL 模式的 accept 仅说明用户同意进行外部交互，不说明交互已完成。这个区别对任务系统很实际：同意打开授权页、成功取得凭证、获准执行某项操作，应分别有证据。结构校验也只能验证输入形状，不能验证目标及许可的语义。[^10]

A2A 访问时标出的最新发布版是 **1.0.0**，固定版已经定义等待输入和等待授权的状态，也允许客户端协商、纠正或拒绝请求。其 Task 主要承载执行过程与产物，并没有因此成为完整的任务需求书。[^12]

另一个需要保留的版本差异：访问时 `/latest` 有新增的 §7.6.4，明确授权范围、表示、有效期、撤销语义由实现、签发方或扩展规定，状态转换本身不构成授权；固定 `/v1.0.0/` 尚无此节。该措辞可作为演进方向证据，不能误标为已发布 1.0.0 的原文。[^23]

## 能验证的产品机会

现有证据不支持“没有人做任务定义”，也不支持“Memory 无法抽象”。尚待验证的是一种组合体验是否有额外价值：从用户已有工作和表达开始，保留来源与不确定性，只澄清会改变方向的分歧，再形成一份可用于交接、执行与验收的工作约定。能生成字段或接上协议，都不足以证明这一点。

建议用同一组真实工作比较三个基线：直接与强模型对话；加入现成 Memory；加入待验证的 Abstract 流程。coding 任务可再加入 Spec Kit 或 Kiro 流程，但不能把软件任务上的表现直接推广到研究、汇报、设计或业务沟通。

评估至少要回答五个问题：候选定义是否保留关键意图；是否增加用户从未认可的要求；用户需要花多少时间纠正和确认；更换执行者后是否仍能少解释地继续；最终结果是否按用户认可的标准通过。可把“未经认可的新增约束比例”与“确认时间”同时记录，防止用漫长问卷换取表面完整性。

对隐喻与离散表达，值得优先验证的并非自动重写的流畅度，而是多解分歧的处理。例如“像一个靠谱的老同事”可能指主动推进、表达克制、熟悉背景或遇到风险先询问；这些方向对实现和权限并不等价。系统应该展示有证据的候选理解，并让关键差别变成可选择、可修正的决定。

目前这些是研究命题。本文没有直接比较实测、对照实验或客户采用证据，因此不能据此宣称 Worket 有市场空白、性能优势或护城河。

## 来源

[^1]: GitHub. [Spec Kit README](https://github.com/github/spec-kit). 官方仓库 `main`，访问时 README 标示 1.0.0；使用 Core Commands、Optional Commands、Assessing Ideas 等部分。未将动态分支视为不可变发布内容。
[^2]: GitHub. [Spec Kit clarify command template](https://github.com/github/spec-kit/blob/main/templates/commands/clarify.md). 官方仓库 `main`；包括问题上限、重要性筛选、规格写回与检查表。未标页面发布日期。
[^3]: Kiro. [Requirements-First Workflow](https://kiro.dev/docs/specs/feature-specs/requirements-first/). 页面更新 2026-08-04。
[^4]: Kiro. [Analyze Requirements](https://kiro.dev/docs/specs/analyze-requirements/). 页面更新 2026-09-02。
[^5]: Anthropic. [Choose a permission mode](https://code.claude.com/docs/en/permission-modes). Claude Code 官方当前文档；未标发布日期。
[^6]: Anthropic. [Handle approvals and user input](https://code.claude.com/docs/en/agent-sdk/user-input). Agent SDK 官方当前文档；未标发布日期。
[^7]: Google. [Use Deep Research in Gemini Apps](https://support.google.com/gemini/answer/15719111?hl=en). 官方帮助页；未标发布日期。
[^8]: Microsoft. [PromptWizard](https://github.com/microsoft/PromptWizard). 官方仓库 `main` README，任务配置、三种训练例路径及定制评估部分；未锁定 release。
[^9]: DSPy maintainers. [DSPy Optimizers](https://github.com/stanfordnlp/dspy/blob/main/docs/docs/learn/optimization/optimizers.md). 官方文档源文件 `main`；使用输入要求、优化目标、保存加载部分，未引用页面中非正式跑分。
[^10]: Model Context Protocol. [Elicitation](https://modelcontextprotocol.io/specification/2026-07-28/client/elicitation). 规范版本 2026-07-28。
[^11]: Model Context Protocol. [Specification](https://modelcontextprotocol.io/specification/2026-07-28). 规范版本 2026-07-28；访问时 latest 重定向至本页。协议自身不能强制执行所有安全原则。
[^12]: A2A Project. [Agent2Agent Protocol Specification 1.0.0](https://a2a-protocol.org/v1.0.0/specification/). 固定发布版；§4.1 Task 与 TaskState、§7.6 In-Task Authorization。
[^13]: Mem0. [Add Memories](https://docs.mem0.ai/api-reference/memory/add-memories). Platform V3 REST 文档；使用 ADD-only、infer、entity scope、expiration 字段，未把未完整描述的 schema 字段当成稳定能力。
[^14]: Mem0. [Dream](https://docs.mem0.ai/platform/features/dream). Platform 当前功能文档；使用 Synthesis、Supersede、Merge、来源保留及项目级开启边界；未标发布日期。
[^15]: Letta. [Memory](https://docs.letta.com/agent-sdk/memory). 当前 Agent SDK 文档；记忆、Dreaming；未锁定 SDK 包版本。
[^16]: Letta. [MemFS](https://docs.letta.com/concepts/memfs). 当前官方概念文档；Git 版本、同步及 agent 所有权；未标发布日期。
[^17]: Letta. [Permissions](https://docs.letta.com/agent-sdk/permissions). 当前 Agent SDK 文档；permissionMode 与 canUseTool；未将配置能力误作每条记忆默认要求确认。
[^18]: Zep. [Graphiti Overview](https://help.getzep.com/graphiti/getting-started/overview). 官方 Graphiti 概览；区分 OSS 和 Zep 托管产品；未引用营销性能数字。
[^19]: Zep. [Facts](https://help.getzep.com/facts). 访问时 v3 文档；事实的 valid_at / invalid_at。
[^20]: Zep. [Episodes](https://help.getzep.com/episodes). 访问时 v3 文档；保留原始 episode 与提取产物。
[^21]: Zep. [Episode metadata projection](https://help.getzep.com/v3/episode-metadata-projection). v3 文档；产物与 episode 关联、来源追溯。
[^22]: LangChain. [LangMem: Long-term Memory in LLM Applications](https://langchain-ai.github.io/langmem/concepts/conceptual_guide/). 官方当前概念文档；memory managers、prompt optimizers、即时和后台形成、无副作用核心接口；未锁定包版本。
[^23]: A2A Project. [Agent2Agent Protocol Specification — latest](https://a2a-protocol.org/latest/specification/#764-in-task-authorization-scope). 2026-09-10 动态文档快照；新增 §7.6.4 不存在于同时读取的 1.0.0 固定版，须区别引用。
[^24]: Zep. [Observations](https://help.getzep.com/observations). 访问时 v3 文档；自动衍生观察、只读与 steering 机制；页面标注适用 Flex Plus / Enterprise，未实测方案可用性。
