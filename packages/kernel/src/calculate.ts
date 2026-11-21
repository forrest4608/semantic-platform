/**
 * 规则计算。时长和限额只由工具按契约计算，模型不心算。
 * 未在该时点现行的规则直接拒绝，不会把它的数字算进回执。
 */
import { isRecord, stringField } from "./model.ts";
import { loadCase, readDays, readFacts, requireClass, requireText, type DayMark } from "./cases.ts";
import { ModelError, type SemanticDocument, type SemanticModel, type ValidationIssue } from "./types.ts";
import { findInForceRule, queryRuleVersion, ruleDocument, type RuleVersion } from "./version.ts";

export type { DayMark };

export interface CalculationReceipt {
  tool: "get_leave_days" | "get_limit";
  ruleId: string;
  citation: string;
  basis: "working_day" | "calendar_day";
  inForce: true;
  effectiveFrom: string | null;
  supersededAt: string | null;
  replaces: string | null;
  replacedBy: string | null;
  inputSpan: string;
  countedDays: number;
  excludedDayLabels: string[];
  thresholdValue?: number;
  requiresHrApproval?: boolean;
  remainingLeaveDays?: number;
  unitAmount?: number;
  personCount?: number;
  cap?: number;
  invoiceAmount?: number;
  reimbursable?: number;
  selfPay?: number;
}

export interface LeaveQuoteInput {
  ruleId: string;
  asOf: string;
  subjectType: string;
  spanLabel: string;
  days: DayMark[];
  remainingLeaveDays: number;
}

export interface LimitQuoteInput {
  ruleId: string;
  asOf: string;
  subjectType: string;
  spanLabel: string;
  days: DayMark[];
  personCount: number;
  invoiceAmount: number;
  departureIncluded: boolean;
  returnIncluded: boolean;
}

export interface TripFact {
  caseId: string;
  employeeName: string;
  destination: string;
  spanLabel: string;
  departureIncluded: boolean;
  returnIncluded: boolean;
}

export function countByBasis(
  basis: "working_day" | "calendar_day",
  days: DayMark[],
): { countedDays: number; excludedDayLabels: string[] } {
  if (basis === "calendar_day") {
    return { countedDays: days.length, excludedDayLabels: [] };
  }
  const excludedDayLabels = days.filter((day) => day.kind !== "working_day").map((day) => day.label);
  return { countedDays: days.length - excludedDayLabels.length, excludedDayLabels };
}

export function quoteLeave(model: SemanticModel, input: LeaveQuoteInput): CalculationReceipt {
  const version = requireInForce(model, input.ruleId, input.subjectType, input.asOf);
  const rule = ruleDocument(model, version.ruleId);
  const basis = basisOf(rule);
  const counted = countByBasis(basis, input.days);
  const threshold = isRecord(rule.spec.threshold) ? rule.spec.threshold : undefined;
  if (!threshold || threshold.comparison !== "gt" || typeof threshold.value !== "number") {
    throw new ModelError("请假规则缺少「超过」门槛");
  }
  if (threshold.unit !== basis) throw new ModelError("门槛单位与计算基准不一致");
  if (typeof input.remainingLeaveDays !== "number") throw new ModelError("缺少剩余年假");
  return {
    tool: "get_leave_days",
    ...versionFields(version, citationOf(rule), basis),
    inputSpan: input.spanLabel,
    countedDays: counted.countedDays,
    excludedDayLabels: counted.excludedDayLabels,
    thresholdValue: threshold.value,
    requiresHrApproval: counted.countedDays > threshold.value,
    remainingLeaveDays: input.remainingLeaveDays,
  };
}

export function quoteLimit(model: SemanticModel, input: LimitQuoteInput): CalculationReceipt {
  const version = requireInForce(model, input.ruleId, input.subjectType, input.asOf);
  const rule = ruleDocument(model, version.ruleId);
  const basis = basisOf(rule);
  if (rule.spec.includeEndpoints === true && (!input.departureIncluded || !input.returnIncluded)) {
    throw new ModelError("出发日和返回日都计入");
  }
  const limit = isRecord(rule.spec.limit) ? rule.spec.limit : undefined;
  if (!limit || typeof limit.amount !== "number" || limit.per !== "person") {
    throw new ModelError("报销规则缺少每人限额");
  }
  if (limit.unit !== basis) throw new ModelError("限额单位与计算基准不一致");
  if (!Number.isInteger(input.personCount) || input.personCount < 1) throw new ModelError("人数不正确");
  if (typeof input.invoiceAmount !== "number") throw new ModelError("缺少发票金额");
  const counted = countByBasis(basis, input.days);
  const cap = limit.amount * counted.countedDays * input.personCount;
  const reimbursable = Math.min(input.invoiceAmount, cap);
  return {
    tool: "get_limit",
    ...versionFields(version, citationOf(rule), basis),
    inputSpan: input.spanLabel,
    countedDays: counted.countedDays,
    excludedDayLabels: counted.excludedDayLabels,
    unitAmount: limit.amount,
    personCount: input.personCount,
    cap,
    invoiceAmount: input.invoiceAmount,
    reimbursable,
    selfPay: input.invoiceAmount - reimbursable,
  };
}

export function getLeaveDays(model: SemanticModel, caseId: string): CalculationReceipt {
  const loaded = loadCase(model, caseId);
  requireClass(loaded.spec, "calculation_basis", loaded.id);
  const facts = readFacts(loaded.spec);
  const days = readDays(facts);
  if (typeof facts.remainingLeaveDays !== "number") throw new ModelError("用例缺少剩余年假");
  return quoteLeave(model, {
    ruleId: requireText(loaded.spec, "rule", "规则"),
    asOf: requireText(loaded.spec, "asOf", "业务发生时点"),
    subjectType: requireText(loaded.spec, "subjectType", "主体类型"),
    spanLabel: requireText(facts, "spanLabel", "区间"),
    days,
    remainingLeaveDays: facts.remainingLeaveDays,
  });
}

export function getLimit(model: SemanticModel, caseId: string): CalculationReceipt {
  const loaded = loadCase(model, caseId);
  requireClass(loaded.spec, "version_interference", loaded.id);
  const facts = readFacts(loaded.spec);
  if (typeof facts.personCount !== "number" || typeof facts.invoiceAmount !== "number") {
    throw new ModelError("用例缺少人数或发票金额");
  }
  return quoteLimit(model, {
    ruleId: requireText(loaded.spec, "rule", "规则"),
    asOf: requireText(loaded.spec, "asOf", "业务发生时点"),
    subjectType: requireText(loaded.spec, "subjectType", "主体类型"),
    spanLabel: requireText(facts, "spanLabel", "区间"),
    days: readDays(facts),
    personCount: facts.personCount,
    invoiceAmount: facts.invoiceAmount,
    departureIncluded: facts.departureIncluded === true,
    returnIncluded: facts.returnIncluded === true,
  });
}

export function getTrip(model: SemanticModel, caseId: string): TripFact {
  const loaded = loadCase(model, caseId);
  requireClass(loaded.spec, "version_interference", loaded.id);
  const facts = readFacts(loaded.spec);
  return {
    caseId: loaded.id,
    employeeName: requireText(facts, "employeeName", "员工"),
    destination: requireText(facts, "destination", "目的地"),
    spanLabel: requireText(facts, "spanLabel", "区间"),
    departureIncluded: facts.departureIncluded === true,
    returnIncluded: facts.returnIncluded === true,
  };
}

function requireInForce(model: SemanticModel, ruleId: string, subjectType: string, asOf: string): RuleVersion {
  const version = queryRuleVersion(model, { ruleId, subjectType, asOf });
  if (!version.inForce) {
    const failure: ValidationIssue = {
      level: "error",
      code: "rule_not_in_force",
      path: ruleId,
      message: `规则在 ${asOf} 对主体「${subjectType}」不是现行版本`,
    };
    throw new ModelError(failure.message, [failure]);
  }
  const topic = stringField(ruleDocument(model, version.ruleId).spec, "topic");
  if (!topic) throw new ModelError("规则缺少主题");
  const selected = findInForceRule(model, { topic, subjectType, asOf });
  if (selected.ruleId !== version.ruleId) {
    throw new ModelError("计算必须使用该时点唯一的现行规则");
  }
  return version;
}

function basisOf(rule: SemanticDocument): "working_day" | "calendar_day" {
  const basis = rule.spec.basis;
  if (basis !== "working_day" && basis !== "calendar_day") throw new ModelError("规则缺少计算基准");
  return basis;
}

function citationOf(rule: SemanticDocument): string {
  const citation = rule.spec.citation;
  if (typeof citation !== "string" || citation.length === 0) throw new ModelError("规则缺少条文出处");
  return citation;
}

function versionFields(
  version: RuleVersion,
  citation: string,
  basis: "working_day" | "calendar_day",
): Pick<
  CalculationReceipt,
  | "ruleId"
  | "citation"
  | "basis"
  | "inForce"
  | "effectiveFrom"
  | "supersededAt"
  | "replaces"
  | "replacedBy"
> {
  return {
    ruleId: version.ruleId,
    citation,
    basis,
    inForce: true,
    effectiveFrom: version.effectiveFrom,
    supersededAt: version.supersededAt,
    replaces: version.replaces,
    replacedBy: version.replacedBy,
  };
}
