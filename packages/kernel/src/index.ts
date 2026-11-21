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
  assessTeachingCase,
  judgeKnownFailure,
  type KnownFailureVerdict,
  type ReleaseVerdict,
  type TeachingAssessment,
} from "./gate.ts";
export { queryRuleVersion, findInForceRule, type RuleVersion, type RuleVersionQuery, type VersionStatus } from "./version.ts";
export {
  countByBasis,
  getLeaveDays,
  getLimit,
  getTrip,
  quoteLeave,
  quoteLimit,
  type CalculationReceipt,
  type DayMark,
  type LeaveQuoteInput,
  type LimitQuoteInput,
  type TripFact,
} from "./calculate.ts";
export { retrieveEvidence, type EvidenceHit, type EvidenceQuery } from "./evidence.ts";
export { ingestEvalCase } from "./ingest.ts";
export { approvalRequiredByPolicy, policyViolations, type PolicyTrace } from "./policy-check.ts";
export { READ_TOOL_NAMES, WRITE_TOOL_NAMES, defaultAgentTools, isWriteTool } from "./runtime-tools.ts";
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
