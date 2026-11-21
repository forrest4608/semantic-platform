/**
 * 从模型里取出评测用例。独立 EvalCase 与 CasePack 里的条目都认。
 */
import { documentsOf, isRecord, stringField } from "./model.ts";
import { ModelError, type SemanticModel } from "./types.ts";

export type CaseClass = "calculation_basis" | "version_interference";

export interface LoadedCase {
  id: string;
  spec: Record<string, unknown>;
}

export function loadCase(model: SemanticModel, caseId: string): LoadedCase {
  const trimmed = caseId.trim();
  if (!trimmed) throw new ModelError("评测用例 id 不能为空");
  const document = model.byId.get(trimmed);
  if (document?.kind === "EvalCase") return { id: document.metadata.id, spec: document.spec };
  for (const pack of documentsOf(model, "CasePack")) {
    const cases = Array.isArray(pack.spec.cases) ? pack.spec.cases : [];
    for (const item of cases) {
      if (isRecord(item) && item.id === trimmed) return { id: trimmed, spec: item };
    }
  }
  throw new ModelError(`找不到评测用例：${trimmed}`, [
    { level: "error", code: "not_found", path: trimmed, message: `找不到评测用例：${trimmed}` },
  ]);
}

export function requireClass(spec: Record<string, unknown>, expected: CaseClass, caseId: string): void {
  if (spec.caseClass !== expected) {
    throw new ModelError(`用例 ${caseId} 与工具不匹配`);
  }
}

export interface DayMark {
  label: string;
  kind: "working_day" | "weekend" | "holiday";
}

export function readFacts(spec: Record<string, unknown>): Record<string, unknown> {
  if (!isRecord(spec.facts)) throw new ModelError("用例缺少事实");
  return spec.facts;
}

export function readDays(facts: Record<string, unknown>): DayMark[] {
  if (!Array.isArray(facts.days) || facts.days.length === 0) throw new ModelError("用例缺少日历");
  return facts.days.map((day) => {
    if (!isRecord(day) || typeof day.label !== "string" || day.label.length === 0) {
      throw new ModelError("日历日不完整");
    }
    if (day.kind !== "working_day" && day.kind !== "weekend" && day.kind !== "holiday") {
      throw new ModelError(`日历日种类无法识别：${String(day.kind)}`);
    }
    return { label: day.label, kind: day.kind };
  });
}

export function requireText(record: Record<string, unknown>, key: string, label: string): string {
  const value = stringField(record, key);
  if (!value || value.trim().length === 0) throw new ModelError(`缺少${label}`);
  return value;
}
