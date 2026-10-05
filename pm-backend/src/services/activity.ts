import { AsyncLocalStorage } from "node:async_hooks";
import { prisma } from "../db";
import { Ctx, assertCanRead } from "./permissions";

// ── 操作來源 ──────────────────────────────────────────────────────────
// 經由 AI 工具（MCP connector / Phase 3 內建助理）執行的操作，活動紀錄要標示來源。
// 工具 adapter 以 runWithOrigin 包住整次呼叫，services 內的 logActivity 會自動帶上來源，不必逐層傳遞。

export type ActivitySource = "web" | "mcp" | "assistant";
export type ActivityOrigin = { source: ActivitySource; clientName?: string | null };

const originStore = new AsyncLocalStorage<ActivityOrigin>();

export function runWithOrigin<T>(origin: ActivityOrigin, fn: () => Promise<T>): Promise<T> {
  return originStore.run(origin, fn);
}

/** 目前操作的來源欄位（寫入 ActivityLog 用）；不在工具呼叫中時為 web */
export function currentOrigin(): { source: ActivitySource; clientName: string | null } {
  const o = originStore.getStore();
  return { source: o?.source ?? "web", clientName: o?.clientName ?? null };
}

export async function logActivity(userId: string, action: string, target: string, detail: string, projectId?: string, targetId?: string) {
  return prisma.activityLog.create({
    data: { userId, action, target, detail, projectId, targetId, ...currentOrigin() },
  });
}

export async function createNotification(userId: string, type: string, title: string, message: string, projectId?: string, taskId?: string) {
  return prisma.notification.create({
    data: { userId, type, title, message, projectId, taskId },
  });
}

/** 依 memberId 通知任務負責人（負責人就是操作者本人時不通知） */
export async function notifyAssignee(ctx: Ctx, assigneeMemberId: string, type: string, title: string, message: string, projectId: string, taskId?: string) {
  if (!assigneeMemberId) return;
  const assigneeUser = await prisma.user.findFirst({ where: { memberId: assigneeMemberId }, select: { id: true } });
  if (assigneeUser && assigneeUser.id !== ctx.userId) {
    await createNotification(assigneeUser.id, type, title, message, projectId, taskId);
  }
}

/**
 * 專案活動紀錄（新到舊）。from / to 為台灣時區的 YYYY-MM-DD（含頭尾），userId 篩選操作者。
 */
export async function listActivities(
  ctx: Ctx, projectId: string,
  opts: { take?: number; from?: string; to?: string; userId?: string } = {},
) {
  await assertCanRead(ctx, projectId);
  const createdAt: { gte?: Date; lte?: Date } = {};
  if (opts.from) createdAt.gte = new Date(`${opts.from}T00:00:00+08:00`);
  if (opts.to) createdAt.lte = new Date(`${opts.to}T23:59:59.999+08:00`);
  return prisma.activityLog.findMany({
    where: {
      projectId,
      ...(opts.userId ? { userId: opts.userId } : {}),
      ...(opts.from || opts.to ? { createdAt } : {}),
    },
    include: { user: { select: { id: true, name: true, memberId: true } } },
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 100,
  });
}
