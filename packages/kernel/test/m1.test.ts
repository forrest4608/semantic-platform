import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { validateDocumentSchema } from "@semantic/contract";
import { ModelError } from "../src/types.ts";
import {
  countByBasis,
  evaluateModel,
  getLeaveDays,
  getLimit,
  getTrip,
  indexDocuments,
  ingestEvalCase,
  judgeKnownFailure,
  loadModel,
  policyViolations,
  queryRuleVersion,
  quoteLimit,
  retrieveEvidence,
  validateModel,
  type SemanticModel,
} from "../src/index.ts";

const hrDir = fileURLToPath(new URL("../../../examples/hr-leave", import.meta.url));
const financeDir = fileURLToPath(new URL("../../../examples/finance-expense", import.meta.url));

describe("契约版本查询", () => {
  it("请假规则没有废止日，查询时返回现行和空的替代指针", () => {
    const version = queryRuleVersion(loadModel(hrDir), {
      ruleId: "hr.leave.rule.approval",
      subjectType: "全职员工",
      asOf: "2026-11-18",
    });
    expect(version.inForce).toBe(true);
    expect(version.status).toBe("in_force");
    expect(version.effectiveFrom).toBeNull();
    expect(version.supersededAt).toBeNull();
    expect(version.replaces).toBeNull();
    expect(version.replacedBy).toBeNull();
  });

  it("2025 版在生效日现行，2022 旧规已废止并指向替代版本", () => {
    const model = loadModel(financeDir);
    const current = queryRuleVersion(model, {
      ruleId: "finance.meal.2025",
      subjectType: "员工",
      asOf: "2025-01-01",
    });
    const old = queryRuleVersion(model, {
      ruleId: "finance.meal.2022",
      subjectType: "员工",
      asOf: "2025-01-01",
    });
    expect(current.inForce).toBe(true);
    expect(current.replaces).toBe("finance.meal.2022");
    expect(current.replacedBy).toBeNull();
    expect(old.inForce).toBe(false);
    expect(old.status).toBe("superseded");
    expect(old.supersededAt).toBe("2025-01-01");
    expect(old.replacedBy).toBe("finance.meal.2025");
  });

  it("生效日之前，新旧状态对调", () => {
    const model = loadModel(financeDir);
    expect(
      queryRuleVersion(model, { ruleId: "finance.meal.2025", subjectType: "员工", asOf: "2024-12-31" }).status,
    ).toBe("not_yet_effective");
    expect(
      queryRuleVersion(model, { ruleId: "finance.meal.2022", subjectType: "员工", asOf: "2024-12-31" }).inForce,
    ).toBe(true);
  });
});

describe("规则计算回执", () => {
  it("周五至下周一按工作日计为 2 天，不需人事审批，余额 8 天", () => {
    const receipt = getLeaveDays(loadModel(hrDir), "eval_hr_001");
    expect(receipt.countedDays).toBe(2);
    expect(receipt.excludedDayLabels).toEqual(["周六", "周日"]);
    expect(receipt.requiresHrApproval).toBe(false);
    expect(receipt.remainingLeaveDays).toBe(8);
    expect(receipt.citation).toBe("《请假管理办法》第 5 条");
    expect(receipt.basis).toBe("working_day");
    expect(receipt.inForce).toBe(true);
    expect(receipt.tool).toBe("get_leave_days");
  });

  it("周三至周五按自然日计为 3 天，可报 300，自理 120", () => {
    const model = loadModel(financeDir);
    const trip = getTrip(model, "eval_exp_001");
    expect(trip.employeeName).toBe("李四");
    expect(trip.destination).toBe("北京");
    expect(trip.spanLabel).toBe("周三至周五");
    expect(trip.departureIncluded).toBe(true);
    expect(trip.returnIncluded).toBe(true);

    const receipt = getLimit(model, "eval_exp_001");
    expect(receipt.countedDays).toBe(3);
    expect(receipt.unitAmount).toBe(100);
    expect(receipt.cap).toBe(300);
    expect(receipt.invoiceAmount).toBe(420);
    expect(receipt.reimbursable).toBe(300);
    expect(receipt.selfPay).toBe(120);
    expect(receipt.citation).toBe("《差旅报销管理办法》2025 版第 7 条");
    expect(receipt.ruleId).toBe("finance.meal.2025");
  });

  it("已废止的 150 元规则不能拿来计算", () => {
    const model = loadModel(financeDir);
    expect(() =>
      quoteLimit(model, {
        ruleId: "finance.meal.2022",
        asOf: "2025-01-01",
        subjectType: "员工",
        spanLabel: "周三至周五",
        days: [
          { label: "周三", kind: "working_day" },
          { label: "周四", kind: "working_day" },
          { label: "周五", kind: "working_day" },
        ],
        personCount: 1,
        invoiceAmount: 420,
        departureIncluded: true,
        returnIncluded: true,
      }),
    ).toThrow(ModelError);
    try {
      quoteLimit(model, {
        ruleId: "finance.meal.2022",
        asOf: "2025-01-01",
        subjectType: "员工",
        spanLabel: "周三至周五",
        days: [{ label: "周三", kind: "working_day" }],
        personCount: 1,
        invoiceAmount: 420,
        departureIncluded: true,
        returnIncluded: true,
      });
    } catch (error) {
      expect(error).toBeInstanceOf(ModelError);
      const message = error instanceof Error ? error.message : "";
      expect(message).not.toContain("450");
      expect(message).not.toContain("可报 420");
      expect((error as ModelError).issues.some((item) => item.code === "rule_not_in_force")).toBe(true);
    }
  });

  it("工作日不计周末和法定节假日，自然日全计", () => {
    const days = [
      { label: "周五", kind: "working_day" as const },
      { label: "周六", kind: "weekend" as const },
      { label: "假日", kind: "holiday" as const },
    ];
    expect(countByBasis("working_day", days)).toEqual({ countedDays: 1, excludedDayLabels: ["周六", "假日"] });
    expect(countByBasis("calendar_day", days).countedDays).toBe(3);
  });
});

describe("证据检索", () => {
  it("餐费同时召回现行 100 和已废止 150，并标出现行状态", () => {
    const hits = retrieveEvidence(loadModel(financeDir), {
      query: "餐费",
      asOf: "2025-01-01",
      subjectType: "员工",
    });
    expect(hits.map((hit) => hit.ruleId).sort()).toEqual(["finance.meal.2022", "finance.meal.2025"]);
    expect(hits.find((hit) => hit.ruleId === "finance.meal.2025")?.inForce).toBe(true);
    expect(hits.find((hit) => hit.ruleId === "finance.meal.2022")?.inForce).toBe(false);
    expect(hits.find((hit) => hit.ruleId === "finance.meal.2022")?.excerpt).toContain("150");
  });

  it("请假条文标为现行", () => {
    const hits = retrieveEvidence(loadModel(hrDir), {
      query: "请假管理办法",
      asOf: "2026-11-18",
      subjectType: "全职员工",
    });
    expect(hits).toHaveLength(1);
    expect(hits[0]?.citation).toBe("《请假管理办法》第 5 条");
    expect(hits[0]?.inForce).toBe(true);
  });
});

describe("教学用例门禁", () => {
  it("eval_hr_001 通过，把 4 个自然日误判为需审批的轨迹失败", () => {
    const model = loadModel(hrDir);
    const report = evaluateModel(model);
    const result = report.results.find((item) => item.caseId === "eval_hr_001");
    expect(result?.passed).toBe(true);
    expect(result?.releaseGate).toMatchObject({
      basisCorrect: true,
      versionCorrect: true,
      citationCorrect: true,
      receiptComplete: true,
      passed: true,
    });
    const failure = result?.releaseGate?.knownFailures[0];
    expect(failure?.description).toBe("按自然日算成 4 天并误触发人事审批");
    expect(failure?.passed).toBe(false);
    expect(failure?.basisCorrect).toBe(false);
    expect(failure?.receiptComplete).toBe(false);
  });

  it("eval_exp_001 通过，选用 150 的轨迹失败", () => {
    const model = loadModel(financeDir);
    expect(validateModel(model).ok).toBe(true);
    const report = evaluateModel(model);
    expect(report.ok).toBe(true);
    const result = report.results.find((item) => item.caseId === "eval_exp_001");
    expect(result?.releaseGate?.passed).toBe(true);
    const spec = model.byId.get("eval_exp_001")?.spec;
    expect(spec).toBeDefined();
    const raw = Array.isArray(spec?.knownFailures) ? spec.knownFailures[0] : undefined;
    expect(raw && typeof raw === "object" ? judgeKnownFailure(model, spec ?? {}, raw as Record<string, unknown>).passed : true).toBe(
      false,
    );
    expect(result?.releaseGate?.knownFailures[0]).toMatchObject({
      description: "检索到 100 与 150 后选用 150",
      passed: false,
      versionCorrect: false,
    });
  });

  it("schema 允许的完整正确轨迹会让已知失败检查失败", () => {
    const hr = loadModel(hrDir);
    const leaveTrace = {
      basis: "working_day",
      ruleId: "hr.leave.rule.approval",
      citation: "《请假管理办法》第 5 条",
      countedDays: 2,
      requiresHrApproval: false,
      remainingLeaveDays: 8,
      thresholdValue: 3,
      inForce: true,
      receiptComplete: true,
      inputSpan: "周五至下周一",
      effectiveFrom: null,
      supersededAt: null,
      replaces: null,
      replacedBy: null,
    };
    const leaveDoc = withKnownFailure(hr, "eval_hr_001", leaveTrace);
    expect(validateDocumentSchema("EvalCase", leaveDoc).ok).toBe(true);
    const leaveReport = evaluateModel(indexDocuments(hr.documents.map((document) => (
      document.metadata.id === "eval_hr_001" ? leaveDoc : document
    ))));
    const leave = leaveReport.results.find((item) => item.caseId === "eval_hr_001");
    expect(leave?.releaseGate?.knownFailures[0]?.passed).toBe(true);
    expect(leave?.releaseGate?.knownFailures[0]?.receiptComplete).toBe(true);
    expect(leave?.passed).toBe(false);
    expect(leave?.notes.join("")).toContain("未被拦截");

    const finance = loadModel(financeDir);
    const expenseTrace = {
      basis: "calendar_day",
      ruleId: "finance.meal.2025",
      citation: "《差旅报销管理办法》2025 版第 7 条",
      countedDays: 3,
      unitAmount: 100,
      cap: 300,
      invoiceAmount: 420,
      reimbursable: 300,
      selfPay: 120,
      inForce: true,
      receiptComplete: true,
      inputSpan: "周三至周五",
      effectiveFrom: "2025-01-01",
      supersededAt: null,
      replaces: "finance.meal.2022",
      replacedBy: null,
    };
    const expenseDoc = withKnownFailure(finance, "eval_exp_001", expenseTrace);
    expect(validateDocumentSchema("EvalCase", expenseDoc).ok).toBe(true);
    const expenseReport = evaluateModel(indexDocuments(finance.documents.map((document) => (
      document.metadata.id === "eval_exp_001" ? expenseDoc : document
    ))));
    const expense = expenseReport.results.find((item) => item.caseId === "eval_exp_001");
    expect(expense?.releaseGate?.knownFailures[0]?.passed).toBe(true);
    expect(expense?.passed).toBe(false);
    expect(expense?.notes.join("")).toContain("未被拦截");
  });
});

function withKnownFailure(model: SemanticModel, caseId: string, trace: Record<string, unknown>) {
  const document = model.byId.get(caseId);
  if (!document) throw new Error(caseId);
  return {
    ...document,
    spec: {
      ...document.spec,
      knownFailures: [
        {
          id: "control_complete_receipt",
          description: "完整且正确的回执不应被当成失败",
          trace,
        },
      ],
    },
  };
}

describe("公司、项目、场景", () => {
  it("教学用例挂在教学夹具公司下的各自项目，而不是悬空的域", () => {
    const leave = loadModel(hrDir);
    const expense = loadModel(financeDir);
    expect(leave.byId.get("fixture.teaching")?.kind).toBe("Company");
    expect(leave.byId.get("fixture.teaching")?.metadata.name).toBe("教学夹具公司");
    expect(expense.byId.get("fixture.teaching")?.metadata.name).toBe("教学夹具公司");
    expect(leave.byId.get("fixture.teaching.leave")).toMatchObject({
      kind: "Project",
      spec: { company: "fixture.teaching" },
    });
    expect(expense.byId.get("fixture.teaching.expense")).toMatchObject({
      kind: "Project",
      spec: { company: "fixture.teaching" },
    });
    expect(leave.byId.get("hr.leave")?.spec.project).toBe("fixture.teaching.leave");
    expect(expense.byId.get("finance")?.spec.project).toBe("fixture.teaching.expense");
    expect(leave.byId.get("hr.leave.brief.approval")?.spec.project).toBe("fixture.teaching.leave");
    expect(expense.byId.get("finance.brief.meal")?.spec.project).toBe("fixture.teaching.expense");
    expect(validateModel(leave).ok).toBe(true);
    expect(validateModel(expense).ok).toBe(true);
  });

  it("场景不能挂到另一个项目", () => {
    const model = loadModel(hrDir);
    const next = indexDocuments(
      model.documents.map((document) =>
        document.metadata.id === "hr.leave.brief.approval"
          ? { ...document, spec: { ...document.spec, project: "fixture.teaching" } }
          : document,
      ),
    );
    const report = validateModel(next);
    expect(report.ok).toBe(false);
    expect(report.issues.some((item) => item.code === "missing_project" || item.code === "project_mismatch")).toBe(
      true,
    );
  });
});

describe("策略与人授权分开", () => {
  it("请假规则只保留门槛，人事审批由 Policy 决定", () => {
    const model = loadModel(hrDir);
    const rule = model.byId.get("hr.leave.rule.approval");
    expect(rule?.metadata.name).toBe("请假时长按工作日计，门槛 3 个工作日");
    expect(rule?.metadata.name).not.toContain("须人事审批");
    expect(getLeaveDays(model, "eval_hr_001")).toMatchObject({
      thresholdValue: 3,
      thresholdExceeded: false,
      requiresHrApproval: false,
    });
    const stripped = indexDocuments(
      model.documents.filter((document) => document.metadata.id !== "hr.leave.policy.hr_approval"),
    );
    expect(() => getLeaveDays(stripped, "eval_hr_001")).toThrow(/Policy/);

    expect(policyViolations(model, "hr.leave.rule.approval", {
      basis: "calendar_day",
      countedDays: 4,
      requiresHrApproval: true,
    })).toContain("forbid_basis");
    expect(policyViolations(model, "hr.leave.rule.approval", {
      basis: "working_day",
      countedDays: 2,
      requiresHrApproval: true,
    })).toContain("approval");
    expect(policyViolations(model, "hr.leave.rule.approval", {
      basis: "working_day",
      countedDays: 4,
      requiresHrApproval: false,
    })).toContain("approval");
    expect(policyViolations(model, "hr.leave.rule.approval", {
      basis: "working_day",
      countedDays: 2,
      requiresHrApproval: false,
    })).toEqual([]);
  });

  it("写回钩子仍要人确认，但未超门槛时不把 hr_admin 当成必经角色", () => {
    const model = loadModel(hrDir);
    const action = model.byId.get("hr.leave.ApproveLeave");
    expect(action?.spec.approval).toMatchObject({ required: true, approverRoles: ["manager"] });
    const finance = loadModel(financeDir);
    expect(finance.byId.get("finance.SubmitExpense")?.spec.approval).toMatchObject({
      required: true,
      approverRoles: ["finance"],
    });
    expect(
      policyViolations(
        finance,
        "finance.meal.2025",
        { ruleId: "finance.meal.2022" },
        { asOf: "2025-01-01", subjectType: "员工" },
      ),
    ).toContain("forbid_superseded");
    expect(
      policyViolations(
        finance,
        "finance.meal.2025",
        { ruleId: "finance.meal.2022" },
        { asOf: "2024-12-31", subjectType: "员工" },
      ),
    ).not.toContain("forbid_superseded");
    expect(
      policyViolations(
        finance,
        "finance.meal.2025",
        { ruleId: "finance.meal.2022", unitAmount: 150, countedDays: 3, reimbursable: 420, personCount: 1 },
        { asOf: "2024-12-31", subjectType: "员工" },
      ),
    ).not.toContain("above_cap");
    expect(
      policyViolations(
        finance,
        "finance.meal.2025",
        { ruleId: "finance.meal.2025", unitAmount: 100, countedDays: 3, reimbursable: 420, personCount: 1 },
        { asOf: "2025-01-01", subjectType: "员工" },
      ),
    ).toContain("above_cap");
    expect(
      quoteLimit(finance, {
        ruleId: "finance.meal.2022",
        asOf: "2024-12-31",
        subjectType: "员工",
        spanLabel: "周三至周五",
        days: [
          { label: "周三", kind: "working_day" },
          { label: "周四", kind: "working_day" },
          { label: "周五", kind: "working_day" },
        ],
        personCount: 1,
        invoiceAmount: 420,
        departureIncluded: true,
        returnIncluded: true,
      }).unitAmount,
    ).toBe(150);
    expect(policyViolations(finance, "finance.meal.2025", { ruleId: "finance.meal.2025" })).toEqual([]);
    expect(validateModel(model).ok).toBe(true);
    expect(validateModel(finance).ok).toBe(true);
  });
});

describe("评测用例入库", () => {
  it("可以重新入库口径对照用例，重复 id 被拒绝", () => {
    const model = loadModel(hrDir);
    const document = model.byId.get("eval_hr_001");
    expect(document).toBeDefined();
    const without = indexDocuments(model.documents.filter((item) => item.metadata.id !== "eval_hr_001"));
    const ingested = ingestEvalCase(without, document);
    expect(ingested.byId.has("eval_hr_001")).toBe(true);
    expect(evaluateModel(ingested).results.find((item) => item.caseId === "eval_hr_001")?.passed).toBe(true);
    expect(() => ingestEvalCase(ingested, document)).toThrow(/已存在/);
  });

  it("没有门禁类别的用例不能从入库接口进入", () => {
    const model = loadModel(hrDir);
    expect(() =>
      ingestEvalCase(model, {
        apiVersion: "semantic.platform/v1",
        kind: "EvalCase",
        metadata: { id: "eval_hr_draft", name: "草稿", namespace: "hr.leave" },
        spec: {
          question: "还有几天？",
          expectedAnswer: "看指标。",
          expectedObjects: ["hr.leave.Employee"],
          golden: false,
        },
      }),
    ).toThrow(/口径对照或版本干扰/);
  });
});
