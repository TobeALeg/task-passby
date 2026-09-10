# 从含混意图到可执行任务：LLM 澄清与评测证据

研究截止：2026-09-10。本文围绕“识别缺口—选择问题—整合回答—交付任务定义”检索了 16 项原始研究，重点核读其中 8 篇的方法、实验、结果及局限。2020—2022 年文献仅作历史前驱；具体数字保留论文版本，不代表今天所有模型的能力。本文没有重新运行论文代码，也没有开展新的用户实验。

## 研究判断

这个方向已有直接先例，尤其是 IN3 的上游意图理解模块；仍然值得研究的是：**怎样在少打扰用户的条件下，形成足够准确、保留授权边界、能够随对话修订的任务定义**。已有实验分别支持选择性澄清、显式保存要求、按下游价值分配问题预算；它们尚未共同证明一套适合真实知识工作的通用方案。

需要分开四件事：模型不知道事实，用户没有说出偏好，任务本身有多种成立的解释，用户还没有形成决定。检索可能解决第一种，询问可能解决第二、三种，第四种可能需要例子或试稿来帮助用户做选择。把这些全部判为“prompt 不够完整”会混淆问题来源。以下前两节报告经验结果；第三节以后明确属于基于证据提出的研究设计。

## 八篇关键研究：实验究竟证明了什么

### 1. CLAMBER：歧义识别本身需要独立评估

Zhang 等将歧义分为知识错配、语言歧义、输出所需信息缺失三个维度、八类。约 12K 数据经语言专家检查；实验抽取 3,600 项，测试五个模型以及零样本、少样本和 CoT 组合。GPT-3.5-Turbo-16k 在四种设置下的平均识别准确率为 **54.25%**、F1 为 **52.77%**；CoT 和示例没有稳定解决识别问题。这支持将“判断是否需要澄清”作为独立能力，而不能用最终回答的流畅程度代替。局限是模型代际较早、标签是静态二分类，且其知识错配类别不等同于用户意图不明；不能据此说 2026 年模型也只有约 54% 水平。[原文 §3—5、表 2—3](https://arxiv.org/html/2405.12063v1)

### 2. IN3 / Mistral-Interact：与“任务定义层”最直接的先例

IN3 共 1,369 项任务，训练/测试为 1,261/108，标注是否含混、缺失信息、重要级别及候选选项。研究将 Mistral-7B 训练成先判断、再询问、最后汇总目标的上游模块。108 项理解评测由 **8 位本科水平参与者**交互；下游仅对 10 项可由 XAgent 完成的含混任务作概念验证。加入澄清模块后，不必要子任务比例 **22.22%→1.85%**，每个子任务平均工具调用 **5.22→4.79**。它证明可把定义任务与执行任务分开实验；但下游样本很小，“不必要子任务减少”也不是最终成果验收率，不能当生产收益预测。[原文 §3、§5.2、附录 E.1](https://arxiv.org/html/2402.09205v2)

### 3. Clarify When Necessary：有歧义，不等于值得询问

Zhang 与 Choi 将目标定义为识别“当前会错、且获得澄清后能改善”的实例。NAACL 2025 正式版包含 QA 1,482 个输入、NLI 504 个输入、MT 264 个输入；利用带正确解释的 oracle 澄清问答控制第二阶段，主要评估何时问。IntentSim 通过模拟用户回答并计算意图熵，比较输出似然、Self-Ask、答案采样熵。在 GPT-3 的 QA 设置中 AUROC 为 **0.628**，答案采样熵 **0.625**、似然 **0.590**；总体六种模型/任务组合中四种 AUROC 最优。它没有证明“熵越高越应问”普遍成立，也没有测真人愿意付出的时间。早期摘要中“10% 预算收益翻倍”不宜代替正式版的分任务结果。[正式论文 §2、§4—5、表 4/6](https://aclanthology.org/2025.findings-naacl.306.pdf)

### 4. Lost in Conversation：要求说齐了，也可能被之前的错误答案污染

Laban 等将 **600 项任务**拆成逐轮提供的信息片段，对 15 个模型、三种输入方式各重复 10 次，累计超过 20 万次模拟。完整单轮、片段拼接单轮和片段多轮形成控制：最后所含信息相当，区别是呈现过程。六类任务的平均相对表现下降为 **39%**，不是下降 39 个百分点。例如 GPT-4.1 的数据库任务，完整输入为 93.0，拼接为 86.5，多轮为 46.0。轨迹分析观察到提前给答案、错误假设及后续过度依赖旧答案。局限：GPT-4o-mini 扮演用户，最终保证有足够信息，并非真实用户行为调查；这里的“多轮”也不能推广到所有聊天。[原文 §3—6、表 1](https://arxiv.org/html/2505.06120v1)

### 5. AskBench：把“补齐了什么”与“答对了什么”分开

AskBench v2 从 Math500、MedQA、BBH、GPQA-d 生成 **800 项对话**：400 项删减必要信息，400 项植入错误前提；每项有检查点，默认最多三轮并强制最终作答。Qwen2.5-7B 经 rubric RLVR 后，在缺失信息集合上正确率 **33.2%→61.5%**，全部检查点覆盖 **21.4%→67.9%**；但冗余提问发生率 **0.3%→3.0%**。更值得关注的是，其 IN3 清晰任务直接回答率从 **100% 降至 62.5%**。提高询问能力可能牺牲“不该问时直接做”。局限：统一模型兼任裁判与模拟用户、QA 信息空间预先封闭；覆盖率不是用户满意度。[原文 §3、§5—6、表 4](https://arxiv.org/html/2602.11199v2)

### 6. SAGE-Agent / ClarifyBench：问题应对应会改变行动的参数

SAGE 将不确定性落到工具及参数候选，用信息价值减重复询问成本选择问题。ClarifyBench 覆盖五领域、92 个工具，区分清晰、含混和不可行请求。共同 ReAct 框架下，GPT-4o 在含混任务上的正确参数工具调用覆盖率从 **42.88% 增至 59.73%**，平均提问 **2.68 降至 1.39**；更强的、带 schema 的 ReAct 基线覆盖率为 55.70%。收益取决于比较对象，不能只报最大相对提升。局限：这是工具调用匹配指标；模拟器不会自然代表权限态度。v2 表 2 总样本写 716，但三个查询类别合计为 652，分母尚需作者/数据核对。[原文 §3—8、表 2—3](https://arxiv.org/html/2511.08798v2)

### 7. CLARITI：问题有价值，还必须是用户能回答的

研究先分析 112 个高度缺失需求的 issue，再构造 SWE-Bench Verified 删减版本。最终在 **250 项**上固定 OpenHands、Seed OSS 36B、最多 30 次迭代，仅改变澄清模块；以补丁通过测试衡量完成。无澄清成功率 **22.4%**，完整 issue 为 **41.6%**；GPT-5 澄清为 **35.6% / 5.1 问**，训练的 8B CLARITI 为 **36.8% / 3.0 问**。36.8/41.6 约 88%，指达到完整输入水平的比例，不是弥补 88% 的损失。这里“可回答”是完整 issue 中是否含答案的代理指标，并无真人验证；只进行单轮澄清。结果支持同时优化相关性、可回答性及冗余，不能证明用户应提供实现方案。[原文 §3、§5—6、表 3](https://arxiv.org/html/2604.14624v1)

### 8. 用户模拟器效用：离线成功必须经过真人迁移检验

Suh 等固定初始助手、训练算法和奖励，只改变用户模拟器：同一 Qwen2.5-14B 经角色提示或用 WildChat 用户话语微调；主要比较的助手为 Qwen2.5-3B。**283 位参与者**完成至少五轮写作任务，逐轮比较匿名回答。真人数据模拟器训练的助手对初始助手胜率 **58.1%（95% CI 54.3—61.8）**；角色扮演模拟器训练的助手为 **50.6%（46.5—54.9）**，与初始助手无法显著区分。训练内使用相同模拟器得到好成绩，不保证面对别的模拟器或真人仍有效。局限：真人部分只涉及三类写作任务、小模型，不能推断全部工具代理训练；偏好胜率也不等于客观正确率。[原文 §4—5、附录 H](https://arxiv.org/html/2605.09808v1)

## 八项补充研究及适用边界

| 研究 | 对本课题有用的部分 | 阅读与边界 |
|---|---|---|
| [AmbigQA / AmbigNQ，2020](https://aclanthology.org/2020.emnlp-main.466/) | 对同一问题保留多个合理解释，分别生成消歧改写；数据覆盖 14,042 个 NQ-open 问题 | 阅读官方摘要。是多答案与改写任务，不能当作真实互动澄清成果 |
| [Abg-CoQA，2021](https://www.akbc.ws/2021/papers/SlDZ1o8FsJU) | 在基于段落的连续问答中加入澄清回合 | 阅读会议摘要。BLEU 与问答 F1 不覆盖认知负担、授权和开放目标 |
| [CLAM，2022/2023](https://arxiv.org/abs/2212.07769) | “检测—有选择地提问—根据澄清回答”的早期框架，利用拥有特权信息的模拟用户 | 阅读摘要及方法节摘录；不引用效果量。与 CLAMBER 是不同工作 |
| [QuestBench，2025](https://arxiv.org/html/2503.22674v1) | 将缺少变量的任务写成约束满足问题，测试能否选择最小必要的问题 | 阅读任务形式与摘要；答案来自候选列表，最多一问即可充分，不能直接衡量自由提问的表达质量 |
| [When2Call，2025](https://arxiv.org/abs/2504.18851) | 显式评估调用工具、追问、承认工具不能完成任务的时机 | 阅读原始摘要。可行性与参数充足性不是授权；“工具能执行”不表示“用户同意执行” |
| [偏好询问，2025](https://arxiv.org/html/2510.12015v1) | 从电影偏好档案逐步删除信息，训练由宽到细的问题重建档案；记录已问历史 | 阅读方法与实验。目标档案由 LLM 根据评分历史生成，重建用 BLEU/ROUGE；尚未证明问答中的偏好是被发现还是被塑造 |
| [Knowing but Not Showing，2026](https://arxiv.org/html/2605.25284v1) | 对 1,000 个 AmbigQA 问题、10 模型分别测歧义判断与实际追问；两者明显脱节，提供检索上下文进一步压低追问 | 阅读方法、结果、附录。不能把提示间的行为差异解释为已测量到“内部知道”；正文与附录出现 Claude 版本不一致，复现需核对 |
| [Intent Mismatch，2026](https://arxiv.org/html/2602.07338v1) | 用 mediator 将对话重构为执行指令；GPT-4o-mini 四类任务平均 53.6→73.9，简单摘要为 54.7、Mem0 为 56.5 | 阅读方法与实验；五次重复，使用合成历史提炼经验并修改原碎片顺序。结果支持继续测中间表示，但未证明这是多轮失败的唯一成因 |

## 对“如何定义任务”的研究启发

以下是本文综合提出的假说，不是上述论文已经验证的产品结论。

第一，任务定义应保留**依据与不确定性**。把“网页像杂志”翻成“使用衬线字体、三栏排版”可能看起来更具体，却偷偷把类比变成用户没有选择的设计决定。可将一个要求保存为“用户原话—候选解释—已经确认的含义—尚未决定的实现”，让执行者看到哪部分可以依赖。高质量不应等于字段填得满，未确定项可以明确留空。

第二，应围绕会改变交付物的决策组织问题。上下文、输出格式、验收标准、预算、权限都是候选维度，但不是固定问卷。知道收件人是投资人还是客户，可能决定整个演示文稿；知道更喜欢 28px 还是 30px 标题，往往不值得中断。可把候选问题的预期收益理解为“不同回答会带来多大成果差异”，再扣除用户回答成本、等待成本及误导风险。这里的收益需要依任务校准，不能仅用模型自报置信度。

第三，**澄清与授权应分开记录**。澄清回答“要得到什么”，授权回答“允许系统造成什么变化”。用户确认邮件内容，不自动等于同意发送；用户选定旅行日期，不自动等于允许扣款。工具参数齐全、任务意图明确、操作已授权，是三个不同判断。本次技术文献对前两者已有较多测量，对第三者与任务定义联动的证据不足。

第四，任务定义应是可修订状态。需要区别补充、纠正、改变主意和新增任务，并保存当前有效条件及被替代条件。只生成一次漂亮的“最终 prompt”，之后继续把旧稿和新要求混在上下文里，未必能解决多轮错误。是否应该执行前生成最新任务快照，是可直接做消融实验的问题。

第五，不能把探索性对话当作恢复固定答案。很多基准提前藏好完整任务，模型只要问出缺失槽位；真实用户可能通过看到两个方向才知道自己想要哪一个。应专门加入“起初没有稳定偏好”的任务，观察试稿、示例比较和追问各自的作用。用户确认一个选项，既可能是准确表达，也可能是被默认推荐牵引；需要记录他们为什么选择及后来是否反悔。

## 建议的可复现实验

先建设一个小而可审查的真实任务集，例如 120—180 项用于预实验；这个数量不声称足以支持显著性结论。覆盖材料研究、代码修改、文档/页面制作，以及有外部操作边界的任务。采集最初自然输入、零散补充、真实上下文、用户最终认可的成果与返工记录。由任务本人校验验收条件，允许多种合格成果，避免研究者把自己猜出的“完整 prompt”当真值。

建议比较四种条件，并固定执行模型、工具、可用材料和总预算：

1. 原始对话直接交给执行模型。
2. 不增加用户信息，只重写和归并已有要求。
3. 固定模板询问后再执行。
4. 按决策影响选择问题，并维护带依据的最新任务定义。

第二组可以检验纯重写价值；第三、四组比较问卷与选择性澄清。另保留用户事先确认的完整要求作为参考上界，不能让实验组提前读取它。为了分离“获得了更多信息”和“问得更好”，同时报告同信息条件、同提问预算条件；不要把额外获知关键事实的收益全部归功于 prompt 格式。

| 维度 | 可记录的指标 | 防止的误判 |
|---|---|---|
| 下游成果 | 用户首次验收率、客观验收条件通过率、实质返工分钟数 | 内容更长或裁判更喜欢，不等于完成任务 |
| 意图保真 | 关键要求保留率、无依据新增约束、被推翻的假设次数 | 用“更具体”掩盖语义偏移 |
| 互动负担 | 用户主动投入时间、不能回答的问题比例、重复提问、退出率 | 少回合里塞十个问题，不算少打扰 |
| 授权边界 | 未授权动作尝试、错过已授权动作、范围扩大 | 只奖励谨慎会导致所有事情都要求确认 |
| 状态更新 | 改变主意后旧约束残留、已确认条件遗失、错误假设再次出现 | 只测最终文本，看不到中途失控 |
| 可迁移性 | 相同任务规范交给不同执行模型后的表现与方差 | 特定模型的提示习惯被误当作通用任务质量 |

把“能完成但无需追问”的清晰任务、“确有关键缺口”的任务、“有多个同等可接受结果”的任务都纳入，并预先标注风险级别。外部操作在沙盒里记录尝试即可，无需真的支付、发送或删除。比较时按用户/任务分组计算置信区间，不能把同一用户的每一轮当成互相独立样本。

自动化评测可用于扩大覆盖，但模拟器应分开知道什么、愿意说什么、能理解什么；加入简短回答、不知道、拒答、反悔及说错的情况。至少使用不同来源的模拟器交叉测试，再用真人小样本验证排序。可以由 LLM 帮忙标注，验收与越权等关键标签仍需抽检，且应让裁判看到原始要求及授权记录，而不是只看到改写后的自洽文本。

## 尚无定论及引用风险

尚未找到一套同时充分覆盖真实碎片输入、隐喻、变化中目标、用户认知成本和行动权限的标准基准。没有足够证据支持永远先问、永远先出稿、永远使用 JSON，或以固定字段数量衡量任务质量。较好的研究问题是：哪种不确定性、任务代价和用户条件下，哪一种定义动作值得发生。

数字使用应特别注意：Lost in Conversation 的 39% 是跨任务的相对表现变化；IN3 下游仅 10 项；AskBench 的覆盖率与 SAGE 的覆盖率定义不同；CLARITI 的“88%”是完整输入表现的比例；真人研究的胜率不是任务成功率。ClarifyBench 样本合计不一致仍未解决；Intent Mismatch 的理论论断强于其有限干预实验；Knowing but Not Showing 的模型版本标注需要核查。以上问题降低可泛化程度，但不自动推翻其全部观察。

## 原始文献与复现入口

以下为本文使用的 16 项研究；“重点”表示已读与本文结论相关的方法、实验和局限全文段落，“补充”阅读范围见前表。列出的代码是作者提供的入口，未执行复现。

1. **重点** Tong Zhang 等（2024）。*CLAMBER: A Benchmark of Identifying and Clarifying Ambiguous Information Needs in Large Language Models*. ACL 2024。[正式条目](https://aclanthology.org/2024.acl-long.578/)；[所读 v1](https://arxiv.org/html/2405.12063v1)；[数据/代码](https://github.com/zt991211/CLAMBER)。
2. **重点** Cheng Qian 等（2024）。*Tell Me More! Towards Implicit User Intention Understanding of Language Model Driven Agents*. ACL 2024。[正式条目](https://aclanthology.org/2024.acl-long.61/)；[所读 v2](https://arxiv.org/html/2402.09205v2)；[代码](https://github.com/HBX-hbx/Mistral-Interact)。
3. **重点** Michael J.Q. Zhang、Eunsol Choi（2025；预印本 2023）。*Clarify When Necessary: Resolving Ambiguity Through Interaction with LMs*. Findings of NAACL 2025，5541—5558。[正式全文](https://aclanthology.org/2025.findings-naacl.306.pdf)。
4. **重点** Philippe Laban、Hiroaki Hayashi、Yingbo Zhou、Jennifer Neville（2025）。*LLMs Get Lost In Multi-Turn Conversation*. arXiv:2505.06120v1。[全文](https://arxiv.org/html/2505.06120v1)；[代码](https://github.com/microsoft/lost_in_conversation)。
5. **重点** Jiale Zhao、Ke Fang、Lu Cheng（2026）。*When and What to Ask: AskBench and Rubric-Guided RLVR for LLM Clarification*. arXiv:2602.11199v2，2026-04-20。[全文](https://arxiv.org/html/2602.11199v2)；[代码](https://github.com/jialeuuz/askbench)。
6. **重点** Manan Suri、Puneet Mathur、Nedim Lipka、Franck Dernoncourt、Ryan A. Rossi、Dinesh Manocha（2025/2026）。*Structured Uncertainty guided Clarification for LLM Agents*. arXiv:2511.08798v2，2026-04-10。[全文](https://arxiv.org/html/2511.08798v2)。
7. **重点** Sanidhya Vijayvargiya、Vijay Viswanathan、Graham Neubig（2026）。*Asking What Matters: Reward-Driven Clarification for Software Engineering Tasks*. arXiv:2604.14624v1。[全文](https://arxiv.org/html/2604.14624v1)；[代码](https://github.com/sani903/Teaching-Effective-Clarification)。
8. **重点** Joseph Suh、Ayush Raj、Minwoo Kang、Serina Chang（2026）。*Quantifying the Utility of User Simulators for Building Collaborative LLM Assistants*. arXiv:2605.09808v1。[全文](https://arxiv.org/html/2605.09808v1)；[代码/模型](https://github.com/schang-lab/utility-of-user-simulators)。
9. **补充** Sewon Min、Julian Michael、Hannaneh Hajishirzi、Luke Zettlemoyer（2020）。*AmbigQA: Answering Ambiguous Open-domain Questions*. EMNLP 2020，5783—5797。[正式条目](https://aclanthology.org/2020.emnlp-main.466/)。
10. **补充** Meiqi Guo、Mingda Zhang、Siva Reddy、Malihe Alikhani（2021）。*Abg-CoQA: Clarifying Ambiguity in Conversational Question Answering*. AKBC 2021。[会议条目](https://www.akbc.ws/2021/papers/SlDZ1o8FsJU)。
11. **补充** Lorenz Kuhn、Yarin Gal、Sebastian Farquhar（2022/2023）。*CLAM: Selective Clarification for Ambiguous Questions with Generative Language Models*. arXiv:2212.07769，v2 于 2023-02-20。[论文入口](https://arxiv.org/abs/2212.07769)。
12. **补充** Belinda Z. Li、Been Kim、Zi Wang（2025）。*QuestBench: Can LLMs ask the right question to acquire information in reasoning tasks?* arXiv:2503.22674v1。[全文](https://arxiv.org/html/2503.22674v1)；[代码](https://github.com/google-deepmind/questbench)。
13. **补充** Hayley Ross、Ameya Sunil Mahabaleshwarkar、Yoshi Suhara（2025）。*When2Call: When (not) to Call Tools*. arXiv:2504.18851。[论文入口](https://arxiv.org/abs/2504.18851)；[代码](https://github.com/NVIDIA/When2Call)。
14. **补充** Ali Montazeralghaem、Guy Tennenholtz、Craig Boutilier、Ofer Meshi（2025）。*Asking Clarifying Questions for Preference Elicitation With Large Language Models*. arXiv:2510.12015v1。[全文](https://arxiv.org/html/2510.12015v1)。其 PDF/HTML 有会议模板占位字段，本文只按预印本引用。
15. **补充** Jinyan Su、Claire Cardie（2026）。*Knowing but Not Showing: LLMs Recognize Ambiguity but Rarely Ask Clarifying Questions*. arXiv:2605.25284v1。[全文](https://arxiv.org/html/2605.25284v1)。
16. **补充** Geng Liu、Fei Zhu、Rong Feng、Changyi Ma、Shiqi Wang、Gaofeng Meng（2026）。*Intent Mismatch Causes LLMs to Get Lost in Multi-Turn Conversation*. arXiv:2602.07338v1。[全文](https://arxiv.org/html/2602.07338v1)。
