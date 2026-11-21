/**
 * 工作台只在服务端加载模型。浏览器不读文件系统。
 * 试问只回放已入库的教学问句。实时 Harness 的接入口在 liveHarnessHook，本切片不调用。
 */
import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  documentsOf,
  evaluateModel,
  getLeaveDays,
  getLimit,
  getTrip,
  isRecord,
  loadModel,
  previewRelease,
  releaseModel,
  stringField,
  type ReleaseRecord,
  type SemanticDocument,
  type SemanticModel,
} from "@semantic/kernel";

export interface ScenarioView {
  id: string;
  name: string;
  goals: string[];
}

export interface ProjectView {
  id: string;
  name: string;
  scenarios: ScenarioView[];
}

export interface CompanyView {
  id: string;
  name: string;
  projects: ProjectView[];
}

export interface CatalogItem {
  kind: string;
  id: string;
  name: string;
  description?: string;
}

export interface GraphNode {
  id: string;
  kind: string;
  name: string;
}

export interface GraphEdge {
  from: string;
  to: string;
  label: string;
}

const KIND_LABEL: Record<string, string> = {
  Company: "公司",
  Project: "项目",
  Namespace: "命名空间",
  Entity: "实体",
  Relation: "关系",
  Metric: "指标",
  Policy: "策略",
  Action: "动作",
  ScenarioBrief: "场景简报",
  GapLog: "缺口记录",
  CasePack: "用例包",
  EvalCase: "评测用例",
  SourceMapping: "来源映射",
  Rule: "规则",
};

export function kindLabel(kind: string): string {
  return KIND_LABEL[kind] ?? kind;
}

export function discoverContext(roots: string[]): { companies: CompanyView[] } {
  const companies = new Map<string, CompanyView>();
  for (const root of roots) {
    const model = loadModel(root);
    for (const company of documentsOf(model, "Company")) {
      const view = companies.get(company.metadata.id) ?? {
        id: company.metadata.id,
        name: company.metadata.name,
        projects: [],
      };
      for (const project of documentsOf(model, "Project")) {
        if (stringField(project.spec, "company") !== company.metadata.id) continue;
        if (view.projects.some((item) => item.id === project.metadata.id)) continue;
        view.projects.push({
          id: project.metadata.id,
          name: project.metadata.name,
          scenarios: documentsOf(model, "ScenarioBrief")
            .filter((brief) => stringField(brief.spec, "project") === project.metadata.id)
            .map((brief) => ({
              id: brief.metadata.id,
              name: brief.metadata.name,
              goals: goalStatements(brief),
            })),
        });
      }
      companies.set(view.id, view);
    }
  }
  return { companies: [...companies.values()] };
}

export function projectRoot(roots: string[], projectId: string): string | undefined {
  for (const root of roots) {
    const model = loadModel(root);
    if (model.byId.get(projectId)?.kind === "Project") return root;
  }
  return undefined;
}

export function workspaceView(model: SemanticModel, scenarioId: string) {
  const scenario = model.byId.get(scenarioId);
  if (!scenario || scenario.kind !== "ScenarioBrief") {
    throw new Error("找不到场景");
  }
  const preview = previewRelease(model);
  const evaluation = evaluateModel(model);
  return {
    scenario: {
      id: scenario.metadata.id,
      name: scenario.metadata.name,
      goals: goalStatements(scenario),
    },
    catalog: model.documents.map(toCatalog),
    graph: toGraph(model),
    gaps: documentsOf(model, "GapLog").map((gap) => ({
      id: gap.metadata.id,
      name: gap.metadata.name,
      items: Array.isArray(gap.spec.items) ? gap.spec.items : [],
    })),
    evaluation: {
      ok: evaluation.ok,
      passed: evaluation.passed,
      failed: evaluation.failed,
      results: evaluation.results.map((item) => ({
        caseId: item.caseId,
        question: item.question,
        passed: item.passed,
        skipped: item.skipped,
        notes: item.notes,
        releaseGate: item.releaseGate
          ? {
              basisCorrect: item.releaseGate.basisCorrect,
              versionCorrect: item.releaseGate.versionCorrect,
              citationCorrect: item.releaseGate.citationCorrect,
              receiptComplete: item.releaseGate.receiptComplete,
              passed: item.releaseGate.passed,
            }
          : undefined,
      })),
    },
    release: preview,
  };
}

export interface AskResult {
  matched: boolean;
  question: string;
  answer?: string;
  receipt?: unknown;
  trip?: unknown;
  message: string;
}

export function answerQuestion(model: SemanticModel, question: string): AskResult {
  const normalized = normalize(question);
  if (!normalized) {
    return { matched: false, question, message: "请先写下问题。" };
  }
  const found = findCase(model, normalized);
  if (!found) {
    return {
      matched: false,
      question,
      message: "当前只回答本项目已入库的教学问句。实时 Harness 未接入，不会调用火山方舟。",
    };
  }
  if (found.caseClass === "calculation_basis") {
    const receipt = getLeaveDays(model, found.id);
    return {
      matched: true,
      question: found.question,
      answer: found.expectedAnswer,
      receipt,
      message: "回执由规则计算工具生成，不是模型心算。",
    };
  }
  if (found.caseClass === "version_interference") {
    return {
      matched: true,
      question: found.question,
      answer: found.expectedAnswer,
      receipt: getLimit(model, found.id),
      trip: getTrip(model, found.id),
      message: "回执按业务发生时点的现行规则计算。已废止条文不会被当成依据。",
    };
  }
  return {
    matched: true,
    question: found.question,
    answer: found.expectedAnswer,
    message: "该问句绑定目录中的契约对象，不产生时长或限额回执。",
  };
}

/** 实时对话内核接入口。本切片禁止调用。 */
export function liveHarnessHook(): never {
  throw new Error("实时 Harness 未接入");
}

export function publishRelease(model: SemanticModel, approvedBy: string): ReleaseRecord {
  return releaseModel(model, approvedBy);
}

export function defaultRoots(repoRoot: string): string[] {
  return [join(repoRoot, "examples/hr-leave"), join(repoRoot, "examples/finance-expense")];
}

export function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

export function listExampleRoots(repoRoot: string): string[] {
  const examples = join(repoRoot, "examples");
  if (!isDirectory(examples)) return [];
  return readdirSync(examples)
    .map((name) => join(examples, name))
    .filter((path) => isDirectory(path));
}

function toCatalog(document: SemanticDocument): CatalogItem {
  return {
    kind: document.kind,
    id: document.metadata.id,
    name: document.metadata.name,
    ...(document.metadata.description ? { description: document.metadata.description } : {}),
  };
}

function toGraph(model: SemanticModel): { nodes: GraphNode[]; edges: GraphEdge[] } {
  const nodeKinds = new Set(["Entity", "Rule", "Policy", "Action", "Metric"]);
  const nodes = model.documents
    .filter((document) => nodeKinds.has(document.kind))
    .map((document) => ({ id: document.metadata.id, kind: document.kind, name: document.metadata.name }));
  const edges: GraphEdge[] = [];
  for (const relation of documentsOf(model, "Relation")) {
    const from = stringField(relation.spec, "from");
    const to = stringField(relation.spec, "to");
    if (from && to) edges.push({ from, to, label: relation.metadata.name });
  }
  return { nodes, edges };
}

function goalStatements(brief: SemanticDocument): string[] {
  const goals = Array.isArray(brief.spec.goals) ? brief.spec.goals : [];
  return goals.flatMap((goal) => {
    if (!isRecord(goal) || typeof goal.statement !== "string") return [];
    const id = typeof goal.id === "string" ? goal.id : "";
    return [`${id} ${goal.statement}`.trim()];
  });
}

function findCase(model: SemanticModel, normalized: string): {
  id: string;
  question: string;
  expectedAnswer: string;
  caseClass?: string;
} | undefined {
  for (const document of documentsOf(model, "EvalCase")) {
    const question = stringField(document.spec, "question") ?? "";
    if (normalize(question) !== normalized) continue;
    return {
      id: document.metadata.id,
      question,
      expectedAnswer: stringField(document.spec, "expectedAnswer") ?? "",
      caseClass: stringField(document.spec, "caseClass"),
    };
  }
  for (const pack of documentsOf(model, "CasePack")) {
    const cases = Array.isArray(pack.spec.cases) ? pack.spec.cases : [];
    for (const item of cases) {
      if (!isRecord(item) || typeof item.question !== "string") continue;
      if (normalize(item.question) !== normalized) continue;
      return {
        id: typeof item.id === "string" ? item.id : "",
        question: item.question,
        expectedAnswer: typeof item.expectedAnswer === "string" ? item.expectedAnswer : "",
        caseClass: typeof item.caseClass === "string" ? item.caseClass : undefined,
      };
    }
  }
  return undefined;
}

function normalize(value: string): string {
  return value.trim().replace(/\s+/g, "");
}
