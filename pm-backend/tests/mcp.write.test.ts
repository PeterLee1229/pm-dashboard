// Phase 2：工具註冊表、寫入工具（權限一致性、scope 與開關、create_tasks、update_task、活動紀錄、稽核）
import crypto from "node:crypto";
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { prisma } from "../src/db";
import { buildMcpServer } from "../src/tools/adapters/mcp";
import { toAnthropicTools } from "../src/tools/adapters/anthropic";
import { allTools } from "../src/tools/registry";
import { DUPLICATE_SIMILARITY_THRESHOLD, datesOverlap, normalizeTitle, titleSimilarity } from "../src/services/taskBatch";
import { Fixture, ROLE_USER, api, resetAndSeed } from "./fixtures";

let f: Fixture;
const clients: Client[] = [];

async function enable(write = true) {
  await prisma.systemSetting.upsert({ where: { id: 1 }, update: { mcpEnabled: true, mcpWriteEnabled: write }, create: { id: 1, mcpEnabled: true, mcpWriteEnabled: write } });
}

beforeEach(async () => {
  f = await resetAndSeed();
  await enable(true);
});
afterAll(async () => { await Promise.all(clients.map((c) => c.close())); });

type Role = keyof typeof ROLE_USER;
const ROLES = Object.keys(ROLE_USER) as Role[];

async function call(role: Role, name: string, args: Record<string, unknown>, scopes = ["pm:read", "pm:write"]) {
  const user = f.users[ROLE_USER[role]];
  const server = buildMcpServer({ userId: user.id, systemRole: user.role }, { clientId: "test-client", clientName: "Claude", scopes });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "test", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  clients.push(client);
  const res = await client.callTool({ name, arguments: args });
  return { isError: !!res.isError, body: JSON.parse((res.content as { text: string }[])[0].text) };
}

const restAs = (role: Role) => {
  const auth = { Authorization: `Bearer ${f.tokens[ROLE_USER[role]]}` };
  return {
    post: (path: string, body: object) => api().post(path).set(auth).send(body),
    put: (path: string, body: object) => api().put(path).set(auth).send(body),
  };
};

/** REST 狀態碼 → 工具結果的分類（成功 / FORBIDDEN / NOT_FOUND / BAD_REQUEST） */
const restClass = (status: number) => (status < 300 ? "OK" : ({ 400: "BAD_REQUEST", 403: "FORBIDDEN", 404: "NOT_FOUND" } as Record<number, string>)[status] ?? `HTTP_${status}`);

/** 權限一致性的結果分布（避免兩邊因為同一個錯誤一起失敗而空泛通過） */
const outcomes = new Map<string, Map<string, string>>();
const toolClass = (r: { isError: boolean; body: any }) => {
  const cls = r.isError ? r.body.code : "OK";
  const name = expect.getState().currentTestName ?? "";
  const m = name.match(/權限一致性（(\w+)）\s*>\s*(.+?)(?:\s*>|$)/);
  if (m) {
    const [, role, label] = m;
    if (!outcomes.has(label)) outcomes.set(label, new Map());
    const prev = outcomes.get(label)!.get(role);
    outcomes.get(label)!.set(role, prev ? `${prev},${cls}` : cls);
  }
  return cls;
};

// ── 工具註冊表 ────────────────────────────────────────────────────────

describe("工具註冊表", () => {
  it("所有工具都能轉成 MCP 與 Anthropic 格式（input schema 非空）", async () => {
    const client = new Client({ name: "t", version: "1" });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await Promise.all([buildMcpServer({ userId: f.users.pm.id, systemRole: "user" }, { clientId: "x" }).connect(a), client.connect(b)]);
    clients.push(client);
    const { tools } = await client.listTools();
    const anthropic = toAnthropicTools();
    expect(tools).toHaveLength(allTools.length);
    expect(anthropic).toHaveLength(allTools.length);
    for (const t of anthropic) {
      expect(t.name).toMatch(/^[a-zA-Z0-9_-]{1,64}$/);
      expect(t.input_schema.type).toBe("object");
      expect(t.input_schema).not.toHaveProperty("$schema");
      expect(t.description.length).toBeGreaterThan(10);
      expect(tools.find((x) => x.name === t.name)!.inputSchema).toEqual(t.input_schema);
    }
    // zod-to-json-schema 對 zod v4 會產生空 schema；確認改用 z.toJSONSchema 後參數完整
    const ct = anthropic.find((t) => t.name === "create_tasks")!.input_schema as any;
    expect(Object.keys(ct.properties)).toEqual(["projectId", "dryRun", "batchKey", "tasks"]);
    expect(ct.required).toEqual(["projectId", "tasks"]);
    expect(ct.properties.tasks.items.required).toEqual(["clientRef", "title"]);
  });

  it("toAnthropicTools 可依 scope 篩選（只授權讀取時不提供寫入工具）", () => {
    expect(toAnthropicTools({ scopes: ["pm:read"] }).map((t) => t.name)).not.toContain("create_tasks");
    expect(toAnthropicTools({ scopes: ["pm:read"] })).toHaveLength(12);
  });
});

// ── 權限一致性：每支寫入工具 × 每種角色，與對應的 REST endpoint 一致 ──

describe.each(ROLES)("權限一致性（%s）", (role) => {
  it("create_tasks ↔ POST /projects/:id/tasks", async () => {
    const tool = await call(role, "create_tasks", { projectId: f.p1.id, dryRun: false, tasks: [{ clientRef: "t1", title: "新任務" }] });
    const rest = await restAs(role).post(`/api/projects/${f.p1.id}/tasks`, { title: "新任務" });
    expect(toolClass(tool), JSON.stringify(tool.body)).toBe(restClass(rest.status));
  });

  it("create_tasks（指派給 B 組成員）↔ POST（組長規則）", async () => {
    const assignee = f.users.memberB.memberId;
    const tool = await call(role, "create_tasks", { projectId: f.p1.id, dryRun: false, tasks: [{ clientRef: "t1", title: "x", assigneeId: assignee }] });
    const rest = await restAs(role).post(`/api/projects/${f.p1.id}/tasks`, { title: "x", assignee });
    expect(toolClass(tool), JSON.stringify(tool.body)).toBe(restClass(rest.status));
  });

  it("update_task（描述）↔ PUT /tasks/:id（Member 只能改自己的任務）", async () => {
    const tool = await call(role, "update_task", { taskId: f.tasks.ofMember.id, changes: { description: "工具" } });
    const rest = await restAs(role).put(`/api/tasks/${f.tasks.ofMember.id}`, { description: "REST" });
    expect(toolClass(tool), JSON.stringify(tool.body)).toBe(restClass(rest.status));
    const other = await call(role, "update_task", { taskId: f.tasks.ofMemberB.id, changes: { description: "工具" } });
    const otherRest = await restAs(role).put(`/api/tasks/${f.tasks.ofMemberB.id}`, { description: "REST" });
    expect(toolClass(other)).toBe(restClass(otherRest.status));
  });

  it("update_task（改派）↔ PUT（Member 不能改派、組長規則）", async () => {
    const fresh = () => prisma.task.create({ data: { title: "改派", assignee: f.users.member.memberId, groupId: f.groups.A.id, projectId: f.p1.id } });
    const [a, b] = [await fresh(), await fresh()];
    const tool = await call(role, "update_task", { taskId: a.id, changes: { assigneeId: f.users.leader.memberId } });
    const rest = await restAs(role).put(`/api/tasks/${b.id}`, { assignee: f.users.leader.memberId });
    expect(toolClass(tool), JSON.stringify(tool.body)).toBe(restClass(rest.status));
  });

  it("update_task（別組任務改到 A 組）↔ PUT（組長組別規則）", async () => {
    const fresh = () => prisma.task.create({ data: { title: "B組", groupId: f.groups.B.id, projectId: f.p1.id } });
    const [a, b] = [await fresh(), await fresh()];
    const tool = await call(role, "update_task", { taskId: a.id, changes: { groupId: f.groups.A.id } });
    const rest = await restAs(role).put(`/api/tasks/${b.id}`, { groupId: f.groups.A.id });
    expect(toolClass(tool)).toBe(restClass(rest.status));
  });

  it("add_comment ↔ POST /tasks/:id/comments", async () => {
    const tool = await call(role, "add_comment", { taskId: f.tasks.ofMember.id, content: "工具留言" });
    const rest = await restAs(role).post(`/api/tasks/${f.tasks.ofMember.id}/comments`, { content: "REST 留言" });
    expect(toolClass(tool)).toBe(restClass(rest.status));
  });

  it("create_meeting_record（既有系列）↔ POST /meetings/:id/records", async () => {
    const tool = await call(role, "create_meeting_record", { seriesId: f.series.id, date: "2026-10-01", summary: "工具" });
    const rest = await restAs(role).post(`/api/meetings/${f.series.id}/records`, { date: "2026-10-01", summary: "REST" });
    expect(toolClass(tool)).toBe(restClass(rest.status));
  });

  it("create_meeting_record（新建系列）↔ POST /projects/:id/meetings", async () => {
    const tool = await call(role, "create_meeting_record", { projectId: f.p1.id, seriesName: "新會議", date: "2026-10-01" });
    const rest = await restAs(role).post(`/api/projects/${f.p1.id}/meetings`, { name: "新會議" });
    expect(toolClass(tool)).toBe(restClass(rest.status));
  });

  it("create_risk ↔ POST /projects/:id/risks（Member 可以新增）", async () => {
    const tool = await call(role, "create_risk", { projectId: f.p1.id, title: "風險", probability: 3, impact: 4 });
    const rest = await restAs(role).post(`/api/projects/${f.p1.id}/risks`, { title: "風險" });
    expect(toolClass(tool)).toBe(restClass(rest.status));
  });

  it("create_risk（負責人為 B 組成員）↔ POST（組長規則）", async () => {
    const tool = await call(role, "create_risk", { projectId: f.p1.id, title: "風險", probability: 3, impact: 4, ownerId: f.users.memberB.memberId });
    const rest = await restAs(role).post(`/api/projects/${f.p1.id}/risks`, { title: "風險", ownerId: f.users.memberB.memberId });
    expect(toolClass(tool)).toBe(restClass(rest.status));
  });
});

describe("權限一致性的預期結果（避免兩邊一起錯）", () => {
  it("每個案例在 7 種身分中都同時出現允許與拒絕，且非成員一律 NOT_FOUND", () => {
    expect(outcomes.size).toBe(10);
    for (const [label, byRole] of outcomes) {
      const all = [...byRole.values()].join(",").split(",");
      expect(all, label).toContain("OK");
      expect(all.some((c) => c === "FORBIDDEN"), label).toBe(true);
      expect(byRole.get("outsider")!.split(",").every((c) => c === "NOT_FOUND"), label).toBe(true);
      expect(all.every((c) => ["OK", "FORBIDDEN", "NOT_FOUND"].includes(c)), `${label}：${JSON.stringify(Object.fromEntries(byRole))}`).toBe(true);
    }
  });

  it("Viewer 不能寫入；Member 不能改派；組長不能指派別組", async () => {
    expect((await call("viewer", "add_comment", { taskId: f.tasks.ofMember.id, content: "x" })).body.code).toBe("FORBIDDEN");
    expect((await call("viewer", "create_risk", { projectId: f.p1.id, title: "x", probability: 1, impact: 1 })).body.code).toBe("FORBIDDEN");
    expect((await call("member", "update_task", { taskId: f.tasks.ofMember.id, changes: { assigneeId: null } })).body.code).toBe("FORBIDDEN");
    const gl = await call("group_leader", "create_tasks", { projectId: f.p1.id, dryRun: false, tasks: [{ clientRef: "a", title: "x", assigneeId: f.users.memberB.memberId }] });
    expect(gl.body.code).toBe("FORBIDDEN");
    expect(gl.body.details.items[0].errors.join()).toContain("不屬於你的組別");
    expect((await call("member", "create_risk", { projectId: f.p1.id, title: "x", probability: 1, impact: 1 })).isError).toBe(false);
    expect((await call("outsider", "add_comment", { taskId: f.tasks.ofMember.id, content: "x" })).body.code).toBe("NOT_FOUND");
  });
});

// ── scope 與開關 ──────────────────────────────────────────────────────

describe("scope 與寫入開關（工具層）", () => {
  it("pm:read 的 token 呼叫寫入工具：INSUFFICIENT_SCOPE，提示重新授權；讀取工具正常", async () => {
    const r = await call("pm", "add_comment", { taskId: f.tasks.ofMember.id, content: "x" }, ["pm:read"]);
    expect(r.body.code).toBe("INSUFFICIENT_SCOPE");
    expect(r.body.error).toContain("重新連接");
    expect((await call("pm", "list_projects", {}, ["pm:read"])).isError).toBe(false);
    expect(await prisma.comment.count()).toBe(1);
  });

  it("mcpWriteEnabled 為 false 時寫入工具被拒（讀取不受影響）", async () => {
    await enable(false);
    const r = await call("pm", "add_comment", { taskId: f.tasks.ofMember.id, content: "x" });
    expect(r.body.code).toBe("WRITE_DISABLED");
    expect((await call("pm", "list_projects", {})).isError).toBe(false);
  });
});

/** 直接建立 OAuth token（與正式核發相同，只存 hash） */
async function issueToken(userId: string, scope: string) {
  const token = crypto.randomBytes(32).toString("base64url");
  const sha = (v: string) => crypto.createHash("sha256").update(v).digest("hex");
  await prisma.oAuthClient.upsert({ where: { clientId: "c1" }, update: {}, create: { clientId: "c1", clientName: "Claude", redirectUris: [] } });
  await prisma.oAuthToken.create({
    data: {
      accessTokenHash: sha(token), refreshTokenHash: sha(token + "r"), clientId: "c1", userId, scope,
      resource: "http://localhost:3000/mcp", accessExpiresAt: new Date(Date.now() + 3600_000), refreshExpiresAt: new Date(Date.now() + 86400_000),
    },
  });
  return token;
}

const mcpCall = (token: string, name: string, args: Record<string, unknown>, id = 1) =>
  api().post("/mcp").set("Authorization", `Bearer ${token}`).set("Accept", "application/json, text/event-stream")
    .send({ jsonrpc: "2.0", id, method: "tools/call", params: { name, arguments: args } });

describe("scope 與寫入開關（HTTP /mcp）", () => {
  it("pm:read token 呼叫寫入工具：403 insufficient_scope（WWW-Authenticate 要求 pm:write）", async () => {
    const token = await issueToken(f.users.pm.id, "pm:read");
    const res = await mcpCall(token, "create_risk", { projectId: f.p1.id, title: "x", probability: 1, impact: 1 });
    expect(res.status).toBe(403);
    expect(res.headers["www-authenticate"]).toContain('error="insufficient_scope"');
    expect(res.headers["www-authenticate"]).toContain('scope="pm:read pm:write"');
    expect(res.body.error.message).toContain("重新連接");
    expect((await mcpCall(token, "list_projects", {})).status).toBe(200);
  });

  it("mcpWriteEnabled 為 false：寫入工具 403；開啟後可以寫入", async () => {
    const token = await issueToken(f.users.pm.id, "pm:read pm:write");
    await enable(false);
    expect((await mcpCall(token, "create_risk", { projectId: f.p1.id, title: "x", probability: 1, impact: 1 })).status).toBe(403);
    await enable(true);
    const ok = await mcpCall(token, "create_risk", { projectId: f.p1.id, title: "x", probability: 1, impact: 1 });
    expect(ok.status).toBe(200);
    expect(ok.body.result.isError).toBeFalsy();
  });

  it("寫入工具每位使用者每分鐘 20 次，另外計算（讀取不受影響）", async () => {
    const token = await issueToken(f.users.pm.id, "pm:read pm:write");
    const statuses = [];
    for (let i = 0; i < 21; i++) statuses.push((await mcpCall(token, "add_comment", { taskId: f.tasks.ofMember.id, content: `c${i}` }, i)).status);
    expect(statuses.slice(0, 20).every((s) => s === 200)).toBe(true);
    expect(statuses[20]).toBe(429);
    expect((await mcpCall(token, "list_projects", {})).status).toBe(200);
  });

  it("活動紀錄標示來源：source=mcp、clientName=Claude；網頁操作為 web", async () => {
    const token = await issueToken(f.users.pm.id, "pm:read pm:write");
    await mcpCall(token, "create_tasks", { projectId: f.p1.id, dryRun: false, tasks: [{ clientRef: "a", title: "經由 Claude" }] });
    await restAs("pm").post(`/api/projects/${f.p1.id}/tasks`, { title: "經由網頁" });
    const viaClaude = await prisma.activityLog.findFirstOrThrow({ where: { detail: "經由 Claude" } });
    const viaWeb = await prisma.activityLog.findFirstOrThrow({ where: { detail: "經由網頁" } });
    expect(viaClaude).toMatchObject({ source: "mcp", clientName: "Claude", userId: f.users.pm.id });
    expect(viaWeb).toMatchObject({ source: "web", clientName: null });
    const log = await mcpCall(token, "get_activity_log", { projectId: f.p1.id });
    const item = JSON.parse(log.body.result.content[0].text).items.find((x: any) => x.detail === "經由 Claude");
    expect(item).toMatchObject({ source: "mcp", clientName: "Claude" });
  });
});

// ── create_tasks ──────────────────────────────────────────────────────

const counts = async () => ({
  tasks: await prisma.task.count(), subtasks: await prisma.subTask.count(),
  activity: await prisma.activityLog.count(), notifications: await prisma.notification.count(),
});

describe("create_tasks", () => {
  const batch = (overrides: Record<string, unknown> = {}) => ({
    projectId: f.p1.id,
    tasks: [
      { clientRef: "main", title: "導入新系統", assigneeId: f.users.member.memberId, groupId: f.groups.A.id, startDate: "2026-11-01", endDate: "2026-11-30", priority: "high" },
      { clientRef: "s1", parentRef: "main", title: "需求訪談", assigneeId: f.users.member.memberId, startDate: "2026-11-01", endDate: "2026-11-07" },
      { clientRef: "s2", parentRef: "main", title: "系統測試", assigneeId: f.users.memberB.memberId },
      { clientRef: "ext", parentTaskId: f.tasks.unassigned.id, title: "補充子任務" },
    ],
    ...overrides,
  });

  it("dryRun 預設為 true，不改變 DB，回傳解析後的名稱與摘要", async () => {
    const before = await counts();
    const r = await call("pm", "create_tasks", batch());
    expect(r.isError).toBe(false);
    expect(r.body.dryRun).toBe(true);
    expect(await counts()).toEqual(before);
    expect(r.body.summary).toMatchObject({ total: 4, tasks: 1, subtasks: 3, withErrors: 0 });
    const [main, s1, , ext] = r.body.items;
    expect(main).toMatchObject({ kind: "task", assignee: { id: f.users.member.memberId, name: "A組成員" }, group: { name: "A組" }, priority: "high", status: "todo" });
    expect(s1).toMatchObject({ kind: "subtask", parent: { clientRef: "main", title: "導入新系統" } });
    expect(ext.parent).toEqual({ taskId: f.tasks.unassigned.id, title: "未指派任務" });
  });

  it("正式寫入：parentRef 建立子任務、parentTaskId 掛在既有任務，回傳 clientRef 對照表", async () => {
    const r = await call("pm", "create_tasks", { ...batch(), dryRun: false });
    expect(r.isError, JSON.stringify(r.body)).toBe(false);
    expect(r.body.created).toBe(4);
    const ref = Object.fromEntries(r.body.mapping.map((m: any) => [m.clientRef, m]));
    const main = await prisma.task.findUniqueOrThrow({ where: { id: ref.main.id }, include: { subtasks: true } });
    expect(main).toMatchObject({ title: "導入新系統", priority: "high", assignee: f.users.member.memberId, projectId: f.p1.id });
    expect(main.subtasks.map((s) => s.title).sort()).toEqual(["系統測試", "需求訪談"]);
    expect(ref.s1).toMatchObject({ kind: "subtask", parentTaskId: ref.main.id });
    const ext = await prisma.subTask.findUniqueOrThrow({ where: { id: ref.ext.id } });
    expect(ext.taskId).toBe(f.tasks.unassigned.id);
  });

  it("有一筆失敗時整批不寫入，並列出每筆錯誤", async () => {
    const before = await counts();
    const r = await call("pm", "create_tasks", {
      projectId: f.p1.id, dryRun: false,
      tasks: [
        { clientRef: "ok", title: "正常" },
        { clientRef: "bad1", title: "負責人錯誤", assigneeId: "E-nobody" },
        { clientRef: "bad2", title: "父任務錯誤", parentRef: "missing" },
      ],
    });
    expect(r.body.code).toBe("BAD_REQUEST");
    expect(r.body.details.items.map((x: any) => x.clientRef)).toEqual(["bad1", "bad2"]);
    expect(await counts()).toEqual(before);
  });

  it("各種驗證錯誤：子任務只有一層、parentTaskId 與 parentRef 擇一、clientRef 重複、組長不能設為已完成", async () => {
    const r = await call("pm", "create_tasks", {
      projectId: f.p1.id,
      tasks: [
        { clientRef: "a", title: "主" },
        { clientRef: "b", title: "子", parentRef: "a" },
        { clientRef: "c", title: "孫", parentRef: "b" },
        { clientRef: "d", title: "兩者", parentRef: "a", parentTaskId: f.tasks.done.id },
        { clientRef: "a", title: "重複代號" },
        { clientRef: "e", title: "別專案的父任務", parentTaskId: f.p2Task.id },
      ],
    });
    const err = Object.fromEntries(r.body.items.map((x: any, i: number) => [i, x.errors.join()]));
    expect(err[2]).toContain("子任務只有一層");
    expect(err[3]).toContain("擇一");
    expect(err[4]).toContain("重複");
    expect(err[5]).toContain("不存在於本專案");
    const gl = await call("group_leader", "create_tasks", { projectId: f.p1.id, tasks: [{ clientRef: "x", title: "x", status: "done" }] });
    expect(gl.body.items[0].errors.join()).toContain("已完成");
  });

  it("batchKey 重送不會重複建立，回傳第一次的結果；同一個 key 用於不同內容時拒絕", async () => {
    const args = { ...batch(), dryRun: false, batchKey: "batch-0001-abc" };
    const first = await call("pm", "create_tasks", args);
    const after = await counts();
    const second = await call("pm", "create_tasks", args);
    expect(second.body.replayed).toBe(true);
    expect(second.body.mapping).toEqual(first.body.mapping);
    expect(await counts()).toEqual(after);
    const different = await call("pm", "create_tasks", { ...args, tasks: [{ clientRef: "z", title: "別的" }] });
    expect(different.body.code).toBe("BAD_REQUEST");
    expect(different.body.error).toContain("batchKey");
    // 不同使用者的同一個 key 互不影響
    const other = await call("owner", "create_tasks", args);
    expect(other.body.replayed).toBeUndefined();
    expect(other.body.created).toBe(4);
  });

  it("batchKey 過期後視為新批次", async () => {
    const args = { projectId: f.p1.id, dryRun: false, batchKey: "batch-expired-1", tasks: [{ clientRef: "a", title: "x" }] };
    await call("pm", "create_tasks", args);
    await prisma.toolIdempotency.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    const again = await call("pm", "create_tasks", args);
    expect(again.body.replayed).toBeUndefined();
    expect(await prisma.task.count({ where: { title: "x" } })).toBe(2);
  });

  it("每位負責人只收到一則彙總通知（指派給自己不通知）", async () => {
    await prisma.notification.deleteMany();
    const r = await call("pm", "create_tasks", {
      projectId: f.p1.id, dryRun: false,
      tasks: [
        { clientRef: "a", title: "甲", assigneeId: f.users.member.memberId },
        { clientRef: "b", title: "乙", assigneeId: f.users.member.memberId },
        { clientRef: "c", title: "丙", parentRef: "a", assigneeId: f.users.member.memberId },
        { clientRef: "d", title: "丁", assigneeId: f.users.memberB.memberId },
        { clientRef: "e", title: "戊", assigneeId: f.users.pm.memberId },
      ],
    });
    expect(r.isError).toBe(false);
    const notes = await prisma.notification.findMany();
    expect(notes.map((n) => n.userId).sort()).toEqual([f.users.member.id, f.users.memberB.id].sort());
    const toMember = notes.find((n) => n.userId === f.users.member.id)!;
    expect(toMember.message).toContain("3 個新任務");
    expect(toMember.message).toContain("甲");
  });

  it("疑似重複：完全相同、全半形與空白差異、高度相似；日期不重疊時不列入；不會擋下寫入", async () => {
    await prisma.task.create({ data: { title: "API 串接", startDate: "2026-11-01", endDate: "2026-11-10", projectId: f.p1.id } });
    await prisma.task.create({ data: { title: "撰寫測試計畫書", startDate: "2026-11-01", endDate: "2026-11-10", projectId: f.p1.id } });
    await prisma.task.create({ data: { title: "年度盤點", startDate: "2026-01-01", endDate: "2026-01-31", projectId: f.p1.id } });
    const r = await call("pm", "create_tasks", {
      projectId: f.p1.id,
      tasks: [
        { clientRef: "exact", title: "API 串接", startDate: "2026-11-05", endDate: "2026-11-20" },
        { clientRef: "width", title: "ＡＰＩ　串接", startDate: "2026-11-05" },
        { clientRef: "similar", title: "撰寫測試計劃書", startDate: "2026-11-02", endDate: "2026-11-03" },
        { clientRef: "noOverlap", title: "年度盤點", startDate: "2026-12-01", endDate: "2026-12-31" },
        { clientRef: "noDates", title: "API串接" },
        { clientRef: "different", title: "採購伺服器", startDate: "2026-11-05" },
      ],
    });
    const dup = Object.fromEntries(r.body.items.map((x: any) => [x.clientRef, x.possibleDuplicates]));
    expect(dup.exact[0]).toMatchObject({ title: "API 串接", similarity: 1, dateOverlap: true });
    expect(dup.width[0]).toMatchObject({ title: "API 串接", similarity: 1 });
    expect(dup.similar[0].title).toBe("撰寫測試計畫書");
    expect(dup.similar[0].similarity).toBeGreaterThanOrEqual(DUPLICATE_SIMILARITY_THRESHOLD);
    expect(dup.similar[0].similarity).toBeLessThan(1);
    expect(dup.noOverlap).toEqual([]);
    expect(dup.noDates[0]).toMatchObject({ title: "API 串接", dateOverlap: null });
    expect(dup.different).toEqual([]);
    expect(r.body.summary.possibleDuplicates).toBe(4);
    expect(r.body.summary.withErrors).toBe(0);

    const commit = await call("pm", "create_tasks", { projectId: f.p1.id, dryRun: false, tasks: [{ clientRef: "exact", title: "API 串接" }] });
    expect(commit.isError).toBe(false);
    expect(commit.body.possibleDuplicatesIgnored).toEqual(["exact"]);
  });

  it("相似度與日期重疊的純函式", () => {
    expect(normalizeTitle("ＡＢＣ　 def")).toBe("abcdef");
    expect(titleSimilarity("abc", "abc")).toBe(1);
    expect(titleSimilarity("撰寫測試計畫書", "撰寫測試計劃書")).toBeCloseTo(6 / 7);
    expect(titleSimilarity("會議", "採購")).toBe(0);
    expect(datesOverlap({ start: "2026-01-01", end: "2026-01-10" }, { start: "2026-01-10", end: "2026-01-20" })).toBe(true);
    expect(datesOverlap({ start: "2026-01-01", end: "2026-01-09" }, { start: "2026-01-10" })).toBe(false);
    expect(datesOverlap({}, { start: "2026-01-10" })).toBeNull();
  });

  it("超過 20 筆時拒絕", async () => {
    const tasks = Array.from({ length: 21 }, (_, i) => ({ clientRef: `t${i}`, title: `任務${i}` }));
    expect((await call("pm", "create_tasks", { projectId: f.p1.id, tasks })).body.code).toBe("BAD_REQUEST");
  });
});

// ── update_task ───────────────────────────────────────────────────────

describe("update_task", () => {
  it("回傳修改前後的 diff；帶入正確的 expectedUpdatedAt 可寫入", async () => {
    const current = await call("pm", "get_task", { taskId: f.tasks.ofMember.id });
    const r = await call("pm", "update_task", {
      taskId: f.tasks.ofMember.id, expectedUpdatedAt: current.body.updatedAt,
      changes: { title: "新標題", status: "review", completion: 80 },
    });
    expect(r.isError, JSON.stringify(r.body)).toBe(false);
    expect(r.body.diff.map((d: any) => d.field).sort()).toEqual(["completion", "status", "title"]);
    expect(r.body.diff.find((d: any) => d.field === "title")).toEqual({ field: "title", before: "A組成員的任務", after: "新標題" });
    expect(r.body.task.updatedAt).not.toBe(current.body.updatedAt);
  });

  it("expectedUpdatedAt 與目前不同時拒絕（CONFLICT），回傳最新內容，不寫入", async () => {
    const current = await call("pm", "get_task", { taskId: f.tasks.ofMember.id });
    await restAs("owner").put(`/api/tasks/${f.tasks.ofMember.id}`, { title: "被別人改了" });
    const r = await call("pm", "update_task", { taskId: f.tasks.ofMember.id, expectedUpdatedAt: current.body.updatedAt, changes: { title: "我的修改" } });
    expect(r.body.code).toBe("CONFLICT");
    expect(r.body.details.latest.title).toBe("被別人改了");
    expect((await prisma.task.findUniqueOrThrow({ where: { id: f.tasks.ofMember.id } })).title).toBe("被別人改了");
  });

  it("projectId 等禁止欄位無法寫入；changes 不可為空", async () => {
    const r = await call("pm", "update_task", { taskId: f.tasks.ofMember.id, changes: { title: "x", projectId: f.p2.id, id: "hijack" } });
    expect(r.isError).toBe(false);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: f.tasks.ofMember.id } })).projectId).toBe(f.p1.id);
    expect((await call("pm", "update_task", { taskId: f.tasks.ofMember.id, changes: {} })).body.code).toBe("BAD_REQUEST");
  });

  it("沿用 REST 的商業規則：只有 PM 以上可以移入已完成；null 代表取消指派", async () => {
    expect((await call("group_leader", "update_task", { taskId: f.tasks.ofMember.id, changes: { status: "done" } })).body.code).toBe("FORBIDDEN");
    const r = await call("pm", "update_task", { taskId: f.tasks.ofMember.id, changes: { assigneeId: null, groupId: null } });
    expect(r.body.diff.map((d: any) => [d.field, d.after])).toEqual([["assignee", null], ["group", null]]);
  });
});

// ── 其他寫入工具 ──────────────────────────────────────────────────────

describe("add_comment、create_meeting_record、create_risk", () => {
  it("add_comment 長度上限 2000 字", async () => {
    expect((await call("pm", "add_comment", { taskId: f.tasks.ofMember.id, content: "x".repeat(2001) })).body.code).toBe("BAD_REQUEST");
    const ok = await call("pm", "add_comment", { taskId: f.tasks.ofMember.id, content: "好" });
    expect(ok.body).toMatchObject({ content: "好", author: { name: "專案經理" } });
  });

  it("create_meeting_record：既有系列、新建系列；與會者以員工編號解析，查不到時拒絕", async () => {
    const a = await call("pm", "create_meeting_record", { seriesId: f.series.id, date: "2026-10-01", attendees: [f.users.member.memberId], summary: "決議：下週上線" });
    expect(a.body).toMatchObject({ seriesId: f.series.id, seriesCreated: false, attendees: [{ id: f.users.member.memberId, name: "A組成員" }] });
    const b = await call("pm", "create_meeting_record", { projectId: f.p1.id, seriesName: "臨時檢討會", seriesType: "adhoc", date: "2026-10-02" });
    expect(b.body.seriesCreated).toBe(true);
    expect(await prisma.meetingSeries.findUniqueOrThrow({ where: { id: b.body.seriesId } })).toMatchObject({ name: "臨時檢討會", type: "adhoc", projectId: f.p1.id });
    expect((await call("pm", "create_meeting_record", { seriesId: f.series.id, date: "2026-10-01", attendees: ["王小明"] })).body.error).toContain("找不到與會者");
    expect((await call("pm", "create_meeting_record", { date: "2026-10-01" })).body.code).toBe("BAD_REQUEST");
    expect((await call("pm", "create_meeting_record", { seriesId: f.series.id, date: "2026-10-01", externalLink: "javascript:alert(1)" })).body.code).toBe("BAD_REQUEST");
  });

  it("create_risk：1～5 分對應風險矩陣等級，mitigation 寫入因應對策", async () => {
    const r = await call("member", "create_risk", { projectId: f.p1.id, title: "供應商延遲", probability: 4, impact: 5, mitigation: "備援廠商" });
    expect(r.body).toMatchObject({ score: 20, probability: 4, impact: 5 });
    expect(await prisma.risk.findUniqueOrThrow({ where: { id: r.body.id } })).toMatchObject({ probability: "mid-high", impact: "high", countermeasure: "備援廠商" });
    expect((await call("pm", "create_risk", { projectId: f.p1.id, title: "x", probability: 6, impact: 1 })).body.code).toBe("BAD_REQUEST");
  });
});

// ── 稽核紀錄 ──────────────────────────────────────────────────────────

describe("寫入類稽核紀錄", () => {
  it("記錄 dryRun 旗標與影響筆數；update_task 記錄修改前後摘要", async () => {
    await prisma.mcpAuditLog.deleteMany();
    const args = { projectId: f.p1.id, tasks: [{ clientRef: "a", title: "x" }, { clientRef: "b", title: "y" }] };
    await call("pm", "create_tasks", args);
    await call("pm", "create_tasks", { ...args, dryRun: false });
    await call("pm", "update_task", { taskId: f.tasks.ofMember.id, changes: { completion: 60 } });
    await call("viewer", "create_tasks", { ...args, dryRun: false });
    const logs = await prisma.mcpAuditLog.findMany({ orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => [l.tool, l.success, (l.params as any).dryRun, (l.params as any).affected])).toEqual([
      ["create_tasks", true, true, 0],
      ["create_tasks", true, false, 2],
      ["update_task", true, undefined, 1],
      ["create_tasks", false, false, 0],
    ]);
    expect((logs[0].params as any).tasks).toBe("[2 筆]");
    expect((logs[2].params as any).diff).toEqual([{ field: "completion", before: "0", after: "60" }]);
    expect(logs[3].errorCode).toBe("FORBIDDEN");
  });
});
