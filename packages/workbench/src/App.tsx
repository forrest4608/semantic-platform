import { useEffect, useState, type FormEvent } from "react";
import { api, ApiError, type AskResult, type CompanyView, type StoredRelease, type Workspace } from "./api.ts";

export function App() {
  const [username, setUsername] = useState<string | null>(null);
  const [loginError, setLoginError] = useState("");
  const [companies, setCompanies] = useState<CompanyView[]>([]);
  const [companyId, setCompanyId] = useState("");
  const [projectId, setProjectId] = useState("");
  const [scenarioId, setScenarioId] = useState("");
  const [workspace, setWorkspace] = useState<Workspace | null>(null);
  const [loading, setLoading] = useState(false);
  const [loadError, setLoadError] = useState("");
  const [question, setQuestion] = useState("");
  const [asking, setAsking] = useState(false);
  const [answer, setAnswer] = useState<AskResult | null>(null);
  const [askError, setAskError] = useState("");
  const [records, setRecords] = useState<StoredRelease[]>([]);
  const [releaseError, setReleaseError] = useState("");
  const [releasing, setReleasing] = useState(false);
  const [latest, setLatest] = useState<StoredRelease | null>(null);

  useEffect(() => {
    void api.session().then((session) => setUsername(session.username)).catch(() => setUsername(null));
    void api.context().then((context) => setCompanies(context.companies)).catch((error: unknown) => {
      setLoadError(error instanceof Error ? error.message : "无法读取公司与项目");
    });
  }, []);

  const company = companies.find((item) => item.id === companyId);
  const project = company?.projects.find((item) => item.id === projectId);
  const scenario = project?.scenarios.find((item) => item.id === scenarioId);

  useEffect(() => {
    if (!projectId || !scenarioId) {
      setWorkspace(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setLoadError("");
    setAnswer(null);
    setLatest(null);
    void api
      .workspace(projectId, scenarioId)
      .then((view) => {
        if (!cancelled) setWorkspace(view);
      })
      .catch((error: unknown) => {
        if (!cancelled) setLoadError(error instanceof Error ? error.message : "模型加载失败");
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    if (username) {
      void api.releases(projectId).then((body) => {
        if (!cancelled) setRecords(body.records);
      }).catch(() => {
        if (!cancelled) setRecords([]);
      });
    } else {
      setRecords([]);
    }
    return () => {
      cancelled = true;
    };
  }, [projectId, scenarioId, username]);

  async function onLogin(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setLoginError("");
    const form = new FormData(event.currentTarget);
    try {
      const session = await api.login(String(form.get("username") ?? ""), String(form.get("password") ?? ""));
      setUsername(session.username);
    } catch (error) {
      setUsername(null);
      setLoginError(error instanceof ApiError ? error.message : "登录失败");
    }
  }

  async function onAsk(event: FormEvent) {
    event.preventDefault();
    if (!projectId) return;
    setAsking(true);
    setAskError("");
    try {
      setAnswer(await api.ask(projectId, question));
    } catch (error) {
      setAnswer(null);
      setAskError(error instanceof Error ? error.message : "试问失败");
    } finally {
      setAsking(false);
    }
  }

  async function onRelease() {
    if (!projectId) return;
    setReleasing(true);
    setReleaseError("");
    try {
      const body = await api.release(projectId);
      setLatest(body.record);
      const saved = await api.releases(projectId);
      setRecords(saved.records);
      const workspaceNow = await api.workspace(projectId, scenarioId);
      setWorkspace(workspaceNow);
    } catch (error) {
      setLatest(null);
      setReleaseError(error instanceof ApiError ? error.message : "发布失败");
    } finally {
      setReleasing(false);
    }
  }

  return (
    <div className="shell">
      <header className="top">
        <div>
          <p className="eyebrow">场景驱动语义构建</p>
          <h1>企业语义平台</h1>
        </div>
        <LoginPanel username={username} error={loginError} onLogin={onLogin} onLogout={() => {
          void api.logout().then(() => setUsername(null));
        }} />
      </header>

      <section className="selectors">
        <label>
          公司
          <select
            value={companyId}
            onChange={(event) => {
              setCompanyId(event.target.value);
              setProjectId("");
              setScenarioId("");
            }}
          >
            <option value="">请选择</option>
            {companies.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
        <label>
          项目
          <select
            value={projectId}
            onChange={(event) => {
              setProjectId(event.target.value);
              setScenarioId("");
            }}
            disabled={!company}
          >
            <option value="">请选择</option>
            {company?.projects.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
        <label>
          场景
          <select value={scenarioId} onChange={(event) => setScenarioId(event.target.value)} disabled={!project}>
            <option value="">请选择</option>
            {project?.scenarios.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </select>
        </label>
      </section>

      {loadError ? <p className="banner blocked">{loadError}</p> : null}
      {loading ? <p className="banner">正在从服务端加载模型…</p> : null}
      {!scenarioId ? <p className="lead">先选择公司、项目和场景。模型由服务端读取，页面不直接访问文件。</p> : null}

      {workspace && scenario ? (
        <>
          <section>
            <h2>{scenario.name}</h2>
            <ul>
              {scenario.goals.map((goal) => (
                <li key={goal}>{goal}</li>
              ))}
            </ul>
          </section>

          <section>
            <h2>目录</h2>
            <ul className="catalog">
              {workspace.catalog.map((item) => (
                <li key={item.id}>
                  <strong>{item.name}</strong>
                  <code>{workspace.kindLabels[item.kind] ?? item.kind}</code>
                  <span>{item.id}</span>
                  {item.description ? <span>{item.description}</span> : null}
                </li>
              ))}
            </ul>
          </section>

          <section>
            <h2>图谱</h2>
            <Graph nodes={workspace.graph.nodes} edges={workspace.graph.edges} labels={workspace.kindLabels} />
          </section>

          <section>
            <h2>试问</h2>
            <p className="lead">只回放本项目已入库的教学问句，并给出工具回执。实时 Harness 与火山方舟未接入。</p>
            <form onSubmit={(event) => void onAsk(event)}>
              <label htmlFor="question">问题</label>
              <textarea id="question" value={question} onChange={(event) => setQuestion(event.target.value)} rows={3} />
              <button type="submit" disabled={asking}>{asking ? "正在计算…" : "提问"}</button>
            </form>
            {askError ? <p className="banner blocked">{askError}</p> : null}
            {answer ? <AnswerView answer={answer} /> : null}
          </section>

          <section>
            <h2>评测与缺口</h2>
            <p className={workspace.evaluation.ok ? "banner ok" : "banner blocked"}>
              评测{workspace.evaluation.ok ? "通过" : "未通过"}：通过 {workspace.evaluation.passed}，失败 {workspace.evaluation.failed}
            </p>
            <ul className="catalog">
              {workspace.evaluation.results.map((item) => (
                <li key={item.caseId}>
                  <strong>{item.passed ? "通过" : item.skipped ? "跳过" : "失败"}</strong>
                  <code>{item.caseId}</code>
                  <span>{item.question}</span>
                  {item.releaseGate ? (
                    <span>
                      口径{flag(item.releaseGate.basisCorrect)} 版本{flag(item.releaseGate.versionCorrect)} 证据{flag(item.releaseGate.citationCorrect)} 回执{flag(item.releaseGate.receiptComplete)}
                    </span>
                  ) : null}
                </li>
              ))}
            </ul>
            <h3>缺口</h3>
            {workspace.gaps.map((gap) => (
              <article key={gap.id}>
                <h4>{gap.name}</h4>
                <ul>
                  {gap.items.map((item) => (
                    <li key={String(item.id)}>
                      {String(item.id)} · {String(item.status)} · {String(item.description ?? "")}
                    </li>
                  ))}
                </ul>
              </article>
            ))}
          </section>

          <section>
            <h2>发布</h2>
            <p className="lead">这是业务发布。确认人来自已登录的本地管理员会话。Git 合并和外部工单不是发布门。</p>
            <ReleasePanel
              release={workspace.release}
              username={username}
              releasing={releasing}
              error={releaseError}
              latest={latest}
              records={records}
              onRelease={() => void onRelease()}
            />
          </section>
        </>
      ) : null}
    </div>
  );
}

function LoginPanel({
  username,
  error,
  onLogin,
  onLogout,
}: {
  username: string | null;
  error: string;
  onLogin: (event: FormEvent<HTMLFormElement>) => void;
  onLogout: () => void;
}) {
  if (username) {
    return (
      <section className="auth" aria-label="会话">
        <p className="session">已登录：{username}</p>
        <button type="button" onClick={onLogout}>退出</button>
        <p className="hint">企业 SSO 尚未接入，不能用它登录。</p>
      </section>
    );
  }
  return (
    <form className="auth" aria-label="本地管理员登录" onSubmit={onLogin}>
      <label>
        用户名
        <input name="username" autoComplete="username" />
      </label>
      <label>
        口令
        <input name="password" type="password" autoComplete="current-password" />
      </label>
      <button type="submit">登录</button>
      {error ? <p className="banner blocked">{error}</p> : null}
      <p className="hint">口令只在服务端与 LOCAL_ADMIN_PASSWORD 比对。企业 SSO 尚未接入。</p>
    </form>
  );
}

function AnswerView({ answer }: { answer: AskResult }) {
  return (
    <div className={answer.matched ? "banner ok" : "banner blocked"}>
      <p>{answer.message}</p>
      {answer.answer ? <p>{answer.answer}</p> : null}
      {answer.receipt ? <pre>{JSON.stringify(answer.receipt, null, 2)}</pre> : null}
    </div>
  );
}

function ReleasePanel({
  release,
  username,
  releasing,
  error,
  latest,
  records,
  onRelease,
}: {
  release: Workspace["release"];
  username: string | null;
  releasing: boolean;
  error: string;
  latest: StoredRelease | null;
  records: StoredRelease[];
  onRelease: () => void;
}) {
  return (
    <>
      <p className={release.releasable ? "banner ok" : "banner blocked"}>
        {release.releasable ? "当前项目可以发布。" : "当前项目不能发布。"}
        契约版本 {release.contractVersion}。评测{release.evalPassed ? "已通过" : "未通过"}。
      </p>
      {release.blockedBy.length > 0 ? (
        <ul>
          {release.blockedBy.map((item) => (
            <li key={item}>{item}</li>
          ))}
        </ul>
      ) : null}
      {release.acceptedScopes.length > 0 ? (
        <ul>
          {release.acceptedScopes.map((scope) => (
            <li key={`${scope.gapId}-${scope.itemId}`}>{scope.kind}：{scope.statement}</li>
          ))}
        </ul>
      ) : (
        <p>没有被明确接受的范围。</p>
      )}
      <button type="button" disabled={!username || !release.releasable || releasing} onClick={onRelease}>
        {releasing ? "正在写入发布记录…" : "确认发布"}
      </button>
      {!username ? <p className="hint">未登录时不能发布。</p> : null}
      {error ? <p className="banner blocked">{error}</p> : null}
      {latest ? <RecordView title="刚写入的发布记录" record={latest} /> : null}
      <h3>已保存的发布记录</h3>
      {records.length === 0 ? <p>还没有可回读的发布记录。</p> : records.map((record) => (
        <RecordView key={record.id} title={record.createdAt} record={record} />
      ))}
    </>
  );
}

function RecordView({ title, record }: { title: string; record: StoredRelease }) {
  return (
    <article className="banner ok">
      <h4>{title}</h4>
      <p>确认人 {record.approvedBy}</p>
      <p>契约版本 {record.contractVersion}。评测{record.evalPassed ? "已通过" : "未通过"}。</p>
      <ul>
        {record.namespaceVersions.map((item) => (
          <li key={item.id}>{item.id} {item.version} · 项目 {item.project} · 公司 {item.company}</li>
        ))}
      </ul>
      {record.acceptedScopes.length === 0 ? <p>接受的范围：无</p> : (
        <ul>
          {record.acceptedScopes.map((scope) => (
            <li key={`${scope.gapId}-${scope.itemId}`}>{scope.statement}</li>
          ))}
        </ul>
      )}
    </article>
  );
}

function Graph({
  nodes,
  edges,
  labels,
}: {
  nodes: Workspace["graph"]["nodes"];
  edges: Workspace["graph"]["edges"];
  labels: Record<string, string>;
}) {
  const columns = ["Entity", "Metric", "Rule", "Policy", "Action"];
  return (
    <>
      <svg className="graph" viewBox="0 0 900 280" role="img" aria-label="模型图谱">
        {columns.map((kind, column) =>
          nodes.filter((node) => node.kind === kind).map((node, row) => (
            <g key={node.id} transform={`translate(${40 + column * 175}, ${36 + row * 42})`}>
              <rect width="150" height="32" rx="4" />
              <text x="8" y="21">{labels[kind] ?? kind} · {node.name}</text>
            </g>
          )),
        )}
      </svg>
      <ul>
        {edges.map((edge) => (
          <li key={`${edge.from}-${edge.to}-${edge.label}`}>{edge.from} — {edge.label} → {edge.to}</li>
        ))}
      </ul>
    </>
  );
}

function flag(value: boolean): string {
  return value ? "对" : "错";
}
