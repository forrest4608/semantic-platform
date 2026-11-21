/**
 * 对话内核。只能提议。
 * 补丁先过我们自己的 schema，人确认发布在另一个函数里，不由 dsh 完成。
 */
import { validateDocumentSchema, validatePatchSchema, type ObjectKind } from "@semantic/contract";
import { applyPatch, isRecord, isWriteTool, validateModel, type ModelPatch, type SemanticModel } from "@semantic/kernel";
import type { LlmConfig } from "./llm-config.ts";

export class HarnessError extends Error {
  readonly code:
    | "live_harness_disabled"
    | "missing_api_key"
    | "live_call_deferred"
    | "invalid_patch"
    | "write_forbidden"
    | "release_unconfirmed";

  constructor(code: HarnessError["code"], message: string) {
    super(message);
    this.name = "HarnessError";
    this.code = code;
  }
}

export interface ProposalRequest {
  prompt: string;
  llm: LlmConfig;
}

export interface RawProposal {
  patch: unknown;
  toolCalls?: string[];
  writesSystemsOfRecord?: boolean;
}

export interface ProposalBackend {
  readonly name: string;
  propose(request: ProposalRequest): Promise<RawProposal>;
}

export interface Proposal {
  patch: ModelPatch;
  released: false;
  writesSystemsOfRecord: false;
  toolCalls: string[];
}

export interface DialogueKernel {
  propose(request: { prompt: string }): Promise<Proposal>;
}

export function createDialogueKernel(options: { backend: ProposalBackend; llm: LlmConfig }): DialogueKernel {
  return {
    async propose(request) {
      const raw = await options.backend.propose({ prompt: request.prompt, llm: options.llm });
      if (raw.writesSystemsOfRecord === true) {
        throw new HarnessError("write_forbidden", "对话内核不能写业务系统。");
      }
      for (const toolName of raw.toolCalls ?? []) {
        if (isWriteTool(toolName)) {
          throw new HarnessError("write_forbidden", `默认运行时不能调用写工具：${toolName}`);
        }
      }
      const patch = assertPatch(raw.patch);
      return {
        patch,
        released: false,
        writesSystemsOfRecord: false,
        toolCalls: raw.toolCalls ?? [],
      };
    },
  };
}

/** 人确认后才应用到内存模型。这里不调用写工具，也不访问方舟。 */
export function confirmRelease(input: { model: SemanticModel; patch: ModelPatch; confirmedBy: string }): SemanticModel {
  if (input.confirmedBy.trim().length === 0) {
    throw new HarnessError("release_unconfirmed", "发布必须由人确认。");
  }
  const next = applyPatch(input.model, input.patch);
  const report = validateModel(next);
  if (!report.ok) {
    throw new HarnessError("invalid_patch", report.issues.map((item) => item.message).join("；"));
  }
  return next;
}

function assertPatch(value: unknown): ModelPatch {
  const schema = validatePatchSchema(value);
  if (!schema.ok || !isRecord(value) || !Array.isArray(value.operations)) {
    throw new HarnessError("invalid_patch", schema.ok ? "补丁缺少 operations" : schema.errors.join("；"));
  }
  for (const operation of value.operations) {
    if (!isRecord(operation)) throw new HarnessError("invalid_patch", "补丁操作不是对象");
    if (operation.op === "remove") continue;
    const kind = operation.targetKind;
    if (typeof kind !== "string") throw new HarnessError("invalid_patch", "补丁缺少 targetKind");
    const documentSchema = validateDocumentSchema(kind as ObjectKind, operation.document);
    if (!documentSchema.ok) {
      throw new HarnessError("invalid_patch", documentSchema.errors.join("；"));
    }
  }
  return value as unknown as ModelPatch;
}
