/**
 * OSI 导出接口。内部模型是 OSI 的超集：
 * Action、Policy、EvalCase、GapLog 放在 extensions，不假装已被 OSI 覆盖。
 * M0 不对照某一版 OSI 规范逐字段对齐。
 */
import { documentsOf, stringField, stringList } from "./model.ts";
import type { SemanticDocument, SemanticModel } from "./types.ts";

export interface OsiField {
  name: string;
  type?: string;
}

export interface OsiEntity {
  name: string;
  id: string;
  primaryKey: string[];
  fields: OsiField[];
}

export interface OsiRelationship {
  name: string;
  id: string;
  from: string;
  to: string;
  cardinality?: string;
}

export interface OsiMetric {
  name: string;
  id: string;
  entity?: string;
  expr?: string;
  agg?: string;
}

export interface OsiSemanticModel {
  namespace: string;
  name: string;
  entities: OsiEntity[];
  relationships: OsiRelationship[];
  metrics: OsiMetric[];
}

export interface OsiExportDocument {
  format: "osi";
  status: "stub";
  osiVersion: "unspecified";
  note: string;
  semanticModels: OsiSemanticModel[];
  extensions: {
    policies: string[];
    actions: string[];
    evalCases: string[];
    gapLogs: string[];
    sourceMappings: string[];
  };
}

export interface OsiExporter {
  exportModel(model: SemanticModel): OsiExportDocument;
}

export class StubOsiExporter implements OsiExporter {
  exportModel(model: SemanticModel): OsiExportDocument {
    const namespaces = documentsOf(model, "Namespace");
    return {
      format: "osi",
      status: "stub",
      osiVersion: "unspecified",
      note: "占位导出。未实现 OSI 规范对齐，也不能当作可导入其他引擎的成品。",
      semanticModels: namespaces.map((namespace) => projectNamespace(model, namespace)),
      extensions: {
        policies: idsOf(model, "Policy"),
        actions: idsOf(model, "Action"),
        evalCases: evalCaseIds(model),
        gapLogs: idsOf(model, "GapLog"),
        sourceMappings: idsOf(model, "SourceMapping"),
      },
    };
  }
}

function projectNamespace(model: SemanticModel, namespace: SemanticDocument): OsiSemanticModel {
  const namespaceId = namespace.metadata.id;
  const inNamespace = (document: SemanticDocument) => document.metadata.namespace === namespaceId;
  return {
    namespace: namespaceId,
    name: namespace.metadata.name,
    entities: documentsOf(model, "Entity").filter(inNamespace).map(projectEntity),
    relationships: documentsOf(model, "Relation").filter(inNamespace).map(projectRelation),
    metrics: documentsOf(model, "Metric").filter(inNamespace).map(projectMetric),
  };
}

function projectEntity(document: SemanticDocument): OsiEntity {
  const attributes = Array.isArray(document.spec.attributes) ? document.spec.attributes : [];
  return {
    name: document.metadata.name,
    id: document.metadata.id,
    primaryKey: stringList(document.spec.primaryKey),
    fields: attributes.flatMap((attribute) => {
      if (!attribute || typeof attribute !== "object") return [];
      const record = attribute as Record<string, unknown>;
      const name = stringField(record, "name");
      if (!name) return [];
      return [{ name, type: stringField(record, "type") }];
    }),
  };
}

function projectRelation(document: SemanticDocument): OsiRelationship {
  return {
    name: document.metadata.name,
    id: document.metadata.id,
    from: stringField(document.spec, "from") ?? "",
    to: stringField(document.spec, "to") ?? "",
    cardinality: stringField(document.spec, "cardinality"),
  };
}

function projectMetric(document: SemanticDocument): OsiMetric {
  return {
    name: document.metadata.name,
    id: document.metadata.id,
    entity: stringField(document.spec, "entity"),
    expr: stringField(document.spec, "expression"),
    agg: stringField(document.spec, "aggregation"),
  };
}

function idsOf(model: SemanticModel, kind: SemanticDocument["kind"]): string[] {
  return documentsOf(model, kind).map((document) => document.metadata.id);
}

function evalCaseIds(model: SemanticModel): string[] {
  const ids = documentsOf(model, "EvalCase").map((document) => document.metadata.id);
  for (const pack of documentsOf(model, "CasePack")) {
    const cases = Array.isArray(pack.spec.cases) ? pack.spec.cases : [];
    for (const item of cases) {
      if (item && typeof item === "object" && typeof (item as { id?: unknown }).id === "string") {
        ids.push((item as { id: string }).id);
      }
    }
  }
  return ids;
}
