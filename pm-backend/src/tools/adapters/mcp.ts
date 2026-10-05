// 把工具註冊表轉成 MCP server。使用低階 Server，tools/list 的 inputSchema 與 Anthropic adapter 共用同一份 JSON Schema。

import { Server } from "@modelcontextprotocol/sdk/server/index.js";
import { CallToolRequestSchema, ListToolsRequestSchema, type CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import type { Ctx } from "../../services/permissions";
import { allTools, findTool } from "../registry";
import { toJsonSchema } from "../schema";
import { executeTool } from "../execute";

export type McpMeta = {
  clientId: string;
  clientName?: string;
  /** token 核發的 scope；未提供時視為唯讀 */
  scopes?: string[];
};

/** 給 tools/list 用的工具清單（JSON Schema 只轉換一次） */
let cachedList: { name: string; title: string; description: string; inputSchema: Record<string, unknown>; annotations: Record<string, unknown> }[] | null = null;
export function mcpToolList() {
  cachedList ??= allTools.map((t) => ({
    name: t.name,
    title: t.title,
    description: t.description,
    inputSchema: toJsonSchema(t.inputSchema),
    annotations: { title: t.title, ...t.annotations },
  }));
  return cachedList;
}

export function buildMcpServer(ctx: Ctx, meta: McpMeta) {
  const server = new Server({ name: "pm-dashboard", version: "2.0.0" }, { capabilities: { tools: {} } });
  const scopes = meta.scopes ?? ["pm:read"];

  // 所有工具都列出；沒有 pm:write 的 token 呼叫寫入工具時，會回覆需要重新授權
  server.setRequestHandler(ListToolsRequestSchema, async () => ({ tools: mcpToolList() as never }));

  server.setRequestHandler(CallToolRequestSchema, async (req): Promise<CallToolResult> => {
    const def = findTool(req.params.name);
    if (!def) {
      return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: `找不到工具：${req.params.name}`, code: "NOT_FOUND" }) }] };
    }
    const outcome = await executeTool(
      def,
      { userId: ctx.userId, systemRole: ctx.systemRole, source: "mcp", clientName: meta.clientName },
      req.params.arguments,
      { scopes, clientId: meta.clientId },
    );
    return { isError: outcome.isError || undefined, content: [{ type: "text", text: JSON.stringify(outcome.payload) }] } as CallToolResult;
  });

  return server;
}
