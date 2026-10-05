// MCP connector 設定（環境變數）。部署時需設定 MCP_ISSUER_URL、MCP_RESOURCE_URL、FRONTEND_URL、OAUTH_ALLOWED_REDIRECT_URIS

const DEFAULT_REDIRECT_URIS = [
  "https://claude.ai/api/mcp/auth_callback",
  "https://claude.com/api/mcp/auth_callback",
];

export function getMcpConfig() {
  const issuerUrl = new URL(process.env.MCP_ISSUER_URL || "http://localhost:3000");
  const resourceUrl = new URL(process.env.MCP_RESOURCE_URL || new URL("/mcp", issuerUrl).href);
  const frontendUrl = (process.env.FRONTEND_URL || "http://localhost:5173").replace(/\/$/, "");
  const allowedRedirectUris = (process.env.OAUTH_ALLOWED_REDIRECT_URIS || DEFAULT_REDIRECT_URIS.join(","))
    .split(",").map((s) => s.trim()).filter(Boolean);
  return { issuerUrl, resourceUrl, frontendUrl, allowedRedirectUris };
}

export const SCOPE_READ = "pm:read";
/** Phase 2 起核發：使用者可在同意頁取消勾選 */
export const SCOPE_WRITE = "pm:write";
export const SUPPORTED_SCOPES = [SCOPE_READ, SCOPE_WRITE];

export const AUTH_CODE_TTL_MS = 10 * 60 * 1000;
export const ACCESS_TOKEN_TTL_MS = 60 * 60 * 1000;
export const REFRESH_TOKEN_TTL_MS = 30 * 24 * 60 * 60 * 1000;
/** 授權請求（authorize → 同意頁）的有效時間 */
export const AUTH_REQUEST_TTL_SECONDS = 10 * 60;
