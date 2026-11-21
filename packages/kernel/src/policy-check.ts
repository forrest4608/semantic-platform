/**
 * 只核对两个教学用例用到的结构化策略。
 * Policy.spec.condition 仍是作者文本，这里不解释、不执行。
 */
import { documentsOf, isRecord, stringField } from "./model.ts";
import { ModelError, type SemanticModel } from "./types.ts";
import { findInForceRule, queryRuleVersion } from "./version.ts";

export interface PolicyTrace {
  basis?: string;
  ruleId?: string;
  countedDays?: number;
  requiresHrApproval?: boolean;
  inForce?: boolean;
  unitAmount?: number;
  reimbursable?: number;
  personCount?: number;
}

/** 超过门槛是否须人事审批，只在存在对应 Policy 时才有结论。 */
export function approvalRequiredByPolicy(
  model: SemanticModel,
  ruleId: string,
  thresholdExceeded: boolean,
): boolean {
  const matched = structuredChecks(model).filter(
    (item) => item.check.kind === "require_approval_when_exceeded" && item.check.rule === ruleId,
  );
  if (matched.length !== 1) {
    throw new ModelError(`规则 ${ruleId} 是否须人事审批要由唯一的 Policy 决定`);
  }
  return thresholdExceeded;
}

/**
 * 返回这条轨迹违反的策略种类。
 * 自然日不能拿来触发人事审批；未超过工作日门槛时不得要求人事审批。
 * 已废止只按业务发生时点判断，废止日之前仍可使用该版本。
 */
export function policyViolations(
  model: SemanticModel,
  caseRuleId: string | undefined,
  trace: PolicyTrace,
  at?: { asOf: string; subjectType: string },
): string[] {
  const violations: string[] = [];
  const subjectRuleId = trace.ruleId ?? caseRuleId;
  for (const item of structuredChecks(model)) {
    const check = item.check;
    if (check.kind === "forbid_basis" && check.rule === subjectRuleId && trace.basis === check.basis) {
      violations.push("forbid_basis");
    }
    if (check.kind === "forbid_superseded" && typeof trace.ruleId === "string" && trace.ruleId === check.rule && supersededAt(model, trace.ruleId, at)) {
      violations.push("forbid_superseded");
    }
    if (check.kind === "require_approval_when_exceeded" && check.rule === subjectRuleId) {
      if (approvalDecisionMismatches(model, check, trace)) violations.push("approval");
    }
    if (check.kind === "within_in_force_limit" && exceedsInForceLimit(model, check, trace, at, subjectRuleId)) {
      violations.push("above_cap");
    }
  }
  return violations;
}

function approvalDecisionMismatches(
  model: SemanticModel,
  check: Record<string, unknown>,
  trace: PolicyTrace,
): boolean {
  const ruleId = stringField(check, "rule");
  const rule = ruleId ? model.byId.get(ruleId) : undefined;
  if (!rule || !isRecord(rule.spec.threshold)) return false;
  const threshold = rule.spec.threshold.value;
  const ruleBasis = stringField(rule.spec, "basis");
  if (typeof threshold !== "number" || !ruleBasis) return false;
  if (trace.basis !== ruleBasis) return false;
  if (typeof trace.countedDays !== "number" || typeof trace.requiresHrApproval !== "boolean") return false;
  return trace.requiresHrApproval !== trace.countedDays > threshold;
}

function exceedsInForceLimit(
  model: SemanticModel,
  check: Record<string, unknown>,
  trace: PolicyTrace,
  at: { asOf: string; subjectType: string } | undefined,
  evaluatedRuleId: string | undefined,
): boolean {
  if (!at || !evaluatedRuleId) return false;
  const anchorId = stringField(check, "rule");
  const anchor = anchorId ? model.byId.get(anchorId) : undefined;
  const evaluated = model.byId.get(evaluatedRuleId);
  const topic = anchor ? stringField(anchor.spec, "topic") : undefined;
  const evaluatedTopic = evaluated ? stringField(evaluated.spec, "topic") : undefined;
  if (!anchor || !evaluated || !topic || topic !== evaluatedTopic) return false;
  if (anchor.metadata.namespace !== evaluated.metadata.namespace) return false;
  let version;
  try {
    version = findInForceRule(model, { topic, subjectType: at.subjectType, asOf: at.asOf });
  } catch {
    return false;
  }
  const rule = model.byId.get(version.ruleId);
  const limit = rule && isRecord(rule.spec.limit) ? rule.spec.limit.amount : undefined;
  if (typeof limit !== "number") return false;
  if (typeof trace.unitAmount === "number" && trace.unitAmount > limit) return true;
  if (typeof trace.reimbursable !== "number" || typeof trace.countedDays !== "number") return false;
  const people = typeof trace.personCount === "number" ? trace.personCount : 1;
  return trace.reimbursable > limit * trace.countedDays * people;
}

function supersededAt(
  model: SemanticModel,
  ruleId: string,
  at: { asOf: string; subjectType: string } | undefined,
): boolean {
  if (!at) return false;
  try {
    return queryRuleVersion(model, { ruleId, subjectType: at.subjectType, asOf: at.asOf }).status === "superseded";
  } catch {
    return false;
  }
}

function structuredChecks(model: SemanticModel): Array<{ check: Record<string, unknown> }> {
  const found: Array<{ check: Record<string, unknown> }> = [];
  for (const policy of documentsOf(model, "Policy")) {
    if (!isRecord(policy.spec.check)) continue;
    found.push({ check: policy.spec.check });
  }
  return found;
}
