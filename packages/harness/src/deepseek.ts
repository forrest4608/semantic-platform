/**
 * DeepSeek Harness 适配器。
 * 默认不连接。即使显式打开，本里程碑也不把密钥送出去，也不发起网络请求。
 */
import { defaultAgentTools } from "@semantic/kernel";
import { DSH_PIN } from "./pin.ts";
import { HarnessError, type ProposalBackend, type ProposalRequest, type RawProposal } from "./kernel.ts";

export interface DeepSeekHarnessOptions {
  allowLive?: boolean;
  env?: NodeJS.ProcessEnv;
  fetchImpl?: typeof fetch;
}

export class DeepSeekHarnessBackend implements ProposalBackend {
  readonly name = "deepseek-harness";
  readonly pin = DSH_PIN;

  constructor(private readonly options: DeepSeekHarnessOptions = {}) {}

  propose(_request: ProposalRequest): Promise<RawProposal> {
    if (this.options.allowLive !== true) {
      return Promise.reject(
        new HarnessError("live_harness_disabled", "对话内核默认不连接 DeepSeek Harness，测试也不发起请求。"),
      );
    }
    const key = this.options.env?.ARK_API_KEY;
    if (typeof key !== "string" || key.trim().length === 0) {
      return Promise.reject(new HarnessError("missing_api_key", "缺少环境变量 ARK_API_KEY。"));
    }
    // 密钥只用于判断是否存在，不进入错误文本，也不传给 fetch。
    void this.options.fetchImpl;
    return Promise.reject(new HarnessError("live_call_deferred", "M1 不调用火山方舟。请注入 ProposalBackend。"));
  }
}

export function agentPluginManifest(): {
  name: "semantic-platform";
  architecture: "cordis-plugin";
  dsh: typeof DSH_PIN;
  tools: { read: readonly string[]; write: readonly [] };
} {
  return {
    name: "semantic-platform",
    architecture: "cordis-plugin",
    dsh: DSH_PIN,
    tools: { read: defaultAgentTools(), write: [] },
  };
}
