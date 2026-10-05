// 工具執行的共用外層：參數驗證、scope 檢查、寫入開關、操作來源（活動紀錄）與稽核紀錄。
// 各 adapter 都經由 executeTool 呼叫工具，個別工具不需要處理這些事。

import { prisma } from "../db";
import { HttpError } from "../errors";
import { runWithOrigin } from "../services/activity";
import { isMcpWriteEnabled } from "../services/systemSettings";
import type { ToolContext, ToolDef } from "./types";

export type CallMeta = {
  /** token 核發的 scope */
  scopes: string[];
  /** OAuth client id，寫入稽核紀錄 */
  clientId: string;
};

export type ToolOutcome = { isError: boolean; payload: unknown };

export const INSUFFICIENT_SCOPE_MESSAGE =
  "此操作需要寫入權限（pm:write）。請在 AI 服務中中斷並重新連接 PM Dashboard，授權時勾選「寫入」。";
export const WRITE_DISABLED_MESSAGE = "系統未開放 AI 寫入工具，請聯繫系統管理員。";

const CODE_BY_STATUS: Record<number, string> = { 400: "BAD_REQUEST", 403: "FORBIDDEN", 404: "NOT_FOUND", 409: "CONFLICT" };

class ToolError extends Error {
  constructor(public code: string, message: string, public details?: unknown) { super(message); }
}

/** 參數摘要：只保留短字串、陣列只記筆數，避免把大段文字寫進稽核紀錄 */
function summarizeParams(args: unknown): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  if (!args || typeof args !== "object") return out;
  for (const [k, v] of Object.entries(args)) {
    if (typeof v === "string") out[k] = v.length > 100 ? `${v.slice(0, 100)}…` : v;
    else if (Array.isArray(v)) out[k] = v.every((x) => typeof x === "string") && v.length <= 20 ? v : `[${v.length} 筆]`;
    else if (v && typeof v === "object") out[k] = Object.keys(v);
    else out[k] = v;
  }
  return out;
}

export async function executeTool(def: ToolDef, ctx: ToolContext, rawArgs: unknown, meta: CallMeta): Promise<ToolOutcome> {
  const started = Date.now();
  let success = false;
  let errorCode: string | null = null;
  let resultCount: number | null = null;
  let auditExtra: Record<string, unknown> = {};
  let args: unknown = rawArgs ?? {};

  try {
    const parsed = def.inputSchema.safeParse(args);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new ToolError("BAD_REQUEST", `輸入參數錯誤${issue.path.length ? `「${issue.path.join(".")}」` : ""}：${issue.message}`);
    }
    args = parsed.data;

    if (!meta.scopes.includes(def.scope)) throw new ToolError("INSUFFICIENT_SCOPE", INSUFFICIENT_SCOPE_MESSAGE);
    if (def.scope === "pm:write" && !(await isMcpWriteEnabled())) throw new ToolError("WRITE_DISABLED", WRITE_DISABLED_MESSAGE);

    const result = await runWithOrigin({ source: ctx.source, clientName: ctx.clientName }, () => def.handler(ctx, parsed.data));
    success = true;
    resultCount = result.count ?? null;
    auditExtra = result.audit ?? {};
    return { isError: false, payload: result.data };
  } catch (err) {
    let code = "INTERNAL";
    let message = "伺服器錯誤";
    let details: unknown;
    if (err instanceof ToolError) ({ code, message, details } = err);
    else if (err instanceof HttpError) {
      code = CODE_BY_STATUS[err.status] ?? `HTTP_${err.status}`;
      message = err.message;
      details = err.details;
    } else console.error(`工具 ${def.name} 錯誤:`, err);
    errorCode = code;
    if (def.scope === "pm:write") auditExtra = { affected: 0 };
    return { isError: true, payload: { error: message, code, ...(details !== undefined ? { details } : {}) } };
  } finally {
    // 稽核紀錄寫入失敗不可影響回應
    await prisma.mcpAuditLog.create({
      data: {
        userId: ctx.userId, clientId: meta.clientId, tool: def.name,
        params: { ...summarizeParams(args), ...auditExtra } as object,
        resultCount, success, errorCode, durationMs: Date.now() - started,
      },
    }).catch((e: unknown) => console.error("寫入稽核紀錄失敗:", e));
  }
}
