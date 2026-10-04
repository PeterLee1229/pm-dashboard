import { prisma } from "../db";
import { Ctx, assertCanRead } from "./permissions";

/** 專案內全文搜尋（Ctrl+K）：任務、子任務、風險、會議紀錄，各取前 20 筆 */
export async function searchProject(ctx: Ctx, projectId: string, rawQuery: string) {
  await assertCanRead(ctx, projectId);
  const query = (rawQuery || "").trim();
  if (!query) return { tasks: [], subtasks: [], risks: [], meetings: [] };

  const contains = { contains: query, mode: "insensitive" as const };

  const [tasks, subtasks, risks, meetings] = await Promise.all([
    prisma.task.findMany({
      where: { projectId, OR: [{ title: contains }, { description: contains }, { assignee: contains }] },
      include: { subtasks: true },
      take: 20,
    }),
    prisma.subTask.findMany({
      where: { task: { projectId }, OR: [{ title: contains }, { description: contains }, { assignee: contains }] },
      include: { task: { select: { id: true, title: true } } },
      take: 20,
    }),
    prisma.risk.findMany({
      where: { projectId, OR: [{ title: contains }, { description: contains }, { countermeasure: contains }] },
      take: 20,
    }),
    prisma.meetingRecord.findMany({
      where: { series: { projectId }, OR: [{ summary: contains }] },
      include: { series: { select: { id: true, name: true } } },
      take: 20,
    }),
  ]);

  return { tasks, subtasks, risks, meetings };
}
