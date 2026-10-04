// 裁決 #12：註冊頁的 /api/groups/options 每個 IP 每分鐘 30 次
import { beforeAll, describe, expect, it } from "vitest";
import { api, resetAndSeed } from "./fixtures";

beforeAll(async () => { await resetAndSeed(); });

describe("GET /api/groups/options rate limit", () => {
  it("同一 IP 前 30 次成功，第 31 次回 429；不同 IP 不受影響", async () => {
    for (let i = 0; i < 30; i++) {
      const res = await api().get("/api/groups/options").set("X-Forwarded-For", "203.0.113.10");
      expect(res.status, `第 ${i + 1} 次`).toBe(200);
    }
    const blocked = await api().get("/api/groups/options").set("X-Forwarded-For", "203.0.113.10");
    expect(blocked.status).toBe(429);
    expect(blocked.body.error).toBeTruthy();

    const other = await api().get("/api/groups/options").set("X-Forwarded-For", "203.0.113.20");
    expect(other.status).toBe(200);
  });
});
