// OAuth 2.1 授權流程與 /mcp 存取控制（透過 HTTP 端到端測試）
import crypto from "node:crypto";
import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { Fixture, api, resetAndSeed } from "./fixtures";

const CLAUDE_CALLBACK = "https://claude.ai/api/mcp/auth_callback";
const RESOURCE = "http://localhost:3000/mcp";

let f: Fixture;
beforeEach(async () => {
  f = await resetAndSeed();
  await prisma.systemSetting.create({ data: { id: 1, mcpEnabled: true } });
});

const sha256hex = (v: string) => crypto.createHash("sha256").update(v).digest("hex");

function pkce() {
  const verifier = crypto.randomBytes(32).toString("base64url");
  const challenge = crypto.createHash("sha256").update(verifier).digest("base64url");
  return { verifier, challenge };
}

// SDK 內建 DCR rate limit（每個 IP 每小時 20 次）；測試中每次註冊使用不同的來源 IP
let registerSeq = 0;
async function register(redirectUris = [CLAUDE_CALLBACK]) {
  registerSeq++;
  return api().post("/register").set("X-Forwarded-For", `10.0.${Math.floor(registerSeq / 250)}.${registerSeq % 250}`).send({
    client_name: "Claude", redirect_uris: redirectUris,
    token_endpoint_auth_method: "client_secret_post",
    grant_types: ["authorization_code", "refresh_token"], response_types: ["code"],
  });
}

/** 走完 authorize → 同意頁 → 取得 auth code */
async function authorize(client: { client_id: string }, userToken: string, opts: { scope?: string; approve?: boolean; grant?: string[] } = {}) {
  const { verifier, challenge } = pkce();
  const auth = await api().get("/authorize").query({
    response_type: "code", client_id: client.client_id, redirect_uri: CLAUDE_CALLBACK,
    code_challenge: challenge, code_challenge_method: "S256", state: "xyz",
    scope: opts.scope ?? "pm:read", resource: RESOURCE,
  });
  expect(auth.status).toBe(302);
  const consentUrl = new URL(auth.headers.location);
  if (consentUrl.pathname !== "/oauth/consent") return { verifier, redirect: consentUrl, code: null as string | null };
  const request = consentUrl.searchParams.get("request")!;
  const decision = await api().post("/api/oauth/consent").set("Authorization", `Bearer ${userToken}`)
    .send({ request, approve: opts.approve ?? true, ...(opts.grant ? { scopes: opts.grant } : {}) });
  const redirect = decision.body.redirectUrl ? new URL(decision.body.redirectUrl) : (null as unknown as URL);
  return { verifier, redirect, code: redirect?.searchParams.get("code") ?? null, decision, request };
}

function exchange(client: { client_id: string; client_secret: string }, form: Record<string, string>, ip?: string) {
  // /token 每個 IP 每分鐘 20 次；未指定 IP 時每次使用不同的來源 IP
  registerSeq++;
  return api().post("/token").type("form").set("X-Forwarded-For", ip ?? `10.1.${Math.floor(registerSeq / 250)}.${registerSeq % 250}`)
    .send({ client_id: client.client_id, client_secret: client.client_secret, ...form });
}

async function connect(userToken: string) {
  const client = (await register()).body;
  const { code, verifier } = await authorize(client, userToken);
  const tokens = await exchange(client, { grant_type: "authorization_code", code: code!, code_verifier: verifier, redirect_uri: CLAUDE_CALLBACK });
  expect(tokens.status, JSON.stringify(tokens.body)).toBe(200);
  return { client, tokens: tokens.body as { access_token: string; refresh_token: string; expires_in: number; scope: string } };
}

const callMcp = (accessToken: string, name = "list_projects", args: Record<string, unknown> = {}) =>
  api().post("/mcp").set("Authorization", `Bearer ${accessToken}`).set("Accept", "application/json, text/event-stream")
    .send({ jsonrpc: "2.0", id: 1, method: "tools/call", params: { name, arguments: args } });

describe("metadata", () => {
  it("RFC 8414 授權伺服器 metadata", async () => {
    const res = await api().get("/.well-known/oauth-authorization-server");
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({
      issuer: "http://localhost:3000/",
      authorization_endpoint: "http://localhost:3000/authorize",
      token_endpoint: "http://localhost:3000/token",
      registration_endpoint: "http://localhost:3000/register",
      revocation_endpoint: "http://localhost:3000/revoke",
      code_challenge_methods_supported: ["S256"],
      scopes_supported: ["pm:read", "pm:write"],
    });
  });

  it("RFC 9728 protected resource metadata（路徑版與根路徑版）", async () => {
    for (const path of ["/.well-known/oauth-protected-resource/mcp", "/.well-known/oauth-protected-resource"]) {
      const res = await api().get(path);
      expect(res.status, path).toBe(200);
      expect(res.body).toMatchObject({ resource: RESOURCE, authorization_servers: ["http://localhost:3000/"] });
    }
  });

  it("未帶 token 呼叫 /mcp 得 401，並在 WWW-Authenticate 指向 resource metadata", async () => {
    const res = await api().post("/mcp").send({ jsonrpc: "2.0", id: 1, method: "tools/list" });
    expect(res.status).toBe(401);
    expect(res.headers["www-authenticate"]).toContain("resource_metadata=\"http://localhost:3000/.well-known/oauth-protected-resource/mcp\"");
    // 不在 401 限縮 scope：MCP client 會依此決定要求哪些 scope，限縮成 pm:read 會讓使用者無法選擇寫入
    expect(res.headers["www-authenticate"]).not.toContain("scope=");
    const prm = await api().get("/.well-known/oauth-protected-resource/mcp");
    expect(prm.body.scopes_supported).toEqual(["pm:read", "pm:write"]);
  });

  it("/mcp 與 /.well-known 允許 claude.ai 跨來源；其他來源不允許", async () => {
    const ok = await api().options("/mcp").set("Origin", "https://claude.ai").set("Access-Control-Request-Method", "POST");
    expect(ok.headers["access-control-allow-origin"]).toBe("https://claude.ai");
    const comMcp = await api().options("/mcp").set("Origin", "https://claude.com").set("Access-Control-Request-Method", "POST");
    expect(comMcp.headers["access-control-allow-origin"]).toBe("https://claude.com");
    // metadata 是公開的探索資訊，SDK 對 /.well-known 一律回應 *
    const com = await api().get("/.well-known/oauth-authorization-server").set("Origin", "https://claude.com");
    expect(["*", "https://claude.com"]).toContain(com.headers["access-control-allow-origin"]);
    const evil = await api().options("/mcp").set("Origin", "https://evil.example").set("Access-Control-Request-Method", "POST");
    expect(evil.headers["access-control-allow-origin"]).toBeUndefined();
  });
});

describe("Dynamic Client Registration", () => {
  it("redirect URI 不在白名單時拒絕", async () => {
    const res = await register(["https://evil.example/callback"]);
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_client_metadata");
    const mixed = await register([CLAUDE_CALLBACK, "https://evil.example/callback"]);
    expect(mixed.status).toBe(400);
    expect(await prisma.oAuthClient.count()).toBe(0);
  });

  it("claude.ai 與 claude.com 的 callback 可以註冊；client secret 只存 hash", async () => {
    const res = await register([CLAUDE_CALLBACK, "https://claude.com/api/mcp/auth_callback"]);
    expect(res.status).toBe(201);
    expect(res.body.client_secret).toBeTruthy();
    const row = await prisma.oAuthClient.findUniqueOrThrow({ where: { clientId: res.body.client_id } });
    expect(row.clientSecretHash).toBe(sha256hex(res.body.client_secret));
    expect(JSON.stringify(row)).not.toContain(res.body.client_secret);
  });
});

describe("授權流程", () => {
  it("完整流程：註冊 → 同意 → 換 token → 呼叫 /mcp；token 與 code 只存 hash", async () => {
    const { tokens } = await connect(f.tokens.member);
    expect(tokens).toMatchObject({ scope: "pm:read", expires_in: 3600 });
    const row = await prisma.oAuthToken.findFirstOrThrow();
    expect(row.accessTokenHash).toBe(sha256hex(tokens.access_token));
    expect(row.refreshTokenHash).toBe(sha256hex(tokens.refresh_token));
    expect(row.userId).toBe(f.users.member.id);
    expect(row.refreshExpiresAt.getTime() - row.createdAt.getTime()).toBeGreaterThan(29 * 86400_000);

    const res = await callMcp(tokens.access_token);
    expect(res.status).toBe(200);
    const projects = JSON.parse(res.body.result.content[0].text).items;
    expect(projects.map((p: any) => p.id).sort()).toEqual([f.p1.id, f.p2.id].sort());
  });

  it("authorize 導向前端同意頁；同意頁 API 回傳 client 名稱", async () => {
    const client = (await register()).body;
    const { request } = await authorize(client, f.tokens.member, { approve: false });
    const res = await api().get("/api/oauth/consent").query({ request }).set("Authorization", `Bearer ${f.tokens.member}`);
    expect(res.body).toMatchObject({ mcpEnabled: true, clientName: "Claude", scopes: ["pm:read"] });
    expect((await api().get("/api/oauth/consent").query({ request })).status).toBe(401);
  });

  it("使用者拒絕時導回 error=access_denied，不核發 code", async () => {
    const client = (await register()).body;
    const { redirect, code } = await authorize(client, f.tokens.member, { approve: false });
    expect(code).toBeNull();
    expect(redirect.searchParams.get("error")).toBe("access_denied");
    expect(redirect.searchParams.get("state")).toBe("xyz");
    expect(await prisma.oAuthAuthCode.count()).toBe(0);
  });

  // Phase 2：開始核發 pm:write；使用者可在同意頁取消勾選寫入
  it("同意頁勾選讀取與寫入：核發 pm:read pm:write", async () => {
    const client = (await register()).body;
    const { code, verifier } = await authorize(client, f.tokens.member, { scope: "pm:read pm:write", grant: ["pm:read", "pm:write"] });
    const t = await exchange(client, { grant_type: "authorization_code", code: code!, code_verifier: verifier, redirect_uri: CLAUDE_CALLBACK });
    expect(t.body.scope).toBe("pm:read pm:write");
  });

  it("同意頁取消勾選寫入：只核發 pm:read", async () => {
    const client = (await register()).body;
    const { code, verifier } = await authorize(client, f.tokens.member, { scope: "pm:read pm:write", grant: ["pm:read"] });
    const t = await exchange(client, { grant_type: "authorization_code", code: code!, code_verifier: verifier, redirect_uri: CLAUDE_CALLBACK });
    expect(t.body.scope).toBe("pm:read");
  });

  it("未指定 scope 時同意頁列出讀取與寫入；不帶勾選結果則全部核發", async () => {
    const client = (await register()).body;
    const res = await api().get("/authorize").query({
      response_type: "code", client_id: client.client_id, redirect_uri: CLAUDE_CALLBACK,
      code_challenge: pkce().challenge, code_challenge_method: "S256",
    });
    const request = new URL(res.headers.location).searchParams.get("request");
    const info = await api().get("/api/oauth/consent").query({ request }).set("Authorization", `Bearer ${f.tokens.member}`);
    expect(info.body).toMatchObject({ scopes: ["pm:read", "pm:write"], mcpWriteEnabled: false });
  });

  it("只要求 pm:write 時一併要求 pm:read（讀取為必要）", async () => {
    const client = (await register()).body;
    const { code, verifier } = await authorize(client, f.tokens.member, { scope: "pm:write" });
    const t = await exchange(client, { grant_type: "authorization_code", code: code!, code_verifier: verifier, redirect_uri: CLAUDE_CALLBACK });
    expect(t.body.scope).toBe("pm:read pm:write");
  });

  it("不能授權超出要求範圍的權限、不能取消讀取", async () => {
    const client = (await register()).body;
    const a = await authorize(client, f.tokens.member, { scope: "pm:read", grant: ["pm:read", "pm:write"] });
    expect(a.decision!.status).toBe(400);
    const b = await authorize(client, f.tokens.member, { scope: "pm:read pm:write", grant: ["pm:write"] });
    expect(b.decision!.status).toBe(400);
  });

  it("不支援的 scope 導回 error=invalid_scope", async () => {
    const client = (await register()).body;
    const { redirect } = await authorize(client, f.tokens.member, { scope: "pm:read pm:admin" });
    expect(redirect.origin + redirect.pathname).toBe(CLAUDE_CALLBACK);
    expect(redirect.searchParams.get("error")).toBe("invalid_scope");
  });

  it("既有的 pm:read token 不會自動升級：refresh 時不能要求 pm:write", async () => {
    const client = (await register()).body;
    const { code, verifier } = await authorize(client, f.tokens.member, { scope: "pm:read" });
    const t = (await exchange(client, { grant_type: "authorization_code", code: code!, code_verifier: verifier, redirect_uri: CLAUDE_CALLBACK })).body;
    expect(t.scope).toBe("pm:read");
    const up = await exchange(client, { grant_type: "refresh_token", refresh_token: t.refresh_token, scope: "pm:read pm:write" });
    expect(up.status).toBe(400);
    expect(up.body.error).toBe("invalid_scope");
    const same = await exchange(client, { grant_type: "refresh_token", refresh_token: t.refresh_token });
    expect(same.body.scope).toBe("pm:read");
  });

  it("authorize 的 redirect URI 未註冊時拒絕", async () => {
    const client = (await register()).body;
    const res = await api().get("/authorize").query({
      response_type: "code", client_id: client.client_id, redirect_uri: "https://evil.example/cb",
      code_challenge: pkce().challenge, code_challenge_method: "S256",
    });
    expect(res.status).toBe(400);
    expect(res.headers.location).toBeUndefined();
  });

  it("不支援 PKCE plain", async () => {
    const client = (await register()).body;
    const res = await api().get("/authorize").query({
      response_type: "code", client_id: client.client_id, redirect_uri: CLAUDE_CALLBACK,
      code_challenge: "abc", code_challenge_method: "plain",
    });
    expect(res.status).toBe(302);
    expect(new URL(res.headers.location).searchParams.get("error")).toBe("invalid_request");
  });

  it("PKCE 驗證失敗時拒絕", async () => {
    const client = (await register()).body;
    const { code } = await authorize(client, f.tokens.member);
    const res = await exchange(client, { grant_type: "authorization_code", code: code!, code_verifier: pkce().verifier, redirect_uri: CLAUDE_CALLBACK });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_grant");
    expect(await prisma.oAuthToken.count()).toBe(0);
  });

  it("auth code 重複使用時拒絕，並撤銷該 code 核發的所有 token", async () => {
    const client = (await register()).body;
    const { code, verifier } = await authorize(client, f.tokens.member);
    const form = { grant_type: "authorization_code", code: code!, code_verifier: verifier, redirect_uri: CLAUDE_CALLBACK };
    const first = await exchange(client, form);
    expect(first.status).toBe(200);
    expect((await callMcp(first.body.access_token)).status).toBe(200);

    const second = await exchange(client, form);
    expect(second.status).toBe(400);
    expect(second.body.error).toBe("invalid_grant");
    expect((await callMcp(first.body.access_token)).status).toBe(401);
    const refresh = await exchange(client, { grant_type: "refresh_token", refresh_token: first.body.refresh_token });
    expect(refresh.status).toBe(400);
  });

  it("其他 client 不能使用別人的 auth code", async () => {
    const a = (await register()).body;
    const b = (await register()).body;
    const { code, verifier } = await authorize(a, f.tokens.member);
    const res = await exchange(b, { grant_type: "authorization_code", code: code!, code_verifier: verifier, redirect_uri: CLAUDE_CALLBACK });
    expect(res.status).toBe(400);
  });

  it("client secret 錯誤時拒絕", async () => {
    const client = (await register()).body;
    const { code, verifier } = await authorize(client, f.tokens.member);
    const res = await exchange({ ...client, client_secret: "wrong" }, { grant_type: "authorization_code", code: code!, code_verifier: verifier });
    expect(res.status).toBe(400);
    expect(res.body.error).toBe("invalid_client");
  });

  it("refresh token rotate：取得新 token，舊的 refresh 與 access token 失效", async () => {
    const { client, tokens } = await connect(f.tokens.member);
    const refreshed = await exchange(client, { grant_type: "refresh_token", refresh_token: tokens.refresh_token });
    expect(refreshed.status).toBe(200);
    expect(refreshed.body.refresh_token).not.toBe(tokens.refresh_token);
    expect((await callMcp(refreshed.body.access_token)).status).toBe(200);

    const reuse = await exchange(client, { grant_type: "refresh_token", refresh_token: tokens.refresh_token });
    expect(reuse.status).toBe(400);
    expect(reuse.body.error).toBe("invalid_grant");
    expect((await callMcp(tokens.access_token)).status).toBe(401);
  });
});

describe("token 即時失效", () => {
  it("使用者被停用後，既有 token 立即失效；refresh 也被拒絕", async () => {
    const { client, tokens } = await connect(f.tokens.member);
    await prisma.user.update({ where: { id: f.users.member.id }, data: { isActive: false } });
    expect((await callMcp(tokens.access_token)).status).toBe(401);
    expect((await exchange(client, { grant_type: "refresh_token", refresh_token: tokens.refresh_token })).status).toBe(400);
  });

  it("使用者被刪除後，既有 token 立即失效", async () => {
    const { tokens } = await connect(f.tokens.outsider);
    await prisma.user.delete({ where: { id: f.users.outsider.id } });
    expect((await callMcp(tokens.access_token)).status).toBe(401);
  });

  it("mcpEnabled 設為 false 後 /mcp 回 403；同意頁顯示未開放且不能核發 code", async () => {
    const { tokens } = await connect(f.tokens.member);
    await prisma.systemSetting.update({ where: { id: 1 }, data: { mcpEnabled: false } });
    expect((await callMcp(tokens.access_token)).status).toBe(403);

    const client = (await register()).body;
    const { decision, request } = await authorize(client, f.tokens.member);
    expect(decision!.status).toBe(403);
    const info = await api().get("/api/oauth/consent").query({ request }).set("Authorization", `Bearer ${f.tokens.member}`);
    expect(info.body.mcpEnabled).toBe(false);
  });

  it("系統設定尚未建立時視為關閉", async () => {
    const { tokens } = await connect(f.tokens.member);
    await prisma.systemSetting.deleteMany();
    expect((await callMcp(tokens.access_token)).status).toBe(403);
  });

  it("透過 /revoke 撤銷後立即失效", async () => {
    const { client, tokens } = await connect(f.tokens.member);
    const res = await api().post("/revoke").type("form")
      .send({ client_id: client.client_id, client_secret: client.client_secret, token: tokens.access_token });
    expect(res.status).toBe(200);
    expect((await callMcp(tokens.access_token)).status).toBe(401);
  });
});

describe("已授權的 AI 連線（使用者管理）", () => {
  it("列出有效授權；撤銷後 /mcp 401、refresh 被拒（需重新授權）", async () => {
    const { client, tokens } = await connect(f.tokens.member);
    await callMcp(tokens.access_token);
    const list = await api().get("/api/oauth/connections").set("Authorization", `Bearer ${f.tokens.member}`);
    expect(list.body).toHaveLength(1);
    expect(list.body[0]).toMatchObject({ clientName: "Claude", scope: "pm:read" });
    expect(list.body[0].lastUsedAt).toBeTruthy();
    expect(JSON.stringify(list.body)).not.toContain("Hash");

    const del = await api().delete(`/api/oauth/connections/${list.body[0].id}`).set("Authorization", `Bearer ${f.tokens.member}`);
    expect(del.status).toBe(200);
    expect((await callMcp(tokens.access_token)).status).toBe(401);
    expect((await exchange(client, { grant_type: "refresh_token", refresh_token: tokens.refresh_token })).status).toBe(400);
    const after = await api().get("/api/oauth/connections").set("Authorization", `Bearer ${f.tokens.member}`);
    expect(after.body).toHaveLength(0);
  });

  it("refresh rotate 後仍只顯示一筆，撤銷時整串一起撤銷", async () => {
    const { client, tokens } = await connect(f.tokens.member);
    const refreshed = (await exchange(client, { grant_type: "refresh_token", refresh_token: tokens.refresh_token })).body;
    const list = await api().get("/api/oauth/connections").set("Authorization", `Bearer ${f.tokens.member}`);
    expect(list.body).toHaveLength(1);
    await api().delete(`/api/oauth/connections/${list.body[0].id}`).set("Authorization", `Bearer ${f.tokens.member}`);
    expect((await callMcp(refreshed.access_token)).status).toBe(401);
  });

  it("不能撤銷別人的授權", async () => {
    await connect(f.tokens.member);
    const id = (await prisma.oAuthToken.findFirstOrThrow()).id;
    const res = await api().delete(`/api/oauth/connections/${id}`).set("Authorization", `Bearer ${f.tokens.pm}`);
    expect(res.status).toBe(404);
    const others = await api().get("/api/oauth/connections").set("Authorization", `Bearer ${f.tokens.pm}`);
    expect(others.body).toHaveLength(0);
  });
});

describe("稽核紀錄", () => {
  it("每次呼叫（含失敗）都寫入 McpAuditLog", async () => {
    const { tokens } = await connect(f.tokens.member);
    await callMcp(tokens.access_token, "list_projects");
    await callMcp(tokens.access_token, "get_task", { taskId: "does-not-exist" });
    const logs = await prisma.mcpAuditLog.findMany({ orderBy: { createdAt: "asc" } });
    expect(logs.map((l) => [l.tool, l.success, l.errorCode])).toEqual([
      ["list_projects", true, null],
      ["get_task", false, "NOT_FOUND"],
    ]);
    expect(logs[0]).toMatchObject({ userId: f.users.member.id, resultCount: 2 });
    expect(logs[1].params).toEqual({ taskId: "does-not-exist" });
  });
});

describe("系統管理 API", () => {
  it("只有 Admin 可以讀取與切換 mcpEnabled", async () => {
    expect((await api().get("/api/admin/mcp/settings").set("Authorization", `Bearer ${f.tokens.owner}`)).status).toBe(403);
    expect((await api().put("/api/admin/mcp/settings").set("Authorization", `Bearer ${f.tokens.owner}`).send({ mcpEnabled: false })).status).toBe(403);
    const res = await api().put("/api/admin/mcp/settings").set("Authorization", `Bearer ${f.tokens.admin}`).send({ mcpEnabled: false });
    expect(res.body).toMatchObject({ mcpEnabled: false, updatedBy: f.users.admin.id });
    expect((await api().get("/api/admin/mcp/settings").set("Authorization", `Bearer ${f.tokens.admin}`)).body.mcpEnabled).toBe(false);
  });

  it("稽核紀錄查詢可依使用者與工具篩選（僅 Admin）", async () => {
    const a = await connect(f.tokens.member);
    const b = await connect(f.tokens.pm);
    await callMcp(a.tokens.access_token, "list_projects");
    await callMcp(b.tokens.access_token, "list_overdue_tasks");
    const q = (query: Record<string, string>, token = f.tokens.admin) =>
      api().get("/api/admin/mcp/audit-logs").query(query).set("Authorization", `Bearer ${token}`);
    expect((await q({}, f.tokens.pm)).status).toBe(403);
    expect((await q({})).body.total).toBe(2);
    const byUser = (await q({ userId: f.users.member.id })).body;
    expect(byUser.items.map((x: any) => x.tool)).toEqual(["list_projects"]);
    expect(byUser.items[0]).toMatchObject({ user: { name: "A組成員" }, clientName: "Claude" });
    expect((await q({ tool: "list_overdue_tasks" })).body.total).toBe(1);
    expect((await q({ from: "2000-01-01", to: "2000-01-02" })).body.total).toBe(0);
  });
});

describe("rate limit", () => {
  it("/token 每個 IP 每分鐘 20 次", async () => {
    const client = (await register()).body;
    const statuses = [];
    for (let i = 0; i < 21; i++) {
      statuses.push((await exchange(client, { grant_type: "refresh_token", refresh_token: "x" }, "198.51.100.7")).status);
    }
    expect(statuses.slice(0, 20).every((s) => s === 400)).toBe(true);
    expect(statuses[20]).toBe(429);
  });

  it("/mcp 每位使用者每分鐘 60 次", async () => {
    const { tokens } = await connect(f.tokens.viewer);
    const statuses = [];
    for (let i = 0; i < 61; i++) {
      statuses.push((await api().post("/mcp").set("Authorization", `Bearer ${tokens.access_token}`)
        .set("Accept", "application/json, text/event-stream").send({ jsonrpc: "2.0", id: i, method: "tools/list" })).status);
    }
    expect(statuses.slice(0, 60).every((s) => s === 200)).toBe(true);
    expect(statuses[60]).toBe(429);
  });
});
