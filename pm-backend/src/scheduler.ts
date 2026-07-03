import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

async function createNotification(
  userId: string, type: string, title: string, message: string,
  projectId?: string, taskId?: string
) {
  await prisma.notification.create({
    data: { userId, type, title, message, projectId, taskId },
  });
}

export async function checkDueTasks() {
  const today = new Date().toISOString().split("T")[0];
  const tomorrow = new Date(Date.now() + 86400000).toISOString().split("T")[0];

  // 明天到期
  const dueTomorrow = await prisma.task.findMany({
    where: { endDate: tomorrow, completion: { lt: 100 } },
    include: { project: true },
  });
  for (const task of dueTomorrow) {
    if (!task.assignee) continue;
    const user = await prisma.user.findFirst({ where: { memberId: task.assignee } });
    if (!user) continue;
    const existing = await prisma.notification.findFirst({
      where: { userId: user.id, taskId: task.id, type: "task_due_tomorrow",
        createdAt: { gte: new Date(today) } },
    });
    if (existing) continue;
    await createNotification(user.id, "task_due_tomorrow", "任務即將到期",
      `任務「${task.title}」將於明天到期`, task.projectId, task.id);
  }

  // 今天到期
  const dueToday = await prisma.task.findMany({
    where: { endDate: today, completion: { lt: 100 } },
    include: { project: true },
  });
  for (const task of dueToday) {
    if (!task.assignee) continue;
    const user = await prisma.user.findFirst({ where: { memberId: task.assignee } });
    if (!user) continue;
    const existing = await prisma.notification.findFirst({
      where: { userId: user.id, taskId: task.id, type: "task_due_today",
        createdAt: { gte: new Date(today) } },
    });
    if (existing) continue;
    await createNotification(user.id, "task_due_today", "任務今天到期",
      `任務「${task.title}」今天到期`, task.projectId, task.id);
  }

  // 已逾期
  const overdue = await prisma.task.findMany({
    where: { endDate: { lt: today, not: "" }, completion: { lt: 100 } },
    include: { project: true },
  });
  for (const task of overdue) {
    if (!task.assignee) continue;
    const user = await prisma.user.findFirst({ where: { memberId: task.assignee } });
    if (!user) continue;
    const existing = await prisma.notification.findFirst({
      where: { userId: user.id, taskId: task.id, type: "task_overdue",
        createdAt: { gte: new Date(today) } },
    });
    if (existing) continue;
    await createNotification(user.id, "task_overdue", "任務已逾期",
      `任務「${task.title}」已逾期（預計 ${task.endDate}）`, task.projectId, task.id);

    // 同時通知 PM / Owner
    const pmMembers = await prisma.projectMember.findMany({
      where: { projectId: task.projectId, role: { in: ["owner", "pm"] } },
    });
    for (const pm of pmMembers) {
      if (pm.userId === user.id) continue;
      const pmExisting = await prisma.notification.findFirst({
        where: { userId: pm.userId, taskId: task.id, type: "task_overdue",
          createdAt: { gte: new Date(today) } },
      });
      if (pmExisting) continue;
      await createNotification(pm.userId, "task_overdue", "任務已逾期",
        `「${task.title}」已逾期，指派給 ${task.assignee}`, task.projectId, task.id);
    }
  }

  console.log(`排程完成：明天到期 ${dueTomorrow.length}、今天到期 ${dueToday.length}、逾期 ${overdue.length}`);
}
