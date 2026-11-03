export function GraphPage() {
  return (
    <section>
      <h2>图谱</h2>
      <p className="lead">这里将展示一个 Namespace 里的实体与关系。M0 还没有画布。</p>
      <div className="empty">
        <p>当前没有可渲染的业务域图谱。</p>
        <p>示例契约在 examples/hr-leave，接入内核后再在此展开。</p>
      </div>
    </section>
  );
}
