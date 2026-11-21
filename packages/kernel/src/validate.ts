/**
 * 引用完整性。结构问题在加载时已经按 JSON Schema 拒绝。
 * M0 要求关系、指标、动作写回都落在同一个 Namespace。
 */
import { documentsOf, isRecord, stringField, stringList } from "./model.ts";
import type { SemanticDocument, SemanticModel, ValidationIssue, ValidationReport } from "./types.ts";

export function validateModel(model: SemanticModel): ValidationReport {
  const issues: ValidationIssue[] = [];
  const namespaces = new Set(documentsOf(model, "Namespace").map((document) => document.metadata.id));

  for (const document of model.documents) {
    const path = document.metadata.id;
    if (document.kind === "Namespace") {
      if (document.metadata.namespace !== document.metadata.id) {
        issues.push(issue("namespace_identity", path, "Namespace 的 metadata.namespace 必须等于 metadata.id"));
      }
      continue;
    }
    if (document.kind === "Company" || document.kind === "Project") {
      if (document.metadata.namespace !== document.metadata.id) {
        issues.push(issue("context_identity", path, "Company 与 Project 的 metadata.namespace 必须等于自己的 id"));
      }
      continue;
    }
    if (!namespaces.has(document.metadata.namespace)) {
      issues.push(issue("missing_namespace", path, `找不到 Namespace：${document.metadata.namespace}`));
    }
  }

  const entities = new Map(
    documentsOf(model, "Entity").map((document) => [document.metadata.id, document]),
  );

  for (const relation of documentsOf(model, "Relation")) {
    checkRelation(relation, entities, issues);
  }
  for (const metric of documentsOf(model, "Metric")) {
    checkEntityRef(metric, "spec.entity", stringField(metric.spec, "entity"), entities, issues);
  }
  for (const action of documentsOf(model, "Action")) {
    checkAction(action, entities, issues);
  }
  const approvalRuleOwners = new Map<string, string>();
  for (const policy of documentsOf(model, "Policy")) {
    for (const resource of stringList(policy.spec.resources)) {
      if (!model.byId.has(resource)) {
        issues.push(issue("missing_resource", policy.metadata.id, `策略资源不存在：${resource}`));
      }
    }
    checkStructuredPolicy(policy, model, issues, approvalRuleOwners);
  }
  for (const mapping of documentsOf(model, "SourceMapping")) {
    checkMapping(mapping, model, entities, issues);
  }
  for (const project of documentsOf(model, "Project")) {
    const companyId = stringField(project.spec, "company");
    const company = companyId ? model.byId.get(companyId) : undefined;
    if (!company || company.kind !== "Company") {
      issues.push(issue("missing_company", project.metadata.id, `项目没有所属公司：${companyId ?? ""}`));
    }
  }
  for (const namespace of documentsOf(model, "Namespace")) {
    const projectId = stringField(namespace.spec, "project");
    const project = projectId ? model.byId.get(projectId) : undefined;
    if (!project || project.kind !== "Project") {
      issues.push(issue("missing_project", namespace.metadata.id, `Namespace 没有所属项目：${projectId ?? ""}`));
    }
  }
  for (const brief of documentsOf(model, "ScenarioBrief")) {
    checkGoals(brief, issues);
    checkBriefProject(brief, model, issues);
  }
  const goalIds = collectGoalIds(model);
  for (const gap of documentsOf(model, "GapLog")) {
    checkGap(gap, goalIds, issues);
  }

  const caseIds = new Set<string>();
  for (const pack of documentsOf(model, "CasePack")) {
    checkCasePack(pack, model, caseIds, issues);
  }
  for (const rule of documentsOf(model, "Rule")) {
    checkRule(rule, model, issues);
  }
  for (const evalCase of documentsOf(model, "EvalCase")) {
    rememberCaseId(caseIds, evalCase.metadata.id, evalCase.metadata.id, issues);
    checkExpectedObjects(evalCase.metadata.id, evalCase.spec.expectedObjects, model, issues);
    checkEvalGate(evalCase.metadata.id, evalCase.spec, model, issues);
  }

  for (const entity of entities.values()) {
    checkPrimaryKey(entity, issues);
  }

  return { ok: issues.length === 0, issues };
}

function checkRelation(
  relation: SemanticDocument,
  entities: Map<string, SemanticDocument>,
  issues: ValidationIssue[],
): void {
  const fromId = stringField(relation.spec, "from");
  const toId = stringField(relation.spec, "to");
  const from = checkEntityRef(relation, "spec.from", fromId, entities, issues);
  const to = checkEntityRef(relation, "spec.to", toId, entities, issues);
  const fromAttribute = stringField(relation.spec, "fromAttribute");
  const toAttribute = stringField(relation.spec, "toAttribute");
  if (from && fromAttribute && !attributeNames(from).has(fromAttribute)) {
    issues.push(issue("missing_attribute", relation.metadata.id, `起点实体没有属性 ${fromAttribute}`));
  }
  if (to && toAttribute && !attributeNames(to).has(toAttribute)) {
    issues.push(issue("missing_attribute", relation.metadata.id, `终点实体没有属性 ${toAttribute}`));
  }
}

function checkAction(
  action: SemanticDocument,
  entities: Map<string, SemanticDocument>,
  issues: ValidationIssue[],
): void {
  const writeBack = isRecord(action.spec.writeBack) ? action.spec.writeBack : undefined;
  const targetId = writeBack ? stringField(writeBack, "target") : undefined;
  const target = checkEntityRef(action, "spec.writeBack.target", targetId, entities, issues);
  if (target && writeBack) {
    const names = attributeNames(target);
    for (const field of stringList(writeBack.fields)) {
      if (!names.has(field)) {
        issues.push(issue("missing_attribute", action.metadata.id, `写回字段不是目标实体属性：${field}`));
      }
    }
  }
  const approval = isRecord(action.spec.approval) ? action.spec.approval : undefined;
  if (approval?.required === true) {
    const roles = stringList(approval.approverRoles);
    if (roles.length === 0) {
      issues.push(issue("approval_roles", action.metadata.id, "需要审批时必须给出 approverRoles"));
    }
  }
}

function checkMapping(
  mapping: SemanticDocument,
  model: SemanticModel,
  entities: Map<string, SemanticDocument>,
  issues: ValidationIssue[],
): void {
  const objectRef = stringField(mapping.spec, "objectRef");
  if (!objectRef || !model.byId.has(objectRef)) {
    issues.push(issue("missing_object", mapping.metadata.id, `映射目标不存在：${objectRef ?? ""}`));
    return;
  }
  const target = entities.get(objectRef);
  if (!target) return;
  const names = attributeNames(target);
  const fieldMappings = Array.isArray(mapping.spec.fieldMappings) ? mapping.spec.fieldMappings : [];
  for (const field of fieldMappings) {
    if (!isRecord(field)) continue;
    const semantic = stringField(field, "semantic");
    if (semantic && !names.has(semantic)) {
      issues.push(issue("missing_attribute", mapping.metadata.id, `映射字段不是实体属性：${semantic}`));
    }
  }
}

function checkBriefProject(brief: SemanticDocument, model: SemanticModel, issues: ValidationIssue[]): void {
  const projectId = stringField(brief.spec, "project");
  const project = projectId ? model.byId.get(projectId) : undefined;
  if (!project || project.kind !== "Project") {
    issues.push(issue("missing_project", brief.metadata.id, `场景没有所属项目：${projectId ?? ""}`));
    return;
  }
  const namespace = model.byId.get(brief.metadata.namespace);
  const namespaceProject =
    namespace && namespace.kind === "Namespace" ? stringField(namespace.spec, "project") : undefined;
  if (namespaceProject && namespaceProject !== projectId) {
    issues.push(issue("project_mismatch", brief.metadata.id, "场景简报必须和所在 Namespace 属于同一个项目"));
  }
}

function checkGoals(brief: SemanticDocument, issues: ValidationIssue[]): void {
  const seen = new Set<string>();
  const goals = Array.isArray(brief.spec.goals) ? brief.spec.goals : [];
  for (const goal of goals) {
    if (!isRecord(goal) || typeof goal.id !== "string") continue;
    if (seen.has(goal.id)) {
      issues.push(issue("duplicate_goal", brief.metadata.id, `需求目标重复：${goal.id}`));
    }
    seen.add(goal.id);
  }
}

function collectGoalIds(model: SemanticModel): Set<string> {
  const ids = new Set<string>();
  for (const brief of documentsOf(model, "ScenarioBrief")) {
    const goals = Array.isArray(brief.spec.goals) ? brief.spec.goals : [];
    for (const goal of goals) {
      if (isRecord(goal) && typeof goal.id === "string") ids.add(goal.id);
    }
  }
  return ids;
}

function checkGap(gap: SemanticDocument, goalIds: Set<string>, issues: ValidationIssue[]): void {
  const items = Array.isArray(gap.spec.items) ? gap.spec.items : [];
  for (const item of items) {
    if (!isRecord(item)) continue;
    for (const goal of stringList(item.relatedGoals)) {
      if (!goalIds.has(goal)) {
        issues.push(issue("missing_goal", gap.metadata.id, `缺口引用了不存在的需求目标：${goal}`));
      }
    }
  }
}

function checkCasePack(
  pack: SemanticDocument,
  model: SemanticModel,
  caseIds: Set<string>,
  issues: ValidationIssue[],
): void {
  const briefId = stringField(pack.spec, "scenarioBrief");
  const brief = briefId ? model.byId.get(briefId) : undefined;
  if (!brief || brief.kind !== "ScenarioBrief") {
    issues.push(issue("missing_brief", pack.metadata.id, `找不到场景简报：${briefId ?? ""}`));
  }
  const cases = Array.isArray(pack.spec.cases) ? pack.spec.cases : [];
  for (const item of cases) {
    if (!isRecord(item) || typeof item.id !== "string") continue;
    rememberCaseId(caseIds, item.id, pack.metadata.id, issues);
    checkExpectedObjects(pack.metadata.id, item.expectedObjects, model, issues);
    checkEvalGate(pack.metadata.id, item, model, issues);
  }
}

function checkStructuredPolicy(
  policy: SemanticDocument,
  model: SemanticModel,
  issues: ValidationIssue[],
  approvalRuleOwners: Map<string, string>,
): void {
  if (!isRecord(policy.spec.check)) return;
  const check = policy.spec.check;
  const kind = stringField(check, "kind");
  const ruleId = stringField(check, "rule");
  const actionId = stringField(check, "action");
  if (kind === "forbid_basis") {
    const rule = requirePolicyRule(model, policy, ruleId, issues);
    const basis = stringField(check, "basis");
    if (rule && basis !== "working_day" && basis !== "calendar_day") {
      issues.push(issue("policy_check", policy.metadata.id, "禁止计算基准的策略必须写明基准"));
    }
    return;
  }
  if (kind === "require_approval_when_exceeded") {
    const rule = requirePolicyRule(model, policy, ruleId, issues);
    if (rule && !isRecord(rule.spec.threshold)) {
      issues.push(issue("policy_check", policy.metadata.id, "人事审批策略引用的规则没有门槛"));
    }
    if (stringList(check.approverRoles).length === 0) {
      issues.push(issue("policy_check", policy.metadata.id, "人事审批策略必须写明审批角色"));
    }
    if (ruleId) {
      const owner = approvalRuleOwners.get(ruleId);
      if (owner) {
        issues.push(issue("policy_check", policy.metadata.id, `同一规则的人事审批策略重复：${owner}`));
      } else {
        approvalRuleOwners.set(ruleId, policy.metadata.id);
      }
    }
    return;
  }
  if (kind === "forbid_superseded") {
    const rule = requirePolicyRule(model, policy, ruleId, issues);
    if (rule && !stringField(rule.spec, "supersededAt") && !stringField(rule.spec, "replacedBy")) {
      issues.push(issue("policy_check", policy.metadata.id, "禁止废止版本的策略必须指向已废止规则"));
    }
    return;
  }
  if (kind === "human_authorization") {
    const action = actionId ? model.byId.get(actionId) : undefined;
    if (!action || action.kind !== "Action") {
      issues.push(issue("policy_check", policy.metadata.id, `人授权策略没有指向动作：${actionId ?? ""}`));
      return;
    }
    const approval = isRecord(action.spec.approval) ? action.spec.approval : undefined;
    if (approval?.required !== true) {
      issues.push(issue("policy_check", policy.metadata.id, "人授权策略指向的动作必须保留审批钩子"));
    }
    const policyRoles = stringList(check.approverRoles);
    const actionRoles = stringList(approval?.approverRoles);
    if (policyRoles.length === 0 || !sameRoles(policyRoles, actionRoles)) {
      issues.push(issue("policy_check", policy.metadata.id, "人授权角色必须与 Action 的审批角色一致"));
    }
  }
}

function requirePolicyRule(
  model: SemanticModel,
  policy: SemanticDocument,
  ruleId: string | undefined,
  issues: ValidationIssue[],
): SemanticDocument | undefined {
  const rule = ruleId ? model.byId.get(ruleId) : undefined;
  if (!rule || rule.kind !== "Rule") {
    issues.push(issue("policy_check", policy.metadata.id, `策略没有指向规则：${ruleId ?? ""}`));
    return undefined;
  }
  return rule;
}

function sameRoles(left: string[], right: string[]): boolean {
  if (left.length !== right.length) return false;
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return sortedLeft.every((role, index) => role === sortedRight[index]);
}

function checkRule(rule: SemanticDocument, model: SemanticModel, issues: ValidationIssue[]): void {
  const replaces = stringField(rule.spec, "replaces");
  const replacedBy = stringField(rule.spec, "replacedBy");
  const effectiveFrom = stringField(rule.spec, "effectiveFrom");
  const supersededAt = stringField(rule.spec, "supersededAt");
  if (replaces) checkRulePointer(rule, model, replaces, "replacedBy", issues);
  if (replacedBy) {
    checkRulePointer(rule, model, replacedBy, "replaces", issues);
    if (!supersededAt) {
      issues.push(issue("rule_version", rule.metadata.id, "被替代的规则必须写废止日"));
    }
  }
  if (supersededAt && !replacedBy) {
    issues.push(issue("rule_version", rule.metadata.id, "写了废止日就必须指向替代它的规则"));
  }
  if (effectiveFrom && supersededAt && supersededAt <= effectiveFrom) {
    issues.push(issue("rule_version", rule.metadata.id, "废止日必须晚于生效日"));
  }
  const basis = stringField(rule.spec, "basis");
  const threshold = isRecord(rule.spec.threshold) ? rule.spec.threshold : undefined;
  if (threshold && stringField(threshold, "unit") !== basis) {
    issues.push(issue("rule_basis", rule.metadata.id, "门槛单位必须与计算基准一致"));
  }
  const limit = isRecord(rule.spec.limit) ? rule.spec.limit : undefined;
  if (limit && stringField(limit, "unit") !== basis) {
    issues.push(issue("rule_basis", rule.metadata.id, "限额单位必须与计算基准一致"));
  }
}

function checkRulePointer(
  rule: SemanticDocument,
  model: SemanticModel,
  pointer: string,
  inverseKey: "replaces" | "replacedBy",
  issues: ValidationIssue[],
): void {
  const other = model.byId.get(pointer);
  if (!other || other.kind !== "Rule") {
    issues.push(issue("missing_rule", rule.metadata.id, `替代关系不是规则：${pointer}`));
    return;
  }
  if (stringField(other.spec, inverseKey) !== rule.metadata.id) {
    issues.push(issue("rule_version", rule.metadata.id, `替代关系没有互相指向：${pointer}`));
  }
}

function checkEvalGate(
  path: string,
  spec: Record<string, unknown>,
  model: SemanticModel,
  issues: ValidationIssue[],
): void {
  const caseClass = stringField(spec, "caseClass");
  if (!caseClass) return;
  const briefId = stringField(spec, "scenarioBrief");
  if (briefId) {
    const brief = model.byId.get(briefId);
    if (!brief || brief.kind !== "ScenarioBrief") {
      issues.push(issue("missing_brief", path, `找不到场景简报：${briefId}`));
    }
  }
  const ruleId = stringField(spec, "rule");
  const rule = ruleId ? model.byId.get(ruleId) : undefined;
  if (!rule || rule.kind !== "Rule") {
    issues.push(issue("missing_rule", path, `评测用例没有指向规则：${ruleId ?? ""}`));
  }
  for (const interference of stringList(spec.interferenceRules)) {
    const document = model.byId.get(interference);
    if (!document || document.kind !== "Rule") {
      issues.push(issue("missing_rule", path, `干扰规则不存在：${interference}`));
    }
  }
  if (!stringField(spec, "asOf") || !stringField(spec, "subjectType") || !stringField(spec, "evidenceQuery")) {
    issues.push(issue("eval_gate", path, "发布门禁用例必须写查询时点、主体和证据检索词"));
  }
  if (!isRecord(spec.facts) || !isRecord(spec.expected)) {
    issues.push(issue("eval_gate", path, "发布门禁用例必须写案件事实和期望回执"));
  }
  const failures = Array.isArray(spec.knownFailures) ? spec.knownFailures : [];
  if (failures.length === 0) {
    issues.push(issue("eval_gate", path, "发布门禁用例必须带上已知失败模式"));
  }
  const conditions = stringList(spec.failureConditions);
  if (conditions.length === 0) {
    issues.push(issue("eval_gate", path, "发布门禁用例必须写明失败条件"));
  }
}

function checkExpectedObjects(
  path: string,
  raw: unknown,
  model: SemanticModel,
  issues: ValidationIssue[],
): void {
  for (const objectId of stringList(raw)) {
    if (!model.byId.has(objectId)) {
      issues.push(issue("missing_object", path, `评测用例引用了不存在的对象：${objectId}`));
    }
  }
}

function checkPrimaryKey(entity: SemanticDocument, issues: ValidationIssue[]): void {
  const names = attributeNames(entity);
  for (const key of stringList(entity.spec.primaryKey)) {
    if (!names.has(key)) {
      issues.push(issue("missing_attribute", entity.metadata.id, `主键不是属性：${key}`));
    }
  }
}

function checkEntityRef(
  document: SemanticDocument,
  path: string,
  entityId: string | undefined,
  entities: Map<string, SemanticDocument>,
  issues: ValidationIssue[],
): SemanticDocument | undefined {
  if (!entityId || !entities.has(entityId)) {
    issues.push(issue("missing_entity", document.metadata.id, `${path} 不是实体：${entityId ?? ""}`));
    return undefined;
  }
  const entity = entities.get(entityId);
  if (entity && entity.metadata.namespace !== document.metadata.namespace) {
    issues.push(issue("cross_namespace", document.metadata.id, `${path} 必须与当前对象位于同一 Namespace`));
  }
  return entity;
}

function attributeNames(entity: SemanticDocument): Set<string> {
  const names = new Set<string>();
  const attributes = Array.isArray(entity.spec.attributes) ? entity.spec.attributes : [];
  for (const attribute of attributes) {
    if (isRecord(attribute) && typeof attribute.name === "string") names.add(attribute.name);
  }
  return names;
}

function rememberCaseId(
  seen: Set<string>,
  caseId: string,
  path: string,
  issues: ValidationIssue[],
): void {
  if (seen.has(caseId)) {
    issues.push(issue("duplicate_case", path, `评测用例 id 重复：${caseId}`));
  }
  seen.add(caseId);
}

function issue(code: string, path: string, message: string): ValidationIssue {
  return { level: "error", code, path, message };
}
