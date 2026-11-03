#!/usr/bin/env node
import { Command } from "commander";
import { runDiff, runEval, runExportOsi, runValidate, type ExportTarget } from "./commands.ts";

const program = new Command();

program.name("semantic").description("企业语义平台命令行（M0）").version("0.1.0");

program
  .command("validate")
  .description("用 JSON Schema 与引用规则校验模型目录")
  .argument("<dir>", "模型目录")
  .action((dir: string) => {
    process.exitCode = runValidate(dir);
  });

program
  .command("diff")
  .description("比较两个模型目录，把补丁以 YAML 写到标准输出")
  .argument("<base>", "基线模型目录")
  .argument("<head>", "目标模型目录")
  .action((base: string, head: string) => {
    process.exitCode = runDiff(base, head);
  });

program
  .command("eval")
  .description("对黄金用例做契约回归（M0 为占位打分，不执行查询）")
  .argument("<dir>", "模型目录")
  .action((dir: string) => {
    process.exitCode = runEval(dir);
  });

program
  .command("export-osi")
  .description("导出 OSI 占位文档，或调用指标编译器占位")
  .argument("<dir>", "模型目录")
  .option("--target <target>", "osi、metricflow 或 snowflake", "osi")
  .action((dir: string, options: { target: string }) => {
    const target = options.target;
    if (target !== "osi" && target !== "metricflow" && target !== "snowflake") {
      process.stderr.write("target 只能是 osi、metricflow 或 snowflake。\n");
      process.exitCode = 2;
      return;
    }
    process.exitCode = runExportOsi(dir, target as ExportTarget);
  });

await program.parseAsync(process.argv);
