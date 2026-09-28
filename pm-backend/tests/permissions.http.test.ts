// 每個修補的 endpoint × 每種角色：非成員 404、權限不足 403、有權限可正常操作
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { Fixture, ROLE_USER, api, resetAndSeed } from "./fixtures";

type Case = {
  name: string;
  method: "get" | "post" | "put" | "delete";
  /** 每次請求前準備目標（刪除類需要新資料），回傳路徑與 body */
  prepare: (f: Fixture) => Promise<{ path: string; body?: unknown }> | { path: string; body?: unknown };
  /** 允許的專案角色；admin 一律允許，outsider 一律 404 */
  allowed: string[];
};

const ALL_MEMBERS = ["owner", "pm", "group_leader", "member", "viewer"];
const TESTED_ROLES = ["admin", "owner", "pm", "group_leader", "member", "viewer", "outsider"];

const read = (name: string, path: (f: Fixture) => string): Case =>
  ({ name, method: "get", prepare: (f) => ({ path: path(f) }), allowed: ALL_MEMBERS });

const CASES: Case[] = [
  // ── 讀取 ──
  read("GET 任務列表", (f) => `/api/projects/${f.p1.id}/tasks`),
  read("GET 單一任務", (f) => `/api/tasks/${f.tasks.ofMember.id}`),
  read("GET 會議", (f) => `/api/projects/${f.p1.id}/meetings`),
  read("GET 單一會議紀錄", (f) => `/api/meeting-records/${f.record.id}`),
  read("GET 風險", (f) => `/api/projects/${f.p1.id}/risks`),
  read("GET 週報備註", (f) => `/api/projects/${f.p1.id}/weekly-reports`),
  read("GET 週報資料", (f) => `/api/projects/${f.p1.id}/weekly-report-data?weekStart=2026-09-28`),
  read("GET 專案摘要", (f) => `/api/projects/${f.p1.id}/summary`),
  read("GET OKR", (f) => `/api/projects/${f.p1.id}/okrs`),
  read("GET 搜尋", (f) => `/api/projects/${f.p1.id}/search?q=${encodeURIComponent("任務")}`),
  read("GET 評論", (f) => `/api/tasks/${f.tasks.ofMember.id}/comments`),
  read("GET 附件", (f) => `/api/tasks/${f.tasks.ofMember.id}/attachments`),
  read("GET 活動紀錄", (f) => `/api/projects/${f.p1.id}/activities`),
  read("GET 專案成員", (f) => `/api/projects/${f.p1.id}/members`),

  // ── 任務 ──
  { name: "POST 任務", method: "post", allowed: ["owner", "pm", "group_leader"],
    prepare: (f) => ({ path: `/api/projects/${f.p1.id}/tasks`, body: { title: "新任務" } }) },
  { name: "PUT 自己負責的任務", method: "put", allowed: ["owner", "pm", "group_leader", "member"],
    prepare: (f) => ({ path: `/api/tasks/${f.tasks.ofMember.id}`, body: { description: "更新" } }) },
  { name: "PUT 別人負責的任務", method: "put", allowed: ["owner", "pm", "group_leader"],
    prepare: (f) => ({ path: `/api/tasks/${f.tasks.ofMemberB.id}`, body: { description: "更新" } }) },
  { name: "DELETE 任務", method: "delete", allowed: ["owner", "pm", "group_leader"],
    prepare: async (f) => ({ path: `/api/tasks/${(await prisma.task.create({ data: { title: "待刪", projectId: f.p1.id } })).id}` }) },

  // ── 會議 ──
  { name: "POST 會議系列", method: "post", allowed: ["owner", "pm", "group_leader"],
    prepare: (f) => ({ path: `/api/projects/${f.p1.id}/meetings`, body: { name: "新會議" } }) },
  { name: "DELETE 會議系列", method: "delete", allowed: ["owner", "pm", "group_leader"],
    prepare: async (f) => ({ path: `/api/meetings/${(await prisma.meetingSeries.create({ data: { name: "待刪", projectId: f.p1.id } })).id}` }) },
  { name: "POST 會議紀錄", method: "post", allowed: ["owner", "pm", "group_leader"],
    prepare: (f) => ({ path: `/api/meetings/${f.series.id}/records`, body: { date: "2026-09-10", summary: "新紀錄" } }) },
  { name: "PUT 會議紀錄", method: "put", allowed: ["owner", "pm", "group_leader"],
    prepare: (f) => ({ path: `/api/meeting-records/${f.record.id}`, body: { summary: "修改" } }) },
  { name: "DELETE 會議紀錄", method: "delete", allowed: ["owner", "pm", "group_leader"],
    prepare: async (f) => ({ path: `/api/meeting-records/${(await prisma.meetingRecord.create({ data: { date: "2026-09-02", seriesId: f.series.id } })).id}` }) },

  // ── 風險 ──
  { name: "POST 風險", method: "post", allowed: ["owner", "pm", "group_leader", "member"],
    prepare: (f) => ({ path: `/api/projects/${f.p1.id}/risks`, body: { title: "新風險" } }) },
  { name: "PUT 風險", method: "put", allowed: ["owner", "pm", "group_leader", "member"],
    prepare: (f) => ({ path: `/api/risks/${f.risk.id}`, body: { countermeasure: "對策" } }) },
  { name: "DELETE 風險", method: "delete", allowed: ["owner", "pm", "group_leader", "member"],
    prepare: async (f) => ({ path: `/api/risks/${(await prisma.risk.create({ data: { title: "待刪", projectId: f.p1.id } })).id}` }) },

  // ── 週報 ──
  { name: "PUT 週報備註", method: "put", allowed: ["owner", "pm"],
    prepare: (f) => ({ path: `/api/projects/${f.p1.id}/weekly-reports`, body: { weekStart: "2026-09-28", weekEnd: "2026-10-04", notes: "備註" } }) },

  // ── OKR ──
  { name: "POST OKR", method: "post", allowed: ["owner", "pm"],
    prepare: (f) => ({ path: `/api/projects/${f.p1.id}/okrs`, body: { title: "新目標" } }) },
  { name: "PUT OKR", method: "put", allowed: ["owner", "pm"],
    prepare: (f) => ({ path: `/api/okrs/${f.objective.id}`, body: { description: "說明" } }) },
  { name: "DELETE OKR", method: "delete", allowed: ["owner", "pm"],
    prepare: async (f) => ({ path: `/api/okrs/${(await prisma.objective.create({ data: { title: "待刪", projectId: f.p1.id } })).id}` }) },
  { name: "POST KR", method: "post", allowed: ["owner", "pm"],
    prepare: (f) => ({ path: `/api/okrs/${f.objective.id}/key-results`, body: { title: "新 KR", targetValue: 10 } }) },
  { name: "PUT KR", method: "put", allowed: ["owner", "pm"],
    prepare: (f) => ({ path: `/api/key-results/${f.keyResult.id}`, body: { currentValue: 5 } }) },
  { name: "DELETE KR", method: "delete", allowed: ["owner", "pm"],
    prepare: async (f) => ({ path: `/api/key-results/${(await prisma.keyResult.create({ data: { title: "待刪", objectiveId: f.objective.id } })).id}` }) },

  // ── 評論與附件 ──
  { name: "POST 評論", method: "post", allowed: ["owner", "pm", "group_leader", "member"],
    prepare: (f) => ({ path: `/api/tasks/${f.tasks.ofMember.id}/comments`, body: { content: "新評論" } }) },
  { name: "DELETE 別人的評論（僅本人與 admin）", method: "delete", allowed: [],
    prepare: async (f) => ({ path: `/api/comments/${(await prisma.comment.create({ data: { content: "x", taskId: f.tasks.ofMember.id, userId: f.users.memberB.id } })).id}` }) },
  { name: "POST 附件到自己的任務", method: "post", allowed: ["owner", "pm", "group_leader", "member"],
    prepare: (f) => ({ path: `/api/tasks/${f.tasks.ofMember.id}/attachments`, body: { name: "文件", url: "https://example.com/a" } }) },
  { name: "POST 附件到別人的任務", method: "post", allowed: ["owner", "pm", "group_leader"],
    prepare: (f) => ({ path: `/api/tasks/${f.tasks.ofMemberB.id}/attachments`, body: { name: "文件", url: "https://example.com/b" } }) },
  { name: "DELETE 別人上傳的附件", method: "delete", allowed: ["owner", "pm", "group_leader"],
    prepare: async (f) => ({
      path: `/api/attachments/${(await prisma.attachment.create({ data: { name: "x", url: "https://example.com/x", taskId: f.tasks.ofMember.id, uploaderId: f.users.memberB.id } })).id}`,
    }) },
];

let f: Fixture;
beforeAll(async () => { f = await resetAndSeed(); });

describe.each(CASES)("$name", (c) => {
  it.each(TESTED_ROLES)("%s", async (role) => {
    const { path, body } = await c.prepare(f);
    const token = f.tokens[ROLE_USER[role]];
    let req = api()[c.method](path).set("Authorization", `Bearer ${token}`);
    if (body !== undefined) req = req.send(body as object);
    const res = await req;

    const expected = role === "outsider" ? 404 : (role === "admin" || c.allowed.includes(role)) ? "ok" : 403;
    if (expected === "ok") {
      expect(res.status, JSON.stringify(res.body)).toBeGreaterThanOrEqual(200);
      expect(res.status, JSON.stringify(res.body)).toBeLessThan(300);
    } else {
      expect(res.status, JSON.stringify(res.body)).toBe(expected);
      expect(res.body.error).toBeTruthy();
    }
  });
});

describe("跨專案", () => {
  it("在專案二是 viewer 的使用者可讀專案二，但不能寫入", async () => {
    const r1 = await api().get(`/api/projects/${f.p2.id}/tasks`).set("Authorization", `Bearer ${f.tokens.member}`);
    expect(r1.status).toBe(200);
    expect(r1.body.map((t: any) => t.id)).toEqual([f.p2Task.id]);
    const r2 = await api().put(`/api/tasks/${f.p2Task.id}`).set("Authorization", `Bearer ${f.tokens.member}`).send({ title: "x" });
    expect(r2.status).toBe(403);
  });

  it("不存在的專案與非成員的專案回應相同（404）", async () => {
    const a = await api().get(`/api/projects/does-not-exist/tasks`).set("Authorization", `Bearer ${f.tokens.outsider}`);
    const b = await api().get(`/api/projects/${f.p1.id}/tasks`).set("Authorization", `Bearer ${f.tokens.outsider}`);
    expect(a.status).toBe(404);
    expect(b.status).toBe(404);
    expect(a.body).toEqual(b.body);
  });

  it("專案列表只含自己所屬的專案；admin 看得到全部", async () => {
    const mine = await api().get("/api/projects").set("Authorization", `Bearer ${f.tokens.viewer}`);
    expect(mine.body.map((p: any) => p.id)).toEqual([f.p1.id]);
    const none = await api().get("/api/projects").set("Authorization", `Bearer ${f.tokens.outsider}`);
    expect(none.body).toEqual([]);
    const all = await api().get("/api/projects").set("Authorization", `Bearer ${f.tokens.admin}`);
    expect(all.body.map((p: any) => p.id).sort()).toEqual([f.p1.id, f.p2.id].sort());
  });

  it("GroupLeader 讀取時看得到整個專案（含別組任務）", async () => {
    const res = await api().get(`/api/projects/${f.p1.id}/tasks`).set("Authorization", `Bearer ${f.tokens.leader}`);
    expect(res.status).toBe(200);
    expect(res.body.map((t: any) => t.id)).toContain(f.tasks.ofMemberB.id);
    expect(res.body).toHaveLength(await prisma.task.count({ where: { projectId: f.p1.id } }));
  });

  it("本人可刪除自己的評論", async () => {
    const res = await api().delete(`/api/comments/${f.comment.id}`).set("Authorization", `Bearer ${f.tokens.member}`);
    expect(res.status).toBe(200);
  });

  it("上傳者本人可刪除自己上傳的附件", async () => {
    const res = await api().delete(`/api/attachments/${f.attachment.id}`).set("Authorization", `Bearer ${f.tokens.member}`);
    expect(res.status).toBe(200);
  });
});
