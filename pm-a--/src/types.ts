export type Priority = "low" | "medium" | "high";
export type RiskLevel = "high" | "mid-high" | "medium" | "mid-low" | "low";
export type RiskStatus = "monitoring" | "occurred" | "resolved";

export type TimeLog = { id: string; date: string; hours: number };
export type Member = { id: string; name: string };
export type Group = { id: string; name: string; color: string; members: Member[] };
export type SubTask = {
  id: string; title: string; description: string; assignee: string; groupId: string;
  startDate: string; endDate: string; completion: number; timeLogs: TimeLog[];
};
export type Task = {
  id: string; title: string; description: string; priority: Priority;
  assignee: string; groupId: string; startDate: string; endDate: string;
  completion: number; timeLogs: TimeLog[]; subtasks: SubTask[]; columnId?: string;
};
export type Column = { id: string; title: string; tasks: Task[] };
export type MeetingRecord = { id: string; date: string; attendees: string[]; summary: string; externalLink: string };
export type MeetingSeries = { id: string; name: string; type: "regular" | "adhoc"; records: MeetingRecord[] };
export type Risk = {
  id: string; title: string; description: string; probability: RiskLevel; impact: RiskLevel;
  countermeasure: string; ownerId: string; ownerGroupId: string; status: RiskStatus; createdDate: string;
};
export type WeeklyReport = { id: string; weekStart: string; weekEnd: string; notes: string };
export type Project = {
  id: string; name: string; description: string; color: string;
  columns: Column[]; groups: Group[]; meetings?: MeetingSeries[];
  risks?: Risk[]; weeklyReports?: WeeklyReport[]; userRole?: string;
};
