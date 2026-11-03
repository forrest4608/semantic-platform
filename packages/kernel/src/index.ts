export {
  ModelError,
  type DocumentMetadata,
  type ModelPatch,
  type PatchOp,
  type PatchOperation,
  type SemanticDocument,
  type SemanticModel,
  type ValidationIssue,
  type ValidationReport,
} from "./types.ts";

export { canonical, documentsOf, indexDocuments, isRecord } from "./model.ts";
export { loadModel } from "./load.ts";
export { validateModel } from "./validate.ts";
export { diffModels } from "./diff.ts";
export { applyPatch } from "./patch.ts";
export { evaluateModel, type EvalCaseScore, type EvalReport } from "./eval.ts";
export {
  StubOsiExporter,
  type OsiExporter,
  type OsiExportDocument,
} from "./export-osi.ts";
export {
  MetricFlowCompiler,
  SnowflakeSemanticViewCompiler,
  compilerFor,
  type CompilationArtifact,
  type MetricCompiler,
  type MetricCompilerTarget,
} from "./compile.ts";
export { dumpYaml } from "./yaml.ts";
