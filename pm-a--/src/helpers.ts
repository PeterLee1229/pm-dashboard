import type { Priority, RiskLevel, RiskStatus, TimeLog, Member, Group, Task } from "./types";

export const PRIORITY_CONFIG: Record<Priority, { label: string; color: string }> = {
  low:    { label: "低",  color: "#4ade80" },
  medium: { label: "中",  color: "#facc15" },
  high:   { label: "高",  color: "#f87171" },
};

export const COLUMN_COLORS: Record<string, string> = {
  todo: "#6366f1", inprogress: "#f59e0b", review: "#8b5cf6", done: "#10b981",
};

export const RISK_LEVELS: { id: RiskLevel; label: string; color: string; value: number }[] = [
  { id: "high",     label: "高",   color: "#ef4444", value: 5 },
  { id: "mid-high", label: "中高", color: "#f97316", value: 4 },
  { id: "medium",   label: "中",   color: "#facc15", value: 3 },
  { id: "mid-low",  label: "中低", color: "#6366f1", value: 2 },
  { id: "low",      label: "低",   color: "#4ade80", value: 1 },
];

export const RISK_STATUS_CONFIG: Record<RiskStatus, { label: string; color: string }> = {
  monitoring: { label: "監控中", color: "#f59e0b" },
  occurred:   { label: "已發生", color: "#ef4444" },
  resolved:   { label: "已解除", color: "#10b981" },
};

export const PROJECT_COLORS = ["#6366f1", "#f59e0b", "#10b981", "#f43f5e", "#8b5cf6", "#06b6d4"];

export function getCompletion(task: Task): number {
  if (task.subtasks.length === 0) return task.completion;
  const avg = task.subtasks.reduce((sum, s) => sum + s.completion, 0) / task.subtasks.length;
  return Math.round(avg);
}

export function getEffectiveStartDate(task: Task): string {
  if (task.subtasks.length === 0) return task.startDate;
  const dates = task.subtasks.filter((s) => s.startDate).map((s) => s.startDate);
  if (dates.length === 0) return task.startDate;
  return dates.sort()[0];
}

export function getEffectiveEndDate(task: Task): string {
  if (task.subtasks.length === 0) return task.endDate;
  const dates = task.subtasks.filter((s) => s.endDate).map((s) => s.endDate);
  if (dates.length === 0) return task.endDate;
  return dates.sort().reverse()[0];
}

export function getTotalHours(logs: TimeLog[]): number {
  return Math.round(logs.reduce((sum, l) => sum + l.hours, 0) * 10) / 10;
}

export function memberDisplay(member: Member): string {
  return `${member.name}（${member.id}）`;
}

export function findMemberById(groups: Group[], memberId: string): Member | undefined {
  for (const g of groups) {
    const found = g.members.find((m) => m.id === memberId);
    if (found) return found;
  }
  return undefined;
}

export function getSubtaskAssigneeLabel(task: Task, groups: Group[]): string {
  const uniqueIds = [...new Set(
    task.subtasks.map((s) => s.assignee).filter((a) => a && a.trim() !== "")
  )];
  if (uniqueIds.length === 0) return "未指派";
  const first = findMemberById(groups, uniqueIds[0]);
  const firstName = first ? first.name : uniqueIds[0];
  if (uniqueIds.length === 1) return firstName;
  return `${firstName} +${uniqueIds.length - 1}`;
}

export function normalizeDate(dateStr: string): string {
  if (!dateStr) return "";
  const cleaned = dateStr.replace(/\//g, "-");
  const parts = cleaned.split("-");
  if (parts.length !== 3) return dateStr;
  const [year, month, day] = parts;
  return `${year}-${month.padStart(2, "0")}-${day.padStart(2, "0")}`;
}

export function toROCDate(dateStr: string): string {
  const d = new Date(dateStr);
  const rocYear = d.getFullYear() - 1911;
  return `${rocYear}/${d.getMonth() + 1}/${d.getDate()}`;
}

export function hasPermission(userRole: string, action: string): boolean {
  const permissions: Record<string, string[]> = {
    "delete_project":  ["owner"],
    "manage_groups":   ["owner", "pm"],
    "create_task":     ["owner", "pm", "group_leader"],
    "delete_task":     ["owner", "pm", "group_leader"],
    "edit_all_tasks":  ["owner", "pm", "group_leader"],
    "edit_own_task":   ["owner", "pm", "group_leader", "member"],
    "drag_to_done":    ["owner", "pm"],
    "drag_task":       ["owner", "pm", "group_leader", "member"],
    "manage_meetings": ["owner", "pm", "group_leader"],
    "view_risks":      ["owner", "pm", "group_leader", "member", "viewer"],
    "manage_risks":    ["owner", "pm", "group_leader", "member"],
    "manage_weekly":   ["owner", "pm"],
    "export":          ["owner", "pm", "group_leader", "member"],
    "manage_members":  ["owner", "pm", "group_leader"],
    "invite_members":  ["owner", "pm", "group_leader"],
  };
  const allowed = permissions[action] || [];
  return allowed.includes(userRole) || userRole === "admin";
}

export function getWeekRange(date: Date): { start: Date; end: Date } {
  const d = new Date(date);
  const day = d.getDay();
  const diffToMon = day === 0 ? -6 : 1 - day;
  const start = new Date(d);
  start.setDate(d.getDate() + diffToMon);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(start.getDate() + 6);
  end.setHours(23, 59, 59, 999);
  return { start, end };
}

export function formatDateStr(d: Date): string {
  return d.toISOString().split("T")[0];
}
