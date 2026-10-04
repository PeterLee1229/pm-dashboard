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
 * 角色 × 操作權限矩陣（admin 一律允許），採最小權限。
 * 前端 hasPermission（pm-a--/src/helpers.ts）使用對應的權限鍵（註解中列出），兩邊必須同步。
 */
export const PERMISSIONS = {
  "project.update":        ["owner", "pm"],
  "project.delete":        ["owner"],                                    // delete_project
  "task.create":           ["owner", "pm", "group_leader"],              // create_task
  "task.delete":           ["owner", "pm", "group_leader"],              // delete_task
  "task.edit_all":         ["owner", "pm", "group_leader"],              // edit_all_tasks
  "task.edit_own":         ["owner", "pm", "group_leader", "member"],    // edit_own_task（member 限自己負責的任務）
  "task.assign":           ["owner", "pm", "group_leader"],              // assign_task（組長另受組別規則限制；member 不可改派）
  "task.move_done":        ["owner", "pm"],                              // drag_to_done（移入或移出「已完成」）
  "task.import":           ["owner", "pm", "group_leader"],              // 匯入按鈕以 create_task 控制
  "comment.create":        ["owner", "pm", "group_leader", "member"],    // 評論輸入框以 edit_own_task 控制
  "attachment.delete_any": ["owner", "pm"],                              // delete_attachments（上傳者本人也可刪）
  "meeting.manage":        ["owner", "pm", "group_leader"],              // manage_meetings（系列與紀錄）
  "risk.create":           ["owner", "pm", "group_leader", "member"],    // create_risk
  "risk.manage":           ["owner", "pm", "group_leader"],              // manage_risks（編輯、刪除）
  "weekly.manage":         ["owner", "pm"],                              // manage_weekly
  "okr.manage":            ["owner", "pm"],                              // manage_okr
  "member.view_email":     ["owner", "pm", "group_leader", "member"],    // view_member_email（viewer 看不到成員 email）
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
// 1. 只能把任務（或風險）指派給自己 group 的成員
// 2. 只能變更「目前 assignee 屬於自己 group，或尚未指派」的 assignee
// 3. 只能變更「目前屬於自己組、或尚未分組」的任務 groupId，且新的 groupId 只能是自己的組
// 另外：member 不能變更任何任務的 assignee（task.assign）

export type AssigneeInfo = { groupId: string | null; name: string };
export type Change = { current: string; next: string };

/**
 * 純函式：檢查一次 assignee 變更（current → next）是否符合 GroupLeader 規則。
 * 回傳錯誤訊息；符合規則回傳 null。assignee 以 memberId 表示，空字串代表未指派。
 */
export function checkLeaderAssignChange(
  leaderGroupId: string | null,
  users: Map<string, AssigneeInfo>,
  current: string,
  next: string,
  subject = "任務",
): string | null {
  if (current === next) return null;
  const label = (memberId: string) => {
    const u = users.get(memberId);
    return u ? `${u.name}（${memberId}）` : memberId;
  };
  const inMyGroup = (memberId: string) => !!leaderGroupId && users.get(memberId)?.groupId === leaderGroupId;

  if (current && !inMyGroup(current)) {
    return `組長只能調整自己組別成員負責的${subject}：目前負責人「${label(current)}」不屬於你的組別`;
  }
  if (next && !inMyGroup(next)) {
    return `組長只能將${subject}指派給自己組別的成員：「${label(next)}」不屬於你的組別`;
  }
  return null;
}

/**
 * 純函式：檢查一次任務 groupId 變更（current → next）是否符合 GroupLeader 規則。
 * groupNames 用於錯誤訊息；空字串代表未分組。
 */
export function checkLeaderGroupChange(
  leaderGroupId: string | null,
  groupNames: Map<string, string>,
  current: string,
  next: string,
): string | null {
  if (current === next) return null;
  const label = (id: string) => groupNames.get(id) ?? id;
  if (current && current !== leaderGroupId) {
    return `組長只能調整自己組別的任務：此任務目前屬於「${label(current)}」`;
  }
  if (!leaderGroupId || next !== leaderGroupId) {
    return next
      ? `組長只能將任務設為自己的組別：「${label(next)}」不是你的組別`
      : "組長只能將任務設為自己的組別，不能改為未分組";
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

export async function loadGroupNames(): Promise<Map<string, string>> {
  const groups = await prisma.group.findMany({ select: { id: true, name: true } });
  return new Map(groups.map((g) => [g.id, g.name]));
}

/** 只套用 GroupLeader 的負責人規則（風險負責人等）；非 group_leader 角色直接通過 */
export async function assertLeaderAssignRules(
  ctx: Ctx, role: EffectiveRole, changes: Change[], subject = "任務",
): Promise<void> {
  if (role !== "group_leader") return;
  const effective = changes.filter((c) => c.current !== c.next);
  if (effective.length === 0) return;
  const [leaderGroupId, users] = await Promise.all([
    loadLeaderGroupId(ctx),
    loadAssigneeInfo(effective.flatMap((c) => [c.current, c.next])),
  ]);
  for (const c of effective) {
    const error = checkLeaderAssignChange(leaderGroupId, users, c.current, c.next, subject);
    if (error) throw new ForbiddenError(error);
  }
}

/**
 * 任務負責人變更：需有 task.assign 權限（member 一律不可），組長另受組別規則限制。
 * 違反時丟 ForbiddenError。
 */
export async function assertCanAssign(ctx: Ctx, role: EffectiveRole, changes: Change[]): Promise<void> {
  if (!changes.some((c) => c.current !== c.next)) return;
  if (!can(role, "task.assign")) throw new ForbiddenError("只有 Owner、PM 與組長可以變更任務負責人");
  await assertLeaderAssignRules(ctx, role, changes, "任務");
}

/** 任務 groupId 變更：組長受組別規則限制；其他可編輯任務的角色不受限 */
export async function assertCanChangeGroup(ctx: Ctx, role: EffectiveRole, changes: Change[]): Promise<void> {
  if (role !== "group_leader") return;
  const effective = changes.filter((c) => c.current !== c.next);
  if (effective.length === 0) return;
  const [leaderGroupId, groupNames] = await Promise.all([loadLeaderGroupId(ctx), loadGroupNames()]);
  for (const c of effective) {
    const error = checkLeaderGroupChange(leaderGroupId, groupNames, c.current, c.next);
    if (error) throw new ForbiddenError(error);
  }
}
