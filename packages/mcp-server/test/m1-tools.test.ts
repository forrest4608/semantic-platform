import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { READ_TOOL_NAMES, WRITE_TOOL_NAMES, canonical, loadModel } from "@semantic/kernel";
import { createServer } from "../src/server.ts";
import { approveLeave, readEvidence, readLeaveDays, readLimit, rejectEvalIngest, submitExpense } from "../src/tools.ts";

function toolText(result: unknown): string {
  if (!result || typeof result !== "object" || !("content" in result)) return "";
  const content = (result as { content?: Array<{ text?: string }> }).content ?? [];
  return content.map((item) => item.text ?? "").join("\n");
}

const hrDir = fileURLToPath(new URL("../../../examples/hr-leave", import.meta.url));
const financeDir = fileURLToPath(new URL("../../../examples/finance-expense", import.meta.url));

describe("默认运行时只读", () => {
  it("不注册写工具", async () => {
    const server = createServer({ model: loadModel(hrDir) });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientTransport);
    const listed = await client.listTools();
    const names = listed.tools.map((tool) => tool.name).sort();
    expect(names).toEqual([...READ_TOOL_NAMES].sort());
    for (const name of WRITE_TOOL_NAMES) expect(names).not.toContain(name);
    await client.close();
    await server.close();
  });

  it("读工具能查版本、请假回执和证据", async () => {
    const server = createServer({ model: loadModel(hrDir) });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientTransport);
    const version = await client.callTool({
      name: "query_rule_version",
      arguments: { ruleId: "hr.leave.rule.approval", subjectType: "全职员工", asOf: "2026-11-18" },
    });
    expect(toolText(version)).toContain('"inForce": true');
    const days = await client.callTool({ name: "get_leave_days", arguments: { caseId: "eval_hr_001" } });
    expect(toolText(days)).toContain('"countedDays": 2');
    expect(toolText(days)).toContain("《请假管理办法》第 5 条");
    await client.close();
    await server.close();
  });
});

describe("报销读工具", () => {
  it("限额回执是 300 和 120，旧文标成非现行", () => {
    const model = loadModel(financeDir);
    const limit = readLimit(model, "eval_exp_001");
    expect(limit.ok).toBe(true);
    if (limit.ok) {
      expect(limit.data.reimbursable).toBe(300);
      expect(limit.data.selfPay).toBe(120);
      expect(limit.data.unitAmount).toBe(100);
    }
    const evidence = readEvidence(model, "餐费", "2025-01-01", "员工");
    expect(evidence.ok).toBe(true);
    if (evidence.ok) {
      expect(evidence.data.find((hit) => hit.ruleId === "finance.meal.2022")?.inForce).toBe(false);
      expect(evidence.data.find((hit) => hit.ruleId === "finance.meal.2025")?.inForce).toBe(true);
    }
    const leave = readLeaveDays(loadModel(hrDir), "eval_hr_001");
    expect(leave.ok && leave.data.requiresHrApproval).toBe(false);
  });
});

describe("写工具停在审批门后", () => {
  it("未审批不执行，审批角色核对后仍然不写模型", () => {
    const model = loadModel(hrDir);
    const before = canonical(model.documents);
    const blocked = approveLeave(model, "hr.leave.ApproveLeave");
    expect(blocked.ok).toBe(false);
    expect(blocked.error.code).toBe("approval_required");
    const held = approveLeave(model, "hr.leave.ApproveLeave", { approvedBy: "人事", role: "hr_admin" });
    expect(held.ok).toBe(false);
    expect(held.error.code).toBe("not_executed");
    expect(canonical(model.documents)).toBe(before);
  });

  it("报销写入和用例入库都不改知识库", () => {
    const model = loadModel(financeDir);
    const before = canonical(model.documents);
    expect(submitExpense(model, "finance.SubmitExpense").error.code).toBe("approval_required");
    expect(submitExpense(model, "finance.SubmitExpense", { approvedBy: "财务", role: "finance" }).error.code).toBe(
      "not_executed",
    );
    expect(rejectEvalIngest().error.code).toBe("approval_required");
    expect(rejectEvalIngest({ approvedBy: "知识责任人" }).error.code).toBe("not_executed");
    expect(canonical(model.documents)).toBe(before);
  });

  it("脚手架注册后仍然拒绝执行", async () => {
    const server = createServer({ model: loadModel(financeDir), writeScaffold: true });
    const [clientTransport, serverTransport] = InMemoryTransport.createLinkedPair();
    await server.connect(serverTransport);
    const client = new Client({ name: "test", version: "0.0.0" });
    await client.connect(clientTransport);
    const result = await client.callTool({
      name: "submit_expense",
      arguments: { actionId: "finance.SubmitExpense", approvedBy: "财务", role: "finance" },
    });
    expect(toolText(result)).toContain("not_executed");
    await client.close();
    await server.close();
  });
});
