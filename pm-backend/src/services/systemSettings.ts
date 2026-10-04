import { z } from "zod";
import { prisma } from "../db";
import { ForbiddenError, parseInput } from "../errors";
import { Ctx, isAdmin } from "./permissions";
import { logActivity } from "./activity";

/** 系統設定只有一列（id = 1），不存在時視為預設值 */
export async function getSystemSettings() {
  const row = await prisma.systemSetting.findUnique({ where: { id: 1 } });
  return { mcpEnabled: row?.mcpEnabled ?? false, updatedAt: row?.updatedAt ?? null, updatedBy: row?.updatedBy ?? null };
}

export async function isMcpEnabled(): Promise<boolean> {
  return (await getSystemSettings()).mcpEnabled;
}

const updateSchema = z.object({ mcpEnabled: z.boolean() });

export async function updateSystemSettings(ctx: Ctx, input: unknown) {
  if (!isAdmin(ctx)) throw new ForbiddenError("需要管理員權限");
  const data = parseInput(updateSchema, input);
  const row = await prisma.systemSetting.upsert({
    where: { id: 1 },
    update: { mcpEnabled: data.mcpEnabled, updatedBy: ctx.userId },
    create: { id: 1, mcpEnabled: data.mcpEnabled, updatedBy: ctx.userId },
  });
  await logActivity(ctx.userId, "update", "system_setting", `AI 連線（MCP）${data.mcpEnabled ? "開啟" : "關閉"}`);
  return { mcpEnabled: row.mcpEnabled, updatedAt: row.updatedAt, updatedBy: row.updatedBy };
}
