#!/usr/bin/env node
/**
 * 从 SEMANTIC_MODEL_DIR 加载模型并在 stdio 上提供 MCP 工具。
 * 未设置时使用当前工作目录下的 examples/hr-leave。
 */
import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";
import { createServer, loadModelForServer } from "./server.ts";

const modelDir = process.env.SEMANTIC_MODEL_DIR ?? "examples/hr-leave";
const server = createServer({ model: loadModelForServer(modelDir) });
const transport = new StdioServerTransport();
await server.connect(transport);
