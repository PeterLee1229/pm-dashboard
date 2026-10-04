// MCP 工具 × 每種角色：回傳結果必須與對應的 REST API 一致；非成員得不到資料
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { prisma } from "../src/db";
import { buildMcpServer, paginate, toROC } from "../src/mcp/tools";
import { Fixture, ROLE_USER, api, resetAndSeed } from "./fixtures";

let f: Fixture;
const clients: Client[] = [];

beforeAll(async () => {
  f = await resetAndSeed();
  // 讓逾期、到期、活動紀錄、會議日期都有資料
  const past = "2026-01-10";
  await prisma.task.update({ where: { id: f.tasks.ofMember.id }, data: { endDate: past, completion: 20 } });
  await prisma.task.update({ where: { id: f.tasks.ofMemberB.id }, data: { endDate: "2099-12-31", description: "關鍵字在描述裡" } });
  await prisma.task.create({ data: { title: "專案二逾期", endDate: past, projectId: f.p2.id } });
  await prisma.meetingRecord.create({ data: { date: "2026-03-05", summary: "第二次會議 討論任務", seriesId: f.series.id } });
  await prisma.objective.update({ where: { id: f.objective.id }, data: { startDate: "2026-01-01", endDate: "2026-06-30" } });
  await prisma.keyResult.update({ where: { id: f.keyResult.id }, data: { targetValue: 10, currentValue: 4 } });
  await prisma.activityLog.create({ data: { userId: f.users.pm.id, action: "update", target: "task", detail: "任務", projectId: f.p1.id } });
});

afterAll(async () => { await Promise.all(clients.map((c) => c.close())); });

type Role = keyof typeof ROLE_USER;
const ROLES = Object.keys(ROLE_USER) as Role[];

async function clientFor(role: Role) {
  const user = f.users[ROLE_USER[role]];
  const server = buildMcpServer({ userId: user.id, systemRole: user.role }, { clientId: "test-client" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1.0.0" });
  await Promise.all([server.connect(a), client.connect(b)]);
  clients.push(client);
  return client;
}

async function call(role: Role, name: string, args: Record<string, unknown> = {}) {
  const client = await clientFor(role);
  const res = await client.callTool({ name, arguments: args });
  const body = JSON.parse((res.content as { text: string }[])[0].text);
  return { isError: !!res.isError, body };
}

const rest = (role: Role, path: string) => api().get(path).set("Authorization", `Bearer ${f.tokens[ROLE_USER[role]]}`);
const ids = (xs: { id: string }[]) => xs.map((x) => x.id).sort();

describe("工具清單", () => {
  it("12 支工具都有繁體中文描述，且標註 readOnlyHint", async () => {
    const { tools } = await (await clientFor("member")).listTools();
    expect(tools.map((t) => t.name).sort()).toEqual([
      "get_activity_log", "get_meeting", "get_project_summary", "get_task", "get_weekly_report_data",
      "list_meetings", "list_okrs", "list_overdue_tasks", "list_projects", "list_risks", "list_tasks", "search",
    ]);
    for (const t of tools) {
      expect(t.annotations?.readOnlyHint, t.name).toBe(true);
      expect(t.description, t.name).toMatch(/[一-鿿]/);
    }
  });
});

describe.each(ROLES)("角色：%s", (role) => {
  const outsider = role === "outsider";

  it("list_projects 與 GET /api/projects 一致", async () => {
    const tool = await call(role, "list_projects");
    const r = await rest(role, "/api/projects");
    expect(ids(tool.body.items)).toEqual(ids(r.body));
    for (const p of tool.body.items) {
      expect(p.taskCompletionRate.uiLabel).toBe("進度");
      expect(p.weightedProgress.uiLabel).toBe("整體完成度");
    }
  });

  it("get_project_summary 與 GET /summary 一致", async () => {
    const tool = await call(role, "get_project_summary", { projectId: f.p1.id });
    const r = await rest(role, `/api/projects/${f.p1.id}/summary`);
    if (outsider) {
      expect(tool.isError).toBe(true);
      expect(tool.body.code).toBe("NOT_FOUND");
      expect(r.status).toBe(404);
      return;
    }
    expect(tool.body.taskCompletionRate.value).toBe(r.body.taskCompletionRate);
    expect(tool.body.weightedProgress.value).toBe(r.body.weightedProgress);
    expect(ids(tool.body.overdueTasks)).toEqual(ids(r.body.overdueTasks));
    expect(ids(tool.body.upcomingTasks)).toEqual(ids(r.body.upcomingTasks));
    expect(tool.body.highRiskCount).toBe(r.body.highRiskCount);
  });

  it("list_tasks（指定專案）與 GET /tasks 一致（GroupLeader 看得到整個專案）", async () => {
    const tool = await call(role, "list_tasks", { projectId: f.p1.id, limit: 200 });
    const r = await rest(role, `/api/projects/${f.p1.id}/tasks`);
    if (outsider) { expect(tool.isError).toBe(true); expect(r.status).toBe(404); return; }
    expect(ids(tool.body.items)).toEqual(ids(r.body));
    const withSubs = tool.body.items.find((t: any) => t.id === f.tasks.withSubtasks.id);
    expect(withSubs.subtasks.map((s: any) => s.parentTaskId)).toEqual([f.tasks.withSubtasks.id, f.tasks.withSubtasks.id]);
  });

  it("list_tasks（不指定專案）涵蓋所有可見專案", async () => {
    const tool = await call(role, "list_tasks", { limit: 200 });
    const projects = (await rest(role, "/api/projects")).body;
    const expected = [];
    for (const p of projects) expected.push(...(await rest(role, `/api/projects/${p.id}/tasks`)).body);
    expect(ids(tool.body.items)).toEqual(ids(expected));
  });

  it("get_task 與 GET /tasks/:id 一致", async () => {
    const tool = await call(role, "get_task", { taskId: f.tasks.ofMember.id });
    const r = await rest(role, `/api/tasks/${f.tasks.ofMember.id}`);
    if (outsider) { expect(tool.isError).toBe(true); expect(r.status).toBe(404); return; }
    expect(tool.body.id).toBe(r.body.id);
    expect(ids(tool.body.comments)).toEqual(ids(r.body.comments));
    expect(ids(tool.body.attachments)).toEqual(ids(r.body.attachments));
    expect(tool.body.assignee).toEqual({ id: f.users.member.memberId, name: "A組成員" });
  });

  it("list_overdue_tasks 與各專案 /summary 的逾期任務一致", async () => {
    const tool = await call(role, "list_overdue_tasks");
    const projects = (await rest(role, "/api/projects")).body;
    const expected = [];
    for (const p of projects) expected.push(...(await rest(role, `/api/projects/${p.id}/summary`)).body.overdueTasks);
    expect(ids(tool.body.items)).toEqual(ids(expected));
  });

  it("list_risks 與 GET /risks 一致", async () => {
    const tool = await call(role, "list_risks", { projectId: f.p1.id });
    const r = await rest(role, `/api/projects/${f.p1.id}/risks`);
    if (outsider) { expect(tool.isError).toBe(true); return; }
    expect(ids(tool.body.items)).toEqual(ids(r.body));
    expect(tool.body.items[0]).toMatchObject({ score: 25, probability: { value: 5 }, impact: { value: 5 } });
  });

  it("list_meetings 與 get_meeting 與 REST 一致", async () => {
    const tool = await call(role, "list_meetings", { projectId: f.p1.id });
    const r = await rest(role, `/api/projects/${f.p1.id}/meetings`);
    const one = await call(role, "get_meeting", { meetingId: f.record.id });
    const oneRest = await rest(role, `/api/meeting-records/${f.record.id}`);
    if (outsider) { expect(tool.isError).toBe(true); expect(one.isError).toBe(true); expect(oneRest.status).toBe(404); return; }
    expect(ids(tool.body.items)).toEqual(ids(r.body.flatMap((s: any) => s.records)));
    expect(one.body.summary).toBe(oneRest.body.summary);
  });

  it("get_weekly_report_data 與 GET /weekly-report-data 一致，並附民國年", async () => {
    const tool = await call(role, "get_weekly_report_data", { projectId: f.p1.id, weekStart: "2026-09-30" });
    const r = await rest(role, `/api/projects/${f.p1.id}/weekly-report-data?weekStart=2026-09-30`);
    if (outsider) { expect(tool.isError).toBe(true); return; }
    const { project, weekStartROC, weekEndROC, ...rest_ } = tool.body;
    const { projectId, ...expected } = r.body;
    expect(rest_).toEqual(expected);
    expect(project.id).toBe(projectId);
    expect([weekStartROC, weekEndROC]).toEqual(["115/09/28", "115/10/04"]);
  });

  it("list_okrs 與 GET /okrs 一致", async () => {
    const tool = await call(role, "list_okrs", { projectId: f.p1.id });
    const r = await rest(role, `/api/projects/${f.p1.id}/okrs`);
    if (outsider) { expect(tool.isError).toBe(true); return; }
    expect(ids(tool.body.items)).toEqual(ids(r.body));
    expect(tool.body.items[0].progress).toBe(40);
  });

  it("search 與 GET /search 一致", async () => {
    const tool = await call(role, "search", { query: "任務", projectId: f.p1.id, limit: 200 });
    const r = await rest(role, `/api/projects/${f.p1.id}/search?q=${encodeURIComponent("任務")}`);
    if (outsider) { expect(tool.isError).toBe(true); return; }
    const expected = [...r.body.tasks, ...r.body.subtasks, ...r.body.risks, ...r.body.meetings];
    expect(ids(tool.body.items)).toEqual(ids(expected));
  });

  it("get_activity_log 與 GET /activities 一致", async () => {
    const tool = await call(role, "get_activity_log", { projectId: f.p1.id, limit: 200 });
    const r = await rest(role, `/api/projects/${f.p1.id}/activities`);
    if (outsider) { expect(tool.isError).toBe(true); return; }
    expect(tool.body.items.map((a: any) => a.id)).toEqual(r.body.map((a: any) => a.id));
  });
});

describe("非成員得不到資料", () => {
  it("不指定專案的工具回傳空清單", async () => {
    for (const name of ["list_projects", "list_tasks", "list_overdue_tasks", "list_meetings", "list_okrs", "get_activity_log"]) {
      const res = await call("outsider", name);
      expect(res.isError, name).toBe(false);
      expect(res.body.items, name).toEqual([]);
    }
    expect((await call("outsider", "search", { query: "任務" })).body.items).toEqual([]);
  });

  it("不存在的專案與非成員的專案回應相同", async () => {
    const a = await call("outsider", "list_risks", { projectId: f.p1.id });
    const b = await call("outsider", "list_risks", { projectId: "does-not-exist" });
    expect(a.body).toEqual(b.body);
  });
});

describe("篩選與分頁", () => {
  it("list_tasks 依 status、assigneeId、keyword、到期日篩選", async () => {
    const byStatus = await call("pm", "list_tasks", { projectId: f.p1.id, status: "done" });
    expect(ids(byStatus.body.items)).toEqual([f.tasks.done.id]);
    const byAssignee = await call("pm", "list_tasks", { assigneeId: f.users.memberB.memberId });
    expect(ids(byAssignee.body.items)).toEqual([f.tasks.ofMemberB.id, f.tasks.withSubtasks.id].sort());
    const byKeyword = await call("pm", "list_tasks", { keyword: "關鍵字在描述" });
    expect(ids(byKeyword.body.items)).toEqual([f.tasks.ofMemberB.id]);
    const byDue = await call("pm", "list_tasks", { dueFrom: "2026-01-01", dueTo: "2026-01-31" });
    expect(ids(byDue.body.items)).toEqual([f.tasks.ofMember.id]);
  });

  it("list_meetings 依日期區間篩選", async () => {
    const res = await call("pm", "list_meetings", { from: "2026-03-01", to: "2026-03-31" });
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0].date).toBe("2026-03-05");
  });

  it("list_okrs 依期間重疊篩選", async () => {
    expect((await call("pm", "list_okrs", { from: "2026-05-01", to: "2026-12-31" })).body.items).toHaveLength(1);
    expect((await call("pm", "list_okrs", { from: "2026-07-01" })).body.items).toHaveLength(0);
  });

  it("list_overdue_tasks 依逾期天數排序，可依負責人篩選", async () => {
    const all = await call("admin", "list_overdue_tasks");
    const days = all.body.items.map((t: any) => t.overdueDays);
    expect(days).toEqual([...days].sort((a: number, b: number) => b - a));
    const mine = await call("admin", "list_overdue_tasks", { assigneeId: f.users.member.memberId });
    expect(ids(mine.body.items)).toEqual([f.tasks.ofMember.id]);
  });

  it("limit 與 cursor 分頁：逐頁取完與一次取完相同", async () => {
    const full = await call("pm", "list_tasks", { projectId: f.p1.id, limit: 200 });
    const seen: string[] = [];
    let cursor: string | undefined;
    do {
      const page = await call("pm", "list_tasks", { projectId: f.p1.id, limit: 2, cursor });
      expect(page.body.items.length).toBeLessThanOrEqual(2);
      seen.push(...page.body.items.map((t: any) => t.id));
      cursor = page.body.nextCursor ?? undefined;
    } while (cursor);
    expect(seen).toEqual(full.body.items.map((t: any) => t.id));
  });

  it("limit 上限 200；cursor 無效時回錯誤", async () => {
    expect((await clientFor("pm").then((c) => c.callTool({ name: "list_tasks", arguments: { limit: 500 } }))).isError).toBe(true);
    const bad = await call("pm", "list_tasks", { cursor: "not-a-cursor" });
    expect(bad.isError).toBe(true);
    expect(paginate([1, 2, 3], 2).nextCursor).toBeTruthy();
    expect(paginate([1, 2], 2).nextCursor).toBeNull();
  });

  it("民國年轉換", () => {
    expect(toROC("2026-09-28")).toBe("115/09/28");
    expect(toROC(null)).toBeNull();
  });
});

describe("稽核紀錄", () => {
  it("每次工具呼叫（含失敗）都會寫入，參數只保留摘要", async () => {
    await prisma.mcpAuditLog.deleteMany();
    await call("member", "search", { query: "x".repeat(150) });
    await call("outsider", "get_task", { taskId: f.tasks.ofMember.id });
    const logs = await prisma.mcpAuditLog.findMany({ orderBy: { createdAt: "asc" } });
    expect(logs).toHaveLength(2);
    expect(logs[0]).toMatchObject({ tool: "search", success: true, clientId: "test-client", userId: f.users.member.id });
    expect((logs[0].params as any).query.length).toBeLessThanOrEqual(101);
    expect(logs[1]).toMatchObject({ tool: "get_task", success: false, errorCode: "NOT_FOUND" });
    expect(logs[1].durationMs).toBeGreaterThanOrEqual(0);
  });

  it("稽核紀錄寫入失敗不影響回應", async () => {
    const original = prisma.mcpAuditLog.create;
    (prisma.mcpAuditLog as any).create = () => Promise.reject(new Error("db down"));
    try {
      const res = await call("member", "list_projects");
      expect(res.isError).toBe(false);
      expect(res.body.items.length).toBeGreaterThan(0);
    } finally {
      (prisma.mcpAuditLog as any).create = original;
    }
  });
});
