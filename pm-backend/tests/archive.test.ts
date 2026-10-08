// 專案封存：權限、唯讀（REST 所有寫入 endpoint 與 MCP 寫入工具）、讀取仍正常、排程與跨專案查詢排除、解除封存
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { prisma } from "../src/db";
import { buildMcpServer } from "../src/tools/adapters/mcp";
import { checkDueTasks } from "../src/scheduler";
import { Fixture, ROLE_USER, api, resetAndSeed } from "./fixtures";
import { CASES } from "./endpointCases";

let f: Fixture;
const clients: Client[] = [];
beforeEach(async () => {
  f = await resetAndSeed();
  await prisma.systemSetting.create({ data: { id: 1, mcpEnabled: true, mcpWriteEnabled: true } });
});
afterAll(async () => { await Promise.all(clients.map((c) => c.close())); });

type Role = keyof typeof ROLE_USER;
const as = (role: Role) => ({ Authorization: `Bearer ${f.tokens[ROLE_USER[role]]}` });
const archive = (role: Role, projectId = f.p1.id) => api().post(`/api/projects/${projectId}/archive`).set(as(role));
const unarchive = (role: Role, projectId = f.p1.id) => api().post(`/api/projects/${projectId}/unarchive`).set(as(role));

async function tool(role: Role, name: string, args: Record<string, unknown>) {
  const u = f.users[ROLE_USER[role]];
  const server = buildMcpServer({ userId: u.id, systemRole: u.role }, { clientId: "t", clientName: "Claude", scopes: ["pm:read", "pm:write"] });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  clients.push(client);
  const r = await client.callTool({ name, arguments: args });
  return { isError: !!r.isError, body: JSON.parse((r.content as { text: string }[])[0].text) };
}

describe("封存權限", () => {
  it.each([["owner", 200], ["admin", 200], ["pm", 403], ["group_leader", 403], ["member", 403], ["viewer", 403], ["outsider", 404]] as const)(
    "%s 封存 → %i；解除封存權限相同", async (role, status) => {
      const res = await archive(role);
      expect(res.status, JSON.stringify(res.body)).toBe(status);
      if (status === 200) {
        expect(res.body.archivedAt).toBeTruthy();
        expect(res.body.archivedBy).toBe(f.users[ROLE_USER[role]].id);
      } else {
        await archive("owner");
      }
      expect((await unarchive(role)).status).toBe(status);
    });

  it("封存與解除封存都寫入活動紀錄；重複封存不重複寫入", async () => {
    await archive("owner");
    await archive("owner");
    await unarchive("owner");
    const logs = await prisma.activityLog.findMany({ where: { projectId: f.p1.id, target: "project" }, orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => l.action)).toEqual(["archive", "unarchive"]);
  });

  it("任何時候都可以封存（有未完成的任務也可以）", async () => {
    expect(await prisma.task.count({ where: { projectId: f.p1.id, columnId: { not: "done" } } })).toBeGreaterThan(0);
    expect((await archive("owner")).status).toBe(200);
  });
});

describe("封存後的 REST 寫入：一律 403「專案已封存」", () => {
  const WRITE_CASES = CASES.filter((c) => c.method !== "get");

  it.each(WRITE_CASES.map((c) => [c.name, c] as const))("%s（Owner 與 Admin 也不行）", async (_name, c) => {
    await archive("owner");
    for (const role of ["owner", "admin"] as const) {
      const { path, body } = await c.prepare(f);
      let req = api()[c.method](path).set(as(role));
      if (body !== undefined) req = req.send(body as object);
      const res = await req;
      expect(res.status, `${role} ${JSON.stringify(res.body)}`).toBe(403);
      expect(res.body.error).toContain("專案已封存");
    }
  });

  it("專案設定、成員管理、CSV 匯入也被拒絕", async () => {
    await archive("owner");
    const o = as("owner");
    const reqs = [
      api().put(`/api/projects/${f.p1.id}`).set(o).send({ name: "改名" }),
      api().post(`/api/projects/${f.p1.id}/members`).set(o).send({ userId: f.users.outsider.id, role: "member" }),
      api().put(`/api/projects/${f.p1.id}/members/${f.users.member.id}`).set(o).send({ role: "viewer" }),
      api().delete(`/api/projects/${f.p1.id}/members/${f.users.viewer.id}`).set(o),
      api().post(`/api/projects/${f.p1.id}/transfer-owner`).set(o).send({ newOwnerId: f.users.pm.id }),
      api().post(`/api/projects/${f.p1.id}/tasks/import/preview`).set(o).send({ csv: "任務名稱\nx\n" }),
    ];
    for (const r of await Promise.all(reqs)) {
      expect(r.status, JSON.stringify(r.body)).toBe(403);
      expect(r.body.error).toContain("專案已封存");
    }
    expect((await prisma.project.findUniqueOrThrow({ where: { id: f.p1.id } })).name).toBe("專案一");
  });

  it("已封存的專案仍可刪除", async () => {
    await archive("owner");
    expect((await api().delete(`/api/projects/${f.p1.id}`).set(as("owner"))).status).toBe(200);
  });
});

describe("封存後的讀取與匯出仍正常", () => {
  it("所有讀取 endpoint 正常（含週報資料與專案摘要，匯出使用這些資料）", async () => {
    await archive("owner");
    for (const c of CASES.filter((x) => x.method === "get")) {
      const { path } = await c.prepare(f);
      const res = await api().get(path).set(as("viewer"));
      expect(res.status, c.name).toBe(200);
    }
  });

  it("專案列表仍回傳已封存的專案（含 archivedAt），由前端分區顯示", async () => {
    await archive("owner");
    const res = await api().get("/api/projects").set(as("member"));
    const p1 = res.body.find((p: any) => p.id === f.p1.id);
    expect(p1.archivedAt).toBeTruthy();
  });
});

describe("封存後的 MCP 工具", () => {
  it("5 支寫入工具都回傳「專案已封存」", async () => {
    await archive("owner");
    const calls: [string, Record<string, unknown>][] = [
      ["create_tasks", { projectId: f.p1.id, dryRun: false, tasks: [{ clientRef: "a", title: "x" }] }],
      ["update_task", { taskId: f.tasks.ofMember.id, changes: { title: "x" } }],
      ["add_comment", { taskId: f.tasks.ofMember.id, content: "x" }],
      ["create_meeting_record", { seriesId: f.series.id, date: "2026-10-01" }],
      ["create_risk", { projectId: f.p1.id, title: "x", probability: 1, impact: 1 }],
    ];
    for (const [name, args] of calls) {
      const r = await tool("owner", name, args);
      expect(r.body.code, name).toBe("FORBIDDEN");
      expect(r.body.error, name).toContain("專案已封存");
    }
  });

  it("create_tasks 的 dryRun 預覽也提示已封存", async () => {
    await archive("owner");
    const r = await tool("owner", "create_tasks", { projectId: f.p1.id, tasks: [{ clientRef: "a", title: "x" }] });
    expect(r.body.error).toContain("專案已封存");
  });

  it("list_projects 預設不列出已封存的專案；includeArchived 時列出並標示 archived", async () => {
    await archive("owner");
    const def = await tool("member", "list_projects", {});
    expect(def.body.items.map((p: any) => p.id)).toEqual([f.p2.id]);
    const all = await tool("member", "list_projects", { includeArchived: true });
    expect(all.body.items.find((p: any) => p.id === f.p1.id).archived).toBe(true);
    expect(all.body.items.find((p: any) => p.id === f.p2.id).archived).toBe(false);
  });

  it("未指定 projectId 的跨專案查詢排除已封存的專案；指定 projectId 仍可讀取", async () => {
    await prisma.task.update({ where: { id: f.tasks.ofMember.id }, data: { endDate: "2026-01-10" } });
    await archive("owner");
    const tasks = await tool("member", "list_tasks", { limit: 200 });
    expect(tasks.body.items.every((t: any) => t.project.id !== f.p1.id)).toBe(true);
    for (const name of ["list_meetings", "list_okrs", "get_activity_log", "list_overdue_tasks"]) {
      const r = await tool("member", name, {});
      expect(r.body.items.every((x: any) => x.project.id !== f.p1.id), name).toBe(true);
    }
    expect((await tool("member", "search", { query: "任務" })).body.items.every((x: any) => x.project.id !== f.p1.id)).toBe(true);

    const direct = await tool("member", "list_tasks", { projectId: f.p1.id, limit: 200 });
    expect(direct.body.items.length).toBeGreaterThan(0);
    expect((await tool("member", "list_overdue_tasks", { projectId: f.p1.id })).body.items.map((t: any) => t.id)).toEqual([f.tasks.ofMember.id]);
    expect((await tool("member", "get_project_summary", { projectId: f.p1.id })).isError).toBe(false);
  });
});

describe("逾期通知排程", () => {
  it("跳過已封存的專案", async () => {
    await prisma.notification.deleteMany();
    await prisma.task.update({ where: { id: f.tasks.ofMember.id }, data: { endDate: "2020-01-01" } });
    const p2Overdue = await prisma.task.create({
      data: { title: "專案二逾期", endDate: "2020-01-01", assignee: f.users.p2owner.memberId, projectId: f.p2.id },
    });
    await archive("owner");
    await checkDueTasks();
    const notes = await prisma.notification.findMany({ where: { type: "task_overdue" } });
    expect(notes.map((n) => n.taskId)).toEqual([p2Overdue.id]);
  });
});

describe("解除封存", () => {
  it("解除封存後一切恢復正常", async () => {
    await archive("owner");
    await unarchive("owner");
    expect((await api().put(`/api/tasks/${f.tasks.ofMember.id}`).set(as("owner")).send({ title: "可以改了" })).status).toBe(200);
    expect((await tool("owner", "add_comment", { taskId: f.tasks.ofMember.id, content: "恢復" })).isError).toBe(false);
    expect((await tool("member", "list_projects", {})).body.items.map((p: any) => p.id).sort()).toEqual([f.p1.id, f.p2.id].sort());
  });
});
