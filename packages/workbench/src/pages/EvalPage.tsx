export function EvalPage() {
  return (
    <section>
      <h2>评测</h2>
      <p className="lead">
        黄金用例写在契约里。回归命令是 <code>pnpm eval:examples</code>，M0 只检查用例是否仍绑定到存在的对象。
      </p>
      <div className="empty">
        <p>工作台里的评测视图会在后续里程碑读取 EvalCase 的运行结果。</p>
        <p>现在请使用命令行查看示例用例是否通过。</p>
      </div>
    </section>
  );
}
