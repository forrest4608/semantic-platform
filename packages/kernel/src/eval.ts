/**
 * 黄金用例打分（占位）。
 * 只检查问句、期望答案，以及 expectedObjects 是否仍在契约中。
 * 不连接查询引擎，也不生成自然语言回答。
 */
import { documentsOf, isRecord, stringField, stringList } from "./model.ts";
import type { SemanticModel } from "./types.ts";

export interface EvalCaseScore {
  caseId: string;
  packId?: string;
  question: string;
  golden: boolean;
  skipped: boolean;
  passed: boolean;
  score: number;
  notes: string[];
}

export interface EvalReport {
  ok: boolean;
  results: EvalCaseScore[];
  passed: number;
  failed: number;
  skipped: number;
  meanScore: number;
}

interface RawCase {
  id: string;
  question: string;
  expectedAnswer: string;
  expectedObjects: string[];
  golden: boolean;
  packId?: string;
}

export function evaluateModel(model: SemanticModel): EvalReport {
  const cases = collectCases(model);
  const results = cases.map((item) => scoreCase(model, item));
  const scored = results.filter((item) => !item.skipped);
  const passed = scored.filter((item) => item.passed).length;
  const failed = scored.length - passed;
  const skipped = results.length - scored.length;
  const meanScore =
    scored.length === 0 ? 0 : scored.reduce((sum, item) => sum + item.score, 0) / scored.length;
  return {
    ok: failed === 0,
    results,
    passed,
    failed,
    skipped,
    meanScore,
  };
}

function collectCases(model: SemanticModel): RawCase[] {
  const cases: RawCase[] = [];
  for (const pack of documentsOf(model, "CasePack")) {
    const items = Array.isArray(pack.spec.cases) ? pack.spec.cases : [];
    for (const item of items) {
      if (!isRecord(item)) continue;
      cases.push({
        id: typeof item.id === "string" ? item.id : "",
        question: typeof item.question === "string" ? item.question : "",
        expectedAnswer: typeof item.expectedAnswer === "string" ? item.expectedAnswer : "",
        expectedObjects: stringList(item.expectedObjects),
        golden: item.golden === true,
        packId: pack.metadata.id,
      });
    }
  }
  for (const document of documentsOf(model, "EvalCase")) {
    cases.push({
      id: document.metadata.id,
      question: stringField(document.spec, "question") ?? "",
      expectedAnswer: stringField(document.spec, "expectedAnswer") ?? "",
      expectedObjects: stringList(document.spec.expectedObjects),
      golden: document.spec.golden === true,
    });
  }
  return cases;
}

function scoreCase(model: SemanticModel, item: RawCase): EvalCaseScore {
  if (!item.golden) {
    return {
      caseId: item.id,
      packId: item.packId,
      question: item.question,
      golden: false,
      skipped: true,
      passed: false,
      score: 0,
      notes: ["非黄金用例，已跳过"],
    };
  }

  const notes: string[] = [];
  let checks = 0;
  let hits = 0;

  checks += 1;
  if (item.question.trim().length > 0) hits += 1;
  else notes.push("问题为空");

  checks += 1;
  if (item.expectedAnswer.trim().length > 0) hits += 1;
  else notes.push("期望答案为空");

  if (item.expectedObjects.length === 0) {
    checks += 1;
    notes.push("没有绑定契约对象");
  }
  for (const objectId of item.expectedObjects) {
    checks += 1;
    if (model.byId.has(objectId)) hits += 1;
    else notes.push(`契约中不存在 ${objectId}`);
  }

  const score = checks === 0 ? 0 : hits / checks;
  return {
    caseId: item.id,
    packId: item.packId,
    question: item.question,
    golden: true,
    skipped: false,
    passed: notes.length === 0,
    score,
    notes,
  };
}
