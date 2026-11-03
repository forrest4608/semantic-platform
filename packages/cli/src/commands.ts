/**
 * 命令实现与进程退出解耦，方便测试直接调用。
 */
import {
  MetricFlowCompiler,
  ModelError,
  SnowflakeSemanticViewCompiler,
  StubOsiExporter,
  diffModels,
  dumpYaml,
  evaluateModel,
  loadModel,
  validateModel,
  type EvalReport,
  type ValidationReport,
} from "@semantic/kernel";

export interface CommandIO {
  stdout: (text: string) => void;
  stderr: (text: string) => void;
}

const consoleIO: CommandIO = {
  stdout: (text) => process.stdout.write(text),
  stderr: (text) => process.stderr.write(text),
};

export type ExportTarget = "osi" | "metricflow" | "snowflake";

export function runValidate(dir: string, io: CommandIO = consoleIO): number {
  try {
    const model = loadModel(dir);
    const report = validateModel(model);
    io.stdout(formatValidation(report));
    return report.ok ? 0 : 1;
  } catch (error) {
    return fail(io, error);
  }
}

export function runDiff(baseDir: string, headDir: string, io: CommandIO = consoleIO): number {
  try {
    const patch = diffModels(loadModel(baseDir), loadModel(headDir));
    io.stdout(dumpYaml(patch));
    return 0;
  } catch (error) {
    return fail(io, error);
  }
}

export function runEval(dir: string, io: CommandIO = consoleIO): number {
  try {
    const model = loadModel(dir);
    const validation = validateModel(model);
    if (!validation.ok) {
      io.stderr(formatValidation(validation));
      io.stderr("模型未通过校验，已跳过评测。\n");
      return 1;
    }
    const report = evaluateModel(model);
    io.stdout(formatEval(report));
    return report.ok ? 0 : 1;
  } catch (error) {
    return fail(io, error);
  }
}

export function runExportOsi(dir: string, target: ExportTarget, io: CommandIO = consoleIO): number {
  try {
    const model = loadModel(dir);
    const validation = validateModel(model);
    if (!validation.ok) {
      io.stderr(formatValidation(validation));
      return 1;
    }
    const payload =
      target === "metricflow"
        ? new MetricFlowCompiler().compile(model)
        : target === "snowflake"
          ? new SnowflakeSemanticViewCompiler().compile(model)
          : new StubOsiExporter().exportModel(model);
    io.stdout(`${JSON.stringify(payload, null, 2)}\n`);
    return 0;
  } catch (error) {
    return fail(io, error);
  }
}

function formatValidation(report: ValidationReport): string {
  if (report.ok) return "校验通过。\n";
  const lines = report.issues.map((item) => `${item.path}: ${item.message}`);
  return `校验失败（${report.issues.length}）\n${lines.join("\n")}\n`;
}

function formatEval(report: EvalReport): string {
  const lines = report.results.map((item) => {
    const state = item.skipped ? "SKIP" : item.passed ? "PASS" : "FAIL";
    const notes = item.notes.length > 0 ? ` ${item.notes.join("；")}` : "";
    return `${state} ${item.caseId} score=${item.score.toFixed(2)} ${item.question}${notes}`;
  });
  lines.push(
    `汇总：通过 ${report.passed}，失败 ${report.failed}，跳过 ${report.skipped}，平均分 ${report.meanScore.toFixed(2)}`,
  );
  return `${lines.join("\n")}\n`;
}

function fail(io: CommandIO, error: unknown): number {
  if (error instanceof ModelError) {
    const detail = error.issues.map((item) => `${item.path}: ${item.message}`).join("\n");
    io.stderr(detail.length > 0 ? `${error.message}\n${detail}\n` : `${error.message}\n`);
    return 1;
  }
  io.stderr(`${error instanceof Error ? error.message : String(error)}\n`);
  return 1;
}
