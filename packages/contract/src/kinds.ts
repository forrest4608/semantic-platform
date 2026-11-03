/** 契约对象种类。ModelPatch 是补丁，不是可沉淀进 Namespace 的模型对象。 */

export const API_VERSION = "semantic.platform/v1" as const;

export const OBJECT_KINDS = [
  "Namespace",
  "Entity",
  "Relation",
  "Metric",
  "Policy",
  "Action",
  "ScenarioBrief",
  "GapLog",
  "CasePack",
  "EvalCase",
  "SourceMapping",
] as const;

export type ObjectKind = (typeof OBJECT_KINDS)[number];

export function isObjectKind(value: string): value is ObjectKind {
  return (OBJECT_KINDS as readonly string[]).includes(value);
}

const SCHEMA_IDS: Record<ObjectKind, string> = {
  Namespace: "https://semantic.platform/schema/namespace.json",
  Entity: "https://semantic.platform/schema/entity.json",
  Relation: "https://semantic.platform/schema/relation.json",
  Metric: "https://semantic.platform/schema/metric.json",
  Policy: "https://semantic.platform/schema/policy.json",
  Action: "https://semantic.platform/schema/action.json",
  ScenarioBrief: "https://semantic.platform/schema/scenario-brief.json",
  GapLog: "https://semantic.platform/schema/gap-log.json",
  CasePack: "https://semantic.platform/schema/case-pack.json",
  EvalCase: "https://semantic.platform/schema/eval-case.json",
  SourceMapping: "https://semantic.platform/schema/source-mapping.json",
};

export const MODEL_PATCH_SCHEMA_ID = "https://semantic.platform/schema/model-patch.json";

export function schemaIdFor(kind: ObjectKind): string {
  return SCHEMA_IDS[kind];
}
