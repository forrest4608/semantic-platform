/**
 * 证据检索。命中某一主题后，该主题的现行文和已废止文都返回。
 * 每条结果标明查询时点是否现行。已废止文可以出现，但不能当成计算依据。
 */
import { documentsOf, isRecord, stringField } from "./model.ts";
import type { SemanticModel } from "./types.ts";
import { ModelError } from "./types.ts";
import { evidenceBlob, queryRuleVersion, type VersionStatus } from "./version.ts";

export interface EvidenceQuery {
  query: string;
  asOf: string;
  subjectType: string;
}

export interface EvidenceHit {
  ruleId: string;
  title: string;
  excerpt: string;
  citation: string;
  inForce: boolean;
  status: VersionStatus;
  effectiveFrom: string | null;
  supersededAt: string | null;
  replaces: string | null;
  replacedBy: string | null;
}

export function retrieveEvidence(model: SemanticModel, input: EvidenceQuery): EvidenceHit[] {
  const query = input.query.trim();
  if (!query) throw new ModelError("检索词不能为空");
  const topics = new Set<string>();
  for (const rule of documentsOf(model, "Rule")) {
    if (!evidenceBlob(rule).includes(query)) continue;
    const topic = stringField(rule.spec, "topic");
    if (topic) topics.add(topic);
  }
  const hits: EvidenceHit[] = [];
  for (const rule of documentsOf(model, "Rule")) {
    const topic = stringField(rule.spec, "topic");
    if (!topic || !topics.has(topic)) continue;
    const version = queryRuleVersion(model, {
      ruleId: rule.metadata.id,
      subjectType: input.subjectType,
      asOf: input.asOf,
    });
    const evidence = isRecord(rule.spec.evidence) ? rule.spec.evidence : {};
    hits.push({
      ruleId: rule.metadata.id,
      title: stringField(evidence, "title") ?? "",
      excerpt: stringField(evidence, "excerpt") ?? "",
      citation: stringField(rule.spec, "citation") ?? "",
      inForce: version.inForce,
      status: version.status,
      effectiveFrom: version.effectiveFrom,
      supersededAt: version.supersededAt,
      replaces: version.replaces,
      replacedBy: version.replacedBy,
    });
  }
  hits.sort((left, right) => left.ruleId.localeCompare(right.ruleId));
  return hits;
}
