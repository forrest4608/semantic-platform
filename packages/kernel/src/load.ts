/**
 * 从目录递归读取 YAML。每个文件一份契约对象。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { API_VERSION, isObjectKind, validateDocumentSchema } from "@semantic/contract";
import { indexDocuments, isRecord } from "./model.ts";
import { ModelError, type SemanticDocument, type SemanticModel, type ValidationIssue } from "./types.ts";
import { parseYaml } from "./yaml.ts";

export function loadModel(dir: string): SemanticModel {
  const files = listYaml(dir);
  const documents: SemanticDocument[] = [];
  const issues: ValidationIssue[] = [];

  for (const file of files) {
    const text = readFileSync(file, "utf8");
    let parsed: unknown;
    try {
      parsed = parseYaml(text);
    } catch (error) {
      issues.push({
        level: "error",
        code: "yaml_parse",
        path: file,
        message: error instanceof Error ? error.message : "YAML 解析失败",
      });
      continue;
    }
    const document = coerceDocument(parsed, file, issues);
    if (document) documents.push(document);
  }

  if (issues.length > 0) {
    throw new ModelError(`模型目录无法加载：${dir}`, issues);
  }

  try {
    return indexDocuments(documents);
  } catch (error) {
    throw new ModelError(error instanceof Error ? error.message : "模型索引失败");
  }
}

function listYaml(dir: string): string[] {
  let info;
  try {
    info = statSync(dir);
  } catch {
    throw new ModelError(`模型目录不存在：${dir}`);
  }
  if (!info.isDirectory()) {
    throw new ModelError(`路径不是目录：${dir}`);
  }
  const found: string[] = [];
  walk(dir, found);
  return found.sort();
}

function walk(dir: string, found: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, found);
      continue;
    }
    if (entry.isFile() && (entry.name.endsWith(".yaml") || entry.name.endsWith(".yml"))) {
      found.push(full);
    }
  }
}

function coerceDocument(
  parsed: unknown,
  file: string,
  issues: ValidationIssue[],
): SemanticDocument | undefined {
  if (!isRecord(parsed)) {
    issues.push({
      level: "error",
      code: "document_shape",
      path: file,
      message: "每个 YAML 文件必须是一个对象",
    });
    return undefined;
  }
  const kind = parsed.kind;
  if (typeof kind !== "string" || !isObjectKind(kind)) {
    issues.push({
      level: "error",
      code: "unknown_kind",
      path: file,
      message: `无法识别的 kind：${String(kind)}。ModelPatch 不能放进模型目录。`,
    });
    return undefined;
  }
  const schema = validateDocumentSchema(kind, parsed);
  if (!schema.ok) {
    for (const message of schema.errors) {
      issues.push({
        level: "error",
        code: "schema",
        path: file,
        message,
      });
    }
    return undefined;
  }
  const metadata = parsed.metadata as SemanticDocument["metadata"];
  const spec = parsed.spec as Record<string, unknown>;
  return {
    apiVersion: API_VERSION,
    kind,
    metadata: {
      id: metadata.id,
      name: metadata.name,
      namespace: metadata.namespace,
      ...(metadata.description !== undefined ? { description: metadata.description } : {}),
    },
    spec,
  };
}
