import { z } from "zod";
import { prisma } from "../db";
import { ForbiddenError, parseInput } from "../errors";
import { Ctx, isAdmin } from "./permissions";
import { logActivity } from "./activity";

/** 系統設定只有一列（id = 1），不存在時視為預設值（全部關閉） */
export async function getSystemSettings() {
  const row = await prisma.systemSetting.findUnique({ where: { id: 1 } });
  return {
    mcpEnabled: row?.mcpEnabled ?? false,
    mcpWriteEnabled: row?.mcpWriteEnabled ?? false,
    updatedAt: row?.updatedAt ?? null,
    updatedBy: row?.updatedBy ?? null,
  };
}

export async function isMcpEnabled(): Promise<boolean> {
  return (await getSystemSettings()).mcpEnabled;
}

/** 寫入工具：mcpEnabled 與 mcpWriteEnabled 都開啟才可使用 */
export async function isMcpWriteEnabled(): Promise<boolean> {
  const s = await getSystemSettings();
  return s.mcpEnabled && s.mcpWriteEnabled;
}

const updateSchema = z.object({ mcpEnabled: z.boolean(), mcpWriteEnabled: z.boolean() })
  .partial()
  .refine((v) => v.mcpEnabled !== undefined || v.mcpWriteEnabled !== undefined, "至少需要一個設定值");

const LABELS = { mcpEnabled: "AI 連線（MCP）", mcpWriteEnabled: "AI 寫入工具" } as const;

export async function updateSystemSettings(ctx: Ctx, input: unknown) {
  if (!isAdmin(ctx)) throw new ForbiddenError("需要管理員權限");
  const data = parseInput(updateSchema, input);
  await prisma.systemSetting.upsert({
    where: { id: 1 },
    update: { ...data, updatedBy: ctx.userId },
    create: { id: 1, ...data, updatedBy: ctx.userId },
  });
  for (const key of Object.keys(data) as (keyof typeof LABELS)[]) {
    await logActivity(ctx.userId, "update", "system_setting", `${LABELS[key]}${data[key] ? "開啟" : "關閉"}`);
  }
  return getSystemSettings();
}
