import type { ObjectKind } from "@semantic/contract";
import { API_VERSION } from "@semantic/contract";

export interface DocumentMetadata {
  id: string;
  name: string;
  namespace: string;
  description?: string;
}

/** YAML 文档的内存形态。spec 的形状以 JSON Schema 为准。 */
export interface SemanticDocument {
  apiVersion: typeof API_VERSION;
  kind: ObjectKind;
  metadata: DocumentMetadata;
  spec: Record<string, unknown>;
}

export interface SemanticModel {
  documents: SemanticDocument[];
  byId: Map<string, SemanticDocument>;
}

export interface ValidationIssue {
  level: "error";
  code: string;
  path: string;
  message: string;
}

export interface ValidationReport {
  ok: boolean;
  issues: ValidationIssue[];
}

export type PatchOp = "add" | "remove" | "replace";

export interface PatchOperation {
  op: PatchOp;
  targetKind: ObjectKind;
  id: string;
  document?: SemanticDocument;
}

/** harness 产出、可供人工确认后发布的补丁。 */
export interface ModelPatch {
  apiVersion: typeof API_VERSION;
  kind: "ModelPatch";
  operations: PatchOperation[];
}

export class ModelError extends Error {
  readonly issues: ValidationIssue[];

  constructor(message: string, issues: ValidationIssue[] = []) {
    super(message);
    this.name = "ModelError";
    this.issues = issues;
  }
}
