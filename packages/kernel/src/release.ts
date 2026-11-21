/**
 * 业务发布。未关闭的认知缺口默认阻断。
 * 可发布的范围只有书面确认的本期范围，或明确留给人的边界。
 * GitHub 合并和外部工单不是发布门。
 */
import { API_VERSION } from "@semantic/contract";
import { evaluateModel } from "./eval.ts";
import { documentsOf, isRecord, stringField } from "./model.ts";
import { ModelError, type SemanticModel, type ValidationIssue } from "./types.ts";

export type AcceptedScopeKind = "current_period" | "left_for_humans";

export interface AcceptedScope {
  gapId: string;
  itemId: string;
  kind: AcceptedScopeKind;
  statement: string;
  namespace: string;
}

export interface NamespaceVersion {
  id: string;
  version: string;
  project: string | null;
  company: string | null;
}

export interface ReleaseRecord {
  approvedBy: string;
  contractVersion: typeof API_VERSION;
  namespaceVersions: NamespaceVersion[];
  evalPassed: boolean;
  acceptedScopes: AcceptedScope[];
}

export interface ReleasePreview {
  releasable: boolean;
  blockedBy: string[];
  evalPassed: boolean;
  acceptedScopes: AcceptedScope[];
  namespaceVersions: NamespaceVersion[];
  contractVersion: typeof API_VERSION;
}

/** 发布前检查。不写记录，也不接受调用方自报的确认人。 */
export function previewRelease(model: SemanticModel): ReleasePreview {
  const blockedBy = blockingGaps(model);
  const evalPassed = evaluateModel(model).ok;
  if (!evalPassed) blockedBy.push("评测未通过，不能发布");
  return {
    releasable: blockedBy.length === 0,
    blockedBy,
    evalPassed,
    acceptedScopes: collectAcceptedScopes(model),
    namespaceVersions: namespaceVersions(model),
    contractVersion: API_VERSION,
  };
}

export function releaseModel(model: SemanticModel, approvedBy: string): ReleaseRecord {
  const name = approvedBy.trim();
  if (!name) {
    throw new ModelError("发布必须由人确认", [issue("发布必须由人确认")]);
  }
  const preview = previewRelease(model);
  if (!preview.releasable) {
    throw new ModelError(preview.blockedBy.join("；"), preview.blockedBy.map((message) => issue(message)));
  }
  return {
    approvedBy: name,
    contractVersion: preview.contractVersion,
    namespaceVersions: preview.namespaceVersions,
    evalPassed: true,
    acceptedScopes: preview.acceptedScopes,
  };
}

function blockingGaps(model: SemanticModel): string[] {
  const blocked: string[] = [];
  for (const gap of documentsOf(model, "GapLog")) {
    const items = Array.isArray(gap.spec.items) ? gap.spec.items : [];
    for (const item of items) {
      if (!isRecord(item)) continue;
      if (acceptedScope(item)) continue;
      if (item.status === "resolved") continue;
      if (item.notice === "warning" || item.notice === "acknowledged") {
        blocked.push(`仅有警告或知悉，不能作为可发布范围：${gap.metadata.id} ${itemId(item)}`);
        continue;
      }
      blocked.push(`未关闭的缺口阻断发布：${gap.metadata.id} ${itemId(item)}`);
    }
  }
  return blocked;
}

function collectAcceptedScopes(model: SemanticModel): AcceptedScope[] {
  const scopes: AcceptedScope[] = [];
  for (const gap of documentsOf(model, "GapLog")) {
    const items = Array.isArray(gap.spec.items) ? gap.spec.items : [];
    for (const item of items) {
      if (!isRecord(item)) continue;
      const accepted = acceptedScope(item);
      if (!accepted) continue;
      scopes.push({
        gapId: gap.metadata.id,
        itemId: itemId(item),
        kind: accepted.kind,
        statement: accepted.statement,
        namespace: gap.metadata.namespace,
      });
    }
  }
  return scopes;
}

function acceptedScope(item: Record<string, unknown>): { kind: AcceptedScopeKind; statement: string } | undefined {
  if (!isRecord(item.acceptance)) return undefined;
  const kind = item.acceptance.kind;
  const statement = item.acceptance.statement;
  if ((kind !== "current_period" && kind !== "left_for_humans") || typeof statement !== "string") return undefined;
  const text = statement.trim();
  if (!text) return undefined;
  return { kind, statement: text };
}

function namespaceVersions(model: SemanticModel): NamespaceVersion[] {
  return documentsOf(model, "Namespace").map((namespace) => {
    const projectId = stringField(namespace.spec, "project");
    const project = projectId ? model.byId.get(projectId) : undefined;
    const company = project && isRecord(project.spec) ? stringField(project.spec, "company") : undefined;
    return {
      id: namespace.metadata.id,
      version: stringField(namespace.spec, "version") ?? "",
      project: projectId ?? null,
      company: company ?? null,
    };
  });
}

function itemId(item: Record<string, unknown>): string {
  return typeof item.id === "string" ? item.id : "";
}

function issue(message: string): ValidationIssue {
  return { level: "error", code: "release_blocked", path: "/", message };
}
