import { z } from "zod";
import { prisma } from "../db";
import { parseInput } from "../errors";
import { Ctx, EffectiveRole, PROJECT_ROLES, ProjectRole, assertCan, assertCanRead, can, isAdmin } from "./permissions";
import { logActivity } from "./activity";

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{3,8}$/, "顏色格式錯誤");

export const projectCreateSchema = z.object({
  name: z.string().trim().min(1, "專案名稱不可空白").max(200),
  description: z.string().max(5000).optional(),
  color: colorSchema.optional(),
});

export const projectUpdateSchema = projectCreateSchema.partial();

/** 可見專案的查詢條件：admin 看全部，其他人只看自己是成員的專案 */
function visibleProjectsWhere(ctx: Ctx) {
  return isAdmin(ctx) ? {} : { members: { some: { userId: ctx.userId } } };
}

/**
 * 使用者可見的專案（只有 id 與名稱），依建立時間排序；跨專案查詢（例如 MCP 工具、逾期清單）使用。
 * 預設排除已封存的專案。
 */
export async function listVisibleProjects(ctx: Ctx, opts: { includeArchived?: boolean } = {}): Promise<{ id: string; name: string }[]> {
  return prisma.project.findMany({
    where: { ...visibleProjectsWhere(ctx), ...(opts.includeArchived ? {} : { archivedAt: null }) },
    select: { id: true, name: true },
    orderBy: { createdAt: "asc" },
  });
}

/** 讀取單一專案的 id 與名稱；非成員與不存在的專案丟 NotFoundError */
export async function getReadableProject(ctx: Ctx, projectId: string): Promise<{ id: string; name: string }> {
  await assertCanRead(ctx, projectId);
  const p = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true } });
  return { id: projectId, name: p?.name ?? "" };
}

/** 使用者可見的專案（admin 看全部），附上自己的專案角色 */
export async function listProjects(ctx: Ctx) {
  const admin = isAdmin(ctx);
  const projects = await prisma.project.findMany({
    where: visibleProjectsWhere(ctx),
    include: {
      members: {
        include: {
          user: {
            select: {
              id: true, name: true, memberId: true, email: true,
              group: { select: { id: true, name: true, color: true } },
            },
          },
        },
      },
    },
  });
  return projects.map((p) => {
    const mine = p.members.find((m) => m.userId === ctx.userId);
    const myRole: EffectiveRole = admin ? "admin"
      : (PROJECT_ROLES as readonly string[]).includes(mine?.role ?? "") ? mine!.role as ProjectRole : "viewer";
    // viewer 看不到其他成員的 email
    const members = can(myRole, "member.view_email")
      ? p.members
      : p.members.map((m) => ({ ...m, user: { ...m.user, email: undefined } }));
    return { ...p, members, userRole: admin ? "admin" : (mine?.role || "viewer") };
  });
}

export async function createProject(ctx: Ctx, input: unknown) {
  const data = parseInput(projectCreateSchema, input);
  const project = await prisma.project.create({
    data: {
      name: data.name,
      description: data.description || "",
      color: data.color || "#6366f1",
      ownerId: ctx.userId,
    },
  });
  await prisma.projectMember.create({ data: { projectId: project.id, userId: ctx.userId, role: "owner" } });
  await logActivity(ctx.userId, "create", "project", project.name, project.id, project.id);
  return project;
}

export async function updateProject(ctx: Ctx, projectId: string, input: unknown) {
  const data = parseInput(projectUpdateSchema, input);
  await assertCan(ctx, projectId, "project.update");
  return prisma.project.update({ where: { id: projectId }, data });
}

/** 封存專案：Owner 與 Admin 可以操作，任何時候都可以封存。已封存時不重複寫入 */
export async function archiveProject(ctx: Ctx, projectId: string) {
  await assertCan(ctx, projectId, "project.archive", "只有專案擁有者或管理員可以封存專案");
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  if (p.archivedAt) return { id: p.id, archivedAt: p.archivedAt, archivedBy: p.archivedBy };
  const updated = await prisma.project.update({ where: { id: projectId }, data: { archivedAt: new Date(), archivedBy: ctx.userId } });
  await logActivity(ctx.userId, "archive", "project", p.name, projectId, projectId);
  return { id: updated.id, archivedAt: updated.archivedAt, archivedBy: updated.archivedBy };
}

/** 解除封存：權限與封存相同 */
export async function unarchiveProject(ctx: Ctx, projectId: string) {
  await assertCan(ctx, projectId, "project.archive", "只有專案擁有者或管理員可以解除封存");
  const p = await prisma.project.findUniqueOrThrow({ where: { id: projectId } });
  if (!p.archivedAt) return { id: p.id, archivedAt: null, archivedBy: null };
  await prisma.project.update({ where: { id: projectId }, data: { archivedAt: null, archivedBy: null } });
  await logActivity(ctx.userId, "unarchive", "project", p.name, projectId, projectId);
  return { id: p.id, archivedAt: null, archivedBy: null };
}

export async function deleteProject(ctx: Ctx, projectId: string) {
  await assertCan(ctx, projectId, "project.delete", "只有專案擁有者可以刪除專案");
  await prisma.project.delete({ where: { id: projectId } });
}
