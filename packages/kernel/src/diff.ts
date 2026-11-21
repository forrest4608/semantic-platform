/**
 * 按对象 id 比较两版模型，产出可复查的补丁。
 * 同一 id 更换 kind 时拆成 remove + add。
 */
import { API_VERSION } from "@semantic/contract";
import { canonical } from "./model.ts";
import type { ModelPatch, PatchOperation, SemanticDocument, SemanticModel } from "./types.ts";

const OP_ORDER: Record<PatchOperation["op"], number> = {
  remove: 0,
  replace: 1,
  add: 2,
};

export function diffModels(base: SemanticModel, head: SemanticModel): ModelPatch {
  const operations: PatchOperation[] = [];
  const headIds = new Set(head.documents.map((document) => document.metadata.id));

  for (const document of base.documents) {
    if (!headIds.has(document.metadata.id)) {
      operations.push({ op: "remove", targetKind: document.kind, id: document.metadata.id });
    }
  }

  for (const document of head.documents) {
    const previous = base.byId.get(document.metadata.id);
    if (!previous) {
      operations.push({
        op: "add",
        targetKind: document.kind,
        id: document.metadata.id,
        document: cloneDocument(document),
      });
      continue;
    }
    if (canonical(previous) === canonical(document)) continue;
    if (previous.kind !== document.kind) {
      operations.push({ op: "remove", targetKind: previous.kind, id: previous.metadata.id });
      operations.push({
        op: "add",
        targetKind: document.kind,
        id: document.metadata.id,
        document: cloneDocument(document),
      });
      continue;
    }
    operations.push({
      op: "replace",
      targetKind: document.kind,
      id: document.metadata.id,
      document: cloneDocument(document),
    });
  }

  operations.sort(compareOperations);
  return { apiVersion: API_VERSION, kind: "ModelPatch", operations };
}

function compareOperations(left: PatchOperation, right: PatchOperation): number {
  const byId = left.id.localeCompare(right.id);
  if (byId !== 0) return byId;
  const byKind = left.targetKind.localeCompare(right.targetKind);
  if (byKind !== 0) return byKind;
  return OP_ORDER[left.op] - OP_ORDER[right.op];
}

function cloneDocument(document: SemanticDocument): SemanticDocument {
  return structuredClone(document);
}
