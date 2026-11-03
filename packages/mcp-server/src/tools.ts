/**
 * MCP 工具的纯函数实现。
 * 读工具查询已加载契约；写工具在 M0 一律返回未实现，并带上 Action 审批信息。
 */
import { documentsOf, isRecord } from "@semantic/kernel";
import type { SemanticDocument, SemanticModel } from "@semantic/kernel";

export interface ToolError {
  code: "not_implemented" | "not_found" | "invalid_argument";
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

function summarize(document: SemanticDocument): CatalogHit {
  return {
    kind: document.kind,
    id: document.metadata.id,
    name: document.metadata.name,
    namespace: document.metadata.namespace,
    ...(document.metadata.description ? { description: document.metadata.description } : {}),
  };
}
