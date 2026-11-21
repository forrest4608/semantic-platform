/**
 * 默认智能体运行时只挂只读工具。
 * 写工具可以存在于审批门后面，但不进入这份清单。
 */

export const READ_TOOL_NAMES = [
  "list_namespaces",
  "get_object",
  "search_catalog",
  "query_rule_version",
  "get_leave_days",
  "get_trip",
  "get_limit",
  "retrieve_evidence",
  "get_eval_case",
] as const;

export const WRITE_TOOL_NAMES = [
  "invoke_action",
  "propose_patch",
  "approve_leave",
  "submit_expense",
  "ingest_eval_case",
] as const;

export function isWriteTool(name: string): boolean {
  return (WRITE_TOOL_NAMES as readonly string[]).includes(name);
}

export function defaultAgentTools(): readonly string[] {
  return READ_TOOL_NAMES;
}
