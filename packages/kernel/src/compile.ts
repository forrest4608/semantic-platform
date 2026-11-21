/**
 * 指标编译器接口。目标是已有引擎，不是自研查询引擎。
 * M0 两个目标都返回占位结果，不生成可执行项目。
 */
import { documentsOf, stringField } from "./model.ts";
import type { SemanticModel } from "./types.ts";

export type MetricCompilerTarget = "metricflow" | "snowflake-semantic-view";

export interface CompilationArtifact {
  target: MetricCompilerTarget;
  status: "stub";
  note: string;
  metrics: Array<{
    id: string;
    name: string;
    entity?: string;
    expression?: string;
  }>;
}

export interface MetricCompiler {
  readonly target: MetricCompilerTarget;
  compile(model: SemanticModel): CompilationArtifact;
}

export class MetricFlowCompiler implements MetricCompiler {
  readonly target = "metricflow" as const;

  compile(model: SemanticModel): CompilationArtifact {
    return {
      target: this.target,
      status: "stub",
      note: "未生成 MetricFlow 项目，也没有解释 expression。",
      metrics: listMetrics(model),
    };
  }
}

export class SnowflakeSemanticViewCompiler implements MetricCompiler {
  readonly target = "snowflake-semantic-view" as const;

  compile(model: SemanticModel): CompilationArtifact {
    return {
      target: this.target,
      status: "stub",
      note: "未生成 Snowflake semantic view，也没有连接数仓。",
      metrics: listMetrics(model),
    };
  }
}

export function compilerFor(target: MetricCompilerTarget): MetricCompiler {
  if (target === "metricflow") return new MetricFlowCompiler();
  return new SnowflakeSemanticViewCompiler();
}

function listMetrics(model: SemanticModel): CompilationArtifact["metrics"] {
  return documentsOf(model, "Metric").map((document) => ({
    id: document.metadata.id,
    name: document.metadata.name,
    entity: stringField(document.spec, "entity"),
    expression: stringField(document.spec, "expression"),
  }));
}
