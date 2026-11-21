/**
 * 禁止把业务场景写成某种边界对象。检查时跳过本脚本自身。
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const root = new URL("..", import.meta.url).pathname;
const skipDirs = new Set(["node_modules", "dist", ".git", "coverage", ".vite"]);
const extensions = [".ts", ".tsx", ".md", ".json", ".yaml", ".yml", ".css", ".html", ".mjs"];
const forbidden = ["场景边界", "scenario boundary"];
const selfPath = join(root, "scripts", "check-terminology.mjs");

/** @type {string[]} */
const hits = [];

function walk(dir) {
  for (const name of readdirSync(dir)) {
    if (skipDirs.has(name)) continue;
    const full = join(dir, name);
    const info = statSync(full);
    if (info.isDirectory()) {
      walk(full);
      continue;
    }
    if (full === selfPath) continue;
    if (!extensions.some((ext) => name.endsWith(ext))) continue;
    const text = readFileSync(full, "utf8");
    const lower = text.toLowerCase();
    for (const term of forbidden) {
      if (lower.includes(term.toLowerCase())) {
        hits.push(`${full}: 出现禁用用语「${term}」`);
      }
    }
  }
}

walk(root);

if (hits.length > 0) {
  console.error(hits.join("\n"));
  process.exit(1);
}

console.log("terminology: ok");
