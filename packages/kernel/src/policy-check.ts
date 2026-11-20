/**
 * 只核对两个教学用例用到的结构化策略。
 * Policy.spec.condition 仍是作者文本，这里不解释、不执行。
 */
import { documentsOf, isRecord, stringField } from "./model.ts";
import { ModelError, type SemanticModel } from "./types.ts";

export interface PolicyTrace {
  basis?: string;
  ruleId?: string;
  countedDays?: number;
  requiresHrApproval?: boolean;
  inForce?: boolean;
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
 * 自然日不能拿来触发人事审批；未超过工作日门槛时不得要求人事审批；已废止规则不能当计算依据。
 */
export function policyViolations(model: SemanticModel, caseRuleId: string | undefined, trace: PolicyTrace): string[] {
  const violations: string[] = [];
  const subjectRuleId = trace.ruleId ?? caseRuleId;
  for (const item of structuredChecks(model)) {
    const check = item.check;
    if (check.kind === "forbid_basis" && check.rule === subjectRuleId && trace.basis === check.basis) {
      violations.push("forbid_basis");
    }
    if (check.kind === "forbid_superseded" && trace.ruleId === check.rule) {
      violations.push("forbid_superseded");
    }
    if (check.kind === "require_approval_when_exceeded" && check.rule === subjectRuleId) {
      if (approvalDecisionMismatches(model, check, trace)) violations.push("approval");
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

function structuredChecks(model: SemanticModel): Array<{ check: Record<string, unknown> }> {
  const found: Array<{ check: Record<string, unknown> }> = [];
  for (const policy of documentsOf(model, "Policy")) {
    if (!isRecord(policy.spec.check)) continue;
    found.push({ check: policy.spec.check });
  }
  return found;
}
