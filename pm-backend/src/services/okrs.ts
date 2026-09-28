import { z } from "zod";
import { prisma } from "../db";
import { NotFoundError, parseInput } from "../errors";
import { Ctx, assertCan, assertCanRead } from "./permissions";
import { logActivity } from "./activity";

const objectiveSchema = z.object({
  title: z.string().trim().min(1, "目標名稱不可空白").max(500),
  description: z.string().max(20000),
  startDate: z.string().max(30),
  endDate: z.string().max(30),
});
const objectiveCreateSchema = objectiveSchema.partial().required({ title: true });
const objectiveUpdateSchema = objectiveSchema.partial();

const keyResultSchema = z.object({
  title: z.string().trim().min(1, "關鍵結果名稱不可空白").max(500),
  targetValue: z.number().finite(),
  currentValue: z.number().finite(),
  unit: z.string().max(20),
});
const keyResultCreateSchema = keyResultSchema.partial().required({ title: true });
const keyResultUpdateSchema = keyResultSchema.partial();

export async function listOkrs(ctx: Ctx, projectId: string) {
  await assertCanRead(ctx, projectId);
  return prisma.objective.findMany({
    where: { projectId },
    include: { keyResults: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "asc" },
  });
}

export async function createObjective(ctx: Ctx, projectId: string, input: unknown) {
  const data = parseInput(objectiveCreateSchema, input);
  await assertCan(ctx, projectId, "okr.manage");
  const objective = await prisma.objective.create({
    data: {
      title: data.title,
      description: data.description || "",
      startDate: data.startDate || "",
      endDate: data.endDate || "",
      projectId,
    },
    include: { keyResults: true },
  });
  await logActivity(ctx.userId, "create", "okr", `建立目標「${objective.title}」`, projectId, objective.id);
  return objective;
}

async function findObjectiveOr404(objectiveId: string) {
  const objective = await prisma.objective.findUnique({ where: { id: objectiveId } });
  if (!objective) throw new NotFoundError("找不到目標");
  return objective;
}

export async function updateObjective(ctx: Ctx, objectiveId: string, input: unknown) {
  const data = parseInput(objectiveUpdateSchema, input);
  const objective = await findObjectiveOr404(objectiveId);
  await assertCan(ctx, objective.projectId, "okr.manage", "權限不足", "找不到目標");
  const updated = await prisma.objective.update({ where: { id: objectiveId }, data, include: { keyResults: true } });
  await logActivity(ctx.userId, "update", "okr", `更新目標「${updated.title}」`, objective.projectId, updated.id);
  return updated;
}

export async function deleteObjective(ctx: Ctx, objectiveId: string) {
  const objective = await findObjectiveOr404(objectiveId);
  await assertCan(ctx, objective.projectId, "okr.manage", "權限不足", "找不到目標");
  await prisma.keyResult.deleteMany({ where: { objectiveId } });
  await prisma.objective.delete({ where: { id: objectiveId } });
  await logActivity(ctx.userId, "delete", "okr", `刪除目標「${objective.title}」`, objective.projectId, objectiveId);
}

export async function createKeyResult(ctx: Ctx, objectiveId: string, input: unknown) {
  const data = parseInput(keyResultCreateSchema, input);
  const objective = await findObjectiveOr404(objectiveId);
  await assertCan(ctx, objective.projectId, "okr.manage", "權限不足", "找不到目標");
  return prisma.keyResult.create({
    data: {
      title: data.title,
      targetValue: data.targetValue || 100,
      currentValue: data.currentValue || 0,
      unit: data.unit || "%",
      objectiveId,
    },
  });
}

async function findKeyResultOr404(keyResultId: string) {
  const kr = await prisma.keyResult.findUnique({ where: { id: keyResultId }, include: { objective: { select: { projectId: true } } } });
  if (!kr) throw new NotFoundError("找不到關鍵結果");
  return kr;
}

export async function updateKeyResult(ctx: Ctx, keyResultId: string, input: unknown) {
  const data = parseInput(keyResultUpdateSchema, input);
  const kr = await findKeyResultOr404(keyResultId);
  await assertCan(ctx, kr.objective.projectId, "okr.manage", "權限不足", "找不到關鍵結果");
  return prisma.keyResult.update({ where: { id: keyResultId }, data });
}

export async function deleteKeyResult(ctx: Ctx, keyResultId: string) {
  const kr = await findKeyResultOr404(keyResultId);
  await assertCan(ctx, kr.objective.projectId, "okr.manage", "權限不足", "找不到關鍵結果");
  await prisma.keyResult.delete({ where: { id: keyResultId } });
}
