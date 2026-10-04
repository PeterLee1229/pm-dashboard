// 進度、逾期判斷與週報彙整（自前端 helpers.ts / reportCalc.ts 移植）。
// 前端以瀏覽器本地時區（台灣）計算；後端一律以 Asia/Taipei 的日期字串（YYYY-MM-DD）計算，
// 不受伺服器時區影響。前後端結果以 tests/reports.consistency.test.ts 確保一致。

import { z } from "zod";
import { prisma } from "../db";
import { BadRequestError, parseInput } from "../errors";
import { Ctx, assertCan, assertCanRead } from "./permissions";
import { riskScore } from "./risks";

export const REPORT_TIME_ZONE = "Asia/Taipei";
/** 風險矩陣紅色區（分數 ≥ 16，與前端 RiskMatrixView 一致）視為高風險 */
export const HIGH_RISK_SCORE = 16;

// ── 資料型別 ──────────────────────────────────────────────────────────

export type ReportTimeLog = { id?: string; date: string; hours: number | null };
export type ReportSubTask = {
  id: string; title: string; assignee: string; groupId: string;
  startDate: string; endDate: string; completion: number; timeLogs: ReportTimeLog[];
};
export type ReportTask = {
  id: string; title: string; priority: string; assignee: string; groupId: string;
  startDate: string; endDate: string; completion: number; timeLogs: ReportTimeLog[];
  columnId: string; completedAt: Date | string | null; subtasks: ReportSubTask[];
};
export type ReportMember = { id: string; name: string };
export type ReportGroup = { id: string; name: string; color: string; members: ReportMember[] };
export type ReportRisk = { id: string; title: string; status: string; probability: string; impact: string };

/** 看板欄位順序；不在清單內的 columnId 不會顯示在前端看板，也不列入計算 */
export const COLUMN_ORDER = ["todo", "inprogress", "review", "done"] as const;
const RISK_STATUS_LABELS: Record<string, string> = { monitoring: "監控中", occurred: "已發生", resolved: "已解除" };

// ── 日期工具（台北時區，YYYY-MM-DD） ─────────────────────────────────

const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;
const dayFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: REPORT_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
});

/** 日期字串或時間 → 台北時區的 YYYY-MM-DD；無法解析回傳 null */
export function toTaipeiDay(value: string | Date | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string" && ISO_DAY.test(value)) {
    return isNaN(new Date(value).getTime()) ? null : value;
  }
  const d = value instanceof Date ? value : new Date(value);
  if (isNaN(d.getTime())) return null;
  return dayFormatter.format(d);
}

export function addDays(day: string, n: number): string {
  const [y, m, d] = day.split("-").map(Number);
  return new Date(Date.UTC(y, m - 1, d + n)).toISOString().slice(0, 10);
}

function daysBetween(from: string, to: string): number {
  const [y1, m1, d1] = from.split("-").map(Number);
  const [y2, m2, d2] = to.split("-").map(Number);
  return Math.round((Date.UTC(y2, m2 - 1, d2) - Date.UTC(y1, m1 - 1, d1)) / 86400000);
}

/** 該日所在週的週一（週一至週日為一週） */
export function mondayOf(day: string): string {
  const [y, m, d] = day.split("-").map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay();
  return addDays(day, dow === 0 ? -6 : 1 - dow);
}

export function todayInTaipei(now: Date = new Date()): string {
  return dayFormatter.format(now);
}

/** 與前端 normalizeDate 相同：2026/6/1 → 2026-06-01 */
export function normalizeDate(dateStr: string): string {
  if (!dateStr) return "";
  const cleaned = dateStr.replace(/\//g, "-");
  const parts = cleaned.split("-");
  if (parts.length !== 3) return dateStr;
  const [year, month, day] = parts;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

// ── 任務層級計算（對應前端 helpers.ts） ──────────────────────────────

export function getCompletion(task: ReportTask): number {
  if (task.subtasks.length === 0) return task.completion;
  const avg = task.subtasks.reduce((sum, s) => sum + s.completion, 0) / task.subtasks.length;
  return Math.round(avg);
}

export function getEffectiveStartDate(task: ReportTask): string {
  if (task.subtasks.length === 0) return task.startDate;
  const dates = task.subtasks.filter((s) => s.startDate).map((s) => s.startDate);
  if (dates.length === 0) return task.startDate;
  return dates.sort()[0];
}

export function getEffectiveEndDate(task: ReportTask): string {
  if (task.subtasks.length === 0) return task.endDate;
  const dates = task.subtasks.filter((s) => s.endDate).map((s) => s.endDate);
  if (dates.length === 0) return task.endDate;
  return dates.sort().reverse()[0];
}

function findMemberById(groups: ReportGroup[], memberId: string): ReportMember | undefined {
  for (const g of groups) {
    const found = g.members.find((m) => m.id === memberId);
    if (found) return found;
  }
  return undefined;
}

const memberDisplay = (m: ReportMember) => `${m.name}（${m.id}）`;

/** 只保留會出現在看板上的任務，並依看板欄位順序排列（同欄維持原順序） */
export function orderForBoard<T extends { columnId: string }>(tasks: T[]): T[] {
  return COLUMN_ORDER.flatMap((col) => tasks.filter((t) => (t.columnId || "todo") === col));
}

// ── 進度與逾期 ────────────────────────────────────────────────────────

/**
 * 專案進度指標，皆為 0～100 整數。
 *
 * API 欄位與 UI 標籤對照（UI 不改名）：
 * - taskCompletionRate（任務完成率）→ 看板頂部進度條「進度」（App.tsx 頂部列，滑鼠移上顯示「已完成 x / y」）
 * - weightedProgress（加權進度）  → 儀表板統計卡片「整體完成度」（DashboardView）
 * - totalTasks / doneTasks        → 儀表板「總任務數」／「已完成」卡片
 *
 * 任務完成率的算法：「已完成」欄的主任務數 ÷ 看板上的主任務總數。
 * 只計算主任務、不展開子工項，原因是子工項沒有「已完成」狀態（只有完成度），
 * 且現行 UI 的頂部進度條即以主任務計算；維持一致，本次不改（Phase 0 裁決 #7）。
 * 加權進度：各主任務完成度的平均，有子工項的主任務以子工項完成度平均計（getCompletion）。
 */
export function computeProgress(tasks: ReportTask[]) {
  const board = orderForBoard(tasks);
  const totalTasks = board.length;
  const doneTasks = board.filter((t) => t.columnId === "done").length;
  const taskCompletionRate = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const weightedProgress = totalTasks > 0
    ? Math.round(board.reduce((sum, t) => sum + getCompletion(t), 0) / totalTasks)
    : 0;
  return { totalTasks, doneTasks, taskCompletionRate, weightedProgress };
}

/** 截止狀態：有效結束日早於今天且完成度未達 100% 為逾期；0～2 天內到期為即將到期 */
export function getDueStatus(task: ReportTask, today: string) {
  const dueDate = getEffectiveEndDate(task);
  if (!dueDate) return null;
  const dueDay = ISO_DAY.test(dueDate) ? toTaipeiDay(dueDate) : null;
  const diffDays = dueDay ? daysBetween(today, dueDay) : NaN;
  const isDone = getCompletion(task) >= 100;
  return {
    dueDate, diffDays,
    isOverdue: !isDone && diffDays < 0,
    isDueSoon: !isDone && diffDays >= 0 && diffDays <= 2,
  };
}

// ── 週報彙整（對應前端 reportCalc.computeWeeklyReport / toWeeklyReportData） ──

type HoursEntry = { name: string; hours: number };

export function buildWeeklyReport(
  input: { tasks: ReportTask[]; groups: ReportGroup[]; risks: ReportRisk[] },
  weekStartInput: string,
  opts: { referenceDay?: string } = {},
) {
  const weekStart = mondayOf(weekStartInput);
  const weekEnd = addDays(weekStart, 6);
  const nextWeekStart = addDays(weekStart, 7);
  const nextWeekEnd = addDays(weekStart, 13);
  // 「本月工時」以參考日所在月份計算（前端為畫面上選取週的同一天，API 以週一為準）
  const month = (opts.referenceDay ?? weekStart).slice(0, 7);

  const { groups } = input;
  const allTasks = orderForBoard(input.tasks);
  const inRange = (value: string | Date | null | undefined, from: string, to: string) => {
    const day = toTaipeiDay(value);
    return !!day && day >= from && day <= to;
  };
  const isInWeek = (v: string | Date | null | undefined) => inRange(v, weekStart, weekEnd);
  const isInNextWeek = (v: string) => inRange(v, nextWeekStart, nextWeekEnd);
  const isInMonth = (v: string) => toTaipeiDay(v)?.slice(0, 7) === month;
  const groupName = (id: string) => groups.find((g) => g.id === id)?.name || "未分組";

  const completedTasks = allTasks.filter((t) => t.completedAt != null && isInWeek(t.completedAt));

  // 進行中：期間與本週重疊（startDate <= 週日 && endDate >= 週一），橫跨整週的長期任務也算。
  // 只有一端有日期時，以該日是否落在本週判斷。有子工項時，任一子工項與本週重疊即算。
  const overlapsWeek = (start: string, end: string) => {
    if (start && end) {
      const s = toTaipeiDay(start);
      const e = toTaipeiDay(end);
      return !!s && !!e && s <= weekEnd && e >= weekStart;
    }
    return isInWeek(start) || isInWeek(end);
  };
  const taskInWeek = (t: ReportTask) => t.subtasks.length === 0
    ? overlapsWeek(t.startDate, t.endDate)
    : t.subtasks.some((s) => overlapsWeek(s.startDate, s.endDate));
  const inProgressTasks = allTasks.filter((t) => t.columnId === "inprogress" && getCompletion(t) < 100 && taskInWeek(t));

  const buildHoursMap = (isIn: (date: string) => boolean): Record<string, number> => {
    const map: Record<string, number> = {};
    const add = (assignee: string, hours: number | null) => {
      const member = findMemberById(groups, assignee);
      const key = member ? memberDisplay(member) : assignee || "未指派";
      map[key] = (map[key] || 0) + (hours as number);
    };
    for (const t of allTasks) {
      if (t.subtasks.length === 0) (t.timeLogs || []).filter((l) => isIn(l.date)).forEach((l) => add(t.assignee, l.hours));
      for (const s of t.subtasks) (s.timeLogs || []).filter((l) => isIn(l.date)).forEach((l) => add(s.assignee, l.hours));
    }
    return map;
  };
  const toEntries = (map: Record<string, number>): HoursEntry[] => Object.entries(map)
    .sort((a, b) => b[1] - a[1])
    .map(([name, hours]) => ({ name, hours: Math.round(hours * 10) / 10 }));
  const sumHours = (map: Record<string, number>) => Math.round(Object.values(map).reduce((s, h) => s + h, 0) * 10) / 10;

  const weekHoursMap = buildHoursMap(isInWeek);
  const monthHoursMap = buildHoursMap(isInMonth);
  const allHoursMap = buildHoursMap(() => true);

  const activeRisks = input.risks.filter((r) => r.status !== "resolved");

  const nextWeekTasks = allTasks.filter((t) => {
    if (getCompletion(t) >= 100) return false;
    const start = getEffectiveStartDate(t);
    const end = getEffectiveEndDate(t);
    if (isInNextWeek(start) || isInNextWeek(end)) return true;
    if (start && end) {
      const s = toTaipeiDay(start);
      const e = toTaipeiDay(end);
      if (s && e && s <= nextWeekEnd && e >= nextWeekStart) return true;
    }
    return false;
  });

  return {
    weekStart, weekEnd,
    completedTasks: completedTasks.map((t) => ({ id: t.id, title: t.title, group: groupName(t.groupId) })),
    inProgressTasks: inProgressTasks.map((t) => ({ id: t.id, title: t.title, group: groupName(t.groupId), completion: getCompletion(t) })),
    weekHours: toEntries(weekHoursMap),
    totalHours: sumHours(weekHoursMap),
    monthHours: toEntries(monthHoursMap),
    monthTotalHours: sumHours(monthHoursMap),
    allHours: toEntries(allHoursMap),
    allTotalHours: sumHours(allHoursMap),
    activeRisks: activeRisks.map((r) => ({
      id: r.id, title: r.title, status: RISK_STATUS_LABELS[r.status] ?? r.status, score: riskScore(r),
    })),
    nextWeekTasks: nextWeekTasks.map((t) => {
      const assignee = findMemberById(groups, t.assignee);
      return { id: t.id, title: t.title, group: groupName(t.groupId), assignee: assignee ? memberDisplay(assignee) : "未指派" };
    }),
  };
}

// ── 資料載入 ──────────────────────────────────────────────────────────

/** 載入報表所需資料；日期正規化與組別建構方式與前端 App.tsx 相同 */
export async function loadReportInput(projectId: string) {
  const [tasks, members, risks] = await Promise.all([
    prisma.task.findMany({ where: { projectId }, include: { subtasks: true }, orderBy: { createdAt: "asc" } }),
    prisma.projectMember.findMany({
      where: { projectId },
      include: { user: { select: { id: true, name: true, memberId: true, group: { select: { id: true, name: true, color: true } } } } },
      orderBy: { id: "asc" },
    }),
    prisma.risk.findMany({ where: { projectId }, orderBy: { createdAt: "asc" } }),
  ]);

  const reportTasks: ReportTask[] = tasks.map((t) => ({
    id: t.id, title: t.title, priority: t.priority, assignee: t.assignee, groupId: t.groupId,
    startDate: normalizeDate(t.startDate || ""), endDate: normalizeDate(t.endDate || ""),
    completion: t.completion, timeLogs: (t.timeLogs as ReportTimeLog[]) || [],
    columnId: t.columnId || "todo", completedAt: t.completedAt,
    subtasks: t.subtasks.map((s) => ({
      id: s.id, title: s.title, assignee: s.assignee, groupId: s.groupId,
      startDate: normalizeDate(s.startDate || ""), endDate: normalizeDate(s.endDate || ""),
      completion: s.completion, timeLogs: (s.timeLogs as ReportTimeLog[]) || [],
    })),
  }));

  // 專案成員依系統組別分組（前端 projectMemberGroups）
  const groupMap = new Map<string, ReportGroup>();
  for (const m of members) {
    const g = m.user.group;
    const id = g?.id || "ungrouped";
    if (!groupMap.has(id)) groupMap.set(id, { id, name: g?.name || "未分組", color: g?.color || "#64748b", members: [] });
    groupMap.get(id)!.members.push({ id: m.user.memberId || m.user.id, name: m.user.name });
  }

  return { tasks: reportTasks, groups: [...groupMap.values()], risks };
}

// ── Service（REST 與之後的 MCP 共用） ─────────────────────────────────

const weekStartSchema = z.string().regex(ISO_DAY, "weekStart 必須是 YYYY-MM-DD 格式")
  .refine((v) => toTaipeiDay(v) !== null, "weekStart 不是有效日期");

export async function getWeeklyReportData(ctx: Ctx, projectId: string, weekStartRaw: unknown) {
  await assertCanRead(ctx, projectId);
  const parsed = weekStartSchema.safeParse(weekStartRaw);
  if (!parsed.success) throw new BadRequestError(parsed.error.issues[0].message);

  const input = await loadReportInput(projectId);
  const report = buildWeeklyReport(input, parsed.data);
  return { projectId, ...report, notes: await findWeeklyNotes(projectId, report.weekStart) };
}

/**
 * 讀取週報備註：先查週一 key，查不到再查前一天（週日）的 key。
 * TODO(phase0-compat): 前端 formatDateStr 以 toISOString 取日期，在台灣時區會把週一存成前一天（週日），
 * 正式 DB 的既有備註都是週日 key。修正前端並以 migration 把舊 key 往後平移一天後，移除週日 fallback。
 */
async function findWeeklyNotes(projectId: string, monday: string): Promise<string> {
  const byMonday = await prisma.weeklyReport.findUnique({
    where: { projectId_weekStart: { projectId, weekStart: monday } },
    select: { notes: true },
  });
  if (byMonday) return byMonday.notes;
  const bySunday = await prisma.weeklyReport.findUnique({
    where: { projectId_weekStart: { projectId, weekStart: addDays(monday, -1) } },
    select: { notes: true },
  });
  return bySunday?.notes ?? "";
}

export async function getProjectSummary(ctx: Ctx, projectId: string, now: Date = new Date()) {
  await assertCanRead(ctx, projectId);
  const project = await prisma.project.findUnique({ where: { id: projectId }, select: { id: true, name: true } });
  const input = await loadReportInput(projectId);
  const today = todayInTaipei(now);
  const board = orderForBoard(input.tasks);

  const overdueTasks = board
    .map((t) => ({ t, due: getDueStatus(t, today) }))
    .filter((x) => x.due?.isOverdue)
    .map(({ t, due }) => ({ id: t.id, title: t.title, dueDate: due!.dueDate, overdueDays: -due!.diffDays, completion: getCompletion(t) }))
    .sort((a, b) => b.overdueDays - a.overdueDays);

  const activeRisks = input.risks.filter((r) => r.status !== "resolved");
  const highRisks = activeRisks
    .map((r) => ({ id: r.id, title: r.title, score: riskScore(r) }))
    .filter((r) => r.score >= HIGH_RISK_SCORE);

  return {
    projectId, name: project?.name ?? "", today,
    ...computeProgress(input.tasks),
    overdueCount: overdueTasks.length,
    overdueTasks,
    activeRiskCount: activeRisks.length,
    highRiskCount: highRisks.length,
    highRisks,
  };
}

// ── 週報備註 ──────────────────────────────────────────────────────────

const weeklyNotesSchema = z.object({
  weekStart: z.string().regex(ISO_DAY, "weekStart 必須是 YYYY-MM-DD 格式"),
  weekEnd: z.string().regex(ISO_DAY, "weekEnd 必須是 YYYY-MM-DD 格式").optional(),
  notes: z.string().max(100000).optional(),
});

export async function listWeeklyReports(ctx: Ctx, projectId: string) {
  await assertCanRead(ctx, projectId);
  return prisma.weeklyReport.findMany({ where: { projectId }, orderBy: { weekStart: "desc" } });
}

/**
 * 儲存週報備註，weekStart 照前端送來的值存。
 * TODO(phase0-compat): 目前前端送來的 weekStart 是週日（見 findWeeklyNotes）；此處不可自行轉成週一，
 * 否則前端以週日 key 查不到剛存的備註。前端修正後，改為一律以週一（Asia/Taipei）為 key。
 */
export async function saveWeeklyNotes(ctx: Ctx, projectId: string, input: unknown) {
  const data = parseInput(weeklyNotesSchema, input);
  await assertCan(ctx, projectId, "weekly.manage");
  return prisma.weeklyReport.upsert({
    where: { projectId_weekStart: { projectId, weekStart: data.weekStart } },
    update: { notes: data.notes ?? "" },
    create: { weekStart: data.weekStart, weekEnd: data.weekEnd ?? addDays(data.weekStart, 6), notes: data.notes ?? "", projectId },
  });
}
