import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { validateDocumentSchema } from "@semantic/contract";
import {
  MetricFlowCompiler,
  ModelError,
  SnowflakeSemanticViewCompiler,
  StubOsiExporter,
  applyPatch,
  canonical,
  diffModels,
  evaluateModel,
  indexDocuments,
  loadModel,
  validateModel,
  type SemanticDocument,
} from "../src/index.ts";

const exampleDir = fileURLToPath(new URL("../../../examples/hr-leave", import.meta.url));
const temps: string[] = [];

afterEach(() => {
  for (const dir of temps.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe("示例模型", () => {
  it("能加载并通过引用校验", () => {
    const model = loadModel(exampleDir);
    expect(model.documents.length).toBeGreaterThanOrEqual(11);
    expect(model.byId.get("hr.leave.remaining_leave_days")?.kind).toBe("Metric");
    const report = validateModel(model);
    expect(report.issues).toEqual([]);
    expect(report.ok).toBe(true);
  });

  it("三则黄金用例全部通过", () => {
    const report = evaluateModel(loadModel(exampleDir));
    expect(report.passed).toBe(3);
    expect(report.failed).toBe(0);
    expect(report.ok).toBe(true);
    expect(report.meanScore).toBe(1);
  });
});

describe("schema", () => {
  it("接受独立的 EvalCase 文档", () => {
    const result = validateDocumentSchema("EvalCase", {
      apiVersion: "semantic.platform/v1",
      kind: "EvalCase",
      metadata: {
        id: "hr.leave.eval.EC-9",
        name: "草稿用例",
        namespace: "hr.leave",
      },
      spec: {
        question: "还有没有待确认的口径？",
        expectedAnswer: "查看 GapLog。",
        expectedObjects: ["hr.leave.gap.001"],
        golden: false,
      },
    });
    expect(result.ok).toBe(true);
  });

  it("拒绝多余字段", () => {
    const result = validateDocumentSchema("Entity", {
      apiVersion: "semantic.platform/v1",
      kind: "Entity",
      metadata: { id: "hr.leave.Employee", name: "Employee", namespace: "hr.leave" },
      spec: { primaryKey: ["employee_id"], attributes: [{ name: "employee_id", type: "string" }] },
      extra: true,
    });
    expect(result.ok).toBe(false);
  });

  it("拒绝未知的缺口种类", () => {
    const dir = tempModel({
      "gap.yaml": `apiVersion: semantic.platform/v1
kind: GapLog
metadata:
  id: hr.leave.gap.bad
  name: bad
  namespace: hr.leave
spec:
  items:
    - id: GAP-9
      kind: mystery
      description: 不在枚举内
      status: open
`,
    });
    expect(() => loadModel(dir)).toThrow(ModelError);
  });
});

describe("引用校验", () => {
  it("关系指向不存在的实体时失败", () => {
    const model = loadModel(exampleDir);
    const broken = indexDocuments(
      model.documents.map((document) => {
        if (document.kind !== "Relation") return document;
        return {
          ...document,
          spec: { ...document.spec, to: "hr.leave.Missing" },
        };
      }),
    );
    const report = validateModel(broken);
    expect(report.ok).toBe(false);
    expect(report.issues.some((item) => item.code === "missing_entity")).toBe(true);
  });
});

describe("diff 与 patch", () => {
  it("相同模型的 diff 为空，应用后保持不变", () => {
    const model = loadModel(exampleDir);
    const patch = diffModels(model, model);
    expect(patch.operations).toEqual([]);
    const next = applyPatch(model, patch);
    expect(canonical(next.documents)).toBe(canonical(model.documents));
  });

  it("能发现新增、删除和替换，并且往返后与目标一致", () => {
    const base = loadModel(exampleDir);
    const headDocs = base.documents.flatMap((document) => {
      if (document.metadata.id === "hr.leave.policy.self_read") return [];
      if (document.metadata.id === "hr.leave.remaining_leave_days") {
        return [{ ...document, metadata: { ...document.metadata, description: "口径更新" } }];
      }
      return [document];
    });
    headDocs.push(extraMetric());
    const head = indexDocuments(headDocs);
    const patch = diffModels(base, head);
    const ops = patch.operations.map((operation) => `${operation.op}:${operation.id}`);
    expect(ops).toContain("remove:hr.leave.policy.self_read");
    expect(ops).toContain("replace:hr.leave.remaining_leave_days");
    expect(ops).toContain("add:hr.leave.pending_request_count");

    const applied = applyPatch(base, patch);
    expect(canonical(applied.documents)).toBe(canonical(head.documents));
    expect(validateModel(applied).ok).toBe(true);
  });

  it("新增已存在对象时拒绝", () => {
    const model = loadModel(exampleDir);
    const metric = model.byId.get("hr.leave.remaining_leave_days");
    expect(metric).toBeDefined();
    expect(() =>
      applyPatch(model, {
        apiVersion: "semantic.platform/v1",
        kind: "ModelPatch",
        operations: [
          {
            op: "add",
            targetKind: "Metric",
            id: "hr.leave.remaining_leave_days",
            document: metric,
          },
        ],
      }),
    ).toThrow(/已存在/);
  });

  it("删除不存在对象时拒绝", () => {
    const model = loadModel(exampleDir);
    expect(() =>
      applyPatch(model, {
        apiVersion: "semantic.platform/v1",
        kind: "ModelPatch",
        operations: [{ op: "remove", targetKind: "Metric", id: "hr.leave.missing" }],
      }),
    ).toThrow(/不存在/);
  });
});

describe("评测占位打分", () => {
  it("引用丢失的黄金用例失败", () => {
    const model = loadModel(exampleDir);
    const pack = model.byId.get("hr.leave.casepack.v1");
    expect(pack).toBeDefined();
    const cases = Array.isArray(pack?.spec.cases) ? [...pack.spec.cases] : [];
    cases.push({
      id: "EC-9",
      question: "不存在的指标是多少？",
      expectedAnswer: "不应该通过。",
      expectedObjects: ["hr.leave.not_a_metric"],
      golden: true,
    });
    const next = indexDocuments(
      model.documents.map((document) =>
        document.metadata.id === pack?.metadata.id ? { ...document, spec: { ...document.spec, cases } } : document,
      ),
    );
    const report = evaluateModel(next);
    expect(report.ok).toBe(false);
    expect(report.failed).toBe(1);
    expect(report.results.find((item) => item.caseId === "EC-9")?.notes.join(" ")).toContain("不存在");
  });

  it("非黄金用例被跳过", () => {
    const model = loadModel(exampleDir);
    const pack = model.byId.get("hr.leave.casepack.v1");
    const cases = (pack?.spec.cases as unknown[]).map((item, index) =>
      index === 0 && item && typeof item === "object" ? { ...item, golden: false } : item,
    );
    const next = indexDocuments(
      model.documents.map((document) =>
        document.metadata.id === pack?.metadata.id ? { ...document, spec: { ...document.spec, cases } } : document,
      ),
    );
    const report = evaluateModel(next);
    expect(report.skipped).toBe(1);
    expect(report.passed).toBe(2);
    expect(report.ok).toBe(true);
  });
});

describe("导出与编译占位", () => {
  it("OSI 导出标记为 stub，并带上超集扩展", () => {
    const exported = new StubOsiExporter().exportModel(loadModel(exampleDir));
    expect(exported.status).toBe("stub");
    expect(exported.osiVersion).toBe("unspecified");
    expect(exported.semanticModels[0]?.metrics.map((metric) => metric.name)).toContain("remaining_leave_days");
    expect(exported.extensions.actions).toContain("hr.leave.ApproveLeave");
    expect(exported.extensions.evalCases).toEqual(expect.arrayContaining(["EC-1", "EC-2", "EC-3"]));
  });

  it("MetricFlow 与 Snowflake 编译器都只返回占位", () => {
    const model = loadModel(exampleDir);
    for (const compiler of [new MetricFlowCompiler(), new SnowflakeSemanticViewCompiler()]) {
      const artifact = compiler.compile(model);
      expect(artifact.status).toBe("stub");
      expect(artifact.metrics.map((metric) => metric.name)).toContain("remaining_leave_days");
    }
  });
});

function extraMetric(): SemanticDocument {
  return {
    apiVersion: "semantic.platform/v1",
    kind: "Metric",
    metadata: {
      id: "hr.leave.pending_request_count",
      name: "pending_request_count",
      namespace: "hr.leave",
      description: "待审批申请数",
    },
    spec: {
      entity: "hr.leave.LeaveRequest",
      expression: "count(status = 'pending')",
      aggregation: "count",
      unit: "count",
    },
  };
}

function tempModel(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), "semantic-model-"));
  temps.push(dir);
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name);
    mkdirSync(join(full, ".."), { recursive: true });
    writeFileSync(full, content, "utf8");
  }
  return dir;
}
