// OAuth 2.1 授權伺服器（搭配 SDK 的 mcpAuthRouter），資料存在 Prisma。
// token、auth code、client secret 一律只存 SHA-256 hash。

import crypto from "node:crypto";
import type { Response } from "express";
import jwt from "jsonwebtoken";
import type { OAuthServerProvider, AuthorizationParams } from "@modelcontextprotocol/sdk/server/auth/provider.js";
import type { OAuthRegisteredClientsStore } from "@modelcontextprotocol/sdk/server/auth/clients.js";
import type { AuthInfo } from "@modelcontextprotocol/sdk/server/auth/types.js";
import type {
  OAuthClientInformationFull, OAuthTokenRevocationRequest, OAuthTokens,
} from "@modelcontextprotocol/sdk/shared/auth.js";
import {
  InvalidClientMetadataError, InvalidGrantError, InvalidScopeError, InvalidTargetError, InvalidTokenError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { prisma } from "../db";
import { BadRequestError, ForbiddenError, NotFoundError } from "../errors";
import { isMcpEnabled } from "../services/systemSettings";
import {
  ACCESS_TOKEN_TTL_MS, AUTH_CODE_TTL_MS, AUTH_REQUEST_TTL_SECONDS, REFRESH_TOKEN_TTL_MS,
  SCOPE_READ, SCOPE_WRITE, SUPPORTED_SCOPES, getMcpConfig,
} from "./config";

export const sha256 = (value: string) => crypto.createHash("sha256").update(value).digest("hex");
const newSecret = () => crypto.randomBytes(32).toString("base64url");

/** 比較 resource indicator（忽略結尾斜線與 fragment） */
function sameResource(a: string | URL | undefined, b: string | URL): boolean {
  if (!a) return false;
  const norm = (v: string | URL) => String(v).split("#")[0].replace(/\/$/, "");
  return norm(a) === norm(b);
}

// ── Client 註冊（DCR） ────────────────────────────────────────────────

class PrismaClientsStore implements OAuthRegisteredClientsStore {
  async getClient(clientId: string): Promise<OAuthClientInformationFull | undefined> {
    const row = await prisma.oAuthClient.findUnique({ where: { clientId } });
    if (!row) return undefined;
    return {
      ...(row.metadata as object),
      redirect_uris: row.redirectUris,
      client_name: row.clientName ?? undefined,
      client_id: row.clientId,
      client_id_issued_at: Math.floor(row.createdAt.getTime() / 1000),
      // SDK 以明文比對 client_secret；hashClientSecret middleware 會先把請求中的 secret 換成 hash 再比對
      client_secret: row.clientSecretHash ?? undefined,
      client_secret_expires_at: row.clientSecretHash ? 0 : undefined,
    } as OAuthClientInformationFull;
  }

  async registerClient(client: OAuthClientInformationFull): Promise<OAuthClientInformationFull> {
    const { allowedRedirectUris } = getMcpConfig();
    const rejected = client.redirect_uris.filter((u) => !allowedRedirectUris.includes(String(u)));
    if (client.redirect_uris.length === 0 || rejected.length > 0) {
      throw new InvalidClientMetadataError(`redirect_uri 不在允許清單內：${rejected.join(", ") || "（未提供）"}`);
    }
    const { client_secret, client_id, client_id_issued_at, client_secret_expires_at, ...metadata } = client;
    await prisma.oAuthClient.create({
      data: {
        clientId: client_id,
        clientSecretHash: client_secret ? sha256(client_secret) : null,
        clientName: client.client_name ?? null,
        redirectUris: client.redirect_uris.map(String),
        metadata: metadata as object,
      },
    });
    // 回應給 client 的是明文 secret（僅此一次），DB 只存 hash
    return client;
  }
}

// ── 授權請求（authorize → 前端同意頁 → 核發 auth code） ──────────────

type PendingAuthorization = {
  clientId: string;
  redirectUri: string;
  codeChallenge: string;
  scope: string;
  state?: string;
  resource?: string;
};

// 與登入 JWT 使用不同的 key，避免授權請求被當成登入憑證
const requestKey = () => `${process.env.JWT_SECRET}:mcp-consent-request`;

export function signAuthorizationRequest(p: PendingAuthorization): string {
  return jwt.sign(p, requestKey(), { expiresIn: AUTH_REQUEST_TTL_SECONDS, audience: "mcp-consent" });
}

export function readAuthorizationRequest(token: unknown): PendingAuthorization {
  if (typeof token !== "string" || !token) throw new BadRequestError("缺少授權請求");
  try {
    return jwt.verify(token, requestKey(), { audience: "mcp-consent" }) as PendingAuthorization;
  } catch {
    throw new BadRequestError("授權請求無效或已過期，請回到 AI 服務重新連線");
  }
}

function buildRedirect(redirectUri: string, params: Record<string, string | undefined>): string {
  const url = new URL(redirectUri);
  for (const [k, v] of Object.entries(params)) if (v !== undefined) url.searchParams.set(k, v);
  return url.href;
}

/** 同意頁顯示用：client 名稱與要求的權限 */
export async function describeAuthorizationRequest(requestToken: unknown) {
  const req = readAuthorizationRequest(requestToken);
  const client = await prisma.oAuthClient.findUnique({ where: { clientId: req.clientId } });
  if (!client) throw new NotFoundError("找不到要求授權的應用程式");
  return {
    mcpEnabled: await isMcpEnabled(),
    clientName: client.clientName || "未命名的應用程式",
    redirectHost: new URL(req.redirectUri).host,
    scopes: req.scope.split(" "),
  };
}

/**
 * 使用者在同意頁按下「允許」或「拒絕」。回傳要導回 client 的網址。
 * 允許時核發 auth code（綁定目前登入的使用者），拒絕時帶 error=access_denied。
 */
export async function decideAuthorization(userId: string, requestToken: unknown, approve: boolean) {
  const req = readAuthorizationRequest(requestToken);
  const client = await prisma.oAuthClient.findUnique({ where: { clientId: req.clientId } });
  if (!client || !client.redirectUris.includes(req.redirectUri)) throw new BadRequestError("授權請求無效");

  if (!approve) {
    return { redirectUrl: buildRedirect(req.redirectUri, { error: "access_denied", error_description: "使用者拒絕授權", state: req.state }) };
  }
  if (!(await isMcpEnabled())) throw new ForbiddenError("系統未開放 AI 連線");

  const code = newSecret();
  await prisma.oAuthAuthCode.create({
    data: {
      codeHash: sha256(code),
      clientId: req.clientId,
      userId,
      redirectUri: req.redirectUri,
      codeChallenge: req.codeChallenge,
      scope: req.scope,
      resource: req.resource ?? null,
      expiresAt: new Date(Date.now() + AUTH_CODE_TTL_MS),
    },
  });
  return { redirectUrl: buildRedirect(req.redirectUri, { code, state: req.state }) };
}

// ── Token ─────────────────────────────────────────────────────────────

/** 使用者是否存在且啟用、系統是否開放 MCP；不符合時回傳原因 */
async function grantBlockedReason(userId: string): Promise<string | null> {
  const user = await prisma.user.findUnique({ where: { id: userId }, select: { isActive: true } });
  if (!user) return "使用者不存在";
  if (!user.isActive) return "帳號已被停用";
  if (!(await isMcpEnabled())) return "系統未開放 AI 連線";
  return null;
}

async function issueTokens(data: { clientId: string; userId: string; scope: string; resource: string | null; authCodeId: string | null }): Promise<OAuthTokens> {
  const accessToken = newSecret();
  const refreshToken = newSecret();
  const now = Date.now();
  await prisma.oAuthToken.create({
    data: {
      ...data,
      accessTokenHash: sha256(accessToken),
      refreshTokenHash: sha256(refreshToken),
      accessExpiresAt: new Date(now + ACCESS_TOKEN_TTL_MS),
      refreshExpiresAt: new Date(now + REFRESH_TOKEN_TTL_MS),
    },
  });
  return {
    access_token: accessToken,
    token_type: "Bearer",
    expires_in: Math.floor(ACCESS_TOKEN_TTL_MS / 1000),
    refresh_token: refreshToken,
    scope: data.scope,
  };
}

export class PrismaOAuthProvider implements OAuthServerProvider {
  readonly clientsStore = new PrismaClientsStore();

  async authorize(client: OAuthClientInformationFull, params: AuthorizationParams, res: Response): Promise<void> {
    const { resourceUrl, frontendUrl } = getMcpConfig();
    const scopes = params.scopes && params.scopes.length > 0 ? params.scopes : [SCOPE_READ];
    if (scopes.includes(SCOPE_WRITE)) throw new InvalidScopeError("pm:write 尚未開放");
    const unknown = scopes.filter((s) => !SUPPORTED_SCOPES.includes(s));
    if (unknown.length > 0) throw new InvalidScopeError(`不支援的 scope：${unknown.join(" ")}`);
    if (params.resource && !sameResource(params.resource, resourceUrl)) {
      throw new InvalidTargetError("resource 必須是本伺服器的 MCP endpoint");
    }

    const request = signAuthorizationRequest({
      clientId: client.client_id,
      redirectUri: params.redirectUri,
      codeChallenge: params.codeChallenge,
      scope: scopes.join(" "),
      state: params.state,
      resource: resourceUrl.href,
    });
    res.redirect(302, `${frontendUrl}/oauth/consent?request=${encodeURIComponent(request)}`);
  }

  async challengeForAuthorizationCode(client: OAuthClientInformationFull, authorizationCode: string): Promise<string> {
    const code = await prisma.oAuthAuthCode.findUnique({ where: { codeHash: sha256(authorizationCode) } });
    if (!code || code.clientId !== client.client_id) throw new InvalidGrantError("授權碼無效");
    return code.codeChallenge;
  }

  async exchangeAuthorizationCode(
    client: OAuthClientInformationFull, authorizationCode: string, _codeVerifier?: string, redirectUri?: string, resource?: URL,
  ): Promise<OAuthTokens> {
    const code = await prisma.oAuthAuthCode.findUnique({ where: { codeHash: sha256(authorizationCode) } });
    if (!code || code.clientId !== client.client_id) throw new InvalidGrantError("授權碼無效");

    // 只能使用一次（以條件更新避免同時兌換）；重複使用時撤銷這個 code 核發的所有 token
    const claimed = await prisma.oAuthAuthCode.updateMany({ where: { id: code.id, usedAt: null }, data: { usedAt: new Date() } });
    if (claimed.count === 0) {
      await prisma.oAuthToken.updateMany({ where: { authCodeId: code.id, revokedAt: null }, data: { revokedAt: new Date() } });
      throw new InvalidGrantError("授權碼已使用過，相關的 token 已全部撤銷");
    }
    if (code.expiresAt.getTime() < Date.now()) throw new InvalidGrantError("授權碼已過期");
    if (redirectUri !== undefined && redirectUri !== code.redirectUri) throw new InvalidGrantError("redirect_uri 與授權時不同");
    if (resource && code.resource && !sameResource(resource, code.resource)) throw new InvalidTargetError("resource 與授權時不同");

    const blocked = await grantBlockedReason(code.userId);
    if (blocked) throw new InvalidGrantError(blocked);

    return issueTokens({ clientId: client.client_id, userId: code.userId, scope: code.scope, resource: code.resource, authCodeId: code.id });
  }

  async exchangeRefreshToken(
    client: OAuthClientInformationFull, refreshToken: string, scopes?: string[], resource?: URL,
  ): Promise<OAuthTokens> {
    const row = await prisma.oAuthToken.findUnique({ where: { refreshTokenHash: sha256(refreshToken) } });
    if (!row || row.clientId !== client.client_id) throw new InvalidGrantError("refresh token 無效");
    if (row.revokedAt) throw new InvalidGrantError("refresh token 已失效");
    if (row.refreshExpiresAt.getTime() < Date.now()) throw new InvalidGrantError("refresh token 已過期");
    const granted = row.scope.split(" ");
    if (scopes && scopes.some((s) => !granted.includes(s))) throw new InvalidScopeError("不可要求超出原授權範圍的 scope");
    if (resource && row.resource && !sameResource(resource, row.resource)) throw new InvalidTargetError("resource 與授權時不同");

    const blocked = await grantBlockedReason(row.userId);
    if (blocked) throw new InvalidGrantError(blocked);

    // rotate：舊的 access 與 refresh token 立即失效（條件更新避免同時兌換同一個 refresh token）
    const rotated = await prisma.oAuthToken.updateMany({ where: { id: row.id, revokedAt: null }, data: { revokedAt: new Date() } });
    if (rotated.count === 0) throw new InvalidGrantError("refresh token 已失效");

    return issueTokens({
      clientId: row.clientId, userId: row.userId, scope: scopes?.length ? scopes.join(" ") : row.scope,
      resource: row.resource, authCodeId: row.authCodeId,
    });
  }

  // 注意：InvalidTokenError 的訊息會放進 WWW-Authenticate header，只能使用 ASCII
  async verifyAccessToken(token: string): Promise<AuthInfo> {
    const row = await prisma.oAuthToken.findUnique({ where: { accessTokenHash: sha256(token) } });
    if (!row || row.revokedAt) throw new InvalidTokenError("Token is invalid or has been revoked");
    if (row.accessExpiresAt.getTime() < Date.now()) throw new InvalidTokenError("Token has expired");

    // 每次都即時檢查帳號狀態：停用或刪除的帳號立即失效
    const user = await prisma.user.findUnique({ where: { id: row.userId }, select: { isActive: true } });
    if (!user || !user.isActive) throw new InvalidTokenError("User account is missing or deactivated");

    // 最後使用時間：至多每分鐘更新一次
    if (!row.lastUsedAt || Date.now() - row.lastUsedAt.getTime() > 60_000) {
      await prisma.oAuthToken.update({ where: { id: row.id }, data: { lastUsedAt: new Date() } }).catch(() => undefined);
    }

    return {
      token,
      clientId: row.clientId,
      scopes: row.scope.split(" "),
      expiresAt: Math.floor(row.accessExpiresAt.getTime() / 1000),
      resource: row.resource ? new URL(row.resource) : undefined,
      extra: { userId: row.userId, tokenId: row.id },
    };
  }

  async revokeToken(client: OAuthClientInformationFull, request: OAuthTokenRevocationRequest): Promise<void> {
    const hash = sha256(request.token);
    await prisma.oAuthToken.updateMany({
      where: { clientId: client.client_id, revokedAt: null, OR: [{ accessTokenHash: hash }, { refreshTokenHash: hash }] },
      data: { revokedAt: new Date() },
    });
  }
}

// ── 使用者管理自己的授權 ──────────────────────────────────────────────

/** 目前有效的授權（未撤銷且 refresh token 未過期） */
export async function listConnections(userId: string) {
  const tokens = await prisma.oAuthToken.findMany({
    where: { userId, revokedAt: null, refreshExpiresAt: { gt: new Date() } },
    orderBy: { createdAt: "desc" },
  });
  const clients = await prisma.oAuthClient.findMany({
    where: { clientId: { in: [...new Set(tokens.map((t) => t.clientId))] } },
    select: { clientId: true, clientName: true },
  });
  const nameOf = new Map(clients.map((c) => [c.clientId, c.clientName]));
  // refresh rotate 會產生新列，「授權時間」以最初的 auth code 時間為準
  const codes = await prisma.oAuthAuthCode.findMany({
    where: { id: { in: tokens.map((t) => t.authCodeId).filter((x): x is string => !!x) } },
    select: { id: true, createdAt: true },
  });
  const grantedAt = new Map(codes.map((c) => [c.id, c.createdAt]));
  return tokens.map((t) => ({
    id: t.id,
    clientName: nameOf.get(t.clientId) || "未命名的應用程式",
    scope: t.scope,
    grantedAt: (t.authCodeId && grantedAt.get(t.authCodeId)) || t.createdAt,
    lastUsedAt: t.lastUsedAt,
  }));
}

/** 撤銷授權：同一次授權（同一個 auth code）衍生的所有 token 一併撤銷 */
export async function revokeConnection(userId: string, tokenId: string) {
  const row = await prisma.oAuthToken.findUnique({ where: { id: tokenId } });
  if (!row || row.userId !== userId) throw new NotFoundError("找不到授權");
  await prisma.oAuthToken.updateMany({
    where: { userId, revokedAt: null, ...(row.authCodeId ? { authCodeId: row.authCodeId } : { id: row.id }) },
    data: { revokedAt: new Date() },
  });
}
