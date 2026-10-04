// 測試資料：2 個專案、每種角色各一位使用者、2 個組別、一位跨專案的非成員
import jwt from "jsonwebtoken";
import request from "supertest";
import { prisma } from "../src/db";
import { app } from "../src/index";

export const api = () => request(app);

const TABLES = [
  "KeyResult", "Objective", "Attachment", "ActivityLog", "Comment", "Notification",
  "WeeklyReport", "Risk", "MeetingRecord", "MeetingSeries", "ProjectMember",
  "SubTask", "Task", "Project", "User", "Group",
];

export async function resetDb() {
  await prisma.$executeRawUnsafe(`TRUNCATE ${TABLES.map((t) => `"${t}"`).join(", ")} RESTART IDENTITY CASCADE`);
}

export const ROLES = ["owner", "pm", "group_leader", "member", "viewer"] as const;
export type SeedUserKey = "admin" | "owner" | "pm" | "leader" | "member" | "memberB" | "viewer" | "outsider" | "p2owner";

export function tokenFor(userId: string, role = "user") {
  return jwt.sign({ userId, role }, process.env.JWT_SECRET!, { expiresIn: "1h" });
}

export async function seed() {
  const groupA = await prisma.group.create({ data: { name: "A組", color: "#6366f1" } });
  const groupB = await prisma.group.create({ data: { name: "B組", color: "#f59e0b" } });

  const mk = (key: string, name: string, groupId: string | null, role = "user") =>
    prisma.user.create({
      data: { email: `${key}@test.local`, password: "x", name, memberId: `E-${key}`, role, groupId },
    });

  const users = {
    admin: await mk("admin", "系統管理員", null, "admin"),
    owner: await mk("owner", "擁有者", groupA.id),
    pm: await mk("pm", "專案經理", groupA.id),
    leader: await mk("leader", "A組組長", groupA.id),
    member: await mk("member", "A組成員", groupA.id),
    memberB: await mk("memberB", "B組成員", groupB.id),
    viewer: await mk("viewer", "檢視者", groupB.id),
    outsider: await mk("outsider", "非成員", groupA.id),
    p2owner: await mk("p2owner", "專案二擁有者", groupB.id),
  } satisfies Record<SeedUserKey, unknown>;

  const p1 = await prisma.project.create({ data: { name: "專案一", ownerId: users.owner.id } });
  const p2 = await prisma.project.create({ data: { name: "專案二", ownerId: users.p2owner.id } });

  const memberships: [string, keyof typeof users, string][] = [
    [p1.id, "owner", "owner"], [p1.id, "pm", "pm"], [p1.id, "leader", "group_leader"],
    [p1.id, "member", "member"], [p1.id, "memberB", "member"], [p1.id, "viewer", "viewer"],
    [p2.id, "p2owner", "owner"], [p2.id, "member", "viewer"],
  ];
  for (const [projectId, key, role] of memberships) {
    await prisma.projectMember.create({ data: { projectId, userId: users[key].id, role } });
  }

  const task = (data: Record<string, unknown>) => prisma.task.create({
    data: { projectId: p1.id, title: "任務", ...data } as any,
    include: { subtasks: true },
  });
  const tasks = {
    ofMember: await task({ title: "A組成員的任務", assignee: users.member.memberId, groupId: groupA.id, columnId: "inprogress" }),
    ofMemberB: await task({ title: "B組成員的任務", assignee: users.memberB.memberId, groupId: groupB.id }),
    unassigned: await task({ title: "未指派任務" }),
    done: await task({ title: "已完成任務", columnId: "done", completion: 100, completedAt: new Date() }),
    withSubtasks: await task({
      title: "有子工項的任務",
      subtasks: {
        create: [
          { title: "A組子工項", assignee: users.member.memberId, groupId: groupA.id },
          { title: "B組子工項", assignee: users.memberB.memberId, groupId: groupB.id },
        ],
      },
    }),
  };
  const p2Task = await prisma.task.create({ data: { projectId: p2.id, title: "專案二任務" } });

  const series = await prisma.meetingSeries.create({ data: { name: "週會", projectId: p1.id } });
  const record = await prisma.meetingRecord.create({ data: { date: "2026-09-01", summary: "會議摘要", seriesId: series.id } });
  const risk = await prisma.risk.create({ data: { title: "風險一", probability: "high", impact: "high", projectId: p1.id } });
  const objective = await prisma.objective.create({ data: { title: "目標一", projectId: p1.id } });
  const keyResult = await prisma.keyResult.create({ data: { title: "KR 一", objectiveId: objective.id } });
  const comment = await prisma.comment.create({ data: { content: "評論", taskId: tasks.ofMember.id, userId: users.member.id } });
  const attachment = await prisma.attachment.create({
    data: { name: "規格書", url: "https://example.com/spec", taskId: tasks.ofMember.id, uploaderId: users.member.id },
  });

  const tokens = Object.fromEntries(
    Object.entries(users).map(([k, u]) => [k, tokenFor(u.id, u.role)]),
  ) as Record<keyof typeof users, string>;

  return {
    groups: { A: groupA, B: groupB }, users, tokens, p1, p2, tasks, p2Task,
    series, record, risk, objective, keyResult, comment, attachment,
  };
}

export type Fixture = Awaited<ReturnType<typeof seed>>;

export async function resetAndSeed() {
  await resetDb();
  return seed();
}

/** 以專案一中的角色鍵對應使用者：owner / pm / group_leader / member / viewer，外加 admin 與 outsider */
export const ROLE_USER: Record<string, SeedUserKey> = {
  admin: "admin", owner: "owner", pm: "pm", group_leader: "leader", member: "member", viewer: "viewer", outsider: "outsider",
};
