import { z } from "zod";
import { listProjects } from "../../services/projects";
import * as reports from "../../services/reports";
import { READ_ANNOTATIONS, defineTool, serviceCtx } from "../types";
import { UI_LABELS, isoDay, makeDirectory, pageShape, paginate } from "../format";

export const listProjectsTool = defineTool({
  name: "list_projects",
  title: "列出專案",
  description: "列出你可以看到的專案（與網頁左側專案清單相同），附上兩種完成度：taskCompletionRate（網頁上的「進度」，已完成任務數 ÷ 總任務數）與 weightedProgress（網頁上的「整體完成度」，各任務完成度的平均）。status 可篩選 active（進行中）或 completed（所有任務都已完成）。",
  inputSchema: z.object({
    status: z.enum(["active", "completed"]).optional().describe("active：尚有未完成任務或尚無任務；completed：所有任務都在「已完成」欄"),
    ...pageShape,
  }),
  scope: "pm:read",
  annotations: READ_ANNOTATIONS,
  handler: async (tc, { status, limit, cursor }) => {
    const ctx = serviceCtx(tc);
    const projects = await listProjects(ctx);
    const rows = [];
    for (const p of projects) {
      const progress = await reports.getProjectProgress(ctx, p.id);
      const projectStatus = progress.totalTasks > 0 && progress.doneTasks === progress.totalTasks ? "completed" : "active";
      if (status && status !== projectStatus) continue;
      rows.push({
        id: p.id, name: p.name, description: p.description, myRole: p.userRole, memberCount: p.members.length,
        status: projectStatus, totalTasks: progress.totalTasks, doneTasks: progress.doneTasks,
        taskCompletionRate: { value: progress.taskCompletionRate, uiLabel: UI_LABELS.taskCompletionRate },
        weightedProgress: { value: progress.weightedProgress, uiLabel: UI_LABELS.weightedProgress },
      });
    }
    const page = paginate(rows, limit, cursor);
    return { data: page, count: page.items.length };
  },
});

export const getProjectSummaryTool = defineTool({
  name: "get_project_summary",
  title: "專案摘要",
  description: "取得單一專案的摘要：任務完成率（網頁「進度」）、加權進度（網頁「整體完成度」）、逾期任務、高風險項目（風險分數 ≥ 16，即風險矩陣紅色區）與未來 14 天內到期的主任務。",
  inputSchema: z.object({ projectId: z.string().describe("專案 id（可由 list_projects 取得）") }),
  scope: "pm:read",
  annotations: READ_ANNOTATIONS,
  handler: async (tc, { projectId }) => {
    const s = await reports.getProjectSummary(serviceCtx(tc), projectId);
    const dir = await makeDirectory([...s.overdueTasks, ...s.upcomingTasks].map((t) => t.assignee));
    const task = (t: { id: string; title: string; assignee: string; groupId: string; dueDate: string; completion: number }) => ({
      id: t.id, title: t.title, assignee: dir.member(t.assignee), group: dir.group(t.groupId),
      dueDate: isoDay(t.dueDate), completion: t.completion,
    });
    return {
      data: {
        project: { id: s.projectId, name: s.name }, today: s.today,
        totalTasks: s.totalTasks, doneTasks: s.doneTasks,
        taskCompletionRate: { value: s.taskCompletionRate, uiLabel: UI_LABELS.taskCompletionRate },
        weightedProgress: { value: s.weightedProgress, uiLabel: UI_LABELS.weightedProgress },
        overdueCount: s.overdueCount,
        overdueTasks: s.overdueTasks.map((t) => ({ ...task(t), overdueDays: t.overdueDays })),
        activeRiskCount: s.activeRiskCount, highRiskCount: s.highRiskCount, highRisks: s.highRisks,
        upcomingDays: s.upcomingDays,
        upcomingTasks: s.upcomingTasks.map((t) => ({ ...task(t), daysLeft: t.daysLeft })),
      },
      count: 1,
    };
  },
});
