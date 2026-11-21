/**
 * MCP 服务器骨架。传输使用 stdio，工具实现见 tools.ts。
 */
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { loadModel, validateModel, type SemanticModel } from "@semantic/kernel";
import { z } from "zod";
import {
  approveLeave,
  getObject,
  invokeAction,
  listNamespaces,
  proposePatch,
  queryRule,
  readEvalCase,
  readEvidence,
  readLeaveDays,
  readLimit,
  readTrip,
  rejectEvalIngest,
  searchCatalog,
  submitExpense,
  type ToolResponse,
} from "./tools.ts";

export interface ServerOptions {
  model: SemanticModel;
  /** 默认不注册写工具。打开后也只挂拒绝写回的脚手架。 */
  writeScaffold?: boolean;
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
    "query_rule_version",
    {
      description: "按规则、主体和业务发生时点查询是否现行，并返回生效日、废止日和替代指针",
      inputSchema: z.object({
        ruleId: z.string().describe("规则 id"),
        subjectType: z.string().describe("主体类型"),
        asOf: z.string().describe("业务发生时点，YYYY-MM-DD"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ ruleId, subjectType, asOf }) => jsonResult(queryRule(model, ruleId, subjectType, asOf)),
  );

  server.registerTool(
    "get_leave_days",
    {
      description: "按现行规则计算请假工作日，并给出回执。天数由工具计算。",
      inputSchema: z.object({ caseId: z.string().describe("评测用例 id") }),
      annotations: { readOnlyHint: true },
    },
    async ({ caseId }) => jsonResult(readLeaveDays(model, caseId)),
  );

  server.registerTool(
    "get_trip",
    {
      description: "读取出差事实。不写报销系统。",
      inputSchema: z.object({ caseId: z.string().describe("评测用例 id") }),
      annotations: { readOnlyHint: true },
    },
    async ({ caseId }) => jsonResult(readTrip(model, caseId)),
  );

  server.registerTool(
    "get_limit",
    {
      description: "按现行限额计算可报金额，并给出回执。不采用已废止规则。",
      inputSchema: z.object({ caseId: z.string().describe("评测用例 id") }),
      annotations: { readOnlyHint: true },
    },
    async ({ caseId }) => jsonResult(readLimit(model, caseId)),
  );

  server.registerTool(
    "retrieve_evidence",
    {
      description: "检索制度原文，并标明该文档在查询时点是否现行",
      inputSchema: z.object({
        query: z.string().describe("检索词"),
        asOf: z.string().describe("查询时点，YYYY-MM-DD"),
        subjectType: z.string().describe("主体类型"),
      }),
      annotations: { readOnlyHint: true },
    },
    async ({ query, asOf, subjectType }) => jsonResult(readEvidence(model, query, asOf, subjectType)),
  );

  server.registerTool(
    "get_eval_case",
    {
      description: "读取已入库的评测用例",
      inputSchema: z.object({ caseId: z.string().describe("评测用例 id") }),
      annotations: { readOnlyHint: true },
    },
    async ({ caseId }) => jsonResult(readEvalCase(model, caseId)),
  );

  if (options.writeScaffold) registerWriteScaffold(server, model);

  return server;
}

function registerWriteScaffold(server: McpServer, model: SemanticModel): void {
  server.registerTool(
    "invoke_action",
    {
      description: "写工具脚手架。不执行，返回未实现，并说明是否需要 Action 审批。",
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
      description: "写工具脚手架。不接收补丁。",
      inputSchema: z.object({
        summary: z.string().describe("拟议变更的一句话说明"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async () => jsonResult(proposePatch()),
  );

  server.registerTool(
    "approve_leave",
    {
      description: "请假写回脚手架。必须过审批门，且本里程碑不写入人事系统。",
      inputSchema: z.object({
        actionId: z.string().describe("Action 对象 id"),
        approvedBy: z.string().optional().describe("确认人"),
        role: z.string().optional().describe("确认角色"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ actionId, approvedBy, role }) => jsonResult(approveLeave(model, actionId, { approvedBy, role })),
  );

  server.registerTool(
    "submit_expense",
    {
      description: "报销写回脚手架。必须过财务审批门，且本里程碑不写入报销系统。",
      inputSchema: z.object({
        actionId: z.string().describe("Action 对象 id"),
        approvedBy: z.string().optional().describe("确认人"),
        role: z.string().optional().describe("确认角色"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ actionId, approvedBy, role }) => jsonResult(submitExpense(model, actionId, { approvedBy, role })),
  );

  server.registerTool(
    "ingest_eval_case",
    {
      description: "评测用例入库脚手架。默认运行时不写知识库。",
      inputSchema: z.object({
        caseId: z.string().describe("拟入库的用例 id"),
        approvedBy: z.string().optional().describe("确认人"),
      }),
      annotations: { readOnlyHint: false, destructiveHint: true },
    },
    async ({ approvedBy }) => jsonResult(rejectEvalIngest({ approvedBy })),
  );
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
