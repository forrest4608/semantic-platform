/**
 * MCP 服务器骨架。传输使用 stdio，工具实现见 tools.ts。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadModel, validateModel, type SemanticModel } from "@semantic/kernel";
import { z } from "zod";
import {
  getObject,
  invokeAction,
  listNamespaces,
  proposePatch,
  searchCatalog,
  type ToolResponse,
} from "./tools.ts";

export interface ServerOptions {
  model: SemanticModel;
}

export function createServer(options: ServerOptions): McpServer {
  const model = options.model;
  const server = new McpServer({ name: "semantic-platform", version: "0.1.0" });

  server.registerTool(
    "list_namespaces",
    {
      description: "列出已加载模型中的 Namespace",
      inputSchema: z.object({}),
      annotations: { readOnlyHint: true },
    },
    async () => jsonResult(listNamespaces(model)),
  );

  server.registerTool(
    "get_object",
    {
      description: "按 id 读取一个契约对象",
      inputSchema: z.object({ id: z.string().describe("对象 id") }),
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => jsonResult(getObject(model, id)),
  );

  server.registerTool(
    "search_catalog",
    {
      description: "在目录中按名称、id 或描述做子串搜索",
      inputSchema: z.object({ query: z.string().describe("搜索词") }),
      annotations: { readOnlyHint: true },
    },
    async ({ query }) => jsonResult(searchCatalog(model, query)),
  );

  server.registerTool(
    "invoke_action",
    {
      description: "写工具占位。M0 不执行，返回未实现，并说明是否需要 Action 审批。",
      inputSchema: z.object({
        actionId: z.string().describe("Action 对象 id"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ actionId }) => jsonResult(invokeAction(model, actionId)),
  );

  server.registerTool(
    "propose_patch",
    {
      description: "写工具占位。M0 不接收补丁。",
      inputSchema: z.object({
        summary: z.string().describe("拟议变更的一句话说明"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async () => jsonResult(proposePatch()),
  );

  return server;
}

export function loadModelForServer(modelDir: string): SemanticModel {
  const model = loadModel(modelDir);
  const report = validateModel(model);
  if (!report.ok) {
    const detail = report.issues.map((item) => `${item.path}: ${item.message}`).join("\n");
    throw new Error(`模型未通过校验，MCP 服务器拒绝启动。\n${detail}`);
  }
  return model;
}

function jsonResult(payload: ToolResponse<unknown>) {
  return {
    content: [{ type: "text" as const, text: JSON.stringify(payload, null, 2) }],
    isError: !payload.ok,
  };
}
