// 工具輸出的共用格式（標籤、日期、分頁、名稱解析）

import { z } from "zod";
import { BadRequestError } from "../errors";
import { Ctx, loadAssigneeInfo, loadGroupNames } from "../services/permissions";
import { getReadableProject, listVisibleProjects } from "../services/projects";
import * as reports from "../services/reports";

export const COLUMN_LABELS: Record<string, string> = { todo: "待處理", inprogress: "進行中", review: "審查中", done: "已完成" };
export const PRIORITY_LABELS: Record<string, string> = { low: "低", medium: "中", high: "高" };
export const RISK_LEVEL_LABELS: Record<string, string> = { high: "高", "mid-high": "中高", medium: "中", "mid-low": "中低", low: "低" };
export const RISK_STATUS_LABELS: Record<string, string> = { monitoring: "監控中", occurred: "已發生", resolved: "已解除" };
/** API 欄位對應的 UI 標籤（見 services/reports.ts computeProgress 的註解） */
export const UI_LABELS = { taskCompletionRate: "進度", weightedProgress: "整體完成度" } as const;

/** 日期字串或時間 → ISO YYYY-MM-DD（台灣時區）；無法解析回傳 null */
export const isoDay = (v: string | Date | null | undefined) =>
  reports.toTaipeiDay(typeof v === "string" ? reports.normalizeDate(v) : v);

/** ISO 日期 → 民國年（例如 115/09/28） */
export function toROC(day: string | null): string | null {
  if (!day) return null;
  const [y, m, d] = day.split("-");
  return `${Number(y) - 1911}/${m}/${d}`;
}

export const isHttpUrl = (v: string) => {
  try { const u = new URL(v); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; }
};

/** 依 memberId 取得 {id, name}；查詢一次後在同一次工具呼叫中重複使用 */
export async function makeDirectory(memberIds: string[]) {
  const [users, groups] = await Promise.all([loadAssigneeInfo(memberIds), loadGroupNames()]);
  return {
    member: (memberId: string) => (memberId ? { id: memberId, name: users.get(memberId)?.name ?? memberId } : null),
    group: (groupId: string) => (groupId ? { id: groupId, name: groups.get(groupId) ?? groupId } : null),
  };
}

export const pageShape = {
  limit: z.number().int().min(1).max(200).optional().describe("每頁筆數，預設 50，上限 200"),
  cursor: z.string().optional().describe("上一次回傳的 nextCursor，用來取下一頁；第一頁不用填"),
};

export function paginate<T>(items: T[], limit = 50, cursor?: string) {
  let offset = 0;
  if (cursor) {
    const parsed = Number(Buffer.from(cursor, "base64url").toString());
    if (!Number.isInteger(parsed) || parsed < 0) throw new BadRequestError("cursor 無效");
    offset = parsed;
  }
  const page = items.slice(offset, offset + limit);
  const next = offset + limit < items.length ? Buffer.from(String(offset + limit)).toString("base64url") : null;
  return { total: items.length, items: page, nextCursor: next };
}

export const dateParam = (desc: string) =>
  z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必須是 YYYY-MM-DD").optional().describe(desc);

/** 指定 projectId 時只查該專案（非成員丟 NotFoundError），否則查所有可見專案 */
export async function projectsInScope(ctx: Ctx, projectId?: string) {
  return projectId ? [await getReadableProject(ctx, projectId)] : listVisibleProjects(ctx);
}
