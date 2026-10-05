import { z } from "zod";

/**
 * zod schema → JSON Schema（MCP 與 Anthropic 兩個 adapter 共用）。
 * 使用 zod v4 內建的 z.toJSONSchema：zod-to-json-schema 只支援 zod v3，對 v4 schema 會產生空的 schema。
 */
export function toJsonSchema(schema: z.ZodType): Record<string, unknown> {
  const { $schema: _ignored, ...rest } = z.toJSONSchema(schema, { io: "input" }) as Record<string, unknown>;
  return rest;
}
