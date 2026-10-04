import { z } from "zod";
import { prisma } from "../db";
import { NotFoundError, parseInput } from "../errors";
import { Ctx, assertCan, assertCanRead, assertLeaderAssignRules } from "./permissions";
import { logActivity, createNotification } from "./activity";

/** 5×5 風險矩陣的等級與分值（與前端 RISK_LEVELS 一致） */
export const RISK_LEVEL_VALUES = { high: 5, "mid-high": 4, medium: 3, "mid-low": 2, low: 1 } as const;
const RISK_LEVELS = Object.keys(RISK_LEVEL_VALUES) as [keyof typeof RISK_LEVEL_VALUES, ...(keyof typeof RISK_LEVEL_VALUES)[]];
const RISK_STATUSES = ["monitoring", "occurred", "resolved"] as const;
const STATUS_NAMES: Record<string, string> = { monitoring: "監控中", occurred: "已發生", resolved: "已解除" };

/** 風險分數 = 機率分值 × 衝擊分值（1～25） */
export function riskScore(risk: { probability: string; impact: string }): number {
  const p = RISK_LEVEL_VALUES[risk.probability as keyof typeof RISK_LEVEL_VALUES] ?? 0;
  const i = RISK_LEVEL_VALUES[risk.impact as keyof typeof RISK_LEVEL_VALUES] ?? 0;
  return p * i;
}

const riskSchema = z.object({
  title: z.string().trim().min(1, "風險名稱不可空白").max(500),
  description: z.string().max(20000),
  probability: z.enum(RISK_LEVELS),
  impact: z.enum(RISK_LEVELS),
  countermeasure: z.string().max(20000),
  ownerId: z.string().max(100),
  ownerGroupId: z.string().max(100),
  status: z.enum(RISK_STATUSES),
  createdDate: z.string().max(30),
});
const riskCreateSchema = riskSchema.partial().required({ title: true });
const riskUpdateSchema = riskSchema.omit({ createdDate: true }).partial();

export async function listRisks(ctx: Ctx, projectId: string) {
  await assertCanRead(ctx, projectId);
  return prisma.risk.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } });
}

export async function createRisk(ctx: Ctx, projectId: string, input: unknown) {
  const data = parseInput(riskCreateSchema, input);
  const role = await assertCan(ctx, projectId, "risk.create");
  // 組長只能把風險負責人指定為自己組的成員
  await assertLeaderAssignRules(ctx, role, [{ current: "", next: data.ownerId || "" }], "風險");
  const risk = await prisma.risk.create({
    data: {
      title: data.title,
      description: data.description || "",
      probability: data.probability || "medium",
      impact: data.impact || "medium",
      countermeasure: data.countermeasure || "",
      ownerId: data.ownerId || "",
      ownerGroupId: data.ownerGroupId || "",
      status: data.status || "monitoring",
      createdDate: data.createdDate || new Date().toISOString().split("T")[0],
      projectId,
    },
  });
  await logActivity(ctx.userId, "create", "risk", risk.title, projectId, risk.id);
  return risk;
}

async function findRiskOr404(riskId: string) {
  const risk = await prisma.risk.findUnique({ where: { id: riskId } });
  if (!risk) throw new NotFoundError("找不到風險");
  return risk;
}

export async function updateRisk(ctx: Ctx, riskId: string, input: unknown) {
  const data = parseInput(riskUpdateSchema, input);
  const risk = await findRiskOr404(riskId);
  const role = await assertCan(ctx, risk.projectId, "risk.manage", "只有 Owner、PM 與組長可以編輯風險", "找不到風險");
  // 組長不能更換別組成員負責的風險，也只能指定自己組的成員
  if (data.ownerId !== undefined) {
    await assertLeaderAssignRules(ctx, role, [{ current: risk.ownerId, next: data.ownerId }], "風險");
  }

  const updated = await prisma.risk.update({ where: { id: riskId }, data });

  if (data.status && data.status !== risk.status) {
    const members = await prisma.projectMember.findMany({ where: { projectId: risk.projectId } });
    for (const m of members) {
      if (m.userId === ctx.userId) continue;
      await createNotification(m.userId, "risk_updated", "風險狀態變更",
        `風險「${risk.title}」狀態已變更為「${STATUS_NAMES[data.status] || data.status}」`, risk.projectId);
    }
  }
  await logActivity(ctx.userId, "update", "risk", risk.title, risk.projectId, risk.id);
  return updated;
}

export async function deleteRisk(ctx: Ctx, riskId: string) {
  const risk = await findRiskOr404(riskId);
  await assertCan(ctx, risk.projectId, "risk.manage", "只有 Owner、PM 與組長可以刪除風險", "找不到風險");
  await prisma.risk.delete({ where: { id: riskId } });
}
