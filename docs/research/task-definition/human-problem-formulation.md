# 人如何把模糊表达形成一项工作

高质量任务定义，应让参与者对“接下来值得做什么、做到什么程度、依据什么判断”形成足够一致的理解。它既包括恢复省略的信息，也包括消除歧义、发现冲突和形成此前尚不存在的偏好。因此，“把用户的话写清楚”不能被简化为提取一个已经完整存在于用户头脑中的标准答案。

认知与设计研究支持这一判断，但并未证明某种通用任务模板能改善所有工作。本笔记结合 9 项原始研究或作者理论文献，提出面向 Worket 的研究假设；产品建议与文献结论分开表述。文献检索截至 2026-09-10，重点是人类问题形成与交互机制，未覆盖全部自动澄清算法。

## 1. 模糊表达背后至少有四种状态

| 状态 | 例子 | 合适的处理方向 |
|---|---|---|
| 已有意思，省略了背景 | “还是按上次的形式” | 找到所指记录，恢复相关条件，并检查本次是否适用 |
| 一句话容纳多个意思 | “像杂志一样” | 给出有差异的解释或例子，让用户选择相关维度 |
| 存在尚未解决的取舍 | “全面研究，但别花太多时间” | 显示取舍及其后果，形成当前可接受的边界 |
| 用户还在发现自己想要什么 | “觉得不对，但说不出来” | 用小样、对照和试探性问题帮助形成判断 |

这是分析框架，而非已验证的用户分类。实际表达可以同时含有几种状态；仅靠语句流畅度无法区分它们。共同理解、目标形成和偏好构造的研究，分别解释了这些状态为何不能用同一种“补全字段”流程处理。[Clark 与 Brennan，1991](https://web.stanford.edu/~clark/1990s/Clark%2C%20H.H.%20_%20Brennan%2C%20S.E.%20_Grounding%20in%20communication_%201991.pdf)、[Dorst 与 Cross，2001](https://sites.cc.gatech.edu/classes/AY2018/cs8803cc_spring/research_papers/Dorst_Cross2001.pdf)、[Slovic，1995](https://scholarsbank.uoregon.edu/bitstreams/c3007eab-451e-4e14-936a-eaa379013832/download)

## 2. 对产品判断最重要的证据

### 问题与方案会一起变化

Dorst 与 Cross 观察 9 名拥有 5–20 年经验的工业设计师，在 2.5 小时内设计列车垃圾处理系统。同一任务被持续重新解释；新的方案认识又改变问题边界。这支持给任务定义保留修订空间。它是小样本设计过程研究，不能证明所有任务都必须探索，也不能证明澄清越久越好。[原文，第 1–5 节](https://sites.cc.gatech.edu/classes/AY2018/cs8803cc_spring/research_papers/Dorst_Cross2001.pdf)

Slovic 的理论综述指出，在复杂、不熟悉或需要取舍的选择中，偏好可能在询问过程中形成；等价的提问程序也可能引出不同排序。对 Worket 的含义是：澄清既可能发现偏好，也可能塑造偏好。不能据此否认稳定偏好的存在，或把每次改变都解释为用户“终于说出了真实想法”。[原文，Preference Reversals 与 The Construction of Preference](https://scholarsbank.uoregon.edu/bitstreams/c3007eab-451e-4e14-936a-eaa379013832/download)

### 共同理解需要证据，但不需要无限确认

Clark 与 Brennan 把 grounding 描述为协作双方建立“足以满足当前目的”的理解，并关注双方总沟通成本。复述、指认对象、相关的下一步回应，都可以提供理解证据。它不等于每句话都让用户点确认；该框架来自人与人的交流，不能直接把人际默契当作模型可靠性的证明。[原文，Grounding in Conversation 与 Grounding Changes with Purpose](https://web.stanford.edu/~clark/1990s/Clark%2C%20H.H.%20_%20Brennan%2C%20S.E.%20_Grounding%20in%20communication_%201991.pdf)

《Why Johnny Can’t Prompt》用 BotDesigner 观察 10 名非 AI 专家。他们主要进行机会式修改，常由单次成功或失败推断普遍能力；无人采用研究工具提供的系统化测试界面。这说明自然语言入口仍有理解和验证成本。研究涉及 GPT-3、烹饪教学聊天机器人、短期受协助试用，不能推出普通用户普遍不会提问。[原文，第 3–5 节](https://people.eecs.berkeley.edu/~bjoern/papers/zamfirescu-johnny-chi2023.pdf)

Liu 等的 24 人研究把生成代码反译成可理解的操作描述，帮助参与者发现错误、理解系统能力，并报告更多信心。但两组均完成任务，时间、查询次数、认知负担和可用性量表未见显著差异。启发是展示可检查的解释，而不是只宣布“我懂了”；不能据此声称交付效率或信心校准已被验证改善。[原文，第 5–7 节](https://www.microsoft.com/en-us/research/wp-content/uploads/2023/04/liu_2023_grounded_abstraction_matching.pdf)

### 隐喻和零散片段可以是思考材料

Ball 与 Christensen 分析两场工程设计会议的 3,886 个话语片段，识别 147 次类比，发现它们承担解释、生成方案、发现功能等不同作用，并与表达出的不确定性相关。类比因而不应一律当作需要删除的噪声。研究对象是专业设计讨论，关联也不证明类比造成了理解改善。[原文，第 1–3 节](https://analogi.dk/wp-content/uploads/2019/11/2009-Ball_Christensen.pdf)

由此产生的产品假设是：处理“像编辑部”“像有经验的助理”时，保留原话，并把可能相关的关系或行为提出供修正。例如，“像编辑部”可能涉及取舍、层级、节奏、审稿责任，未必指报纸纹理。系统必须区别用户实际选择的维度与模型自行联想到的装饰。

### 目标、实现方式和环境条件应分开

van Lamsweerde 的目标导向需求工程综述区分目标、软件可承担的要求、环境假设，并讨论 WHY/HOW 追问、障碍、冲突与协商。目标可以从场景和技术细节向上发现，方法并非必然自上而下。这为任务定义提供了“为什么—需要什么—依赖什么”的结构；完整的形式化需求模型是否适合日常工作，仍无直接证据。[原文，第 2、5 节](https://webperso.info.ucl.ac.be/~avl/files/RE01.pdf)

Worket 可借用其区分，减少把某次执行方法固化成永久要求的风险。现有 [沉淀 Spec 的 D04 与内容契约](/Users/dandi/YanGuan/docs/specs/work-distillation-v1.md) 已把方法默认设为参考，并保留来源，适合继续研究哪些内容是稳定目的、哪些只是历史方案。

### 看到例子，才知道如何验收

EvalGen 的 9 名有 LLM 开发经验的行业参与者，在判断输出时补充或重新解释评价标准。论文称之为 criteria drift：标准帮助判断，而判断又帮助形成标准。这支持在必要时先看少量样例，再完善验收条件。研究也观察到标准向模型行为靠拢的情况；变化可能是合理学习，也可能是迁就，不能一概视为改善。[原文，第 6–7 节](https://arxiv.org/html/2404.12272v1)

IntentTagger 让 12 名有专业幻灯片制作经验的人用概念标签、参考材料和局部修改表达意图。参与者认为建议有助于发现需求，同时报告建议过多、视觉拥挤，以及希望锁定满意内容。对照是当时的 PowerPoint Copilot 与 Designer，存在能力混杂，不能把优势全部归因于标签。[原文，第 5–8 节](https://arxiv.org/html/2502.18737v1)

## 3. Abstract 与 memory 的区别：历史证据与本次承诺

“帮用户说出未说出的话”是一项上层价值，下面至少包含四种不同操作。下表是产品概念划分；上述论文并未直接验证 Worket 的 memory 架构。

| 操作 | 依据与产物 | 应避免的跨越 |
|---|---|---|
| 恢复历史信息 | 从记录找到过去说过的话、对象和条件 | 把找不到出处的内容当成记忆 |
| 判断历史信息是否适用 | 比较当前受众、目的、材料等，再提出可复用条件 | 把过去偏好自动变成所有情境下的规则 |
| 解释和形成当前意图 | 组织片段、提出解释、展示取舍或候选，形成可修改的任务理解 | 把模型补出的合理内容写成用户既定要求 |
| 建立本次约定 | 明确当前采取的目标、边界、验收和执行责任 | 从理解上的认可，直接推导未经授权的外部行动 |

**记忆能支持任务定义，不能单独决定任务。** “上次希望报告详细”是历史事实；“本次也应该详细”是适用性判断；“本次用于五分钟汇报，因此先做一页结论”可能是在当前互动中形成的新决定。即使历史恢复完全准确，后两步仍存在。

**Abstract 也不等于任意补全。** 更值得研究的产物，是带有依据和暂定地位的任务理解：哪些来自用户当前表述、哪些恢复自历史、哪些属于系统推断、哪些经过当前选择。工作记录能保留这些变化，使“后来改变主意”与“模型起初理解错了”可区分。这里结合了 grounding、偏好构造和目标演化的证据，属于产品推论。[Clark 与 Brennan](https://web.stanford.edu/~clark/1990s/Clark%2C%20H.H.%20_%20Brennan%2C%20S.E.%20_Grounding%20in%20communication_%201991.pdf)、[Slovic](https://scholarsbank.uoregon.edu/bitstreams/c3007eab-451e-4e14-936a-eaa379013832/download)、[EvalGen](https://arxiv.org/html/2404.12272v1)

确认强度应随决策后果变化。已有清晰依据、影响低且容易改回的表达，可以直接带出处呈现，允许轻松纠正；会改变目标、不可兼得的取舍或本次执行权限，应取得相称的明确选择。这个判断原则尚需产品实验，文献没有给出通用阈值，也没有支持逐条审批所有补充信息。

## 4. 更合适的交互研究对象

建议比较两种任务定义状态，而非强制所有工作先形成完整规格：

- **探索约定**：说清当前困惑、值得探索的方向、不可越过的条件，以及下一次用什么材料帮助判断；允许偏好未定。
- **执行约定**：把已形成的目标、相关背景、交付、限制、验收及必要权限组织到足以交接的程度。

两种状态可以往返。这是从设计共演化和评价标准演化提出的研究假设，不是要求新增两个领域实体。

一个可试验的轻量流程是：先接受原始片段和相关资料，形成简短的当前理解；只暴露会实质改变结果的分歧；若用户难以用语言回答，就展示少量有明确差异的小样；把选择落实到具体内容，同时保留仍开放的部分。不要让用户先学习任务工程术语，也不要把一张庞大的待填表单包装成智能澄清。

例子需要展示“为什么不同”。若两个候选同时改变内容、语气、格式和长度，用户选择其中一个，无法判断偏好落在哪个维度。可以先固定其他条件，只比较“结论优先／证据优先”，再让用户指出喜欢与不喜欢的部分。这是待验证的实验设计，而非已有文献证明的通用最优策略。

也应允许用户直接修改候选。只提供选择题会把系统想到的选项变成用户的全部可能性；只给开放问题又可能要求用户提前说出尚未形成的标准。近期系统研究支持研究这两种方式的组合，但还不足以确定最佳界面。[IntentTagger，第 6.3、8.2–8.4 节](https://arxiv.org/html/2502.18737v1)

## 5. 如何检验“定义得更好”

建议从经用户同意的真实工作记录中，选取重复熟悉、跨情境复用、隐喻表达和开放探索等案例。比较“只恢复历史”“一次性改写”“带少量候选与澄清的任务形成”三种条件，尽量使用相同执行模型和材料。不能预先把事后整理出的最终目标当成用户最初已经具备的唯一答案。

主要观察应覆盖：交付是否符合当次最终约定；是否增添无依据的强制要求；关键歧义是否留到执行后才暴露；用户投入了多少时间和判断负担；目标修订来自新认识还是被系统误导；另一位执行者能否理解并继续工作。文本更长、字段更全、用户按下确认，都不是充分的质量证据。

尤其要保留三个反例：熟悉且低成本的任务可能无需澄清；探索任务的高质量定义可能刻意保留开放性；非常清楚的任务也可能因为数据或执行能力不足而失败。因此，应把定义质量、用户体验和执行质量分别观察，避免把所有失败归为“用户没问好”。

仍未知的是：这些机制在中文、高语境沟通、长期跨 Agent 交接中的效果；历史材料的多少会降低还是增加澄清成本；如何识别偏好成长与迎合模型；以及何时停止定义、开始行动。现有小样本研究不能替代这些验证。

## 来源与证据范围

阅读层级中的“全文关键章节”表示已进入论文正文，核查所用论点、方法或理论论证及相关局限；不表示逐页精读参考文献与所有附录。未把只读摘要的文章计入以下 9 项。

| 来源 | 年份与出处 | 样本／范围 | 实际阅读层级与链接 |
|---|---|---|---|
| Kees Dorst、Nigel Cross，*Creativity in the design process: co-evolution of problem–solution* | 2001，Design Studies 22(5):425–437；DOI 10.1016/S0142-694X(01)00009-6 | 9 名资深工业设计师；单一列车垃圾处理设计题；2.5 小时 | 全文，尤其第 1–5 节；[论文 PDF](https://sites.cc.gatech.edu/classes/AY2018/cs8803cc_spring/research_papers/Dorst_Cross2001.pdf) |
| Herbert H. Clark、Susan E. Brennan，*Grounding in Communication* | 1991，Perspectives on Socially Shared Cognition，127–149；DOI 10.1037/10096-006 | 理论章节，结合对话语料与既有实验；没有单一新实验样本 | 全文关键章节：理解证据、协作成本、目的与媒介；[作者存档 PDF](https://web.stanford.edu/~clark/1990s/Clark%2C%20H.H.%20_%20Brennan%2C%20S.E.%20_Grounding%20in%20communication_%201991.pdf) |
| Paul Slovic，*The Construction of Preference* | 1995，American Psychologist 50(5):364–371；DOI 10.1037/0003-066X.50.5.364 | 作者对偏好逆转与构造研究的理论综述；不作为一项新随机实验 | 作者存档稿正文：引言、逆转实验解释、构造及应用讨论；[机构 PDF](https://scholarsbank.uoregon.edu/bitstreams/c3007eab-451e-4e14-936a-eaa379013832/download) |
| Linden J. Ball、Bo T. Christensen，*Analogical reasoning and mental simulation in design: two strategies linked to uncertainty resolution* | 2009，Design Studies 30(2):169–186；DOI 10.1016/j.destud.2008.12.005 | 两场工程设计会议；3,886 话语片段；147 次类比；观察性编码 | 全文关键章节：编码、结果、讨论；[作者 PDF](https://analogi.dk/wp-content/uploads/2019/11/2009-Ball_Christensen.pdf) |
| Axel van Lamsweerde，*Goal-Oriented Requirements Engineering: A Guided Tour* | 2001，RE’01；DOI 10.1109/ISRE.2001.948567 | 方法综述与案例论证；非面向普通用户的交互实验 | 全文关键章节：目标来源、模型、障碍、冲突、协商；[作者 PDF](https://webperso.info.ucl.ac.be/~avl/files/RE01.pdf) |
| J.D. Zamfirescu-Pereira、Richmond Wong、Bjoern Hartmann、Qian Yang，*Why Johnny Can’t Prompt: How Non-AI Experts Try (and Fail) to Design LLM Prompts* | 2023，CHI；DOI 10.1145/3544548.3581388 | 10 人；非 AI 专家但编程经验不同；短期聊天机器人设计；研究者会协助 | 全文第 3–5 节；[作者 PDF](https://people.eecs.berkeley.edu/~bjoern/papers/zamfirescu-johnny-chi2023.pdf)；正文实际读取亦使用[作者上传全文](https://www.researchgate.net/publication/368577310_Why_Johnny_Can%27t_Prompt_How_Non-AI_Experts_Try_and_Fail_to_Design_LLM_Prompts) |
| Michael Xieyang Liu、Advait Sarkar、Carina Negreanu、Benjamin Zorn、Jack Williams、Neil Toronto、Andrew D. Gordon，*“What It Wants Me To Say”: Bridging the Abstraction Gap Between End-User Programmers and Code-Generating Large Language Models* | 2023，CHI；DOI 10.1145/3544548.3580817 | 24 人；组间比较；3 个小规模表格任务；经验分布含专业程序员 | 全文关键章节：系统机制、第 5–7 节；[机构 PDF](https://www.microsoft.com/en-us/research/wp-content/uploads/2023/04/liu_2023_grounded_abstraction_matching.pdf) |
| Shreya Shankar、J.D. Zamfirescu-Pereira、Björn Hartmann、Aditya G. Parameswaran、Ian Arawjo，*Who Validates the Validators? Aligning LLM-Assisted Evaluation of LLM Outputs with Human Preferences* | 2024，后发表于 UIST；正式版 DOI 10.1145/3654777.3676450 | 用户研究 9 名有 LLM 开发经验的行业人员；命名实体识别任务；另有两条管线的算法比较 | 2024-04 arXiv v1 正文第 3、5–7 节；[所读版本全文](https://arxiv.org/html/2404.12272v1)；不将其数值自动视为正式版逐项一致 |
| Frederic Gmeiner 等，*Intent Tagging: Exploring Micro-Prompting Interactions for Supporting Granular Human-GenAI Co-Creation Workflows* | 2025，CHI；DOI 10.1145/3706598.3713861 | 12 人，来自同一家大型技术公司；专业幻灯片经验；短期受限任务 | 全文关键章节：交互机制、第 5–8 节；[论文 HTML](https://arxiv.org/html/2502.18737v1)；预览反映偏好探索，不等于长期质量验证 |
