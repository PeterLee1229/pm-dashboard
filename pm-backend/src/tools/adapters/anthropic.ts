// 把工具註冊表轉成 Anthropic Messages API 的 tools 格式（Phase 3 內建助理使用；本次只實作轉換，不呼叫 API）。

import type { Scope, ToolDef } from "../types";
import { allTools } from "../registry";
import { toJsonSchema } from "../schema";

export type AnthropicTool = {
  name: string;
  description: string;
  input_schema: Record<string, unknown> & { type: "object" };
};

/** scopes：只轉換這些 scope 的工具（例如使用者只授權讀取時，不提供寫入工具給模型） */
export function toAnthropicTools(opts: { scopes?: Scope[]; tools?: ToolDef[] } = {}): AnthropicTool[] {
  const tools = opts.tools ?? allTools;
  return tools
    .filter((t) => !opts.scopes || opts.scopes.includes(t.scope))
    .map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: toJsonSchema(t.inputSchema) as AnthropicTool["input_schema"],
    }));
}
