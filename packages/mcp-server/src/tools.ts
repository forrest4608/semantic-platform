/**
 * MCP 工具的纯函数实现。
 * 读工具查询契约、版本、证据和计算回执。
 * 写工具仍不落系统：未审批返回审批门，已审批也只返回未执行。
 * invoke_action 与 propose_patch 保持原来的未实现行为。
 */
import {
  documentsOf,
  getLeaveDays,
  getLimit,
  getTrip,
  isRecord,
  ModelError,
  queryRuleVersion,
  retrieveEvidence,
} from "@semantic/kernel";
import type { SemanticDocument, SemanticModel } from "@semantic/kernel";

export interface ToolError {
  code: "not_implemented" | "not_found" | "invalid_argument" | "rule_not_in_force" | "approval_required" | "not_executed";
  message: string;
  approvalRequired?: boolean;
  actionId?: string;
}

export interface ToolSuccess<T> {
  ok: true;
  data: T;
}

export interface ToolFailure {
  ok: false;
  error: ToolError;
}

export type ToolResponse<T> = ToolSuccess<T> | ToolFailure;

export interface CatalogHit {
  kind: string;
  id: string;
  name: string;
  namespace: string;
  description?: string;
}

export function listNamespaces(model: SemanticModel): ToolResponse<CatalogHit[]> {
  return {
    ok: true,
    data: documentsOf(model, "Namespace").map(summarize),
  };
}

export function getObject(model: SemanticModel, id: string): ToolResponse<SemanticDocument> {
  const trimmed = id.trim();
  if (!trimmed) {
    return { ok: false, error: { code: "invalid_argument", message: "id 不能为空" } };
  }
  const document = model.byId.get(trimmed);
  if (!document) {
    return { ok: false, error: { code: "not_found", message: `找不到对象：${trimmed}` } };
  }
  return { ok: true, data: document };
}

export function searchCatalog(model: SemanticModel, query: string): ToolResponse<CatalogHit[]> {
  const needle = query.trim().toLowerCase();
  if (!needle) {
    return { ok: false, error: { code: "invalid_argument", message: "query 不能为空" } };
  }
  const hits = model.documents.filter((document) => {
    const haystack = [
      document.kind,
      document.metadata.id,
      document.metadata.name,
      document.metadata.description ?? "",
    ]
      .join("\n")
      .toLowerCase();
    return haystack.includes(needle);
  });
  return { ok: true, data: hits.map(summarize) };
}

export function invokeAction(model: SemanticModel, actionId: string): ToolFailure {
  const document = model.byId.get(actionId);
  if (!document || document.kind !== "Action") {
    return {
      ok: false,
      error: { code: "not_found", message: `找不到动作：${actionId}`, actionId },
    };
  }
  const approval = isRecord(document.spec.approval) ? document.spec.approval : undefined;
  const approvalRequired = approval?.required === true;
  return {
    ok: false,
    error: {
      code: "not_implemented",
      actionId,
      approvalRequired,
      message: approvalRequired
        ? "M0 不执行写回。该动作要求审批，写工具要等审批策略接通后才会开放。"
        : "M0 不执行写回。写工具尚未实现。",
    },
  };
}

export function proposePatch(): ToolFailure {
  return {
    ok: false,
    error: {
      code: "not_implemented",
      message: "M0 不接收模型补丁。变更需由人工确认后再发布。",
    },
  };
}

export function queryRule(model: SemanticModel, ruleId: string, subjectType: string, asOf: string) {
  return fromKernel(() => queryRuleVersion(model, { ruleId, subjectType, asOf }));
}

export function readLeaveDays(model: SemanticModel, caseId: string) {
  return fromKernel(() => getLeaveDays(model, caseId));
}

export function readTrip(model: SemanticModel, caseId: string) {
  return fromKernel(() => getTrip(model, caseId));
}

export function readLimit(model: SemanticModel, caseId: string) {
  return fromKernel(() => getLimit(model, caseId));
}

export function readEvidence(model: SemanticModel, query: string, asOf: string, subjectType: string) {
  return fromKernel(() => retrieveEvidence(model, { query, asOf, subjectType }));
}

export function readEvalCase(model: SemanticModel, caseId: string): ToolResponse<SemanticDocument> {
  const trimmed = caseId.trim();
  if (!trimmed) return { ok: false, error: { code: "invalid_argument", message: "id 不能为空" } };
  const document = model.byId.get(trimmed);
  if (!document || document.kind !== "EvalCase") {
    return { ok: false, error: { code: "not_found", message: `找不到评测用例：${trimmed}` } };
  }
  return { ok: true, data: document };
}

export interface WriteConfirmation {
  approvedBy?: string;
  role?: string;
}

/** 写工具只核对审批门，不修改模型，也不写业务系统。 */
export function approveLeave(model: SemanticModel, actionId: string, confirmation: WriteConfirmation = {}): ToolFailure {
  return refuseWrite(model, actionId, confirmation);
}

export function submitExpense(model: SemanticModel, actionId: string, confirmation: WriteConfirmation = {}): ToolFailure {
  return refuseWrite(model, actionId, confirmation);
}

export function rejectEvalIngest(confirmation: WriteConfirmation = {}): ToolFailure {
  if (!confirmation.approvedBy?.trim()) {
    return {
      ok: false,
      error: {
        code: "approval_required",
        approvalRequired: true,
        message: "评测用例入库会改知识库，必须经审批。默认运行时不执行。",
      },
    };
  }
  return {
    ok: false,
    error: {
      code: "not_executed",
      approvalRequired: true,
      message: "M1 不通过 MCP 写入知识库。",
    },
  };
}

function refuseWrite(model: SemanticModel, actionId: string, confirmation: WriteConfirmation): ToolFailure {
  const document = model.byId.get(actionId);
  if (!document || document.kind !== "Action") {
    return { ok: false, error: { code: "not_found", message: `找不到动作：${actionId}`, actionId } };
  }
  const approval = isRecord(document.spec.approval) ? document.spec.approval : undefined;
  const approvalRequired = approval?.required === true;
  const roles = Array.isArray(approval?.approverRoles)
    ? approval.approverRoles.filter((role): role is string => typeof role === "string")
    : [];
  const roleOk = !approvalRequired || (confirmation.role !== undefined && roles.includes(confirmation.role));
  if (!confirmation.approvedBy?.trim() || !roleOk) {
    return {
      ok: false,
      error: {
        code: "approval_required",
        actionId,
        approvalRequired,
        message: "写入须经审批门禁。默认运行时不执行写回。",
      },
    };
  }
  return {
    ok: false,
    error: {
      code: "not_executed",
      actionId,
      approvalRequired,
      message: "审批门禁已核对，M1 仍不写入系统。",
    },
  };
}

function fromKernel<T>(fn: () => T): ToolResponse<T> {
  try {
    return { ok: true, data: fn() };
  } catch (error) {
    if (error instanceof ModelError) {
      const coded = error.issues.find((item) => item.code === "rule_not_in_force" || item.code === "not_found");
      const code = coded?.code === "rule_not_in_force" || coded?.code === "not_found" ? coded.code : "invalid_argument";
      return { ok: false, error: { code, message: error.message } };
    }
    throw error;
  }
}

function summarize(document: SemanticDocument): CatalogHit {
  return {
    kind: document.kind,
    id: document.metadata.id,
    name: document.metadata.name,
    namespace: document.metadata.namespace,
    ...(document.metadata.description ? { description: document.metadata.description } : {}),
  };
}
