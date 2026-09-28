import { prisma } from "../db";
import { Ctx, assertCanRead } from "./permissions";

export async function logActivity(userId: string, action: string, target: string, detail: string, projectId?: string, targetId?: string) {
  return prisma.activityLog.create({
    data: { userId, action, target, detail, projectId, targetId },
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

export async function listActivities(ctx: Ctx, projectId: string, opts: { take?: number } = {}) {
  await assertCanRead(ctx, projectId);
  return prisma.activityLog.findMany({
    where: { projectId },
    include: { user: { select: { id: true, name: true, memberId: true } } },
    orderBy: { createdAt: "desc" },
    take: opts.take ?? 100,
  });
}
