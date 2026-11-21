/** js-yaml 是 CommonJS。用 createRequire，避免 Node 原生类型剥离无法做 CJS 命名导入。 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
const yaml = require("js-yaml") as {
  load: (input: string) => unknown;
  dump: (value: unknown) => string;
};

export function parseYaml(text: string): unknown {
  return yaml.load(text);
}

export function dumpYaml(value: unknown): string {
  return yaml.dump(value);
}
