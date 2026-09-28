import { beforeAll, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { Fixture, api, resetAndSeed } from "./fixtures";

let f: Fixture;
beforeAll(async () => { f = await resetAndSeed(); });

describe("PUT /api/notifications/:id/read", () => {
  it("可以標記自己的通知為已讀", async () => {
    const n = await prisma.notification.create({ data: { userId: f.users.member.id, type: "t", title: "t", message: "m" } });
    const res = await api().put(`/api/notifications/${n.id}/read`).set("Authorization", `Bearer ${f.tokens.member}`);
    expect(res.status).toBe(200);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).isRead).toBe(true);
  });

  it("不能標記別人的通知（404，且不會被修改）", async () => {
    const n = await prisma.notification.create({ data: { userId: f.users.member.id, type: "t", title: "t", message: "m" } });
    const res = await api().put(`/api/notifications/${n.id}/read`).set("Authorization", `Bearer ${f.tokens.memberB}`);
    expect(res.status).toBe(404);
    expect((await prisma.notification.findUniqueOrThrow({ where: { id: n.id } })).isRead).toBe(false);
  });

  it("不存在的通知回 404", async () => {
    const res = await api().put(`/api/notifications/nope/read`).set("Authorization", `Bearer ${f.tokens.member}`);
    expect(res.status).toBe(404);
  });
});
