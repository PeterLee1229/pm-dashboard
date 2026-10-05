// 工具註冊表的型別。工具只定義一次，由 adapters/ 轉給 MCP server 與（Phase 3）內建助理使用。

import type { z } from "zod";
import type { Ctx } from "../services/permissions";

export type Scope = "pm:read" | "pm:write";

export interface ToolContext {
  userId: string;
  systemRole: string;
  /** mcp：AI connector；assistant：Phase 3 內建助理 */
  source: "mcp" | "assistant";
  clientName?: string;
}

export interface ToolResult {
  data: unknown;
  /** 結果筆數（寫入工具為影響筆數），寫入稽核紀錄 */
  count?: number;
  /** 額外寫入稽核紀錄 params 的摘要（例如 dryRun、修改前後） */
  audit?: Record<string, unknown>;
}

export interface ToolDef<S extends z.ZodObject = z.ZodObject> {
  name: string;
  title: string;
  /** 繁體中文：用途、參數，以及使用流程 */
  description: string;
  inputSchema: S;
  scope: Scope;
  annotations: { readOnlyHint: boolean; destructiveHint: boolean; idempotentHint: boolean; openWorldHint?: boolean };
  /** 只能呼叫 service，不得直接使用 Prisma */
  handler: (ctx: ToolContext, input: z.infer<S>) => Promise<ToolResult>;
}

/** 定義工具（保留 inputSchema 的型別推導） */
export function defineTool<S extends z.ZodObject>(def: ToolDef<S>): ToolDef<S> {
  return def;
}

/** 工具 context → service 的 ctx */
export const serviceCtx = (ctx: ToolContext): Ctx => ({ userId: ctx.userId, systemRole: ctx.systemRole });

export const READ_ANNOTATIONS = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false } as const;
