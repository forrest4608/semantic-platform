import { spawnSync } from "node:child_process";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { runDiff, runEval, runExportOsi, runValidate } from "../src/commands.ts";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const exampleDir = join(repoRoot, "examples/hr-leave");
const cli = join(repoRoot, "packages/cli/src/index.ts");
const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("CLI 函数", () => {
  it("validate 与 eval 对示例返回 0", () => {
    const out: string[] = [];
    const io = {
      stdout: (text: string) => out.push(text),
      stderr: (text: string) => out.push(text),
    };
    expect(runValidate(exampleDir, io)).toBe(0);
    expect(out.join("")).toContain("校验通过");
    out.length = 0;
    expect(runEval(exampleDir, io)).toBe(0);
    expect(out.join("")).toContain("PASS EC-1");
    expect(out.join("")).toContain("PASS EC-3");
  });

  it("diff 能输出删除操作", () => {
    const head = copyExampleWithout("policies/self-read.yaml");
    const out: string[] = [];
    const code = runDiff(exampleDir, head, {
      stdout: (text) => out.push(text),
      stderr: (text) => out.push(text),
    });
    expect(code).toBe(0);
    expect(out.join("")).toContain("op: remove");
    expect(out.join("")).toContain("hr.leave.policy.self_read");
  });

  it("export-osi 默认是 stub", () => {
    const out: string[] = [];
    expect(
      runExportOsi(exampleDir, "osi", {
        stdout: (text) => out.push(text),
        stderr: () => undefined,
      }),
    ).toBe(0);
    const parsed = JSON.parse(out.join("")) as { status: string; format: string };
    expect(parsed.format).toBe("osi");
    expect(parsed.status).toBe("stub");
  });
});

describe("CLI 进程", () => {
  it("node 可以直接运行 validate 与 eval", () => {
    const validate = spawnSync(process.execPath, [cli, "validate", "examples/hr-leave"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(validate.status).toBe(0);
    expect(validate.stdout).toContain("校验通过");

    const evalRun = spawnSync(process.execPath, [cli, "eval", "examples/hr-leave"], {
      cwd: repoRoot,
      encoding: "utf8",
    });
    expect(evalRun.status).toBe(0);
    expect(evalRun.stdout).toContain("通过 3");
  });
});

function copyExampleWithout(relativeFile: string): string {
  const dir = mkdtempSync(join(tmpdir(), "semantic-cli-"));
  temps.push(dir);
  const sourceFiles = [
    "namespace.yaml",
    "entities/employee.yaml",
    "entities/leave-request.yaml",
    "relations/leave-request-employee.yaml",
    "metrics/remaining-leave-days.yaml",
    "policies/self-read.yaml",
    "actions/approve-leave.yaml",
    "briefs/remaining-leave.yaml",
    "gaps/leave-quota.yaml",
    "mappings/employee.yaml",
    "mappings/leave-request.yaml",
    "eval/case-pack.yaml",
  ];
  for (const file of sourceFiles) {
    if (file === relativeFile) continue;
    const target = join(dir, file);
    mkdirSync(join(target, ".."), { recursive: true });
    writeFileSync(target, readFileSync(join(exampleDir, file)));
  }
  return dir;
}
