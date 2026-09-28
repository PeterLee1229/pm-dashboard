import { prisma } from "../db";
import { ForbiddenError, NotFoundError } from "../errors";

// ── 身分與角色 ────────────────────────────────────────────────────────

/** 每個 service 函式的第一個參數：呼叫者身分（systemRole 取自 DB，不信任 JWT 內的舊值） */
export type Ctx = { userId: string; systemRole: string };

export const PROJECT_ROLES = ["owner", "pm", "group_leader", "member", "viewer"] as const;
export type ProjectRole = (typeof PROJECT_ROLES)[number];
/** admin 只來自系統角色（User.role），ProjectMember.role 不可能是 admin */
export type EffectiveRole = ProjectRole | "admin";

/**
 * 角色 × 操作權限矩陣（admin 一律允許）。
 * 來源：前端 hasPermission（pm-a--/src/helpers.ts），前端沒有定義的操作沿用原本後端規則。
 */
export const PERMISSIONS = {
  "project.update":        ["owner", "pm"],
  "project.delete":        ["owner"],                                    // delete_project
  "task.create":           ["owner", "pm", "group_leader"],              // create_task
  "task.delete":           ["owner", "pm", "group_leader"],              // delete_task
  "task.edit_all":         ["owner", "pm", "group_leader"],              // edit_all_tasks
  "task.edit_own":         ["owner", "pm", "group_leader", "member"],    // edit_own_task（member 限自己負責的任務）
  "task.move_done":        ["owner", "pm"],                              // drag_to_done（移入或移出「已完成」）
  "task.import":           ["owner", "pm", "group_leader"],              // 匯入按鈕以 create_task 控制
  "comment.create":        ["owner", "pm", "group_leader", "member"],    // 評論輸入框以 edit_own_task 控制
  "attachment.delete_any": ["owner", "pm", "group_leader"],              // 附件刪除鈕以 edit_all_tasks 控制（上傳者本人也可刪）
  "meeting.manage":        ["owner", "pm", "group_leader"],              // manage_meetings（系列與紀錄）
  "risk.manage":           ["owner", "pm", "group_leader", "member"],    // manage_risks
  "weekly.manage":         ["owner", "pm"],                              // manage_weekly
  "okr.manage":            ["owner", "pm"],                              // OKRView 以 manage_weekly 控制
} as const satisfies Record<string, readonly ProjectRole[]>;
export type Action = keyof typeof PERMISSIONS;

export function isAdmin(ctx: Ctx): boolean {
  return ctx.systemRole === "admin";
}

export function can(role: EffectiveRole, action: Action): boolean {
  return role === "admin" || (PERMISSIONS[action] as readonly string[]).includes(role);
}

export async function getProjectRole(userId: string, projectId: string): Promise<ProjectRole | null> {
  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } },
    select: { role: true },
  });
  if (!membership) return null;
  // 資料庫中不在清單內的角色值一律視為唯讀
  return (PROJECT_ROLES as readonly string[]).includes(membership.role) ? membership.role as ProjectRole : "viewer";
}

/**
 * 讀取權限：admin 可讀所有專案，成員可讀所屬專案全部內容。
 * 非成員與不存在的專案一律丟 NotFoundError，避免洩漏專案是否存在。
 */
export async function assertCanRead(ctx: Ctx, projectId: string, notFoundMessage = "找不到專案"): Promise<EffectiveRole> {
  if (isAdmin(ctx)) {
    const exists = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true } });
    if (!exists) throw new NotFoundError(notFoundMessage);
    return "admin";
  }
  const role = await getProjectRole(ctx.userId, projectId);
  if (!role) throw new NotFoundError(notFoundMessage);
  return role;
}

/** 寫入權限：先確認可讀（非成員 404），再依權限矩陣檢查（不足 403） */
export async function assertCan(ctx: Ctx, projectId: string, action: Action, message = "權限不足", notFoundMessage?: string): Promise<EffectiveRole> {
  const role = await assertCanRead(ctx, projectId, notFoundMessage);
  if (!can(role, action)) throw new ForbiddenError(message);
  return role;
}

/** 可否編輯任務：edit_all 角色可編輯全部；member 只能編輯自己負責（task.assignee）的任務 */
export async function canEditTask(ctx: Ctx, role: EffectiveRole, task: { assignee: string }): Promise<boolean> {
  if (can(role, "task.edit_all")) return true;
  if (!can(role, "task.edit_own")) return false;
  const me = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { memberId: true } });
  return !!me && !!task.assignee && task.assignee === me.memberId;
}

// ── GroupLeader 人力調整規則 ──────────────────────────────────────────
// 1. 只能把任務指派給自己 group 的成員
// 2. 只能變更「目前 assignee 屬於自己 group，或尚未指派」的任務的 assignee

export type AssigneeInfo = { groupId: string | null; name: string };

/**
 * 純函式：檢查一次 assignee 變更（current → next）是否符合 GroupLeader 規則。
 * 回傳錯誤訊息；符合規則回傳 null。assignee 以 memberId 表示，空字串代表未指派。
 */
export function checkLeaderAssignChange(
  leaderGroupId: string | null,
  users: Map<string, AssigneeInfo>,
  current: string,
  next: string,
): string | null {
  if (current === next) return null;
  const label = (memberId: string) => {
    const u = users.get(memberId);
    return u ? `${u.name}（${memberId}）` : memberId;
  };
  const inMyGroup = (memberId: string) => !!leaderGroupId && users.get(memberId)?.groupId === leaderGroupId;

  if (current && !inMyGroup(current)) {
    return `組長只能調整自己組別成員負責的任務：目前負責人「${label(current)}」不屬於你的組別`;
  }
  if (next && !inMyGroup(next)) {
    return `組長只能將任務指派給自己組別的成員：「${label(next)}」不屬於你的組別`;
  }
  return null;
}

export async function loadLeaderGroupId(ctx: Ctx): Promise<string | null> {
  const me = await prisma.user.findUnique({ where: { id: ctx.userId }, select: { groupId: true } });
  return me?.groupId ?? null;
}

export async function loadAssigneeInfo(memberIds: string[]): Promise<Map<string, AssigneeInfo>> {
  const ids = [...new Set(memberIds.filter(Boolean))];
  const users = ids.length === 0 ? [] : await prisma.user.findMany({
    where: { memberId: { in: ids } },
    select: { memberId: true, name: true, groupId: true },
  });
  return new Map(users.map((u) => [u.memberId, { groupId: u.groupId, name: u.name }]));
}

/**
 * 對一組 assignee 變更套用 GroupLeader 規則；非 group_leader 角色直接通過。
 * 違反時丟 ForbiddenError。
 */
export async function assertCanAssign(
  ctx: Ctx, role: EffectiveRole, changes: { current: string; next: string }[],
): Promise<void> {
  if (role !== "group_leader") return;
  const effective = changes.filter((c) => c.current !== c.next);
  if (effective.length === 0) return;
  const [leaderGroupId, users] = await Promise.all([
    loadLeaderGroupId(ctx),
    loadAssigneeInfo(effective.flatMap((c) => [c.current, c.next])),
  ]);
  for (const c of effective) {
    const error = checkLeaderAssignChange(leaderGroupId, users, c.current, c.next);
    if (error) throw new ForbiddenError(error);
  }
}
