import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { loadModel } from "@semantic/kernel";
import { createServer } from "../src/server.ts";
import { getObject, invokeAction, listNamespaces, proposePatch, searchCatalog } from "../src/tools.ts";

const exampleDir = fileURLToPath(new URL("../../../examples/hr-leave", import.meta.url));

describe("MCP 读工具", () => {
  it("列出 Namespace、按 id 读取、并搜索目录", () => {
    const model = loadModel(exampleDir);
    const namespaces = listNamespaces(model);
    expect(namespaces.ok).toBe(true);
    if (namespaces.ok) {
      expect(namespaces.data.map((item) => item.id)).toContain("hr.leave");
    }

    const object = getObject(model, "hr.leave.ApproveLeave");
    expect(object.ok).toBe(true);
    if (object.ok) expect(object.data.kind).toBe("Action");

    const hits = searchCatalog(model, "remaining_leave_days");
    expect(hits.ok).toBe(true);
    if (hits.ok) {
      expect(hits.data.some((item) => item.id === "hr.leave.remaining_leave_days")).toBe(true);
    }
  });

  it("空查询被拒绝", () => {
    const result = searchCatalog(loadModel(exampleDir), "  ");
    expect(result.ok).toBe(false);
  });
});

describe("MCP 写工具", () => {
  it("invoke_action 返回未实现，并标出审批要求", () => {
    const result = invokeAction(loadModel(exampleDir), "hr.leave.ApproveLeave");
    expect(result.ok).toBe(false);
    expect(result.error.code).toBe("not_implemented");
    expect(result.error.approvalRequired).toBe(true);
  });

  it("propose_patch 返回未实现", () => {
    const result = proposePatch();
    expect(result.error.code).toBe("not_implemented");
  });
});

describe("MCP 传输", () => {
  it("客户端可以调用 list_namespaces", async () => {
    const server = createServer({ model: loadModel(exampleDir) });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientTransport);
    const result = await client.callTool({ name: "list_namespaces", arguments: {} });
    expect(JSON.stringify(result)).toContain("hr.leave");
    await client.close();
    await server.close();
  });
});
