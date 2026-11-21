/**
 * 火山方舟模型配置。密钥只从 ARK_API_KEY 读取，不会写进配置对象。
 */
import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { isRecord } from "@semantic/kernel";
import { DSH_PIN } from "./pin.ts";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml") as { load: (input: string) => unknown };

export interface LlmConfig {
  provider: "volcengine-ark";
  baseUrl: string;
  model: string;
  apiKeyEnv: "ARK_API_KEY";
}

export function loadLlmConfig(options: { file: string; env?: NodeJS.ProcessEnv }): LlmConfig {
  const parsed = yaml.load(readFileSync(options.file, "utf8"));
  if (!isRecord(parsed)) throw new Error("LLM 配置必须是映射");
  rejectEmbeddedSecret(parsed);
  if (parsed.provider !== "volcengine-ark") throw new Error("LLM provider 必须是 volcengine-ark");
  if (parsed.apiKeyEnv !== "ARK_API_KEY") throw new Error("密钥只能通过环境变量 ARK_API_KEY 提供");
  const env = options.env ?? process.env;
  const baseUrl = override(env.LLM_BASE_URL, parsed.baseUrl);
  const model = override(env.LLM_MODEL, parsed.model);
  if (!baseUrl || !model) throw new Error("LLM baseUrl 和 model 不能为空");
  return {
    provider: "volcengine-ark",
    baseUrl,
    model,
    apiKeyEnv: "ARK_API_KEY",
  };
}

/** 给实时调用准备的描述。上面没有密钥。 */
export function buildLiveRequest(llm: LlmConfig): {
  packageName: string;
  version: string;
  baseUrl: string;
  model: string;
  apiKeyEnv: "ARK_API_KEY";
  apiKeyAttached: false;
} {
  return {
    packageName: DSH_PIN.packageName,
    version: DSH_PIN.version,
    baseUrl: llm.baseUrl,
    model: llm.model,
    apiKeyEnv: llm.apiKeyEnv,
    apiKeyAttached: false,
  };
}

function override(envValue: string | undefined, fileValue: unknown): string {
  if (typeof envValue === "string" && envValue.trim().length > 0) return envValue.trim();
  return typeof fileValue === "string" ? fileValue.trim() : "";
}

function rejectEmbeddedSecret(record: Record<string, unknown>): void {
  for (const [key, value] of Object.entries(record)) {
    if (key === "apiKey" || key === "ARK_API_KEY" || key === "api_key") {
      throw new Error("配置文件不能写入密钥");
    }
    if (isRecord(value)) rejectEmbeddedSecret(value);
  }
}
