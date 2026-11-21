const KINDS = [
  ["Namespace", "命名空间", "业务域，语义对象沉淀的位置"],
  ["Entity", "实体", "业务对象与属性"],
  ["Relation", "关系", "实体之间如何关联"],
  ["Metric", "指标", "可复用的口径，M0 不计算"],
  ["Policy", "策略", "谁可以读、写或调用"],
  ["Action", "动作", "前置条件、权限、审批与写回目标"],
  ["ScenarioBrief", "场景简报", "需求目标 G[]"],
  ["GapLog", "缺口记录", "未知项或冲突项"],
  ["CasePack", "用例包", "挂在场景简报上的一组评测用例"],
  ["EvalCase", "评测用例", "黄金问句与期望答案"],
  ["SourceMapping", "来源映射", "语义字段对应的外部来源"],
];

export function CatalogPage() {
  return (
    <section>
      <h2>目录</h2>
      <p className="lead">契约对象一览。此页是静态说明，还没有读取模型目录。</p>
      <ul className="catalog">
        {KINDS.map(([kind, name, summary]) => (
          <li key={kind}>
            <strong>{name}</strong>
            <code>{kind}</code>
            <span>{summary}</span>
          </li>
        ))}
      </ul>
    </section>
  );
}
