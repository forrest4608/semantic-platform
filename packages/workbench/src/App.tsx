import { useEffect, useState } from "react";
import { authConfig, type SessionKind } from "./auth-config.ts";
import { CatalogPage } from "./pages/CatalogPage.tsx";
import { EvalPage } from "./pages/EvalPage.tsx";
import { GraphPage } from "./pages/GraphPage.tsx";
import { SandboxPage } from "./pages/SandboxPage.tsx";

const NAV = [
  { hash: "#/graph", label: "图谱" },
  { hash: "#/catalog", label: "目录" },
  { hash: "#/sandbox", label: "试问沙箱" },
  { hash: "#/eval", label: "评测" },
] as const;

type PageHash = (typeof NAV)[number]["hash"];

export function App() {
  const hash = useHash();
  const page = isPage(hash) ? hash : "#/graph";
  const [session, setSession] = useState<SessionKind>("anonymous");

  return (
    <div className="shell">
      <header className="top">
        <div>
          <p className="eyebrow">M0 工作台</p>
          <h1>企业语义平台</h1>
        </div>
        <AuthBar session={session} onChange={setSession} />
      </header>
      <nav className="nav" aria-label="主导航">
        {NAV.map((item) => (
          <a key={item.hash} href={item.hash} aria-current={page === item.hash ? "page" : undefined}>
            {item.label}
          </a>
        ))}
      </nav>
      <main>
        {page === "#/graph" && <GraphPage />}
        {page === "#/catalog" && <CatalogPage />}
        {page === "#/sandbox" && <SandboxPage />}
        {page === "#/eval" && <EvalPage />}
      </main>
    </div>
  );
}

function AuthBar({
  session,
  onChange,
}: {
  session: SessionKind;
  onChange: (next: SessionKind) => void;
}) {
  return (
    <section className="auth" aria-label="登录占位">
      <p className="session">{sessionLabel(session)}</p>
      <button type="button" onClick={() => onChange("local-placeholder")}>
        以本地管理员进入（占位）
      </button>
      <button type="button" onClick={() => onChange("sso-placeholder")}>
        企业 SSO（占位）
      </button>
      <p className="hint">
        本地账号 {authConfig.localAdmin.username}，口令读取环境变量 {authConfig.localAdmin.passwordEnv}。
        SSO issuer：{authConfig.oidc.issuer}，client id：{authConfig.oidc.clientId}。M0 不校验身份。
      </p>
    </section>
  );
}

function sessionLabel(session: SessionKind): string {
  if (session === "local-placeholder") return "本地会话占位，未校验口令";
  if (session === "sso-placeholder") return "SSO 会话占位，未跳转 IdP";
  return "未登录";
}

function useHash(): string {
  const [hash, setHash] = useState(() => window.location.hash || "#/graph");
  useEffect(() => {
    if (!window.location.hash) window.location.hash = "#/graph";
    const onChange = () => setHash(window.location.hash || "#/graph");
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return hash;
}

function isPage(hash: string): hash is PageHash {
  return NAV.some((item) => item.hash === hash);
}
