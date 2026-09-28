// 進度與週報的純計算邏輯（自 DashboardView / WeeklyReportView / App 抽出，行為不變）。
// 後端 pm-backend/src/services/reports.ts 有對應的實作，兩者以一致性測試確保結果相同。

import type { Column, Group, Risk, Task } from "./types";
import { RISK_STATUS_CONFIG, getCompletion, getEffectiveStartDate, getEffectiveEndDate, getWeekRange, findMemberById, memberDisplay } from "./helpers";

/** 任務完成率（已完成欄的任務數 ÷ 總任務數）與加權進度（各任務完成度的平均） */
export function computeProgress(columns: Column[]) {
  const allTasks = columns.flatMap((c) => c.tasks);
  const totalTasks = allTasks.length;
  const doneTasks = columns.find((c) => c.id === "done")?.tasks.length ?? 0;
  const taskCompletionRate = totalTasks ? Math.round((doneTasks / totalTasks) * 100) : 0;
  const weightedProgress = totalTasks > 0
    ? Math.round(allTasks.reduce((sum, t) => sum + getCompletion(t), 0) / totalTasks)
    : 0;
  return { totalTasks, doneTasks, taskCompletionRate, weightedProgress };
}

/** 截止狀態（KanbanView 的截止日標籤）：有效結束日早於今天且完成度未達 100% 即為逾期 */
export function getDueStatus(task: Task, now: Date = new Date()) {
  const dueDate = getEffectiveEndDate(task);
  if (!dueDate) return null;
  const today = new Date(now); today.setHours(0, 0, 0, 0);
  const due = new Date(dueDate + "T00:00:00");
  const diffDays = Math.round((due.getTime() - today.getTime()) / 86400000);
  const isDone = getCompletion(task) >= 100;
  return {
    dueDate, due, diffDays,
    isOverdue: !isDone && diffDays < 0,
    isDueSoon: !isDone && diffDays >= 0 && diffDays <= 2,
  };
}

export function computeWeeklyReport(columns: Column[], groups: Group[], risks: Risk[], targetDate: Date) {
  const { start: weekStart, end: weekEnd } = getWeekRange(targetDate);
  const allTasks = columns.flatMap((c) => c.tasks);

  const isInWeek = (dateStr: string) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return d >= weekStart && d <= weekEnd;
  };

  const completedTasks = allTasks.filter((t) =>
    t.completedAt != null && isInWeek(t.completedAt)
  );

  const taskInWeek = (t: Task): boolean => {
    if (t.subtasks.length === 0) return isInWeek(t.startDate) || isInWeek(t.endDate);
    return t.subtasks.some((s) => isInWeek(s.startDate) || isInWeek(s.endDate));
  };

  const inProgressColumn = columns.find((c) => c.id === "inprogress");
  const inProgressTasks = inProgressColumn
    ? inProgressColumn.tasks.filter((t) => getCompletion(t) < 100 && taskInWeek(t))
    : [];

  const buildHoursMap = (isInRange: (dateStr: string) => boolean): Record<string, number> => {
    const map: Record<string, number> = {};
    allTasks.forEach((t) => {
      if (t.subtasks.length === 0) {
        (t.timeLogs || []).filter((l) => isInRange(l.date)).forEach((l) => {
          const member = findMemberById(groups, t.assignee);
          const key = member ? memberDisplay(member) : t.assignee || "未指派";
          map[key] = (map[key] || 0) + l.hours;
        });
      }
      t.subtasks.forEach((s) => {
        (s.timeLogs || []).filter((l) => isInRange(l.date)).forEach((l) => {
          const member = findMemberById(groups, s.assignee);
          const key = member ? memberDisplay(member) : s.assignee || "未指派";
          map[key] = (map[key] || 0) + l.hours;
        });
      });
    });
    return map;
  };

  const weekHoursMap = buildHoursMap(isInWeek);

  const isInMonth = (dateStr: string) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return d.getFullYear() === targetDate.getFullYear() && d.getMonth() === targetDate.getMonth();
  };
  const monthHoursMap = buildHoursMap(isInMonth);
  const allHoursMap = buildHoursMap(() => true);

  const totalWeekHours = Math.round(Object.values(weekHoursMap).reduce((s, h) => s + h, 0) * 10) / 10;

  const activeRisks = risks.filter((r) => r.status !== "resolved");

  const nextWeekStart = new Date(weekEnd);
  nextWeekStart.setDate(nextWeekStart.getDate() + 1);
  const nextWeekEnd = new Date(nextWeekStart);
  nextWeekEnd.setDate(nextWeekStart.getDate() + 6);

  const isInNextWeek = (dateStr: string) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return d >= nextWeekStart && d <= nextWeekEnd;
  };

  const nextWeekTasks = allTasks.filter((t) => {
    const comp = getCompletion(t);
    if (comp >= 100) return false;
    const effectiveStart = getEffectiveStartDate(t);
    const effectiveEnd = getEffectiveEndDate(t);
    if (isInNextWeek(effectiveStart) || isInNextWeek(effectiveEnd)) return true;
    if (effectiveStart && effectiveEnd) {
      const s = new Date(effectiveStart);
      const e = new Date(effectiveEnd);
      if (s <= nextWeekEnd && e >= nextWeekStart) return true;
    }
    return false;
  });

  return {
    weekStart, weekEnd,
    completedTasks, inProgressTasks,
    weekHoursMap, monthHoursMap, allHoursMap, totalWeekHours,
    activeRisks, nextWeekTasks,
  };
}

export type WeeklyReportCalc = ReturnType<typeof computeWeeklyReport>;

/** 週報匯出（PDF / Markdown）使用的資料 */
export function toWeeklyReportData(calc: WeeklyReportCalc, groups: Group[], notes: string) {
  return {
    completedTasks: calc.completedTasks.map((t) => ({
      title: t.title,
      group: groups.find((g) => g.id === t.groupId)?.name || "未分組",
    })),
    inProgressTasks: calc.inProgressTasks.map((t) => ({
      title: t.title,
      group: groups.find((g) => g.id === t.groupId)?.name || "未分組",
      completion: getCompletion(t),
    })),
    weekHours: Object.entries(calc.weekHoursMap)
      .sort((a, b) => b[1] - a[1])
      .map(([name, hours]) => ({ name, hours: Math.round(hours * 10) / 10 })),
    totalHours: calc.totalWeekHours,
    activeRisks: calc.activeRisks.map((r) => ({
      title: r.title,
      status: RISK_STATUS_CONFIG[r.status].label,
    })),
    nextWeekTasks: calc.nextWeekTasks.map((t) => {
      const group = groups.find((g) => g.id === t.groupId);
      const assignee = findMemberById(groups, t.assignee);
      return {
        title: t.title,
        group: group?.name || "未分組",
        assignee: assignee ? memberDisplay(assignee) : "未指派",
      };
    }),
    notes,
  };
}
