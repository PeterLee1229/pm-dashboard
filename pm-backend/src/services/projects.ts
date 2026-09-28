import { z } from "zod";
import { prisma } from "../db";
import { parseInput } from "../errors";
import { Ctx, assertCan, isAdmin } from "./permissions";
import { logActivity } from "./activity";

const colorSchema = z.string().regex(/^#[0-9a-fA-F]{3,8}$/, "顏色格式錯誤");

export const projectCreateSchema = z.object({
  name: z.string().trim().min(1, "專案名稱不可空白").max(200),
  description: z.string().max(5000).optional(),
  color: colorSchema.optional(),
});

export const projectUpdateSchema = projectCreateSchema.partial();

/** 使用者可見的專案（admin 看全部），附上自己的專案角色 */
export async function listProjects(ctx: Ctx) {
  const admin = isAdmin(ctx);
  const projects = await prisma.project.findMany({
    where: admin ? {} : { members: { some: { userId: ctx.userId } } },
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
    return { ...p, userRole: admin ? "admin" : (mine?.role || "viewer") };
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

export async function deleteProject(ctx: Ctx, projectId: string) {
  await assertCan(ctx, projectId, "project.delete", "只有專案擁有者可以刪除專案");
  await prisma.project.delete({ where: { id: projectId } });
}
