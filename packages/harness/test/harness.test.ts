import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { loadModel } from "@semantic/kernel";
import {
  DSH_PIN,
  DeepSeekHarnessBackend,
  HarnessError,
  agentPluginManifest,
  buildLiveRequest,
  confirmRelease,
  createDialogueKernel,
  loadLlmConfig,
  type ProposalBackend,
} from "../src/index.ts";

const llmFile = fileURLToPath(new URL("../../../config/llm.example.yaml", import.meta.url));
const hrDir = fileURLToPath(new URL("../../../examples/hr-leave", import.meta.url));
const secret = "ark-test-should-not-leak";

const emptyPatch = {
  apiVersion: "semantic.platform/v1",
  kind: "ModelPatch",
  operations: [],
};

describe("LLM 配置", () => {
  it("读取示例地址和模型，环境变量可以覆盖，密钥不进配置", () => {
    const config = loadLlmConfig({
      file: llmFile,
      env: { LLM_MODEL: "override-model", LLM_BASE_URL: "https://example.invalid/v3", ARK_API_KEY: secret },
    });
    expect(config.provider).toBe("volcengine-ark");
    expect(config.baseUrl).toBe("https://example.invalid/v3");
    expect(config.model).toBe("override-model");
    expect(config.apiKeyEnv).toBe("ARK_API_KEY");
    expect(JSON.stringify(config)).not.toContain(secret);
    const defaults = loadLlmConfig({ file: llmFile, env: {} });
    expect(defaults.baseUrl).toBe("https://ark.cn-beijing.volces.com/api/plan/v3");
    expect(defaults.model).toBe("deepseek-v4.1-flash");
    expect(JSON.stringify(buildLiveRequest(defaults))).not.toContain(secret);
    expect(buildLiveRequest(defaults).apiKeyAttached).toBe(false);
  });
});

describe("对话内核", () => {
  it("只提议，补丁由内核校验，发布确认在内核之外", async () => {
    const backend: ProposalBackend = {
      name: "fake",
      propose: async () => ({ patch: emptyPatch, toolCalls: ["query_rule_version"] }),
    };
    const kernel = createDialogueKernel({
      backend,
      llm: loadLlmConfig({ file: llmFile, env: {} }),
    });
    expect(Object.keys(kernel)).toEqual(["propose"]);
    const proposal = await kernel.propose({ prompt: "周五至下周一要不要人事审批？" });
    expect(proposal.released).toBe(false);
    expect(proposal.writesSystemsOfRecord).toBe(false);
    expect(proposal.toolCalls).toEqual(["query_rule_version"]);

    const model = loadModel(hrDir);
    expect(() => confirmRelease({ model, patch: proposal.patch, confirmedBy: "  " })).toThrow(HarnessError);
    expect(() => confirmRelease({ model, patch: proposal.patch, confirmedBy: "审核人" })).toThrow(HarnessError);
    try {
      confirmRelease({ model, patch: proposal.patch, confirmedBy: "审核人" });
    } catch (error) {
      expect(error).toMatchObject({ code: "release_blocked" });
      expect(error instanceof Error ? error.message : "").toContain("未关闭的缺口阻断发布");
    }
  });

  it("拒绝写工具和非法补丁", async () => {
    const llm = loadLlmConfig({ file: llmFile, env: {} });
    const writing: ProposalBackend = {
      name: "fake",
      propose: async () => ({ patch: emptyPatch, toolCalls: ["approve_leave"] }),
    };
    await expect(createDialogueKernel({ backend: writing, llm }).propose({ prompt: "批准" })).rejects.toMatchObject({
      code: "write_forbidden",
    });

    const direct: ProposalBackend = {
      name: "fake",
      propose: async () => ({ patch: emptyPatch, writesSystemsOfRecord: true }),
    };
    await expect(createDialogueKernel({ backend: direct, llm }).propose({ prompt: "写入" })).rejects.toMatchObject({
      code: "write_forbidden",
    });

    const invalid: ProposalBackend = {
      name: "fake",
      propose: async () => ({ patch: { apiVersion: "semantic.platform/v1", kind: "ModelPatch", operations: [{ op: "add" }] } }),
    };
    await expect(createDialogueKernel({ backend: invalid, llm }).propose({ prompt: "坏补丁" })).rejects.toBeInstanceOf(
      HarnessError,
    );
  });
});

describe("DeepSeek Harness 包装", () => {
  it("固定 dsh 版本，默认运行时不发请求，密钥不出现在错误里", async () => {
    expect(DSH_PIN.version).toBe("0.2.2-rc.5");
    expect(DSH_PIN.tag).toBe("dsh-v0.2.2-rc.5");
    expect(DSH_PIN.commit).toBe("9c2670d3bce5275e0d1610272958121af87787bb");
    expect(agentPluginManifest().tools.write).toEqual([]);
    expect(agentPluginManifest().tools.read).toContain("get_leave_days");
    expect(agentPluginManifest().tools.read).toContain("retrieve_evidence");
    expect(agentPluginManifest().architecture).toBe("cordis-plugin");

    const calls: string[] = [];
    const fetchImpl = (async (url: string | URL | Request) => {
      calls.push(String(url));
      throw new Error("should not fetch");
    }) as typeof fetch;
    const llm = loadLlmConfig({ file: llmFile, env: {} });

    const disabled = new DeepSeekHarnessBackend({ env: { ARK_API_KEY: secret }, fetchImpl });
    await expect(disabled.propose({ prompt: "你好", llm })).rejects.toMatchObject({ code: "live_harness_disabled" });

    const missing = new DeepSeekHarnessBackend({ allowLive: true, env: {}, fetchImpl });
    await expect(missing.propose({ prompt: "你好", llm })).rejects.toMatchObject({ code: "missing_api_key" });

    const deferred = new DeepSeekHarnessBackend({ allowLive: true, env: { ARK_API_KEY: secret }, fetchImpl });
    await expect(deferred.propose({ prompt: "你好", llm })).rejects.toMatchObject({ code: "live_call_deferred" });
    try {
      await deferred.propose({ prompt: "你好", llm });
    } catch (error) {
      expect(error instanceof Error ? error.message : "").not.toContain(secret);
    }
    expect(calls).toEqual([]);
  });
});
