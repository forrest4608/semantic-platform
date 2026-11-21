/** 浏览器只访问本站 /api。模型加载在服务端。 */

export interface SessionState {
  username: string | null;
}

export interface ScenarioView {
  id: string;
  name: string;
  goals: string[];
}

export interface ProjectView {
  id: string;
  name: string;
  scenarios: ScenarioView[];
}

export interface CompanyView {
  id: string;
  name: string;
  projects: ProjectView[];
}

export interface CatalogItem {
  kind: string;
  id: string;
  name: string;
  description?: string;
}

export interface GraphNode {
  id: string;
  kind: string;
  name: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  label: string;
}

export interface ReleasePreview {
  releasable: boolean;
  blockedBy: string[];
  evalPassed: boolean;
  acceptedScopes: Array<{ gapId: string; itemId: string; kind: string; statement: string }>;
  namespaceVersions: Array<{ id: string; version: string; project: string | null; company: string | null }>;
  contractVersion: string;
}

export interface Workspace {
  projectId: string;
  scenario: ScenarioView;
  kindLabels: Record<string, string>;
  catalog: CatalogItem[];
  graph: { nodes: GraphNode[]; edges: GraphEdge[] };
  gaps: Array<{ id: string; name: string; items: Array<Record<string, unknown>> }>;
  evaluation: {
    ok: boolean;
    passed: number;
    failed: number;
    results: Array<{
      caseId: string;
      question: string;
      passed: boolean;
      skipped: boolean;
      notes: string[];
      releaseGate?: {
        basisCorrect: boolean;
        versionCorrect: boolean;
        citationCorrect: boolean;
        receiptComplete: boolean;
        passed: boolean;
      };
    }>;
  };
  release: ReleasePreview;
}

export interface AskResult {
  matched: boolean;
  question: string;
  answer?: string;
  receipt?: Record<string, unknown>;
  trip?: Record<string, unknown>;
  message: string;
}

export interface StoredRelease extends ReleasePreview {
  id: string;
  projectId: string;
  createdAt: string;
  approvedBy: string;
  evalPassed: boolean;
}

export class ApiError extends Error {
  readonly status: number;
  readonly blockedBy: string[];

  constructor(status: number, message: string, blockedBy: string[] = []) {
    super(message);
    this.status = status;
    this.blockedBy = blockedBy;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    credentials: "include",
    headers: { "Content-Type": "application/json", ...(init?.headers ?? {}) },
  });
  const body = (await response.json()) as { error?: string; blockedBy?: string[] };
  if (!response.ok) {
    throw new ApiError(response.status, body.error ?? "请求失败", body.blockedBy ?? []);
  }
  return body as T;
}

export const api = {
  session: () => request<SessionState>("/api/session"),
  login: (username: string, password: string) =>
    request<SessionState>("/api/session/login", { method: "POST", body: JSON.stringify({ username, password }) }),
  logout: () => request<SessionState>("/api/session/logout", { method: "POST", body: "{}" }),
  context: () => request<{ companies: CompanyView[] }>("/api/context"),
  workspace: (projectId: string, scenarioId: string) =>
    request<Workspace>(`/api/workspace?projectId=${encodeURIComponent(projectId)}&scenarioId=${encodeURIComponent(scenarioId)}`),
  ask: (projectId: string, question: string) =>
    request<AskResult>("/api/ask", { method: "POST", body: JSON.stringify({ projectId, question }) }),
  releases: (projectId: string) =>
    request<{ records: StoredRelease[] }>(`/api/releases?projectId=${encodeURIComponent(projectId)}`),
  release: (projectId: string) =>
    request<{ record: StoredRelease }>("/api/release", { method: "POST", body: JSON.stringify({ projectId }) }),
};
