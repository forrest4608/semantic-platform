# 架构

企业语义平台给 BI / 分析、流程和知识类智能体一份共同的语义契约。模型不是一次建完的，而是按「场景驱动语义构建」逐段长出来：先有业务场景描述，再整理需求目标 G[]，然后只构建支撑这些目标的语义对象，最后沉淀进业务域 Namespace。

模型变更由对话驱动的 agent harness 产出。变更必须是可 diff 的补丁，经人工确认后才发布。平台不自建查询引擎。指标要落到已有引擎时，走编译接口；对智能体的外部出口是 MCP。

## 四层

### 契约层

人编写 YAML，机器以 JSON Schema 为准做校验。Schema 放在 `packages/contract`。一份模型是一组对象，而不是一张宽表。

首批对象：

- Namespace、Entity、Relation、Metric、Policy、Action
- 构建过程中的 ScenarioBrief（目标 G[]）、GapLog（未知项或冲突项）
- 评测用的 CasePack / EvalCase
- 来源侧的 SourceMapping

Action 写明前置条件、权限、是否需要审批，以及写回目标。EvalCase 是一等对象，和实体、指标放在同一套契约里。

### 内核层

`packages/kernel` 负责把 YAML 载入内存，做 schema 与引用校验，对两个版本做 diff，再把补丁应用到模型上。评测打分、OSI 导出和指标编译的接口也放在这一层，避免命令行和 MCP 各写一套。

内核只处理契约，不解释指标表达式，也不发 SQL。

### 映射与接入层

SourceMapping 记录语义对象到来源系统的对应关系：哪个系统、哪张表或哪个定位符、哪个语义字段对应哪个物理字段。M0 没有连接器，不会去读 HRIS 或其他系统。

### 治理与运行层

契约里的 Ontology 不是单独对象，而是 Entity、Relation、Metric、Rule、SourceMapping。Rule 放计算基准、版本和数值。Policy 不并进这组：它守边界，例如禁止用自然日、禁止用已废止规则、超过工作日门槛才须人事审批。Action 仍是可执行动作，写回带人授权钩子。模型只提议，工具执行，回执证明结果。

语义层从一家具体公司开始，再到该公司的一个项目，然后才是项目里的场景。Company、Project、ScenarioBrief、Namespace 按这个顺序挂接。域 Namespace 仍是场景切片的存放处。跨项目复用口径留到以后。同一阶段也不接受跨 Namespace 引用。以后若放开，只能显式依赖已发布且当前有效的对象，被依赖对象废止或升级后必须重新评测才能发布。

业务发布由人确认，记录确认人、契约版本、评测是否通过，以及被明确接受的范围。GitHub 合并和外部工单不是发布门。未关闭的缺口默认阻断。

Policy 表达谁可以读、写或调用。Action 的审批要求约束写回。对外用 MCP：读工具和写工具分开，写工具必须经过 Action 的审批策略。评测回归和工作台放在这一层，用来确认契约仍然支撑已确认的问句。发布动作留给人工确认，不由 harness 直接落盘到已发布模型。

M1 在这一层补了四个读能力：按生效日、废止日和替代指针查询规则版本；由工具计算时长和限额并出具回执；检索证据时标明是否现行；把口径对照和版本干扰用例入库。默认智能体运行时只挂读工具。写工具可以打开脚手架，但仍然不写人事或报销系统，也不改知识库。

## 与 OSI 的关系

内部模型是 OSI（Open Semantic Interchange）的超集。实体、关系和指标将来可以投影到 OSI；Action、Policy、EvalCase、GapLog、SourceMapping 保留在扩展区。M0 的导出器只实现接口，`status` 固定为 `stub`，`osiVersion` 为 `unspecified`，不能当作可导入其他产品的成品。

指标编译器同样只是接口，预留 MetricFlow 与 Snowflake semantic view 两个目标。
