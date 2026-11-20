/**
 * 评测用例入库。只接受口径对照和版本干扰两类，入库后仍走同一套引用校验。
 * 这个函数不写业务系统，也不代替人工发布。
 */
import { API_VERSION, validateDocumentSchema } from "@semantic/contract";
import { indexDocuments, isRecord } from "./model.ts";
import { ModelError, type SemanticDocument, type SemanticModel, type ValidationIssue } from "./types.ts";
import { validateModel } from "./validate.ts";

export function ingestEvalCase(model: SemanticModel, raw: unknown): SemanticModel {
  if (!isRecord(raw) || raw.kind !== "EvalCase") {
    throw new ModelError("入库对象必须是 EvalCase");
  }
  const schema = validateDocumentSchema("EvalCase", raw);
  if (!schema.ok) {
    throw new ModelError(
      "评测用例未通过 schema",
      schema.errors.map((message) => issue("schema", "/", message)),
    );
  }
  if (!isRecord(raw.spec)) throw new ModelError("评测用例缺少 spec");
  const spec = raw.spec;
  const caseClass = spec.caseClass;
  if (caseClass !== "calculation_basis" && caseClass !== "version_interference") {
    throw new ModelError("入库的用例必须是口径对照或版本干扰");
  }
  const metadata = raw.metadata as SemanticDocument["metadata"];
  if (model.byId.has(metadata.id)) {
    throw new ModelError(`评测用例已存在：${metadata.id}`);
  }
  const document: SemanticDocument = {
    apiVersion: API_VERSION,
    kind: "EvalCase",
    metadata: {
      id: metadata.id,
      name: metadata.name,
      namespace: metadata.namespace,
      ...(metadata.description !== undefined ? { description: metadata.description } : {}),
    },
    spec: spec,
  };
  const next = indexDocuments([...model.documents, document]);
  const report = validateModel(next);
  if (!report.ok) {
    throw new ModelError("入库后的模型未通过校验", report.issues);
  }
  return next;
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return { level: "error", code, path, message };
}
