// 每個修補的 endpoint × 每種角色：非成員 404、權限不足 403、有權限可正常操作
import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { Fixture, ROLE_USER, api, resetAndSeed } from "./fixtures";

import { CASES, TESTED_ROLES } from "./endpointCases";

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

// 裁決 #13：同專案成員（owner、pm、GL、member）與 admin 看得到 email，viewer 看不到
describe("成員 email 的可見性", () => {
  const SEES_EMAIL: Record<string, boolean> = {
    admin: true, owner: true, pm: true, group_leader: true, member: true, viewer: false,
  };

  it.each(Object.entries(SEES_EMAIL))("%s：GET /members", async (role, sees) => {
    const res = await api().get(`/api/projects/${f.p1.id}/members`).set("Authorization", `Bearer ${f.tokens[ROLE_USER[role]]}`);
    expect(res.status).toBe(200);
    for (const m of res.body) expect("email" in m.user, `${role} ${m.user.name}`).toBe(sees);
  });

  it.each(Object.entries(SEES_EMAIL))("%s：GET /projects 內的成員", async (role, sees) => {
    const res = await api().get("/api/projects").set("Authorization", `Bearer ${f.tokens[ROLE_USER[role]]}`);
    const p1 = res.body.find((p: any) => p.id === f.p1.id);
    for (const m of p1.members) expect("email" in m.user).toBe(sees);
  });

  it("同一位使用者在 viewer 的專案看不到 email，在 member 的專案也只依該專案角色判斷", async () => {
    // member 在專案一是 member、在專案二是 viewer
    const res = await api().get("/api/projects").set("Authorization", `Bearer ${f.tokens.member}`);
    const p1 = res.body.find((p: any) => p.id === f.p1.id);
    const p2 = res.body.find((p: any) => p.id === f.p2.id);
    expect(p1.members.every((m: any) => "email" in m.user)).toBe(true);
    expect(p2.members.some((m: any) => "email" in m.user)).toBe(false);
  });
});
