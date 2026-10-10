// ── 完成度與看板狀態連動 ──────────────────────────────────────────────
// 主任務的實際完成度（沒有子任務看自己、有子任務看子任務平均，同 reports.getCompletion）
// 從未滿 100 變成 100 時：待處理／進行中 → 審查中；審查中從 100 降到未滿 100 時 → 進行中。
// 只看「這次寫入前後」的變化，所以手動把 100% 的任務拖回進行中後不會再被推回審查中；
// 已完成的任務不受影響，系統也不會自動設為已完成。
// 所有會改到完成度的寫入（網頁、MCP、CSV 匯入、批次建立）都經過這裡。

import type { Prisma } from "@prisma/client";
import { prisma } from "../db";
import { currentOrigin } from "./activity";
import { getCompletion } from "./reports";

type Db = Prisma.TransactionClient;

export type StatusAutoChange = { from: string; to: "review" | "inprogress" };

export const AUTO_REVIEW_MESSAGE = "完成度達 100%，自動移至審查中";
export const AUTO_BACK_MESSAGE = "完成度低於 100%，自動移回進行中";

export function autoStatusFor(columnId: string, before: number, after: number): StatusAutoChange | null {
  if (before < 100 && after >= 100 && (columnId === "todo" || columnId === "inprogress")) return { from: columnId, to: "review" };
  if (before >= 100 && after < 100 && columnId === "review") return { from: columnId, to: "inprogress" };
  return null;
}

const completionSelect = { completion: true, subtasks: { select: { completion: true } } } as const;

/** 多個主任務目前的實際完成度（寫入前先記下，寫入後交給 syncStatusWithCompletion 比對） */
export async function loadEffectiveCompletions(taskIds: string[], db: Db = prisma): Promise<Map<string, number>> {
  const rows = await db.task.findMany({ where: { id: { in: taskIds } }, select: { id: true, ...completionSelect } });
  return new Map(rows.map((t) => [t.id, getCompletion(t)]));
}

/**
 * 以寫入前的實際完成度 before 與目前資料比對，需要時移動狀態並寫入活動紀錄。
 * 回傳這次自動做的狀態變更（沒有變更時為 null）。
 */
export async function syncStatusWithCompletion(
  db: Db, userId: string, taskId: string, before: number,
): Promise<StatusAutoChange | null> {
  const t = await db.task.findUnique({
    where: { id: taskId },
    select: { title: true, projectId: true, columnId: true, ...completionSelect },
  });
  if (!t) return null;
  const change = autoStatusFor(t.columnId, before, getCompletion(t));
  if (!change) return null;
  await db.task.update({ where: { id: taskId }, data: { columnId: change.to } });
  await db.activityLog.create({
    data: {
      userId, action: "move", target: "task", targetId: taskId, projectId: t.projectId,
      detail: `${t.title}：${change.to === "review" ? AUTO_REVIEW_MESSAGE : AUTO_BACK_MESSAGE}`,
      ...currentOrigin(),
    },
  });
  return change;
}
