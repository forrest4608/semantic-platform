/**
 * 发布门禁：口径算对、版本用对、证据引用正确、工具回执完整。
 * 工具回执走现行规则；已知的传统检索失败模式必须被判失败。
 */
import { getLeaveDays, getLimit, getTrip, type CalculationReceipt } from "./calculate.ts";
import { retrieveEvidence } from "./evidence.ts";
import { isRecord, stringField, stringList } from "./model.ts";
import type { SemanticModel } from "./types.ts";
import { ModelError } from "./types.ts";
import { policyViolations } from "./policy-check.ts";
import { queryRuleVersion } from "./version.ts";

export interface ReleaseVerdict {
  basisCorrect: boolean;
  versionCorrect: boolean;
  citationCorrect: boolean;
  receiptComplete: boolean;
  passed: boolean;
}

export interface KnownFailureVerdict extends ReleaseVerdict {
  id: string;
  description: string;
}

export interface TeachingAssessment {
  notes: string[];
  releaseGate: ReleaseVerdict & { knownFailures: KnownFailureVerdict[] };
}

interface Trace {
  basis?: string;
  ruleId?: string;
  citation?: string;
  countedDays?: number;
  requiresHrApproval?: boolean;
  remainingLeaveDays?: number;
  unitAmount?: number;
  personCount?: number;
  cap?: number;
  invoiceAmount?: number;
  reimbursable?: number;
  selfPay?: number;
  inForce?: boolean;
  receiptComplete?: boolean;
  inputSpan?: string;
  effectiveFrom?: string | null;
  supersededAt?: string | null;
  replaces?: string | null;
  replacedBy?: string | null;
  thresholdValue?: number;
}

export function assessTeachingCase(
  model: SemanticModel,
  caseId: string,
  spec: Record<string, unknown>,
): TeachingAssessment | undefined {
  const caseClass = spec.caseClass;
  if (caseClass !== "calculation_basis" && caseClass !== "version_interference") return undefined;

  let toolTrace: Trace;
  try {
    const receipt = caseClass === "calculation_basis" ? getLeaveDays(model, caseId) : getLimit(model, caseId);
    if (caseClass === "version_interference") {
      const trip = getTrip(model, caseId);
      if (!trip.departureIncluded || !trip.returnIncluded) {
        throw new ModelError("出发日和返回日都计入");
      }
    }
    toolTrace = receiptToTrace(receipt);
  } catch (error) {
    const message = error instanceof Error ? error.message : "工具没有给出回执";
    const failed = blankVerdict();
    return {
      notes: [message],
      releaseGate: { ...failed, knownFailures: [] },
    };
  }

  const verdict = judgeTrace(model, spec, toolTrace, true);
  const evidenceNotes = checkEvidence(model, spec, verdict);
  const knownFailures = judgeKnownFailures(model, spec);
  const notes: string[] = [];
  if (!verdict.basisCorrect) notes.push("口径算错");
  if (!verdict.versionCorrect) notes.push("版本用错");
  if (!verdict.citationCorrect) notes.push("证据引用不正确");
  if (!verdict.receiptComplete) notes.push("工具回执不完整");
  notes.push(...evidenceNotes);
  for (const failure of knownFailures) {
    if (failure.passed) notes.push(`已知失败模式未被拦截：${failure.description}`);
  }
  const passed =
    verdict.basisCorrect &&
    verdict.versionCorrect &&
    verdict.citationCorrect &&
    verdict.receiptComplete &&
    evidenceNotes.length === 0 &&
    knownFailures.every((failure) => !failure.passed);
  return {
    notes,
    releaseGate: { ...verdict, passed, knownFailures },
  };
}

export function judgeKnownFailure(
  model: SemanticModel,
  spec: Record<string, unknown>,
  failure: Record<string, unknown>,
): KnownFailureVerdict {
  const trace = isRecord(failure.trace) ? (failure.trace as Trace) : {};
  const verdict = judgeTrace(model, spec, trace, false);
  return {
    ...verdict,
    id: typeof failure.id === "string" ? failure.id : "",
    description: typeof failure.description === "string" ? failure.description : "",
  };
}

function judgeKnownFailures(model: SemanticModel, spec: Record<string, unknown>): KnownFailureVerdict[] {
  const failures = Array.isArray(spec.knownFailures) ? spec.knownFailures : [];
  return failures.filter(isRecord).map((failure) => judgeKnownFailure(model, spec, failure));
}

function judgeTrace(
  model: SemanticModel,
  spec: Record<string, unknown>,
  trace: Trace,
  fromTool: boolean,
): ReleaseVerdict {
  const expected = isRecord(spec.expected) ? spec.expected : {};
  let basisCorrect = basisMatches(expected, trace);
  let versionCorrect = versionMatches(model, spec, trace, fromTool);
  const asOf = stringField(spec, "asOf");
  const subjectType = stringField(spec, "subjectType");
  const violations = policyViolations(
    model,
    stringField(spec, "rule"),
    trace,
    asOf && subjectType ? { asOf, subjectType } : undefined,
  );
  if (violations.includes("forbid_basis") || violations.includes("approval") || violations.includes("above_cap")) {
    basisCorrect = false;
  }
  if (violations.includes("forbid_superseded")) versionCorrect = false;
  const citationCorrect = trace.citation === expected.citation && expected.citation !== undefined;
  const receiptComplete = completeReceipt(spec, trace, fromTool);
  return {
    basisCorrect,
    versionCorrect,
    citationCorrect,
    receiptComplete,
    passed: basisCorrect && versionCorrect && citationCorrect && receiptComplete,
  };
}

function basisMatches(expected: Record<string, unknown>, trace: Trace): boolean {
  if (trace.basis !== expected.basis) return false;
  if (trace.countedDays !== expected.countedDays) return false;
  if ("requiresHrApproval" in expected && trace.requiresHrApproval !== expected.requiresHrApproval) return false;
  if ("remainingLeaveDays" in expected && trace.remainingLeaveDays !== expected.remainingLeaveDays) return false;
  if ("unitAmount" in expected && trace.unitAmount !== expected.unitAmount) return false;
  if ("cap" in expected && trace.cap !== expected.cap) return false;
  if ("invoiceAmount" in expected && trace.invoiceAmount !== expected.invoiceAmount) return false;
  if ("reimbursable" in expected && trace.reimbursable !== expected.reimbursable) return false;
  if ("selfPay" in expected && trace.selfPay !== expected.selfPay) return false;
  return true;
}

function versionMatches(
  model: SemanticModel,
  spec: Record<string, unknown>,
  trace: Trace,
  fromTool: boolean,
): boolean {
  if (trace.inForce === false) return false;
  const asOf = stringField(spec, "asOf");
  const subjectType = stringField(spec, "subjectType");
  if (!asOf || !subjectType) return false;
  if (!trace.ruleId) return !fromTool && trace.unitAmount === undefined;
  let version;
  try {
    version = queryRuleVersion(model, { ruleId: trace.ruleId, subjectType, asOf });
  } catch {
    return false;
  }
  if (!version.inForce) return false;
  const rule = model.byId.get(trace.ruleId);
  if (!rule || !isRecord(rule.spec.limit)) return trace.unitAmount === undefined || !fromTool;
  if (typeof rule.spec.limit.amount === "number" && trace.unitAmount !== undefined && trace.unitAmount !== rule.spec.limit.amount) {
    return false;
  }
  return true;
}

function completeReceipt(spec: Record<string, unknown>, trace: Trace, fromTool: boolean): boolean {
  if (trace.receiptComplete === false) return false;
  if (!fromTool && trace.receiptComplete !== true) {
    const hasPointers =
      trace.ruleId !== undefined &&
      trace.inputSpan !== undefined &&
      "effectiveFrom" in trace &&
      "supersededAt" in trace &&
      "replaces" in trace &&
      "replacedBy" in trace;
    if (!hasPointers) return false;
  }
  if (!trace.citation || !trace.basis || trace.countedDays === undefined || trace.inForce !== true || !trace.ruleId) {
    return false;
  }
  if (trace.inputSpan === undefined) return false;
  if (!("effectiveFrom" in trace) || !("supersededAt" in trace) || !("replaces" in trace) || !("replacedBy" in trace)) {
    return false;
  }
  if (spec.caseClass === "calculation_basis") {
    return trace.requiresHrApproval !== undefined && trace.remainingLeaveDays !== undefined && trace.thresholdValue !== undefined;
  }
  return (
    trace.unitAmount !== undefined &&
    trace.cap !== undefined &&
    trace.reimbursable !== undefined &&
    trace.selfPay !== undefined &&
    trace.invoiceAmount !== undefined
  );
}

function checkEvidence(model: SemanticModel, spec: Record<string, unknown>, verdict: ReleaseVerdict): string[] {
  const notes: string[] = [];
  const query = stringField(spec, "evidenceQuery");
  const asOf = stringField(spec, "asOf");
  const subjectType = stringField(spec, "subjectType");
  const expected = isRecord(spec.expected) ? spec.expected : {};
  const citation = stringField(expected, "citation");
  if (!query || !asOf || !subjectType || !citation) {
    notes.push("证据检索条件不完整");
    verdict.citationCorrect = false;
    return notes;
  }
  let hits;
  try {
    hits = retrieveEvidence(model, { query, asOf, subjectType });
  } catch (error) {
    notes.push(error instanceof ModelError ? error.message : "证据检索失败");
    verdict.citationCorrect = false;
    return notes;
  }
  const cited = hits.find((hit) => hit.citation === citation && hit.inForce);
  if (!cited) {
    notes.push("证据引用未落在现行条文");
    verdict.citationCorrect = false;
  }
  for (const ruleId of stringList(spec.interferenceRules)) {
    const hit = hits.find((item) => item.ruleId === ruleId);
    if (!hit) {
      notes.push(`干扰文档未检索到：${ruleId}`);
      verdict.citationCorrect = false;
      continue;
    }
    const version = queryRuleVersion(model, { ruleId, subjectType, asOf });
    if (hit.inForce !== version.inForce) {
      notes.push(`现行标记与契约不一致：${ruleId}`);
      verdict.citationCorrect = false;
    }
  }
  return notes;
}

function receiptToTrace(receipt: CalculationReceipt): Trace {
  return {
    basis: receipt.basis,
    ruleId: receipt.ruleId,
    citation: receipt.citation,
    countedDays: receipt.countedDays,
    requiresHrApproval: receipt.requiresHrApproval,
    remainingLeaveDays: receipt.remainingLeaveDays,
    unitAmount: receipt.unitAmount,
    personCount: receipt.personCount,
    cap: receipt.cap,
    invoiceAmount: receipt.invoiceAmount,
    reimbursable: receipt.reimbursable,
    selfPay: receipt.selfPay,
    inForce: receipt.inForce,
    inputSpan: receipt.inputSpan,
    effectiveFrom: receipt.effectiveFrom,
    supersededAt: receipt.supersededAt,
    replaces: receipt.replaces,
    replacedBy: receipt.replacedBy,
    thresholdValue: receipt.thresholdValue,
    receiptComplete: true,
  };
}

function blankVerdict(): ReleaseVerdict {
  return {
    basisCorrect: false,
    versionCorrect: false,
    citationCorrect: false,
    receiptComplete: false,
    passed: false,
  };
}
