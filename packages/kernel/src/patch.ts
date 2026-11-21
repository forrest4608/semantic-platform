/**
 * 按补丁顺序应用变更。不在中途做引用检查，调用方应再跑 validateModel。
 */
import { validateDocumentSchema, validatePatchSchema, type ObjectKind } from "@semantic/contract";
import { indexDocuments } from "./model.ts";
import { ModelError, type ModelPatch, type SemanticDocument, type SemanticModel, type ValidationIssue } from "./types.ts";

export function applyPatch(model: SemanticModel, patch: ModelPatch): SemanticModel {
  const schema = validatePatchSchema(patch);
  if (!schema.ok) {
    throw new ModelError(
      "补丁不符合 ModelPatch schema",
      schema.errors.map((message) => issue("schema", "/", message)),
    );
  }

  const documents = new Map<string, SemanticDocument>();
  for (const document of model.documents) {
    documents.set(document.metadata.id, structuredClone(document));
  }

  for (const operation of patch.operations) {
    const current = documents.get(operation.id);
    if (operation.op === "remove") {
      if (!current) {
        throw new ModelError(`无法删除不存在的对象：${operation.id}`);
      }
      if (current.kind !== operation.targetKind) {
        throw new ModelError(`删除种类不匹配：${operation.id} 实际是 ${current.kind}`);
      }
      documents.delete(operation.id);
      continue;
    }

    const document = operation.document;
    if (!document) {
      throw new ModelError(`${operation.op} 缺少 document：${operation.id}`);
    }
    assertDocumentMatches(operation.targetKind, operation.id, document);
    if (operation.op === "add") {
      if (current) throw new ModelError(`无法新增已存在的对象：${operation.id}`);
    } else if (!current) {
      throw new ModelError(`无法替换不存在的对象：${operation.id}`);
    } else if (current.kind !== operation.targetKind) {
      throw new ModelError(`替换种类不匹配：${operation.id} 实际是 ${current.kind}`);
    }
    documents.set(operation.id, structuredClone(document));
  }

  return indexDocuments([...documents.values()]);
}

function assertDocumentMatches(kind: ObjectKind, id: string, document: SemanticDocument): void {
  const schema = validateDocumentSchema(kind, document);
  if (!schema.ok) {
    throw new ModelError(
      `补丁中的对象未通过 schema：${id}`,
      schema.errors.map((message) => issue("schema", id, message)),
    );
  }
  if (document.kind !== kind || document.metadata.id !== id) {
    throw new ModelError(`补丁对象与操作声明不一致：${id}`);
  }
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return { level: "error", code, path, message };
}
