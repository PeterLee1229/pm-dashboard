import { z } from "zod";
import { prisma } from "../db";
import { BadRequestError, ConflictError, ForbiddenError, NotFoundError, parseInput } from "../errors";
import { Change, Ctx, assertCan, assertCanAssign, assertCanChangeGroup, assertCanRead, can, canEditTask } from "./permissions";
import { logActivity, notifyAssignee } from "./activity";

// ── 輸入白名單 ────────────────────────────────────────────────────────
// 只允許以下欄位寫入；projectId、id、createdAt、completedAt 等欄位一律丟棄

const PRIORITIES = ["low", "medium", "high"] as const;
const COLUMNS = ["todo", "inprogress", "review", "done"] as const;

const shortText = z.string().max(500);
const longText = z.string().max(20000);
const idText = z.string().max(100);
const dateText = z.string().max(30);
const completion = z.number().int().min(0).max(100);

const timeLogSchema = z.object({
  id: idText.optional(),
  date: dateText,
  // 前端以 parseFloat 產生，無效值經 JSON 序列化後為 null
  hours: z.number().nullable(),
});

const subtaskInputSchema = z.object({
  id: idText.optional(),
  title: shortText.optional(),
  description: longText.optional(),
  assignee: idText.optional(),
  groupId: idText.optional(),
  startDate: dateText.optional(),
  endDate: dateText.optional(),
  completion: completion.optional(),
  timeLogs: z.array(timeLogSchema).optional(),
});

export const taskUpdateSchema = z.object({
  title: shortText,
  description: longText,
  priority: z.enum(PRIORITIES),
  assignee: idText,
  groupId: idText,
  startDate: dateText,
  endDate: dateText,
  completion,
  timeLogs: z.array(timeLogSchema),
  columnId: z.enum(COLUMNS),
  subtasks: z.array(subtaskInputSchema),
}).partial();

export const taskCreateSchema = taskUpdateSchema.omit({ subtasks: true }).extend({
  title: shortText.trim().min(1, "任務名稱不可空白"),
});

const commentSchema = z.object({ content: z.string().trim().min(1, "評論不可空白").max(10000) });

const httpUrl = z.string().trim().max(2000).refine((v) => {
  try {
    const u = new URL(v);
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}, "連結必須是 http 或 https 網址");

const attachmentSchema = z.object({
  name: z.string().trim().min(1, "附件名稱不可空白").max(500),
  url: httpUrl,
  type: z.enum(["link"]).optional(),
});

const COLUMN_NAMES: Record<string, string> = {
  todo: "待處理", inprogress: "進行中", review: "審查中", done: "已完成",
};

async function findTaskOr404(taskId: string) {
  const task = await prisma.task.findUnique({ where: { id: taskId }, include: { subtasks: true } });
  if (!task) throw new NotFoundError("找不到任務");
  return task;
}

// ── 讀取 ──────────────────────────────────────────────────────────────

export async function listTasks(ctx: Ctx, projectId: string) {
  await assertCanRead(ctx, projectId);
  return prisma.task.findMany({
    where: { projectId },
    include: {
      subtasks: true,
      attachments: {
        include: { uploader: { select: { id: true, name: true, memberId: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
    orderBy: { createdAt: "asc" },
  });
}

/** 單一任務完整內容：子任務、留言、附件 */
export async function getTask(ctx: Ctx, taskId: string) {
  const task = await prisma.task.findUnique({
    where: { id: taskId },
    include: {
      subtasks: true,
      comments: {
        include: { user: { select: { id: true, name: true, memberId: true } } },
        orderBy: { createdAt: "asc" },
      },
      attachments: {
        include: { uploader: { select: { id: true, name: true, memberId: true } } },
        orderBy: { createdAt: "desc" },
      },
    },
  });
  // 非成員與不存在的任務回應相同，避免洩漏任務是否存在
  if (!task) throw new NotFoundError("找不到任務");
  await assertCanRead(ctx, task.projectId, "找不到任務");
  return task;
}

// ── 寫入 ──────────────────────────────────────────────────────────────

export async function createTask(ctx: Ctx, projectId: string, input: unknown) {
  const data = parseInput(taskCreateSchema, input);
  const role = await assertCan(ctx, projectId, "task.create");
  if (data.columnId === "done" && !can(role, "task.move_done")) {
    throw new ForbiddenError("只有 PM 以上可以將任務標記為已完成");
  }
  await assertCanChangeGroup(ctx, role, [{ current: "", next: data.groupId ?? "" }]);
  await assertCanAssign(ctx, role, [{ current: "", next: data.assignee ?? "" }]);

  const task = await prisma.task.create({
    data: {
      title: data.title,
      description: data.description ?? "",
      priority: data.priority ?? "medium",
      assignee: data.assignee ?? "",
      groupId: data.groupId ?? "",
      columnId: data.columnId ?? "todo",
      startDate: data.startDate ?? "",
      endDate: data.endDate ?? "",
      completion: data.completion ?? 0,
      timeLogs: data.timeLogs ?? [],
      completedAt: data.columnId === "done" ? new Date() : null,
      projectId,
    },
    include: { subtasks: true },
  });

  if (task.assignee) {
    const project = await prisma.project.findUnique({ where: { id: projectId }, select: { name: true } });
    await notifyAssignee(ctx, task.assignee, "task_assigned", "新任務指派",
      `你被指派了新任務「${task.title}」在專案「${project?.name || ""}」中`, projectId, task.id);
  }
  await logActivity(ctx.userId, "create", "task", task.title, projectId, task.id);
  return task;
}

/**
 * 更新任務。opts.expectedUpdatedAt 為樂觀鎖：與目前的 updatedAt 不同時丟 ConflictError（附上最新內容），不寫入。
 */
export async function updateTask(ctx: Ctx, taskId: string, input: unknown, opts: { expectedUpdatedAt?: string | Date } = {}) {
  const data = parseInput(taskUpdateSchema, input);
  const task = await findTaskOr404(taskId);
  const role = await assertCanRead(ctx, task.projectId, "找不到任務");

  const expected = opts.expectedUpdatedAt !== undefined ? new Date(opts.expectedUpdatedAt) : null;
  if (expected && isNaN(expected.getTime())) throw new BadRequestError("expectedUpdatedAt 不是有效的時間");
  const conflict = () => new ConflictError("任務在讀取後已被修改，未寫入；請以最新內容重新確認", task);
  if (expected && expected.getTime() !== task.updatedAt.getTime()) throw conflict();

  if (!(await canEditTask(ctx, role, task))) {
    throw new ForbiddenError(role === "member" ? "只能編輯自己的任務" : "權限不足");
  }

  const columnChanged = data.columnId !== undefined && data.columnId !== task.columnId;
  if (columnChanged && (data.columnId === "done" || task.columnId === "done") && !can(role, "task.move_done")) {
    throw new ForbiddenError(data.columnId === "done"
      ? "只有 PM 以上可以將任務標記為已完成"
      : "只有 PM 以上可以將任務從已完成移出");
  }

  // 人力調整規則：主任務與每個子工項的 assignee 變更（含刪除子工項）、groupId 變更都要檢查
  // （member 不可改派；組長受組別規則限制）。先檢查組別，組長「先改組再改派」的繞道在第一步就會被擋下
  const assignChanges: Change[] = [];
  const groupChanges: Change[] = [];
  if (data.assignee !== undefined) assignChanges.push({ current: task.assignee, next: data.assignee });
  if (data.groupId !== undefined) groupChanges.push({ current: task.groupId, next: data.groupId });
  if (data.subtasks) {
    const incoming = new Map(data.subtasks.filter((s) => s.id).map((s) => [s.id!, s]));
    for (const existing of task.subtasks) {
      const sub = incoming.get(existing.id);
      assignChanges.push({ current: existing.assignee, next: sub ? (sub.assignee ?? "") : "" });
      if (sub) groupChanges.push({ current: existing.groupId, next: sub.groupId ?? "" });
    }
    const existingIds = new Set(task.subtasks.map((s) => s.id));
    for (const sub of data.subtasks) {
      if (!sub.id || !existingIds.has(sub.id)) {
        assignChanges.push({ current: "", next: sub.assignee ?? "" });
        groupChanges.push({ current: "", next: sub.groupId ?? "" });
      }
    }
  }
  await assertCanChangeGroup(ctx, role, groupChanges);
  await assertCanAssign(ctx, role, assignChanges);

  const { subtasks, ...taskData } = data;
  const patch: Record<string, unknown> = { ...taskData };
  if (data.columnId === "done" && task.columnId !== "done") patch.completedAt = new Date();
  else if (data.columnId && data.columnId !== "done" && task.columnId === "done") patch.completedAt = null;

  if (expected) {
    // 條件更新：讀取到寫入之間若被他人修改也不會覆蓋
    const res = await prisma.task.updateMany({ where: { id: taskId, updatedAt: task.updatedAt }, data: patch });
    if (res.count === 0) throw new ConflictError("任務在讀取後已被修改，未寫入；請以最新內容重新確認", await findTaskOr404(taskId));
  } else {
    await prisma.task.update({ where: { id: taskId }, data: patch });
  }

  if (subtasks) {
    // 保留既有子工項 id（CSV 匯入以工項ID比對），只刪除這次沒送來的
    const existingIds = new Set(task.subtasks.map((s) => s.id));
    const keepIds = subtasks.map((s) => s.id).filter((id): id is string => !!id && existingIds.has(id));
    await prisma.subTask.deleteMany({ where: { taskId, id: { notIn: keepIds } } });
    for (const sub of subtasks) {
      const subData = {
        title: sub.title || "",
        description: sub.description || "",
        assignee: sub.assignee || "",
        groupId: sub.groupId || "",
        startDate: sub.startDate || "",
        endDate: sub.endDate || "",
        completion: sub.completion || 0,
        timeLogs: sub.timeLogs || [],
      };
      if (sub.id && existingIds.has(sub.id)) {
        await prisma.subTask.update({ where: { id: sub.id }, data: subData });
      } else {
        // 沿用前端產生的 id，讓畫面上的子工項與資料庫一致，下次儲存才不會重複建立
        const idTaken = !!sub.id && !!(await prisma.subTask.findUnique({ where: { id: sub.id }, select: { id: true } }));
        await prisma.subTask.create({
          data: { ...subData, taskId, ...(sub.id && !idTaken ? { id: sub.id } : {}) },
        });
      }
    }
  }

  if (columnChanged && task.assignee) {
    await notifyAssignee(ctx, task.assignee, "task_moved", "任務狀態變更",
      `任務「${task.title}」已移至「${COLUMN_NAMES[data.columnId!] || data.columnId}」`, task.projectId, task.id);
  }

  if (columnChanged) {
    await logActivity(ctx.userId, "move", "task", `${task.title} → ${data.columnId}`, task.projectId, task.id);
  } else {
    await logActivity(ctx.userId, "update", "task", task.title, task.projectId, task.id);
  }

  return prisma.task.findUnique({ where: { id: taskId }, include: { subtasks: true } });
}

export async function deleteTask(ctx: Ctx, taskId: string) {
  const task = await findTaskOr404(taskId);
  await assertCan(ctx, task.projectId, "task.delete", "權限不足", "找不到任務");
  await logActivity(ctx.userId, "delete", "task", task.title, task.projectId, task.id);
  await prisma.task.delete({ where: { id: taskId } });
}

// ── 評論 ──────────────────────────────────────────────────────────────

const commentUserSelect = {
  select: { id: true, name: true, memberId: true, group: { select: { name: true, color: true } } },
} as const;

export async function listComments(ctx: Ctx, taskId: string) {
  const task = await findTaskOr404(taskId);
  await assertCanRead(ctx, task.projectId, "找不到任務");
  return prisma.comment.findMany({
    where: { taskId },
    include: { user: commentUserSelect },
    orderBy: { createdAt: "asc" },
  });
}

export async function createComment(ctx: Ctx, taskId: string, input: unknown) {
  const { content } = parseInput(commentSchema, input);
  const task = await findTaskOr404(taskId);
  await assertCan(ctx, task.projectId, "comment.create", "權限不足", "找不到任務");

  const comment = await prisma.comment.create({
    data: { content, taskId, userId: ctx.userId },
    include: { user: commentUserSelect },
  });
  await notifyAssignee(ctx, task.assignee, "comment_added", "新評論", `在任務「${task.title}」中有新的評論`, task.projectId, task.id);
  await logActivity(ctx.userId, "comment", "task", task.title, task.projectId, task.id);
  return comment;
}

export async function deleteComment(ctx: Ctx, commentId: string) {
  const comment = await prisma.comment.findUnique({ where: { id: commentId }, include: { task: { select: { projectId: true } } } });
  if (!comment) throw new NotFoundError("找不到評論");
  const role = await assertCanRead(ctx, comment.task.projectId, "找不到評論");
  if (comment.userId !== ctx.userId && role !== "admin") throw new ForbiddenError("只能刪除自己的評論");
  await prisma.comment.delete({ where: { id: commentId } });
}

// ── 附件 ──────────────────────────────────────────────────────────────

const uploaderSelect = { select: { id: true, name: true, memberId: true } } as const;

export async function listAttachments(ctx: Ctx, taskId: string) {
  const task = await findTaskOr404(taskId);
  await assertCanRead(ctx, task.projectId, "找不到任務");
  return prisma.attachment.findMany({
    where: { taskId },
    include: { uploader: uploaderSelect },
    orderBy: { createdAt: "desc" },
  });
}

export async function createAttachment(ctx: Ctx, taskId: string, input: unknown) {
  const data = parseInput(attachmentSchema, input);
  const task = await findTaskOr404(taskId);
  const role = await assertCanRead(ctx, task.projectId, "找不到任務");
  if (!(await canEditTask(ctx, role, task))) {
    throw new ForbiddenError(role === "member" ? "只能在自己的任務新增附件" : "權限不足");
  }

  const attachment = await prisma.attachment.create({
    data: { name: data.name, url: data.url, type: data.type || "link", taskId, uploaderId: ctx.userId },
    include: { uploader: uploaderSelect },
  });
  await logActivity(ctx.userId, "create", "attachment", `在任務「${task.title}」新增附件「${data.name}」`, task.projectId, attachment.id);
  return attachment;
}

export async function deleteAttachment(ctx: Ctx, attachmentId: string) {
  const attachment = await prisma.attachment.findUnique({ where: { id: attachmentId }, include: { task: { select: { projectId: true } } } });
  if (!attachment) throw new NotFoundError("找不到附件");
  const role = await assertCanRead(ctx, attachment.task.projectId, "找不到附件");
  if (attachment.uploaderId !== ctx.userId && !can(role, "attachment.delete_any")) {
    throw new ForbiddenError("附件只能由上傳者本人、Owner 或 PM 刪除");
  }
  await prisma.attachment.delete({ where: { id: attachmentId } });
  await logActivity(ctx.userId, "delete", "attachment", `刪除附件「${attachment.name}」`, attachment.task.projectId, attachmentId);
}

