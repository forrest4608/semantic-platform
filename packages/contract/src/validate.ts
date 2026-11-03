/**
 * JSON Schema 是校验真源。Ajv 只负责结构，引用完整性由内核处理。
 */
import { createRequire } from "node:module";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import {
  MODEL_PATCH_SCHEMA_ID,
  schemaIdFor,
  type ObjectKind,
} from "./kinds.ts";

const require = createRequire(import.meta.url);
const AjvCtor = require("ajv/dist/2020.js") as new (options?: {
  allErrors?: boolean;
  strict?: boolean;
}) => AjvLike;

interface AjvError {
  instancePath?: string;
  message?: string;
}

interface ValidateFn {
  (data: unknown): boolean;
  errors?: AjvError[] | null;
}

interface AjvLike {
  addSchema(schema: object): void;
  getSchema(id: string): ValidateFn | undefined;
}

let cached: AjvLike | undefined;

export function schemasDir(): string {
  return join(dirname(fileURLToPath(import.meta.url)), "..", "schemas");
}

function ajv(): AjvLike {
  if (cached) return cached;
  const instance = new AjvCtor({ allErrors: true, strict: false });
  const dir = schemasDir();
  const files = readdirSync(dir).filter((name) => name.endsWith(".schema.json"));
  const ordered = [
    ...files.filter((name) => name.startsWith("defs.")),
    ...files.filter((name) => !name.startsWith("defs.")).sort(),
  ];
  for (const name of ordered) {
    const raw = readFileSync(join(dir, name), "utf8");
    instance.addSchema(JSON.parse(raw) as object);
  }
  cached = instance;
  return instance;
}

function runSchema(schemaId: string, data: unknown): SchemaValidation {
  const validate = ajv().getSchema(schemaId);
  if (!validate) {
    return { ok: false, errors: [`找不到 schema：${schemaId}`] };
  }
  const ok = validate(data);
  if (ok) return { ok: true, errors: [] };
  const errors = (validate.errors ?? []).map((error) => {
    const path = error.instancePath && error.instancePath.length > 0 ? error.instancePath : "/";
    return `${path} ${error.message ?? "校验失败"}`;
  });
  return { ok: false, errors: errors.length > 0 ? errors : ["schema 校验失败"] };
}

export interface SchemaValidation {
  ok: boolean;
  errors: string[];
}

export function validateDocumentSchema(kind: ObjectKind, data: unknown): SchemaValidation {
  return runSchema(schemaIdFor(kind), data);
}

export function validatePatchSchema(data: unknown): SchemaValidation {
  return runSchema(MODEL_PATCH_SCHEMA_ID, data);
}
