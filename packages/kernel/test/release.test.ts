import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { ModelError, type SemanticDocument } from "../src/types.ts";
import { indexDocuments, loadModel, releaseModel, validateModel } from "../src/index.ts";

const hrDir = fileURLToPath(new URL("../../../examples/hr-leave", import.meta.url));
const financeDir = fileURLToPath(new URL("../../../examples/finance-expense", import.meta.url));

describe("未关闭缺口阻断发布", () => {
  it("打开的缺口不能发布", () => {
    const model = loadModel(hrDir);
    expect(() => releaseModel(model, "审核人")).toThrow(/未关闭的缺口阻断发布/);
    try {
      releaseModel(model, "审核人");
    } catch (error) {
      expect(error).toBeInstanceOf(ModelError);
      expect((error as ModelError).issues.every((item) => item.code === "release_blocked")).toBe(true);
    }
  });

  it("书面确认的本期范围可以发布，并写进发布记录", () => {
    const model = withGapAcceptance(loadModel(hrDir), {
      kind: "current_period",
      statement: "本期不把病假计入 remaining_leave_days",
    });
    const record = releaseModel(model, "审核人");
    expect(record.approvedBy).toBe("审核人");
    expect(record.contractVersion).toBe("semantic.platform/v1");
    expect(record.evalPassed).toBe(true);
    expect(record.namespaceVersions).toEqual([
      expect.objectContaining({
        id: "hr.leave",
        project: "fixture.teaching.leave",
        company: "fixture.teaching",
      }),
    ]);
    expect(record.acceptedScopes).toEqual([
      expect.objectContaining({
        gapId: "hr.leave.gap.001",
        itemId: "GAP-1",
        kind: "current_period",
        statement: "本期不把病假计入 remaining_leave_days",
      }),
    ]);
  });

  it("明确留给人的边界可以发布，并写进发布记录", () => {
    const model = withGapAcceptance(loadModel(hrDir), {
      kind: "left_for_humans",
      statement: "病假是否计入年假留给人事确认，不由本次发布决定",
    });
    const record = releaseModel(model, "审核人");
    expect(record.evalPassed).toBe(true);
    expect(record.acceptedScopes.map((scope) => scope.kind)).toEqual(["left_for_humans"]);
    expect(record.acceptedScopes[0]?.statement).toContain("留给人事确认");
  });

  it("只有警告或知悉时仍然阻断", () => {
    for (const notice of ["warning", "acknowledged"] as const) {
      const model = withGapNotice(loadModel(hrDir), notice);
      expect(() => releaseModel(model, "审核人")).toThrow(/仅有警告或知悉/);
    }
  });

  it("已澄清且未再声明范围的缺口不阻断报销发布", () => {
    const record = releaseModel(loadModel(financeDir), "财务负责人");
    expect(record.evalPassed).toBe(true);
    expect(record.acceptedScopes).toEqual([]);
    expect(record.namespaceVersions[0]).toMatchObject({
      id: "finance",
      company: "fixture.teaching",
      project: "fixture.teaching.expense",
    });
  });
});

describe("跨 Namespace", () => {
  it("拒绝跨 Namespace 引用，同一 Namespace 内的引用仍然通过", () => {
    const hr = loadModel(hrDir);
    expect(validateModel(hr).ok).toBe(true);
    const finance = loadModel(financeDir);
    const merged = indexDocuments([
      ...hr.documents,
      ...finance.documents.filter((document) => document.metadata.id !== "fixture.teaching"),
    ]);
    const policy = merged.byId.get("hr.leave.policy.working_day_basis");
    expect(policy).toBeDefined();
    const broken = {
      ...policy,
      spec: { ...policy?.spec, resources: ["finance.meal.2025"] },
    } as SemanticDocument;
    const next = indexDocuments(
      merged.documents.map((document) => (document.metadata.id === policy?.metadata.id ? broken : document)),
    );
    const report = validateModel(next);
    expect(report.ok).toBe(false);
    expect(report.issues.some((item) => item.code === "cross_namespace")).toBe(true);
  });
});

function withGapAcceptance(
  model: ReturnType<typeof loadModel>,
  acceptance: { kind: "current_period" | "left_for_humans"; statement: string },
) {
  return mapGapItem(model, (item) => ({ ...item, acceptance }));
}

function withGapNotice(model: ReturnType<typeof loadModel>, notice: "warning" | "acknowledged") {
  return mapGapItem(model, (item) => ({ ...item, notice }));
}

function mapGapItem(
  model: ReturnType<typeof loadModel>,
  mapItem: (item: Record<string, unknown>) => Record<string, unknown>,
) {
  return indexDocuments(
    model.documents.map((document) => {
      if (document.metadata.id !== "hr.leave.gap.001") return document;
      const items = Array.isArray(document.spec.items) ? document.spec.items : [];
      return {
        ...document,
        spec: {
          ...document.spec,
          items: items.map((item) => (item && typeof item === "object" ? mapItem(item as Record<string, unknown>) : item)),
        },
      };
    }),
  );
}
