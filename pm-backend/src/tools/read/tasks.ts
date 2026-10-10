import { z } from "zod";
import { getReadableProject } from "../../services/projects";
import * as tasksService from "../../services/tasks";
import * as reports from "../../services/reports";
import { READ_ANNOTATIONS, ToolContext, defineTool, serviceCtx } from "../types";
import { COLUMN_LABELS, PRIORITY_LABELS, dateParam, isHttpUrl, isoDay, makeDirectory, pageShape, paginate, projectsInScope } from "../format";

export const listTasksTool = defineTool({
  name: "list_tasks",
  title: "列出任務",
  description: "列出 WBS 任務（主任務，子任務附在 subtasks 中並標示 parentTaskId）。未指定 projectId 時涵蓋你可見的所有專案。status 為看板欄位：todo（待處理）、inprogress（進行中）、review（審查中）、done（已完成）。assigneeId 為員工編號（memberId），主任務或任一子任務符合即列出。dueFrom / dueTo 以有效結束日（有子任務時取子任務最晚的結束日）篩選。keyword 比對任務與子任務的名稱和描述。",
  inputSchema: z.object({
    projectId: z.string().optional().describe("專案 id；不填則查詢所有可見且未封存的專案（指定已封存專案的 id 仍可查詢）"),
    status: z.enum(["todo", "inprogress", "review", "done"]).optional().describe("看板欄位"),
    assigneeId: z.string().optional().describe("負責人的員工編號（memberId）"),
    groupId: z.string().optional().describe("組別 id"),
    dueFrom: dateParam("結束日下限（含），YYYY-MM-DD"),
    dueTo: dateParam("結束日上限（含），YYYY-MM-DD"),
    keyword: z.string().max(200).optional().describe("關鍵字"),
    ...pageShape,
  }),
  scope: "pm:read",
  annotations: READ_ANNOTATIONS,
  handler: async (tc, a) => {
    const ctx = serviceCtx(tc);
    const today = reports.todayInTaipei();
    const rows: { project: { id: string; name: string }; t: reports.ReportTask; description: string }[] = [];
    for (const p of await projectsInScope(ctx, a.projectId)) {
      for (const t of reports.orderForBoard(await tasksService.listTasks(ctx, p.id))) {
        rows.push({ project: p, t: reports.toReportTask(t), description: t.description });
      }
    }
    const kw = a.keyword?.trim().toLowerCase();
    const filtered = rows.filter(({ t, description }) => {
      if (a.status && t.columnId !== a.status) return false;
      if (a.assigneeId && t.assignee !== a.assigneeId && !t.subtasks.some((s) => s.assignee === a.assigneeId)) return false;
      if (a.groupId && t.groupId !== a.groupId && !t.subtasks.some((s) => s.groupId === a.groupId)) return false;
      if (a.dueFrom || a.dueTo) {
        const due = isoDay(reports.getEffectiveEndDate(t));
        if (!due || (a.dueFrom && due < a.dueFrom) || (a.dueTo && due > a.dueTo)) return false;
      }
      if (kw) {
        const hay = [t.title, description, ...t.subtasks.map((s) => s.title)].join("\n").toLowerCase();
        if (!hay.includes(kw)) return false;
      }
      return true;
    });
    const page = paginate(filtered, a.limit, a.cursor);
    const dir = await makeDirectory(page.items.flatMap(({ t }) => [t.assignee, ...t.subtasks.map((s) => s.assignee)]));
    return {
      data: {
        ...page,
        items: page.items.map(({ project, t }) => ({
          id: t.id, title: t.title, project,
          status: { id: t.columnId, label: COLUMN_LABELS[t.columnId] ?? t.columnId },
          priority: { id: t.priority, label: PRIORITY_LABELS[t.priority] ?? t.priority },
          assignee: dir.member(t.assignee), group: dir.group(t.groupId),
          startDate: isoDay(reports.getEffectiveStartDate(t)), endDate: isoDay(reports.getEffectiveEndDate(t)),
          completion: reports.getCompletion(t),
          isOverdue: reports.getDueStatus(t, today)?.isOverdue ?? false,
          subtasks: t.subtasks.map((s) => ({
            id: s.id, parentTaskId: t.id, title: s.title, assignee: dir.member(s.assignee), group: dir.group(s.groupId),
            startDate: isoDay(s.startDate), endDate: isoDay(s.endDate), completion: s.completion,
          })),
        })),
      },
      count: page.items.length,
    };
  },
});

/** get_task 與 update_task（修改前後）共用的任務輸出格式 */
export async function formatTaskDetail(tc: ToolContext, taskId: string) {
  const ctx = serviceCtx(tc);
  const task = await tasksService.getTask(ctx, taskId);
  const project = await getReadableProject(ctx, task.projectId);
  const rt = reports.toReportTask(task);
  const dir = await makeDirectory([rt.assignee, ...rt.subtasks.map((s) => s.assignee)]);
  const logs = (l: reports.ReportTimeLog[]) => l.map((x) => ({ date: isoDay(x.date), hours: x.hours ?? 0 }));
  const sumHours = (l: reports.ReportTimeLog[]) => Math.round(l.reduce((s, x) => s + (x.hours ?? 0), 0) * 10) / 10;
  return {
    id: task.id, title: task.title, description: task.description, project,
    status: { id: rt.columnId, label: COLUMN_LABELS[rt.columnId] ?? rt.columnId },
    priority: { id: task.priority, label: PRIORITY_LABELS[task.priority] ?? task.priority },
    assignee: dir.member(rt.assignee), group: dir.group(rt.groupId),
    startDate: isoDay(reports.getEffectiveStartDate(rt)), endDate: isoDay(reports.getEffectiveEndDate(rt)),
    completion: reports.getCompletion(rt), completedAt: isoDay(task.completedAt),
    timeLogs: logs(rt.timeLogs), totalHours: sumHours([...rt.timeLogs, ...rt.subtasks.flatMap((s) => s.timeLogs)]),
    subtasks: rt.subtasks.map((s) => ({
      id: s.id, parentTaskId: task.id, title: s.title, assignee: dir.member(s.assignee), group: dir.group(s.groupId),
      startDate: isoDay(s.startDate), endDate: isoDay(s.endDate), completion: s.completion,
      timeLogs: logs(s.timeLogs), totalHours: sumHours(s.timeLogs),
    })),
    comments: task.comments.map((c) => ({
      id: c.id, author: { id: c.user.id, name: c.user.name }, date: isoDay(c.createdAt), content: c.content,
    })),
    attachments: task.attachments.map((x) => ({
      id: x.id, name: x.name, url: isHttpUrl(x.url) ? x.url : null,
      uploader: { id: x.uploader.id, name: x.uploader.name }, date: isoDay(x.createdAt),
    })),
    // Phase 2 新增：update_task 的 expectedUpdatedAt（樂觀鎖）請帶入此值
    updatedAt: task.updatedAt.toISOString(),
  };
}

export const getTaskTool = defineTool({
  name: "get_task",
  title: "任務詳情",
  description: "取得單一任務的完整內容：描述、子任務、留言、工時紀錄與附件連結。回傳的 updatedAt 可作為 update_task 的 expectedUpdatedAt（樂觀鎖）。",
  inputSchema: z.object({ taskId: z.string().describe("任務 id") }),
  scope: "pm:read",
  annotations: READ_ANNOTATIONS,
  handler: async (tc, { taskId }) => ({ data: await formatTaskDetail(tc, taskId), count: 1 }),
});

export const listOverdueTasksTool = defineTool({
  name: "list_overdue_tasks",
  title: "逾期任務",
  description: "列出逾期的主任務（有效結束日早於今天且完成度未達 100%，判斷方式與看板上的「已逾期」標籤相同），依逾期天數由多到少排序。未指定 projectId 時涵蓋所有可見專案。",
  inputSchema: z.object({
    projectId: z.string().optional().describe("專案 id；不填則查詢所有可見且未封存的專案（指定已封存專案的 id 仍可查詢）"),
    assigneeId: z.string().optional().describe("負責人的員工編號（memberId）"),
    ...pageShape,
  }),
  scope: "pm:read",
  annotations: READ_ANNOTATIONS,
  handler: async (tc, { projectId, assigneeId, limit, cursor }) => {
    const { today, tasks } = await reports.listOverdueTasks(serviceCtx(tc), { projectId });
    const filtered = assigneeId ? tasks.filter((t) => t.assignee === assigneeId) : tasks;
    const page = paginate(filtered, limit, cursor);
    const dir = await makeDirectory(page.items.map((t) => t.assignee));
    return {
      data: {
        today, ...page,
        items: page.items.map((t) => ({
          id: t.id, title: t.title, project: t.project,
          status: { id: t.columnId, label: COLUMN_LABELS[t.columnId] ?? t.columnId },
          assignee: dir.member(t.assignee), group: dir.group(t.groupId),
          dueDate: isoDay(t.dueDate), overdueDays: t.overdueDays, completion: t.completion,
        })),
      },
      count: page.items.length,
    };
  },
});
