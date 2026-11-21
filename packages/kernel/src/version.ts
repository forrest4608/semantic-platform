/**
 * 契约版本查询。
 * 给定规则、主体和业务发生时点，返回是否现行，以及生效日、废止日和替代指针。
 * 不返回「最新一篇文档」这种没有时点的结果。
 */
import { documentsOf, isRecord, stringField, stringList } from "./model.ts";
import { ModelError, type SemanticDocument, type SemanticModel, type ValidationIssue } from "./types.ts";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export type VersionStatus = "in_force" | "superseded" | "not_yet_effective" | "subject_not_applicable";

export interface RuleVersionQuery {
  ruleId: string;
  subjectType: string;
  asOf: string;
}

export interface RuleVersion {
  ruleId: string;
  subjectType: string;
  asOf: string;
  effectiveFrom: string | null;
  supersededAt: string | null;
  replaces: string | null;
  replacedBy: string | null;
  inForce: boolean;
  status: VersionStatus;
}

export function isIsoDate(value: string): boolean {
  return ISO_DATE.test(value);
}

export function queryRuleVersion(model: SemanticModel, input: RuleVersionQuery): RuleVersion {
  const ruleId = input.ruleId.trim();
  const subjectType = input.subjectType.trim();
  const asOf = input.asOf.trim();
  if (!ruleId) throw new ModelError("规则标识不能为空");
  if (!subjectType) throw new ModelError("主体类型不能为空");
  if (!isIsoDate(asOf)) throw new ModelError(`业务发生时点不是日期：${input.asOf}`);

  const rule = model.byId.get(ruleId);
  if (!rule || rule.kind !== "Rule") {
    throw new ModelError(`找不到规则：${ruleId}`, [issue("not_found", ruleId, `找不到规则：${ruleId}`)]);
  }

  const effectiveFrom = optionalString(rule.spec, "effectiveFrom");
  const supersededAt = optionalString(rule.spec, "supersededAt");
  const replaces = optionalString(rule.spec, "replaces");
  const replacedBy = optionalString(rule.spec, "replacedBy");
  const subjects = stringList(rule.spec.subjectTypes);
  let status: VersionStatus = "in_force";
  if (!subjects.includes(subjectType)) status = "subject_not_applicable";
  else if (effectiveFrom && asOf < effectiveFrom) status = "not_yet_effective";
  else if (supersededAt && asOf >= supersededAt) status = "superseded";

  return {
    ruleId,
    subjectType,
    asOf,
    effectiveFrom,
    supersededAt,
    replaces,
    replacedBy,
    inForce: status === "in_force",
    status,
  };
}

/** 同一主题在该时点只应有一条现行规则。多条或零条都拒绝猜测。 */
export function findInForceRule(
  model: SemanticModel,
  input: { topic: string; subjectType: string; asOf: string },
): RuleVersion {
  const matches: RuleVersion[] = [];
  for (const rule of documentsOf(model, "Rule")) {
    if (stringField(rule.spec, "topic") !== input.topic) continue;
    const version = queryRuleVersion(model, {
      ruleId: rule.metadata.id,
      subjectType: input.subjectType,
      asOf: input.asOf,
    });
    if (version.inForce) matches.push(version);
  }
  if (matches.length !== 1) {
    throw new ModelError(
      `主题 ${input.topic} 在 ${input.asOf} 对主体「${input.subjectType}」的现行规则不是唯一的`,
      [issue("rule_not_in_force", input.topic, "现行规则不唯一或缺失")],
    );
  }
  const only = matches[0];
  if (!only) throw new ModelError("现行规则缺失");
  return only;
}

export function ruleDocument(model: SemanticModel, ruleId: string): SemanticDocument {
  const rule = model.byId.get(ruleId);
  if (!rule || rule.kind !== "Rule") throw new ModelError(`找不到规则：${ruleId}`);
  return rule;
}

export function optionalString(record: Record<string, unknown>, key: string): string | null {
  const value = record[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

export function evidenceBlob(rule: SemanticDocument): string {
  const evidence = isRecord(rule.spec.evidence) ? rule.spec.evidence : {};
  return [stringField(evidence, "title") ?? "", stringField(evidence, "excerpt") ?? "", stringField(rule.spec, "citation") ?? ""].join(
    "\n",
  );
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return { level: "error", code, path, message };
}
