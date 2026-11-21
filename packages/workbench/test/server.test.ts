import { mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { liveHarnessHook } from "../server/model-service.ts";
import { FileReleaseStore, type StoredRelease } from "../server/store.ts";
import { startWorkbench } from "../server/http.ts";
import { sameSelection } from "../src/selection.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const password = "test-only-admin-password";
const servers: Array<{ close: () => Promise<void> }> = [];

afterEach(async () => {
  await Promise.all(servers.splice(0).map((server) => server.close()));
});

describe("工作台 API", () => {
  it("请假项目因未关闭缺口不能发布，报销项目可以发布并回读记录", async () => {
    const server = await start();
    const context = await json<{ companies: Array<{ id: string; name: string; projects: Array<{ id: string; name: string; scenarios: Array<{ id: string }> }> }> }>(
      await fetch(`${server.url}/api/context`),
    );
    const company = context.companies.find((item) => item.id === "fixture.teaching");
    expect(company?.name).toBe("教学夹具公司");
    const leave = company?.projects.find((item) => item.id === "fixture.teaching.leave");
    const expense = company?.projects.find((item) => item.id === "fixture.teaching.expense");
    expect(leave?.scenarios.length).toBeGreaterThan(0);
    expect(expense?.scenarios.length).toBeGreaterThan(0);

    const leaveWorkspace = await json<{ release: { releasable: boolean; blockedBy: string[]; evalPassed: boolean } }>(
      await fetch(`${server.url}/api/workspace?projectId=fixture.teaching.leave&scenarioId=${leave?.scenarios[0]?.id}`),
    );
    expect(leaveWorkspace.release.evalPassed).toBe(true);
    expect(leaveWorkspace.release.releasable).toBe(false);
    expect(leaveWorkspace.release.blockedBy.join(" ")).toContain("未关闭的缺口阻断发布");

    const blocked = await fetch(`${server.url}/api/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ projectId: "fixture.teaching.leave", approvedBy: "伪造的人" }),
    });
    expect(blocked.status).toBe(401);

    const cookie = await login(server.url);
    const stillBlocked = await fetch(`${server.url}/api/release`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: cookie },
      body: JSON.stringify({ projectId: "fixture.teaching.leave", approvedBy: "伪造的人" }),
    });
    expect(stillBlocked.status).toBe(409);

    const expenseScenario = expense?.scenarios[0]?.id ?? "";
    const expenseWorkspace = await json<{ catalog: Array<{ id: string }>; graph: { edges: unknown[] }; release: { releasable: boolean; contractVersion: string; acceptedScopes: unknown[] } }>(
      await fetch(`${server.url}/api/workspace?projectId=fixture.teaching.expense&scenarioId=${expenseScenario}`),
    );
    expect(expenseWorkspace.catalog.some((item) => item.id === "finance.meal.2025")).toBe(true);
    expect(expenseWorkspace.graph.edges.length).toBeGreaterThan(0);
    expect(expenseWorkspace.release.releasable).toBe(true);
    expect(expenseWorkspace.release.contractVersion).toBe("semantic.platform/v1");
    expect(expenseWorkspace.release.acceptedScopes).toEqual([]);

    const published = await json<{ record: { id: string; approvedBy: string; evalPassed: boolean; contractVersion: string; projectId: string } }>(
      await fetch(`${server.url}/api/release`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Cookie: cookie },
        body: JSON.stringify({ projectId: "fixture.teaching.expense", approvedBy: "伪造的人" }),
      }),
    );
    expect(published.record.approvedBy).toBe("admin");
    expect(published.record.evalPassed).toBe(true);
    expect(published.record.contractVersion).toBe("semantic.platform/v1");

    const listed = await json<{ records: Array<{ id: string; approvedBy: string }> }>(
      await fetch(`${server.url}/api/releases?projectId=fixture.teaching.expense`, { headers: { Cookie: cookie } }),
    );
    expect(listed.records.some((record) => record.id === published.record.id && record.approvedBy === "admin")).toBe(true);

    const asked = await json<{ matched: boolean; receipt?: { reimbursable?: number; countedDays?: number } }>(
      await fetch(`${server.url}/api/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          projectId: "fixture.teaching.expense",
          question: "李四周三去北京、周五返回，餐费发票 420 元，能否全额报销？",
        }),
      }),
    );
    expect(asked.matched).toBe(true);
    expect(asked.receipt?.countedDays).toBe(3);
    expect(asked.receipt?.reimbursable).toBe(300);

    const unknown = await json<{ matched: boolean; message: string }>(
      await fetch(`${server.url}/api/ask`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ projectId: "fixture.teaching.expense", question: "今天天气如何？" }),
      }),
    );
    expect(unknown.matched).toBe(false);
    expect(unknown.message).toContain("未接入");
  });

  it("实时 Harness 接入口不会被调用", () => {
    expect(() => liveHarnessHook()).toThrow(/未接入/);
  });

  it("已有发布文件损坏时拒绝追加，不改写原文件", () => {
    const file = join(mkdtempSync(join(tmpdir(), "semantic-releases-")), "releases.json");
    const original = '{"records":[{"id":"keep","projectId":"fixture.teaching.expense"}]}\nnot-json';
    writeFileSync(file, original, "utf8");
    const store = new FileReleaseStore(file);
    expect(() => store.append(sampleRelease("new"))).toThrow(/无法读取/);
    expect(readFileSync(file, "utf8")).toBe(original);
    expect(() => store.list("fixture.teaching.expense")).toThrow(/无法读取/);
  });

  it("发布文件不存在时写入第一条，已有记录会保留", () => {
    const file = join(mkdtempSync(join(tmpdir(), "semantic-releases-")), "releases.json");
    const store = new FileReleaseStore(file);
    store.append(sampleRelease("first"));
    store.append(sampleRelease("second"));
    expect(store.list("fixture.teaching.expense").map((record) => record.id)).toEqual(["first", "second"]);
  });

  it("切换项目后不再采用上一次发布的页面结果", () => {
    const requested = { projectId: "fixture.teaching.expense", scenarioId: "finance.brief.meal" };
    expect(sameSelection(requested, requested)).toBe(true);
    expect(sameSelection(requested, { projectId: "fixture.teaching.leave", scenarioId: "hr.leave.brief.approval" })).toBe(false);
  });
});

function sampleRelease(id: string): StoredRelease {
  return {
    id,
    projectId: "fixture.teaching.expense",
    createdAt: "2026-11-21T00:00:00.000Z",
    approvedBy: "admin",
    contractVersion: "semantic.platform/v1",
    namespaceVersions: [],
    evalPassed: true,
    acceptedScopes: [],
  };
}

async function start() {
  const server = await startWorkbench({
    roots: [join(repoRoot, "examples/hr-leave"), join(repoRoot, "examples/finance-expense")],
    releaseFile: join(mkdtempSync(join(tmpdir(), "semantic-releases-")), "releases.json"),
    username: "admin",
    password,
  });
  servers.push(server);
  return server;
}

async function login(url: string): Promise<string> {
  const wrong = await fetch(`${url}/api/session/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password: "wrong" }),
  });
  expect(wrong.status).toBe(401);
  const response = await fetch(`${url}/api/session/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ username: "admin", password }),
  });
  expect(response.status).toBe(200);
  const cookie = response.headers.getSetCookie().map((item) => item.split(";")[0]).join("; ");
  expect(cookie).toContain("sp_session=");
  return cookie;
}

async function json<T>(response: Response): Promise<T> {
  expect(response.ok).toBe(true);
  return response.json() as Promise<T>;
}
