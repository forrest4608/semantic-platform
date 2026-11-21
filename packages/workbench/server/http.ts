/**
 * 工作台 HTTP 接口。确认人只来自服务端会话，不接受请求体里的姓名。
 */
import { randomBytes, timingSafeEqual } from "node:crypto";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { createRequire } from "node:module";
import { readFileSync } from "node:fs";
import { isRecord, loadModel, ModelError } from "@semantic/kernel";
import {
  answerQuestion,
  discoverContext,
  kindLabel,
  projectRoot,
  publishRelease,
  workspaceView,
} from "./model-service.ts";
import { FileReleaseStore, type StoredRelease } from "./store.ts";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml") as { load: (input: string) => unknown };

const COOKIE = "sp_session";

export interface WorkbenchOptions {
  roots: string[];
  releaseFile: string;
  username: string;
  password: string;
  port?: number;
}

interface Session {
  username: string;
}

export function startWorkbench(options: WorkbenchOptions): Promise<{ url: string; close: () => Promise<void> }> {
  const sessions = new Map<string, Session>();
  const releases = new FileReleaseStore(options.releaseFile);
  const server = createServer((request, response) => {
    void handle(request, response, options, sessions, releases).catch((error: unknown) => {
      sendJson(response, 500, { error: error instanceof Error ? error.message : "服务异常" });
    });
  });
  return new Promise((resolve) => {
    server.listen(options.port ?? 0, "127.0.0.1", () => {
      const address = server.address();
      const port = address && typeof address === "object" ? address.port : 0;
      resolve({
        url: `http://127.0.0.1:${port}`,
        close: () =>
          new Promise((done, reject) => {
            server.close((error) => (error ? reject(error) : done()));
          }),
      });
    });
  });
}

export function localAdminFromFile(file: string): { username: string; passwordEnv: string } {
  const parsed = yaml.load(readFileSync(file, "utf8"));
  if (!isRecord(parsed) || !isRecord(parsed.localAdmin)) {
    throw new Error("认证配置缺少 localAdmin");
  }
  const username = parsed.localAdmin.username;
  const passwordEnv = parsed.localAdmin.passwordEnv;
  if (typeof username !== "string" || typeof passwordEnv !== "string") {
    throw new Error("本地管理员配置不完整");
  }
  return { username, passwordEnv };
}

async function handle(
  request: IncomingMessage,
  response: ServerResponse,
  options: WorkbenchOptions,
  sessions: Map<string, Session>,
  releases: FileReleaseStore,
): Promise<void> {
  const url = new URL(request.url ?? "/", "http://127.0.0.1");
  const session = readSession(request, sessions);
  if (request.method === "POST" && url.pathname === "/api/session/login") {
    const body = await readBody(request);
    const username = typeof body.username === "string" ? body.username : "";
    const password = typeof body.password === "string" ? body.password : "";
    if (username !== options.username || !sameSecret(password, options.password)) {
      sendJson(response, 401, { error: "用户名或口令不正确" });
      return;
    }
    const id = randomBytes(32).toString("hex");
    sessions.set(id, { username: options.username });
    response.setHeader("Set-Cookie", `${COOKIE}=${id}; HttpOnly; Path=/; SameSite=Lax`);
    sendJson(response, 200, { username: options.username });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/session/logout") {
    const id = cookieValue(request, COOKIE);
    if (id) sessions.delete(id);
    response.setHeader("Set-Cookie", `${COOKIE}=; HttpOnly; Path=/; Max-Age=0; SameSite=Lax`);
    sendJson(response, 200, { username: null });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/session") {
    sendJson(response, 200, session ? { username: session.username } : { username: null });
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/context") {
    sendJson(response, 200, discoverContext(options.roots));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/workspace") {
    const loaded = loadProject(options.roots, url.searchParams.get("projectId") ?? "");
    if (!loaded.ok) {
      sendJson(response, loaded.status, { error: loaded.error });
      return;
    }
    try {
      sendJson(response, 200, {
        projectId: loaded.projectId,
        kindLabels: kindLabelMap(loaded.model),
        ...workspaceView(loaded.model, url.searchParams.get("scenarioId") ?? ""),
      });
    } catch (error) {
      sendJson(response, 404, { error: error instanceof Error ? error.message : "找不到场景" });
    }
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/ask") {
    const body = await readBody(request);
    const loaded = loadProject(options.roots, typeof body.projectId === "string" ? body.projectId : "");
    if (!loaded.ok) {
      sendJson(response, loaded.status, { error: loaded.error });
      return;
    }
    const question = typeof body.question === "string" ? body.question : "";
    sendJson(response, 200, answerQuestion(loaded.model, question));
    return;
  }
  if (request.method === "GET" && url.pathname === "/api/releases") {
    if (!session) {
      sendJson(response, 401, { error: "需要本地管理员登录后才能查看发布记录" });
      return;
    }
    sendJson(response, 200, { records: releases.list(url.searchParams.get("projectId") ?? "") });
    return;
  }
  if (request.method === "POST" && url.pathname === "/api/release") {
    if (!session) {
      sendJson(response, 401, { error: "未登录，不能发布" });
      return;
    }
    const body = await readBody(request);
    const loaded = loadProject(options.roots, typeof body.projectId === "string" ? body.projectId : "");
    if (!loaded.ok) {
      sendJson(response, loaded.status, { error: loaded.error });
      return;
    }
    try {
      const record = publishRelease(loaded.model, session.username);
      const stored: StoredRelease = {
        ...record,
        id: randomBytes(16).toString("hex"),
        projectId: loaded.projectId,
        createdAt: new Date().toISOString(),
      };
      releases.append(stored);
      sendJson(response, 200, { record: stored });
    } catch (error) {
      if (error instanceof ModelError) {
        sendJson(response, 409, { error: error.message, blockedBy: error.issues.map((item) => item.message) });
        return;
      }
      throw error;
    }
    return;
  }
  sendJson(response, 404, { error: "没有这个接口" });
}

function loadProject(roots: string[], projectId: string):
  | { ok: true; projectId: string; model: ReturnType<typeof loadModel> }
  | { ok: false; status: number; error: string } {
  if (!projectId) return { ok: false, status: 400, error: "缺少项目" };
  const root = projectRoot(roots, projectId);
  if (!root) return { ok: false, status: 404, error: "找不到项目" };
  return { ok: true, projectId, model: loadModel(root) };
}

function kindLabelMap(model: ReturnType<typeof loadModel>): Record<string, string> {
  const labels: Record<string, string> = {};
  for (const document of model.documents) labels[document.kind] = kindLabel(document.kind);
  return labels;
}

function readSession(request: IncomingMessage, sessions: Map<string, Session>): Session | undefined {
  const id = cookieValue(request, COOKIE);
  if (!id) return undefined;
  return sessions.get(id);
}

function cookieValue(request: IncomingMessage, name: string): string | undefined {
  const header = request.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...rest] = part.trim().split("=");
    if (key === name) return rest.join("=");
  }
  return undefined;
}

function sameSecret(input: string, expected: string): boolean {
  const left = Buffer.from(input);
  const right = Buffer.from(expected);
  if (left.length !== right.length) return false;
  return timingSafeEqual(left, right);
}

async function readBody(request: IncomingMessage): Promise<Record<string, unknown>> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.length;
    if (size > 100_000) throw new Error("请求体过大");
    chunks.push(buffer);
  }
  if (chunks.length === 0) return {};
  const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString("utf8"));
  return isRecord(parsed) ? parsed : {};
}

function sendJson(response: ServerResponse, status: number, body: unknown): void {
  response.writeHead(status, { "Content-Type": "application/json; charset=utf-8" });
  response.end(JSON.stringify(body));
}
