/**
 * 工作台 API。口令只从 LOCAL_ADMIN_PASSWORD 读取。
 */
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultRoots } from "./model-service.ts";
import { localAdminFromFile, startWorkbench } from "./http.ts";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "../../..");
const admin = localAdminFromFile(join(repoRoot, "config/auth.example.yaml"));
const password = process.env[admin.passwordEnv];
if (!password) {
  process.stderr.write(`缺少环境变量 ${admin.passwordEnv}。工作台不保存口令。\n`);
  process.exit(1);
}

const server = await startWorkbench({
  roots: defaultRoots(repoRoot),
  releaseFile: join(repoRoot, "data/workbench-releases.json"),
  username: admin.username,
  password,
  port: 8787,
});
process.stdout.write(`工作台 API ${server.url}\n`);
