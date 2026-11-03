import type { SemanticDocument, SemanticModel } from "./types.ts";

export function canonical(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const source = value as Record<string, unknown>;
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(source).sort()) {
      sorted[key] = sortValue(source[key]);
    }
    return sorted;
  }
  return value;
}

export function indexDocuments(documents: SemanticDocument[]): SemanticModel {
  const sorted = [...documents].sort(compareDocuments);
  const byId = new Map<string, SemanticDocument>();
  for (const document of sorted) {
    if (byId.has(document.metadata.id)) {
      throw new Error(`重复的对象 id：${document.metadata.id}`);
    }
    byId.set(document.metadata.id, document);
  }
  return { documents: sorted, byId };
}

export function compareDocuments(left: SemanticDocument, right: SemanticDocument): number {
  const byKind = left.kind.localeCompare(right.kind);
  if (byKind !== 0) return byKind;
  return left.metadata.id.localeCompare(right.metadata.id);
}

export function documentsOf(model: SemanticModel, kind: SemanticDocument["kind"]): SemanticDocument[] {
  return model.documents.filter((document) => document.kind === kind);
}

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function stringField(record: Record<string, unknown>, key: string): string | undefined {
  const value = record[key];
  return typeof value === "string" ? value : undefined;
}

export function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
