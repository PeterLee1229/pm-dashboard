// 掛載 MCP connector 相關的路由：OAuth 授權伺服器、/mcp、同意頁 API、授權管理與系統管理 API。

import express, { type Express, type RequestHandler } from "express";
import cors from "cors";
import rateLimit from "express-rate-limit";
import { z } from "zod";
import { mcpAuthRouter, getOAuthProtectedResourceMetadataUrl } from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { prisma } from "../db";
import { parseInput } from "../errors";
import type { Ctx } from "../services/permissions";
import { getSystemSettings, isMcpEnabled, isMcpWriteEnabled, updateSystemSettings } from "../services/systemSettings";
import { SCOPE_READ, SCOPE_WRITE, SUPPORTED_SCOPES, getMcpConfig } from "./config";
import {
  PrismaOAuthProvider, decideAuthorization, describeAuthorizationRequest, getClientName, listConnections, revokeConnection, sha256,
} from "./oauthProvider";
import { buildMcpServer } from "../tools/adapters/mcp";
import { isWriteTool } from "../tools/registry";
import { INSUFFICIENT_SCOPE_MESSAGE, WRITE_DISABLED_MESSAGE } from "../tools/execute";

/** 這個 JSON-RPC 請求（可能是批次）中呼叫到的寫入工具 */
function writeToolCalls(body: unknown): string[] {
  const msgs = Array.isArray(body) ? body : [body];
  return msgs
    .filter((m): m is { method: string; params?: { name?: unknown } } => !!m && typeof m === "object" && (m as any).method === "tools/call")
    .map((m) => String(m.params?.name ?? ""))
    .filter(isWriteTool);
}

/**
 * /mcp 與 /.well-known/* 允許 claude.ai 與 claude.com 跨來源存取（現有 API 的 CORS 不變）。
 * 必須掛在全域 CORS 之前，否則 preflight 會先被全域 CORS 回應。
 */
export const mcpCors = cors({
  origin: [/^https:\/\/claude\.ai$/, /^https:\/\/claude\.com$/],
  exposedHeaders: ["Mcp-Session-Id", "WWW-Authenticate"],
  allowedHeaders: ["Content-Type", "Authorization", "Mcp-Session-Id", "Mcp-Protocol-Version", "Last-Event-ID"],
});

export function mountMcp(app: Express, deps: { authMiddleware: RequestHandler; requireAdmin: RequestHandler }) {
  const { issuerUrl, resourceUrl } = getMcpConfig();
  const provider = new PrismaOAuthProvider();

  // SDK 以明文比對 client_secret，而 DB 只存 hash：先把請求中的 secret 換成 hash，SDK 便是以 hash 比對 hash
  app.use(["/token", "/revoke"], express.urlencoded({ extended: false }), (req, _res, next) => {
    if (req.body && typeof req.body.client_secret === "string") req.body.client_secret = sha256(req.body.client_secret);
    next();
  });

  // OAuth 授權伺服器：/authorize、/token、/register、/revoke 與 metadata（RFC 8414 / RFC 9728）
  app.use(mcpAuthRouter({
    provider,
    issuerUrl,
    resourceServerUrl: resourceUrl,
    scopesSupported: SUPPORTED_SCOPES,
    resourceName: "PM Dashboard",
    // client secret 不過期（claude.ai 註冊一次後長期使用）
    clientRegistrationOptions: { clientSecretExpirySeconds: 0 },
    tokenOptions: { rateLimit: { windowMs: 60_000, max: 20 } },
  }));

  // RFC 9728 也允許 client 查詢根路徑的 protected resource metadata
  app.get("/.well-known/oauth-protected-resource", (_req, res) => {
    res.json({
      resource: resourceUrl.href,
      authorization_servers: [issuerUrl.href],
      scopes_supported: SUPPORTED_SCOPES,
      resource_name: "PM Dashboard",
    });
  });

  // ── /mcp（Streamable HTTP，stateless：每個請求建立獨立的 server 與 transport） ──

  // 不在 requireBearerAuth 指定 requiredScopes：SDK 會把它寫進 401 的 WWW-Authenticate scope，
  // 而 MCP client 會依此決定要求哪些 scope（只寫 pm:read 時就永遠不會要求 pm:write）。
  // 不指定時 client 改用 metadata 的 scopes_supported（pm:read pm:write），由使用者在同意頁決定是否勾選寫入。
  const bearer = requireBearerAuth({
    verifier: provider,
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(resourceUrl),
    expectedResource: resourceUrl,
  });

  const requireReadScope: RequestHandler = (req: any, res, next) => {
    if (req.auth.scopes.includes(SCOPE_READ)) return next();
    res.status(403)
      .set("WWW-Authenticate", `Bearer error="insufficient_scope", scope="${SCOPE_READ}"`)
      .json({ jsonrpc: "2.0", error: { code: -32003, message: "需要讀取權限（pm:read）" }, id: null });
  };

  const requireMcpEnabled: RequestHandler = async (_req, res, next) => {
    if (!(await isMcpEnabled())) {
      res.status(403).json({ jsonrpc: "2.0", error: { code: -32001, message: "系統未開放 AI 連線" }, id: null });
      return;
    }
    next();
  };

  // 每位使用者每分鐘 60 次
  const mcpLimiter = rateLimit({
    windowMs: 60_000,
    limit: 60,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    keyGenerator: (req) => String((req as any).auth?.extra?.userId ?? "anonymous"),
    message: { jsonrpc: "2.0", error: { code: -32002, message: "請求過於頻繁，請稍後再試" }, id: null },
  });

  // 寫入工具：token 需有 pm:write（否則 403 insufficient_scope，提示重新授權），且系統寫入開關需開啟
  const requireWriteAccess: RequestHandler = async (req: any, res, next) => {
    if (writeToolCalls(req.body).length === 0) return next();
    if (!req.auth.scopes.includes(SCOPE_WRITE)) {
      const { resourceUrl: rs } = getMcpConfig();
      res.status(403)
        .set("WWW-Authenticate", `Bearer error="insufficient_scope", scope="${SCOPE_READ} ${SCOPE_WRITE}", resource_metadata="${getOAuthProtectedResourceMetadataUrl(rs)}"`)
        .json({ jsonrpc: "2.0", error: { code: -32003, message: INSUFFICIENT_SCOPE_MESSAGE, data: { error: "insufficient_scope" } }, id: (req.body as any)?.id ?? null });
      return;
    }
    if (!(await isMcpWriteEnabled())) {
      res.status(403).json({ jsonrpc: "2.0", error: { code: -32001, message: WRITE_DISABLED_MESSAGE }, id: (req.body as any)?.id ?? null });
      return;
    }
    next();
  };

  // 寫入工具另外計算：每位使用者每分鐘 20 次（不與讀取共用額度）
  const writeLimiter = rateLimit({
    windowMs: 60_000,
    limit: 20,
    standardHeaders: "draft-8",
    legacyHeaders: false,
    skip: (req) => writeToolCalls(req.body).length === 0,
    keyGenerator: (req) => `write:${String((req as any).auth?.extra?.userId ?? "anonymous")}`,
    message: { jsonrpc: "2.0", error: { code: -32002, message: "寫入操作過於頻繁，請稍後再試" }, id: null },
  });

  app.post("/mcp", bearer, requireReadScope, requireMcpEnabled, mcpLimiter, requireWriteAccess, writeLimiter, async (req: any, res) => {
    const userId = String(req.auth.extra.userId);
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { role: true } });
    const ctx: Ctx = { userId, systemRole: user?.role ?? "user" };
    const server = buildMcpServer(ctx, {
      clientId: req.auth.clientId,
      clientName: await getClientName(req.auth.clientId),
      scopes: req.auth.scopes,
    });
    const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true });
    res.on("close", () => { transport.close(); server.close(); });
    await server.connect(transport);
    await transport.handleRequest(req, res, req.body);
  });

  // stateless 模式不支援 SSE 串流與 session 結束
  const methodNotAllowed: RequestHandler = (_req, res) => {
    res.status(405).set("Allow", "POST").json({ jsonrpc: "2.0", error: { code: -32000, message: "Method not allowed" }, id: null });
  };
  app.get("/mcp", methodNotAllowed);
  app.delete("/mcp", methodNotAllowed);

  // ── 前端同意頁 API（以一般登入 JWT 驗證） ──

  app.get("/api/oauth/consent", deps.authMiddleware, async (req, res) => {
    res.json(await describeAuthorizationRequest(req.query.request));
  });

  app.post("/api/oauth/consent", deps.authMiddleware, async (req: any, res) => {
    const { request, approve, scopes } = parseInput(z.object({
      request: z.string().min(1),
      approve: z.boolean(),
      /** 使用者勾選要授權的權限；未提供時授權全部要求的權限 */
      scopes: z.array(z.string()).optional(),
    }), req.body);
    res.json(await decideAuthorization(req.ctx.userId, request, approve, scopes));
  });

  // ── 個人設定：已授權的 AI 連線 ──

  app.get("/api/oauth/connections", deps.authMiddleware, async (req: any, res) => {
    res.json(await listConnections(req.ctx.userId));
  });

  app.delete("/api/oauth/connections/:id", deps.authMiddleware, async (req: any, res) => {
    await revokeConnection(req.ctx.userId, req.params.id);
    res.json({ success: true });
  });

  // ── 系統管理：MCP 開關與稽核紀錄（僅 Admin） ──

  app.get("/api/admin/mcp/settings", deps.authMiddleware, deps.requireAdmin, async (_req, res) => {
    res.json(await getSystemSettings());
  });

  app.put("/api/admin/mcp/settings", deps.authMiddleware, deps.requireAdmin, async (req: any, res) => {
    res.json(await updateSystemSettings(req.ctx, req.body));
  });

  const auditQuerySchema = z.object({
    userId: z.string().optional(),
    tool: z.string().optional(),
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    limit: z.coerce.number().int().min(1).max(200).default(50),
    offset: z.coerce.number().int().min(0).default(0),
  });

  app.get("/api/admin/mcp/audit-logs", deps.authMiddleware, deps.requireAdmin, async (req, res) => {
    const q = parseInput(auditQuerySchema, req.query);
    const createdAt: { gte?: Date; lte?: Date } = {};
    if (q.from) createdAt.gte = new Date(`${q.from}T00:00:00+08:00`);
    if (q.to) createdAt.lte = new Date(`${q.to}T23:59:59.999+08:00`);
    const where = {
      ...(q.userId ? { userId: q.userId } : {}),
      ...(q.tool ? { tool: q.tool } : {}),
      ...(q.from || q.to ? { createdAt } : {}),
    };
    const [total, rows] = await Promise.all([
      prisma.mcpAuditLog.count({ where }),
      prisma.mcpAuditLog.findMany({ where, orderBy: { createdAt: "desc" }, skip: q.offset, take: q.limit }),
    ]);
    const [users, clients] = await Promise.all([
      prisma.user.findMany({ where: { id: { in: [...new Set(rows.map((r) => r.userId))] } }, select: { id: true, name: true, memberId: true } }),
      prisma.oAuthClient.findMany({ where: { clientId: { in: [...new Set(rows.map((r) => r.clientId))] } }, select: { clientId: true, clientName: true } }),
    ]);
    res.json({
      total,
      items: rows.map((r) => ({
        ...r,
        user: users.find((u) => u.id === r.userId) ?? null,
        clientName: clients.find((c) => c.clientId === r.clientId)?.clientName ?? null,
      })),
    });
  });
}
