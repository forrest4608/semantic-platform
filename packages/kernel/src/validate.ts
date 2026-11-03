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
  for (const policy of documentsOf(model, "Policy")) {
    for (const resource of stringList(policy.spec.resources)) {
      if (!model.byId.has(resource)) {
        issues.push(issue("missing_resource", policy.metadata.id, `策略资源不存在：${resource}`));
      }
    }
  }
  for (const mapping of documentsOf(model, "SourceMapping")) {
    checkMapping(mapping, model, entities, issues);
  }
  for (const brief of documentsOf(model, "ScenarioBrief")) {
    checkGoals(brief, issues);
  }
  const goalIds = collectGoalIds(model);
  for (const gap of documentsOf(model, "GapLog")) {
    checkGap(gap, goalIds, issues);
  }

  const caseIds = new Set<string>();
  for (const pack of documentsOf(model, "CasePack")) {
    checkCasePack(pack, model, caseIds, issues);
  }
  for (const evalCase of documentsOf(model, "EvalCase")) {
    rememberCaseId(caseIds, evalCase.metadata.id, evalCase.metadata.id, issues);
    checkExpectedObjects(evalCase.metadata.id, evalCase.spec.expectedObjects, model, issues);
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
