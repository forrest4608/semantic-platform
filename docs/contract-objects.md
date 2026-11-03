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

## ModelPatch

harness 的产出，不是 Namespace 里的对象，不要放进模型目录。

操作只有三种：`add`、`remove`、`replace`。`add` 和 `replace` 带完整对象；`remove` 只带 `targetKind` 和 `id`。内核按 id 做 diff。同一 id 如果更换了 kind，会拆成先删后增。
