/**
 * DeepSeek Harness 的固定版本。
 * 运行时不加载该包：它要求 Node >= 24.9.0，且本里程碑不发起模型请求。
 * 对话只走我们自己的接口，补丁交给内核校验。
 */
export const DSH_PIN = {
  packageName: "@deepseek-ai/dsh",
  version: "0.2.2-rc.5",
  tag: "dsh-v0.2.2-rc.5",
  commit: "9c2670d3bce5275e0d1610272958121af87787bb",
  repository: "https://github.com/deepseek-ai/deepseek-harness",
  license: "MIT",
  architecture: "cordis-plugin",
  nodeEngine: ">=24.9.0",
} as const;
