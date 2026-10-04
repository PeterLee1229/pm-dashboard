# pm-backend

PM Dashboard 的 Express + Prisma 後端（部署在 Railway）。

## 開發與測試

```bash
npm run dev          # 啟動開發伺服器（需要 .env 的 DATABASE_URL、JWT_SECRET）
npm run test:db      # 啟動測試用 Postgres 容器（port 55432，資料庫 pm_dashboard_test）
npm test             # 執行 vitest（每個測試檔會清空並重新 seed 測試資料庫）
```

可用 `TEST_DATABASE_URL` 指定其他測試資料庫；資料庫名稱必須以 `_test` 結尾，否則測試會拒絕執行。

## 架構

- `src/index.ts`：路由。只負責解析請求、呼叫 service、回傳結果
- `src/services/`：查詢與權限邏輯（REST API 與 MCP 工具共用）。權限矩陣在 `services/permissions.ts`
- `src/mcp/`：MCP connector（OAuth 授權伺服器、`/mcp` endpoint、12 支唯讀工具）

## MCP connector

讓 claude.ai 等 AI 服務透過自訂 connector，以使用者本人身分**唯讀** PM Dashboard 資料。

- **系統開關**：在系統管理 → AI 連線（MCP）開啟，預設為關閉。關閉時，`/mcp` 一律回 403
- **端點**：
  - `/mcp`（Streamable HTTP，stateless）
  - `/authorize`、`/token`、`/register`、`/revoke`
  - `/.well-known/oauth-authorization-server`、`/.well-known/oauth-protected-resource[/mcp]`
- **授權同意頁**：前端的 `/oauth/consent`
- **Scope**：只核發 `pm:read`。`pm:write` 在結構上已預留，但 Phase 1 不核發
- **安全**：
  - token、auth code、client secret 只存 SHA-256 hash
  - 授權時強制 PKCE S256
  - refresh token 每次使用都會 rotate
  - auth code 被重複使用時，撤銷它核發的所有 token
  - 每次請求都即時檢查帳號是否啟用，以及系統開關是否開啟
- **稽核**：每次工具呼叫（包含失敗）都寫入 `McpAuditLog`

### 環境變數

| 變數 | 說明 | 預設值（本機） |
|---|---|---|
| `MCP_ISSUER_URL` | 授權伺服器的 issuer（後端網址，正式環境必須是 https） | `http://localhost:3000` |
| `MCP_RESOURCE_URL` | MCP endpoint 網址 | `<MCP_ISSUER_URL>/mcp` |
| `FRONTEND_URL` | 前端網址（授權同意頁 `/oauth/consent` 所在） | `http://localhost:5173` |
| `OAUTH_ALLOWED_REDIRECT_URIS` | 允許 DCR 註冊的 redirect URI，以逗號分隔 | `https://claude.ai/api/mcp/auth_callback,https://claude.com/api/mcp/auth_callback` |

### 本機用 MCP Inspector 測試

1. 執行 `npm run dev`，並在前端執行 `npm run dev`
2. 以 Admin 登入前端，在系統管理頁開啟「AI 連線（MCP）」
3. 執行 `npx @modelcontextprotocol/inspector`，Transport 選 Streamable HTTP，URL 填 `http://localhost:3000/mcp`
4. Inspector 預設的 callback 是 `http://localhost:6274/oauth/callback`。本機測試時，請把這個網址加進 `OAUTH_ALLOWED_REDIRECT_URIS`
5. 依畫面完成授權，在同意頁按「允許」後即可呼叫工具

### SDK 版本

使用 `@modelcontextprotocol/sdk` **v1**（`mcpAuthRouter`、`OAuthServerProvider`）。

v2（`@modelcontextprotocol/server` 等拆分套件）已移除授權伺服器相關的 API，只保留 resource server 端的驗證。**日後遷移到 v2 時，OAuth 授權伺服器需要另外處理**，可以自行實作端點，或改用獨立的授權伺服器。需要搬移的部分：

- `src/mcp/oauthProvider.ts`：資料存取與 token 規則可以沿用
- `src/mcp/routes.ts`：`mcpAuthRouter`，以及處理 client secret hash 的前置 middleware

`/mcp` 與工具（`src/mcp/tools.ts`）只要換成 v2 的 `McpServer` 與 transport 即可。
