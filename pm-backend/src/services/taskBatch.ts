// 批次建立任務（create_tasks 工具使用）：預覽（dryRun）→ 確認 → 單一 transaction 寫入。
// 權限與欄位規則與 POST /api/projects/:id/tasks、PUT /api/tasks/:id 相同（permissions.ts）。

import crypto from "node:crypto";
import { z } from "zod";
import { prisma } from "../db";
import { BadRequestError, ForbiddenError } from "../errors";
import {
  AssigneeInfo, Ctx, assertCanRead, can, canEditTask, checkLeaderAssignChange, checkLeaderGroupChange,
  loadGroupNames, loadLeaderGroupId,
} from "./permissions";
import { createNotification, currentOrigin } from "./activity";
import { getEffectiveEndDate, getEffectiveStartDate, toReportTask } from "./reports";

export const MAX_BATCH_TASKS = 20;
/** 疑似重複的標題相似度門檻（正規化 Levenshtein 相似度，1 = 完全相同） */
export const DUPLICATE_SIMILARITY_THRESHOLD = 0.8;
/** batchKey 冪等紀錄的有效時間 */
export const IDEMPOTENCY_TTL_MS = 24 * 60 * 60 * 1000;

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const isoDay = z.string().regex(ISO_DAY, "日期格式必須是 YYYY-MM-DD")
  .refine((v) => !isNaN(new Date(v).getTime()), "不是有效的日期");

export const batchItemSchema = z.object({
  clientRef: z.string().trim().min(1, "clientRef 不可空白").max(50),
  title: z.string().trim().min(1, "任務名稱不可空白").max(500),
  parentTaskId: z.string().max(100).optional(),
  parentRef: z.string().max(50).optional(),
  description: z.string().max(20000).optional(),
  assigneeId: z.string().max(100).optional(),
  groupId: z.string().max(100).optional(),
  startDate: isoDay.optional(),
  endDate: isoDay.optional(),
  priority: z.enum(["low", "medium", "high"]).optional(),
  status: z.enum(["todo", "inprogress", "review", "done"]).optional(),
});
export type BatchItem = z.infer<typeof batchItemSchema>;

const batchSchema = z.object({
  tasks: z.array(batchItemSchema).min(1, "至少需要 1 筆").max(MAX_BATCH_TASKS, `一次最多 ${MAX_BATCH_TASKS} 筆`),
});

// ── 疑似重複偵測 ──────────────────────────────────────────────────────

/** 標題正規化：全半形統一（NFKC）、英文字母轉小寫、去除所有空白 */
export function normalizeTitle(s: string): string {
  return s.normalize("NFKC").toLowerCase().replace(/\s+/g, "");
}

function levenshtein(a: string, b: string): number {
  const x = [...a];
  const y = [...b];
  let prev = Array.from({ length: y.length + 1 }, (_, i) => i);
  for (let i = 1; i <= x.length; i++) {
    const cur = [i];
    for (let j = 1; j <= y.length; j++) {
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + (x[i - 1] === y[j - 1] ? 0 : 1));
    }
    prev = cur;
  }
  return prev[y.length];
}

/** 正規化後的標題相似度（0～1）：1 − 編輯距離 ÷ 較長標題的字數 */
export function titleSimilarity(a: string, b: string): number {
  const na = normalizeTitle(a);
  const nb = normalizeTitle(b);
  if (!na || !nb) return 0;
  if (na === nb) return 1;
  return 1 - levenshtein(na, nb) / Math.max([...na].length, [...nb].length);
}

/** 日期區間是否重疊；任一方完全沒有日期時無法判斷，視為可能重疊（回傳 null） */
export function datesOverlap(a: { start?: string; end?: string }, b: { start?: string; end?: string }): boolean | null {
  const range = (r: { start?: string; end?: string }) => {
    const s = r.start || r.end;
    const e = r.end || r.start;
    return s && e ? { s, e } : null;
  };
  const ra = range(a);
  const rb = range(b);
  if (!ra || !rb) return null;
  return ra.s <= rb.e && rb.s <= ra.e;
}

// ── 主流程 ────────────────────────────────────────────────────────────

type ItemPreview = {
  clientRef: string;
  kind: "task" | "subtask";
  title: string;
  parent: { taskId?: string; clientRef?: string; title: string } | null;
  assignee: { id: string; name: string } | null;
  group: { id: string; name: string } | null;
  startDate: string | null;
  endDate: string | null;
  priority: string | null;
  status: string | null;
  errors: string[];
  warnings: string[];
  possibleDuplicates: { id: string; kind: "task" | "subtask"; title: string; startDate: string | null; endDate: string | null; similarity: number; dateOverlap: boolean | null }[];
};

type ExistingTask = Awaited<ReturnType<typeof loadExisting>>[number];

async function loadExisting(projectId: string) {
  return prisma.task.findMany({ where: { projectId }, include: { subtasks: true }, orderBy: { createdAt: "asc" } });
}

/**
 * 批次建立任務。dryRun = true 時只回傳預覽，不寫入；dryRun = false 時任何一筆有錯誤就整批拒絕。
 * batchKey：24 小時內以同一個 key 重送，直接回傳第一次的結果。
 */
export async function createTasksBatch(
  ctx: Ctx, projectId: string, input: { tasks: unknown },
  opts: { dryRun: boolean; batchKey?: string },
) {
  const parsed = batchSchema.safeParse(input);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw new BadRequestError(`輸入資料格式錯誤「${issue.path.join(".")}」：${issue.message}`);
  }
  const items = parsed.data.tasks;
  const role = await assertCanRead(ctx, projectId);
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true } });

  // 冪等：已處理過的 batchKey 直接回傳第一次的結果
  const requestHash = crypto.createHash("sha256").update(JSON.stringify({ projectId, items })).digest("hex");
  if (!opts.dryRun && opts.batchKey) {
    const replay = await findIdempotentResult(ctx.userId, opts.batchKey, requestHash);
    if (replay) return replay;
  }

  const [existing, members, groupNames, leaderGroupId, me] = await Promise.all([
    loadExisting(projectId),
    prisma.projectMember.findMany({ where: { projectId }, select: { user: { select: { memberId: true, name: true, groupId: true } } } }),
    loadGroupNames(),
    role === "group_leader" ? loadLeaderGroupId(ctx) : Promise.resolve(null),
    prisma.user.findUnique({ where: { id: ctx.userId }, select: { memberId: true } }),
  ]);
  const memberById = new Map<string, AssigneeInfo>(members.map((m) => [m.user.memberId, { groupId: m.user.groupId, name: m.user.name }]));
  const existingById = new Map(existing.map((t) => [t.id, t]));
  const itemByRef = new Map<string, BatchItem>();
  for (const it of items) if (!itemByRef.has(it.clientRef)) itemByRef.set(it.clientRef, it);

  const canCreate = can(role, "task.create");
  const previews: ItemPreview[] = [];
  let permissionDenied = false;
  const seenRefs = new Set<string>();

  for (const it of items) {
    const errors: string[] = [];
    const warnings: string[] = [];
    const denied = (msg: string) => { errors.push(msg); permissionDenied = true; };

    if (seenRefs.has(it.clientRef)) errors.push(`clientRef「${it.clientRef}」在批次中重複`);
    seenRefs.add(it.clientRef);
    if (!canCreate) denied("你在此專案沒有建立任務的權限");

    // 父任務
    let kind: "task" | "subtask" = "task";
    let parent: ItemPreview["parent"] = null;
    if (it.parentTaskId && it.parentRef) {
      errors.push("parentTaskId 與 parentRef 只能擇一");
    } else if (it.parentTaskId) {
      kind = "subtask";
      const p = existingById.get(it.parentTaskId);
      if (!p) errors.push(`父任務「${it.parentTaskId}」不存在於本專案`);
      else {
        parent = { taskId: p.id, title: p.title };
        if (canCreate && !(await canEditTask(ctx, role, p))) denied(`沒有編輯父任務「${p.title}」的權限`);
      }
    } else if (it.parentRef) {
      kind = "subtask";
      const p = itemByRef.get(it.parentRef);
      if (!p || it.parentRef === it.clientRef) errors.push(`parentRef「${it.parentRef}」找不到同批次的任務`);
      else if (p.parentRef || p.parentTaskId) errors.push(`parentRef「${it.parentRef}」本身是子任務；子任務只有一層`);
      else parent = { clientRef: p.clientRef, title: p.title };
    }

    if (kind === "subtask") {
      if (it.status) warnings.push("子任務沒有狀態欄位，status 會被忽略");
      if (it.priority) warnings.push("子任務沒有優先級欄位，priority 會被忽略");
    } else if (it.status === "done" && !can(role, "task.move_done")) {
      denied("只有 PM 以上可以將任務標記為已完成");
    }

    // 負責人與組別（與 REST 相同的組長規則；負責人必須是專案成員）
    let assignee: ItemPreview["assignee"] = null;
    if (it.assigneeId) {
      const u = memberById.get(it.assigneeId);
      if (!u) errors.push(`負責人「${it.assigneeId}」不是本專案成員`);
      else assignee = { id: it.assigneeId, name: u.name };
    }
    let group: ItemPreview["group"] = null;
    if (it.groupId) {
      if (!groupNames.has(it.groupId)) errors.push(`組別「${it.groupId}」不存在`);
      else group = { id: it.groupId, name: groupNames.get(it.groupId)! };
    }
    if (role === "group_leader") {
      const g = checkLeaderGroupChange(leaderGroupId, groupNames, "", it.groupId ?? "");
      if (g) denied(g);
      const a = checkLeaderAssignChange(leaderGroupId, memberById, "", it.assigneeId ?? "");
      if (a) denied(a);
    }
    if (it.startDate && it.endDate && it.startDate > it.endDate) warnings.push("開始日期晚於結束日期");

    previews.push({
      clientRef: it.clientRef, kind, title: it.title, parent, assignee, group,
      startDate: it.startDate ?? null, endDate: it.endDate ?? null,
      priority: kind === "task" ? (it.priority ?? "medium") : null,
      status: kind === "task" ? (it.status ?? "todo") : null,
      errors, warnings,
      possibleDuplicates: findPossibleDuplicates(it, existing),
    });
  }

  const errorCount = previews.filter((p) => p.errors.length > 0).length;
  const summary = {
    total: previews.length,
    tasks: previews.filter((p) => p.kind === "task").length,
    subtasks: previews.filter((p) => p.kind === "subtask").length,
    withErrors: errorCount,
    possibleDuplicates: previews.filter((p) => p.possibleDuplicates.length > 0).length,
  };
  if (opts.dryRun) return { dryRun: true, project, summary, items: previews };

  if (errorCount > 0) {
    const details = { project, summary, items: previews.filter((p) => p.errors.length > 0).map((p) => ({ clientRef: p.clientRef, title: p.title, errors: p.errors })) };
    const message = `有 ${errorCount} 筆無法建立，整批未寫入`;
    throw permissionDenied ? new ForbiddenError(message, details) : new BadRequestError(message, details);
  }

  return commitBatch(ctx, projectId, project?.name ?? "", items, previews, existingById, opts.batchKey, requestHash, me?.memberId ?? "");
}

function findPossibleDuplicates(it: BatchItem, existing: ExistingTask[]): ItemPreview["possibleDuplicates"] {
  const result: ItemPreview["possibleDuplicates"] = [];
  const mine = { start: it.startDate, end: it.endDate };
  const consider = (id: string, kind: "task" | "subtask", title: string, start: string, end: string) => {
    const similarity = titleSimilarity(it.title, title);
    if (similarity < DUPLICATE_SIMILARITY_THRESHOLD) return;
    const overlap = datesOverlap(mine, { start, end });
    if (overlap === false) return;
    result.push({ id, kind, title, startDate: start || null, endDate: end || null, similarity: Math.round(similarity * 100) / 100, dateOverlap: overlap });
  };
  for (const t of existing) {
    const rt = toReportTask(t);
    consider(t.id, "task", t.title, getEffectiveStartDate(rt), getEffectiveEndDate(rt));
    for (const s of rt.subtasks) consider(s.id, "subtask", s.title, s.startDate, s.endDate);
  }
  return result.sort((a, b) => b.similarity - a.similarity);
}

async function findIdempotentResult(userId: string, key: string, requestHash: string) {
  const row = await prisma.toolIdempotency.findUnique({ where: { userId_tool_key: { userId, tool: "create_tasks", key } } });
  if (!row) return null;
  if (row.expiresAt.getTime() < Date.now()) {
    await prisma.toolIdempotency.delete({ where: { id: row.id } }).catch(() => undefined);
    return null;
  }
  if (row.requestHash !== requestHash) throw new BadRequestError("batchKey 已用於內容不同的批次；請改用新的 batchKey");
  return { ...(row.resultJson as object), replayed: true };
}

async function commitBatch(
  ctx: Ctx, projectId: string, projectName: string, items: BatchItem[], previews: ItemPreview[],
  existingById: Map<string, ExistingTask>, batchKey: string | undefined, requestHash: string, myMemberId: string,
) {
  const origin = currentOrigin();
  const mapping: { clientRef: string; id: string; kind: "task" | "subtask"; parentTaskId: string | null }[] = [];

  try {
    await prisma.$transaction(async (tx) => {
      const idByRef = new Map<string, string>();
      const log = (action: string, detail: string, targetId: string) =>
        tx.activityLog.create({ data: { userId: ctx.userId, action, target: "task", detail, targetId, projectId, ...origin } });

      // 先建主任務，子任務才能以 parentRef 對應
      for (const it of items.filter((x) => !x.parentRef && !x.parentTaskId)) {
        const task = await tx.task.create({
          data: {
            title: it.title, description: it.description ?? "", priority: it.priority ?? "medium",
            assignee: it.assigneeId ?? "", groupId: it.groupId ?? "", columnId: it.status ?? "todo",
            startDate: it.startDate ?? "", endDate: it.endDate ?? "", completion: 0, timeLogs: [],
            completedAt: it.status === "done" ? new Date() : null, projectId,
          },
        });
        idByRef.set(it.clientRef, task.id);
        mapping.push({ clientRef: it.clientRef, id: task.id, kind: "task", parentTaskId: null });
        await log("create", task.title, task.id);
      }
      for (const it of items.filter((x) => x.parentRef || x.parentTaskId)) {
        const parentId = it.parentTaskId ?? idByRef.get(it.parentRef!)!;
        const sub = await tx.subTask.create({
          data: {
            title: it.title, description: it.description ?? "", assignee: it.assigneeId ?? "", groupId: it.groupId ?? "",
            startDate: it.startDate ?? "", endDate: it.endDate ?? "", completion: 0, timeLogs: [], taskId: parentId,
          },
        });
        mapping.push({ clientRef: it.clientRef, id: sub.id, kind: "subtask", parentTaskId: parentId });
        const parentTitle = existingById.get(parentId)?.title ?? items.find((x) => x.clientRef === it.parentRef)?.title ?? "";
        await log("update", `${parentTitle}（新增子任務「${it.title}」）`, parentId);
      }

      const result = buildResult(projectId, projectName, mapping, previews);
      if (batchKey) {
        await tx.toolIdempotency.create({
          data: {
            key: batchKey, userId: ctx.userId, tool: "create_tasks", requestHash,
            resultJson: result as object, expiresAt: new Date(Date.now() + IDEMPOTENCY_TTL_MS),
          },
        });
      }
    }, { timeout: 30_000 });
  } catch (err: any) {
    // 同一個 batchKey 同時送出兩次：後到的 transaction 因唯一鍵衝突回滾，改回傳先完成的結果
    if (err?.code === "P2002" && batchKey) {
      const replay = await findIdempotentResult(ctx.userId, batchKey, requestHash);
      if (replay) return replay;
    }
    throw err;
  }

  await notifyAssignees(ctx, projectId, projectName, items, mapping, myMemberId);
  return buildResult(projectId, projectName, mapping, previews);
}

function buildResult(projectId: string, projectName: string, mapping: { clientRef: string; id: string; kind: string; parentTaskId: string | null }[], previews: ItemPreview[]) {
  return {
    dryRun: false,
    project: { id: projectId, name: projectName },
    created: mapping.length,
    mapping,
    possibleDuplicatesIgnored: previews.filter((p) => p.possibleDuplicates.length > 0).map((p) => p.clientRef),
  };
}

/** 同一批次中，每位負責人只收到一則彙總通知（負責人是自己時不通知）；通知連到第一筆相關的主任務 */
async function notifyAssignees(
  ctx: Ctx, projectId: string, projectName: string, items: BatchItem[],
  mapping: { clientRef: string; id: string; parentTaskId: string | null }[], myMemberId: string,
) {
  const byAssignee = new Map<string, { titles: string[]; taskId: string }>();
  for (const it of items) {
    if (!it.assigneeId || it.assigneeId === myMemberId) continue;
    const m = mapping.find((x) => x.clientRef === it.clientRef)!;
    const entry = byAssignee.get(it.assigneeId) ?? { titles: [], taskId: m.parentTaskId ?? m.id };
    entry.titles.push(it.title);
    byAssignee.set(it.assigneeId, entry);
  }
  for (const [memberId, { titles, taskId }] of byAssignee) {
    const user = await prisma.user.findFirst({ where: { memberId }, select: { id: true } });
    if (!user || user.id === ctx.userId) continue;
    const list = titles.length > 3 ? `${titles.slice(0, 3).join("、")} 等` : titles.join("、");
    await createNotification(user.id, "task_assigned", "新任務指派",
      `你在專案「${projectName}」被指派了 ${titles.length} 個新任務：${list}`, projectId, taskId);
  }
}
