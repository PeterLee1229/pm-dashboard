import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { Fixture, api, resetAndSeed, tokenFor } from "./fixtures";

let f: Fixture;
beforeAll(async () => { f = await resetAndSeed(); });

describe("GET /api/groups", () => {
  it("未登入得 401", async () => {
    expect((await api().get("/api/groups")).status).toBe(401);
  });

  it("非 Admin 拿不到 email，但有指派所需的 memberId", async () => {
    const res = await api().get("/api/groups").set("Authorization", `Bearer ${f.tokens.member}`);
    expect(res.status).toBe(200);
    const users = res.body.flatMap((g: any) => g.users);
    expect(users.length).toBeGreaterThan(0);
    for (const u of users) {
      expect(u).not.toHaveProperty("email");
      expect(u.memberId).toBeTruthy();
    }
  });

  it("Admin 看得到 email", async () => {
    const res = await api().get("/api/groups").set("Authorization", `Bearer ${f.tokens.admin}`);
    expect(res.body.flatMap((g: any) => g.users).every((u: any) => u.email)).toBe(true);
  });

  it("/api/projects/:id/groups 也不回傳 email", async () => {
    const res = await api().get(`/api/projects/${f.p1.id}/groups`).set("Authorization", `Bearer ${f.tokens.member}`);
    expect(res.body.flatMap((g: any) => g.users).some((u: any) => "email" in u)).toBe(false);
  });

  it("註冊頁用的 /api/groups/options 不需登入，只有組別名稱", async () => {
    const res = await api().get("/api/groups/options");
    expect(res.status).toBe(200);
    expect(res.body.map((g: any) => g.name)).toEqual(["A組", "B組"]);
    for (const g of res.body) expect(Object.keys(g).sort()).toEqual(["color", "id", "name"]);
  });
});

describe("GET /api/users", () => {
  it("非 Admin 只拿到 id、name、memberId、group", async () => {
    const res = await api().get("/api/users").set("Authorization", `Bearer ${f.tokens.pm}`);
    expect(res.status).toBe(200);
    for (const u of res.body) expect(Object.keys(u).sort()).toEqual(["group", "id", "memberId", "name"]);
  });

  it("Admin 拿得到 email 與 role", async () => {
    const res = await api().get("/api/users").set("Authorization", `Bearer ${f.tokens.admin}`);
    expect(res.body.every((u: any) => u.email && u.role)).toBe(true);
  });
});

describe("authMiddleware", () => {
  it("已刪除的使用者持有有效 JWT 得 401", async () => {
    const ghost = await prisma.user.create({ data: { email: "ghost@test.local", password: "x", name: "幽靈", memberId: "E-ghost" } });
    const token = tokenFor(ghost.id);
    expect((await api().get("/api/projects").set("Authorization", `Bearer ${token}`)).status).toBe(200);
    await prisma.user.delete({ where: { id: ghost.id } });
    const res = await api().get("/api/projects").set("Authorization", `Bearer ${token}`);
    expect(res.status).toBe(401);
  });

  it("停用的帳號得 403", async () => {
    await prisma.user.update({ where: { id: f.users.viewer.id }, data: { isActive: false } });
    const res = await api().get("/api/projects").set("Authorization", `Bearer ${f.tokens.viewer}`);
    expect(res.status).toBe(403);
    await prisma.user.update({ where: { id: f.users.viewer.id }, data: { isActive: true } });
  });

  it("系統角色以 DB 為準：JWT 宣稱 admin 但 DB 不是 admin，不能存取 admin API", async () => {
    const forged = tokenFor(f.users.member.id, "admin");
    const res = await api().get("/api/admin/users").set("Authorization", `Bearer ${forged}`);
    expect(res.status).toBe(403);
  });

  it("被降級的 admin 立即失去 admin 權限", async () => {
    await prisma.user.update({ where: { id: f.users.admin.id }, data: { role: "user" } });
    const res = await api().get(`/api/projects/${f.p2.id}/tasks`).set("Authorization", `Bearer ${f.tokens.admin}`);
    expect(res.status).toBe(404);
    await prisma.user.update({ where: { id: f.users.admin.id }, data: { role: "admin" } });
  });
});
