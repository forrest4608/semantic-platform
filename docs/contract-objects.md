# 契约对象

协议版本字段固定为 `apiVersion: semantic.platform/v1`。除补丁外，每个对象都有 `kind`、`metadata` 和 `spec`。

`metadata` 含 `id`、`name`、`namespace`，以及可选的 `description`。`id` 在整个模型里唯一，建议以 Namespace 为前缀，例如 `hr.leave.Employee`。Namespace 自己的 `metadata.namespace` 必须等于 `metadata.id`。

JSON Schema 在 `packages/contract/schemas`。下面只说明作者需要填写的内容。表达式、条件和过滤都是作者文本，M0 不解析、不执行。

## Namespace

业务域。场景驱动语义构建的结果放在这里。

| 字段 | 说明 |
| --- | --- |
| spec.domain | 更粗的域标签，如 `hr` |
| spec.version | 该域内容的作者版本 |
| spec.owners | 可选，负责人列表 |

## Entity

业务实体。

| 字段 | 说明 |
| --- | --- |
| spec.primaryKey | 属性名列表，至少一项，且必须出现在 attributes 里 |
| spec.attributes | `name`、`type`，可选 `description`、`required` |
| type | `string`、`number`、`integer`、`boolean`、`date`、`datetime` |

## Relation

两个实体之间的关系。M0 要求起点、终点和关系本身在同一个 Namespace。

| 字段 | 说明 |
| --- | --- |
| spec.from / spec.to | 实体 id |
| spec.cardinality | `one_to_one`、`one_to_many`、`many_to_one`、`many_to_many` |
| spec.fromAttribute / spec.toAttribute | 两端用来对齐的属性名 |

## Metric

指标定义，挂在一个实体上。

| 字段 | 说明 |
| --- | --- |
| spec.entity | 实体 id，须与指标同 Namespace |
| spec.expression | 口径文本 |
| spec.aggregation | 可选：`none`、`sum`、`count`、`avg`、`min`、`max` |
| spec.unit / spec.timeDimension / spec.filters | 可选 |

## Policy

访问策略。

| 字段 | 说明 |
| --- | --- |
| spec.effect | `allow` 或 `deny` |
| spec.subjects | `type` 为 `role`、`user` 或 `group` |
| spec.resources | 契约对象 id |
| spec.operations | `read`、`write`、`invoke` |
| spec.condition | 可选文本 |

## Action

可被调用的动作。写回还没实现，但契约里必须写清门槛。

| 字段 | 说明 |
| --- | --- |
| spec.preconditions | `expression`，可选 `description` |
| spec.permissions | 至少一条，含 `role` |
| spec.approval.required | 是否必须审批 |
| spec.approval.approverRoles | `required` 为 true 时至少给一个角色 |
| spec.writeBack.target | 写回的实体 id |
| spec.writeBack.operation | `insert`、`update`、`upsert`、`delete` |
| spec.writeBack.fields | 要写回的属性名，必须是目标实体上的属性 |

## ScenarioBrief

场景简报。它记录的是需求目标，不是一份新的隔离范围。

| 字段 | 说明 |
| --- | --- |
| spec.goals[].id | `G1`、`G2` 这种编号，同一简报内不可重复 |
| spec.goals[].statement | 目标陈述 |
| spec.goals[].priority | 可选：`must`、`should`、`could` |
| spec.sources | 可选，材料名称 |

## GapLog

证据不够或材料互相矛盾时写下的记录，用来把构建循环拉回业务侧。

| 字段 | 说明 |
| --- | --- |
| spec.items[].kind | `unknown` 或 `conflict` |
| spec.items[].status | `open`、`resolved`、`waived` |
| spec.items[].relatedGoals | 可选，须能在模型的目标编号里找到 |

## EvalCase 与 CasePack

EvalCase 可以单独成文，也可以嵌在 CasePack 里。示例采用 CasePack，里面放三条黄金用例。

独立 EvalCase 的问句在 `spec` 里，id 用 `metadata.id`。嵌在 CasePack 里时，每条用例自带 `id`、`question`、`expectedAnswer`、`expectedObjects`、`golden`。

`expectedObjects` 至少引用一个仍然存在的契约对象。`golden: false` 表示草稿，`semantic eval` 会跳过，不让它导致回归失败。

CasePack 还要指向一份 ScenarioBrief（`spec.scenarioBrief`）。

## SourceMapping

| 字段 | 说明 |
| --- | --- |
| spec.objectRef | 被映射的契约对象 |
| spec.source.system | 来源系统名 |
| spec.source.locator | 系统内的定位符 |
| spec.fieldMappings | `semantic` 到 `physical`。目标若是实体，`semantic` 必须是它的属性 |

## Rule

可按业务发生时点查询的规则。同一 `topic` 下，现行版和已废止版可以同时被检索到，但只有现行版能进入计算。

| 字段 | 说明 |
| --- | --- |
| spec.topic | 主题。证据检索命中其中一条时，会把同主题的其他版本一起返回 |
| spec.citation | 必须回链的条文 |
| spec.basis | `working_day` 工作日，或 `calendar_day` 自然日 |
| spec.subjectTypes | 这条规则适用的主体 |
| spec.effectiveFrom | 可选生效日。不写表示材料没有给出生效日 |
| spec.supersededAt | 可选废止日。从这天起不再作为计算依据，并且必须有 `replacedBy` |
| spec.replaces / spec.replacedBy | 替代了哪一版，以及被哪一版替代。两边要互相指向 |
| spec.threshold | 可选。`comparison` 固定为 `gt`，表示「超过」 |
| spec.limit | 可选。`per` 固定为 `person` |
| spec.includeEndpoints | 为 true 时，出发日和返回日都必须计入 |
| spec.evidence | 可检索的标题和摘录 |

教学用例里的日期只把「2025 版 / 2022 旧规」落到可查询的生效日和废止日，不是客户制度的承诺日。请假规则的制度文本没有写这两个日期。

## EvalCase 的发布门禁

原有问句、期望答案和 `expectedObjects` 仍然有效。带 `caseClass` 的用例还要写查询时点、主体、规则、事实、期望回执、证据检索词和已知失败模式。

`calculation_basis` 是口径对照。`version_interference` 是版本干扰。`semantic eval` 会跑工具回执，并确认已知失败模式过不了门禁。门禁四项是：口径算对、版本用对、证据引用正确、工具回执完整。

## ModelPatch

harness 的产出，不是 Namespace 里的对象，不要放进模型目录。

操作只有三种：`add`、`remove`、`replace`。`add` 和 `replace` 带完整对象；`remove` 只带 `targetKind` 和 `id`。内核按 id 做 diff。同一 id 如果更换了 kind，会拆成先删后增。
