// MCP 唯讀工具。所有查詢與權限檢查都呼叫 Phase 0 的 service（與 REST API 共用），這裡只負責
// 參數驗證、跨專案彙整、分頁與輸出格式。每次呼叫（含失敗）都寫入 McpAuditLog。

import { z } from "zod";
import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import type { CallToolResult } from "@modelcontextprotocol/sdk/types.js";
import { prisma } from "../db";
import { BadRequestError, HttpError } from "../errors";
import { Ctx, loadAssigneeInfo, loadGroupNames } from "../services/permissions";
import { getReadableProject, listProjects, listVisibleProjects } from "../services/projects";
import * as tasksService from "../services/tasks";
import * as meetingsService from "../services/meetings";
import * as risksService from "../services/risks";
import * as okrsService from "../services/okrs";
import * as reports from "../services/reports";
import { searchProject } from "../services/search";
import { listActivities } from "../services/activity";

// ── 輸出格式工具 ──────────────────────────────────────────────────────

const COLUMN_LABELS: Record<string, string> = { todo: "待處理", inprogress: "進行中", review: "審查中", done: "已完成" };
const PRIORITY_LABELS: Record<string, string> = { low: "低", medium: "中", high: "高" };
const RISK_LEVEL_LABELS: Record<string, string> = { high: "高", "mid-high": "中高", medium: "中", "mid-low": "中低", low: "低" };
const RISK_STATUS_LABELS: Record<string, string> = { monitoring: "監控中", occurred: "已發生", resolved: "已解除" };
/** API 欄位對應的 UI 標籤（見 services/reports.ts computeProgress 的註解） */
export const UI_LABELS = { taskCompletionRate: "進度", weightedProgress: "整體完成度" } as const;

/** 日期字串或時間 → ISO YYYY-MM-DD（台灣時區）；無法解析回傳 null */
const isoDay = (v: string | Date | null | undefined) =>
  reports.toTaipeiDay(typeof v === "string" ? reports.normalizeDate(v) : v);

/** ISO 日期 → 民國年（例如 115/09/28） */
export function toROC(day: string | null): string | null {
  if (!day) return null;
  const [y, m, d] = day.split("-");
  return `${Number(y) - 1911}/${m}/${d}`;
}

const isHttpUrl = (v: string) => {
  try { const u = new URL(v); return u.protocol === "http:" || u.protocol === "https:"; } catch { return false; }
};

/** 依 memberId 取得 {id, name}；查詢一次後在同一次工具呼叫中重複使用 */
async function makeDirectory(memberIds: string[]) {
  const [users, groups] = await Promise.all([loadAssigneeInfo(memberIds), loadGroupNames()]);
  return {
    member: (memberId: string) => (memberId ? { id: memberId, name: users.get(memberId)?.name ?? memberId } : null),
    group: (groupId: string) => (groupId ? { id: groupId, name: groups.get(groupId) ?? groupId } : null),
  };
}

// ── 分頁 ──────────────────────────────────────────────────────────────

const pageShape = {
  limit: z.number().int().min(1).max(200).optional().describe("每頁筆數，預設 50，上限 200"),
  cursor: z.string().optional().describe("上一次回傳的 nextCursor，用來取下一頁；第一頁不用填"),
};

export function paginate<T>(items: T[], limit = 50, cursor?: string) {
  let offset = 0;
  if (cursor) {
    const parsed = Number(Buffer.from(cursor, "base64url").toString());
    if (!Number.isInteger(parsed) || parsed < 0) throw new BadRequestError("cursor 無效");
    offset = parsed;
  }
  const page = items.slice(offset, offset + limit);
  const next = offset + limit < items.length ? Buffer.from(String(offset + limit)).toString("base64url") : null;
  return { total: items.length, items: page, nextCursor: next };
}

const dateParam = (desc: string) => z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必須是 YYYY-MM-DD").optional().describe(desc);

async function projectsInScope(ctx: Ctx, projectId?: string) {
  return projectId ? [await getReadableProject(ctx, projectId)] : listVisibleProjects(ctx);
}

// ── 稽核紀錄 ──────────────────────────────────────────────────────────

/** 參數摘要：只保留短字串，避免把大段文字寫進稽核紀錄 */
function summarizeParams(args: Record<string, unknown>) {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(args ?? {})) {
    out[k] = typeof v === "string" && v.length > 100 ? `${v.slice(0, 100)}…` : v;
  }
  return out;
}

function errorCodeOf(err: unknown): string {
  if (err instanceof HttpError) return ({ 400: "BAD_REQUEST", 403: "FORBIDDEN", 404: "NOT_FOUND" } as Record<number, string>)[err.status] ?? `HTTP_${err.status}`;
  return "INTERNAL";
}

type ToolResult = { data: unknown; count?: number };

export function buildMcpServer(ctx: Ctx, meta: { clientId: string }) {
  const server = new McpServer({ name: "pm-dashboard", version: "1.0.0" });

  const register = <S extends z.ZodRawShape>(
    name: string, title: string, description: string, inputSchema: S,
    handler: (args: z.infer<z.ZodObject<S>>) => Promise<ToolResult>,
  ) => {
    server.registerTool(
      name,
      { title, description, inputSchema, annotations: { readOnlyHint: true, openWorldHint: false } },
      (async (args: z.infer<z.ZodObject<S>>): Promise<CallToolResult> => {
        const started = Date.now();
        let success = false;
        let errorCode: string | null = null;
        let resultCount: number | null = null;
        try {
          const { data, count } = await handler(args);
          success = true;
          resultCount = count ?? null;
          return { content: [{ type: "text", text: JSON.stringify(data) }] };
        } catch (err) {
          errorCode = errorCodeOf(err);
          if (errorCode === "INTERNAL") console.error(`MCP 工具 ${name} 錯誤:`, err);
          const message = err instanceof HttpError ? err.message : "伺服器錯誤";
          return { isError: true, content: [{ type: "text", text: JSON.stringify({ error: message, code: errorCode }) }] };
        } finally {
          // 稽核紀錄寫入失敗不可影響回應
          await prisma.mcpAuditLog.create({
            data: {
              userId: ctx.userId, clientId: meta.clientId, tool: name,
              params: summarizeParams(args as Record<string, unknown>) as object,
              resultCount, success, errorCode, durationMs: Date.now() - started,
            },
          }).catch((e: unknown) => console.error("寫入 MCP 稽核紀錄失敗:", e));
        }
      }) as never,
    );
  };

  // 1. list_projects
  register("list_projects", "列出專案",
    "列出你可以看到的專案（與網頁左側專案清單相同），附上兩種完成度：taskCompletionRate（網頁上的「進度」，已完成任務數 ÷ 總任務數）與 weightedProgress（網頁上的「整體完成度」，各任務完成度的平均）。status 可篩選 active（進行中）或 completed（所有任務都已完成）。",
    {
      status: z.enum(["active", "completed"]).optional().describe("active：尚有未完成任務或尚無任務；completed：所有任務都在「已完成」欄"),
      ...pageShape,
    },
    async ({ status, limit, cursor }) => {
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
    });

  // 2. get_project_summary
  register("get_project_summary", "專案摘要",
    "取得單一專案的摘要：任務完成率（網頁「進度」）、加權進度（網頁「整體完成度」）、逾期任務、高風險項目（風險分數 ≥ 16，即風險矩陣紅色區）與未來 14 天內到期的主任務。",
    { projectId: z.string().describe("專案 id（可由 list_projects 取得）") },
    async ({ projectId }) => {
      const s = await reports.getProjectSummary(ctx, projectId);
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
    });

  // 3. list_tasks
  register("list_tasks", "列出任務",
    "列出 WBS 任務（主任務，子任務附在 subtasks 中並標示 parentTaskId）。未指定 projectId 時涵蓋你可見的所有專案。status 為看板欄位：todo（待處理）、inprogress（進行中）、review（審查中）、done（已完成）。assigneeId 為員工編號（memberId），主任務或任一子任務符合即列出。dueFrom / dueTo 以有效結束日（有子任務時取子任務最晚的結束日）篩選。keyword 比對任務與子任務的名稱和描述。",
    {
      projectId: z.string().optional().describe("專案 id；不填則查詢所有可見專案"),
      status: z.enum(["todo", "inprogress", "review", "done"]).optional().describe("看板欄位"),
      assigneeId: z.string().optional().describe("負責人的員工編號（memberId）"),
      groupId: z.string().optional().describe("組別 id"),
      dueFrom: dateParam("結束日下限（含），YYYY-MM-DD"),
      dueTo: dateParam("結束日上限（含），YYYY-MM-DD"),
      keyword: z.string().max(200).optional().describe("關鍵字"),
      ...pageShape,
    },
    async (a) => {
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
    });

  // 4. get_task
  register("get_task", "任務詳情",
    "取得單一任務的完整內容：描述、子任務、留言、工時紀錄與附件連結。",
    { taskId: z.string().describe("任務 id") },
    async ({ taskId }) => {
      const task = await tasksService.getTask(ctx, taskId);
      const project = await getReadableProject(ctx, task.projectId);
      const rt = reports.toReportTask(task);
      const dir = await makeDirectory([rt.assignee, ...rt.subtasks.map((s) => s.assignee)]);
      const logs = (l: reports.ReportTimeLog[]) => l.map((x) => ({ date: isoDay(x.date), hours: x.hours ?? 0 }));
      const sumHours = (l: reports.ReportTimeLog[]) => Math.round(l.reduce((s, x) => s + (x.hours ?? 0), 0) * 10) / 10;
      return {
        data: {
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
        },
        count: 1,
      };
    });

  // 5. list_overdue_tasks
  register("list_overdue_tasks", "逾期任務",
    "列出逾期的主任務（有效結束日早於今天且完成度未達 100%，判斷方式與看板上的「已逾期」標籤相同），依逾期天數由多到少排序。未指定 projectId 時涵蓋所有可見專案。",
    {
      projectId: z.string().optional().describe("專案 id；不填則查詢所有可見專案"),
      assigneeId: z.string().optional().describe("負責人的員工編號（memberId）"),
      ...pageShape,
    },
    async ({ projectId, assigneeId, limit, cursor }) => {
      const { today, tasks } = await reports.listOverdueTasks(ctx, { projectId });
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
    });

  // 6. list_risks
  register("list_risks", "風險清單",
    "列出專案的 5×5 風險矩陣項目，含機率、衝擊（1～5 分）與風險分數（機率 × 衝擊，1～25；≥ 16 為高風險）。依分數由高到低排序。",
    {
      projectId: z.string().describe("專案 id"),
      minScore: z.number().int().min(1).max(25).optional().describe("只列出分數大於等於此值的風險"),
      ...pageShape,
    },
    async ({ projectId, minScore, limit, cursor }) => {
      const project = await getReadableProject(ctx, projectId);
      const risks = (await risksService.listRisks(ctx, projectId))
        .map((r) => ({ r, score: risksService.riskScore(r) }))
        .filter((x) => minScore === undefined || x.score >= minScore)
        .sort((a, b) => b.score - a.score);
      const page = paginate(risks, limit, cursor);
      const dir = await makeDirectory(page.items.map((x) => x.r.ownerId));
      const level = (id: string) => ({
        id, label: RISK_LEVEL_LABELS[id] ?? id,
        value: risksService.RISK_LEVEL_VALUES[id as keyof typeof risksService.RISK_LEVEL_VALUES] ?? 0,
      });
      return {
        data: {
          project, ...page,
          items: page.items.map(({ r, score }) => ({
            id: r.id, title: r.title, description: r.description,
            probability: level(r.probability), impact: level(r.impact), score,
            status: { id: r.status, label: RISK_STATUS_LABELS[r.status] ?? r.status },
            owner: dir.member(r.ownerId), ownerGroup: dir.group(r.ownerGroupId),
            countermeasure: r.countermeasure, createdDate: isoDay(r.createdDate),
          })),
        },
        count: page.items.length,
      };
    });

  // 會議出席者以 memberId 或使用者 id 儲存（與前端 MeetingsView 相同）
  const attendeeResolver = async (ids: string[]) => {
    const unique = [...new Set(ids.filter(Boolean))];
    const users = unique.length === 0 ? [] : await prisma.user.findMany({
      where: { OR: [{ memberId: { in: unique } }, { id: { in: unique } }] },
      select: { id: true, memberId: true, name: true },
    });
    return (id: string) => {
      const u = users.find((x) => x.memberId === id || x.id === id);
      return { id: u?.memberId ?? id, name: u?.name ?? id };
    };
  };

  // 7. list_meetings
  register("list_meetings", "會議紀錄列表",
    "列出會議紀錄（依日期新到舊），每筆附會議系列、出席者與摘要開頭。完整內容請用 get_meeting。未指定 projectId 時涵蓋所有可見專案。",
    {
      projectId: z.string().optional().describe("專案 id；不填則查詢所有可見專案"),
      from: dateParam("會議日期下限（含），YYYY-MM-DD"),
      to: dateParam("會議日期上限（含），YYYY-MM-DD"),
      ...pageShape,
    },
    async ({ projectId, from, to, limit, cursor }) => {
      const rows = [];
      for (const p of await projectsInScope(ctx, projectId)) {
        for (const s of await meetingsService.listMeetings(ctx, p.id)) {
          for (const r of s.records) {
            const date = isoDay(r.date);
            if ((from || to) && (!date || (from && date < from) || (to && date > to))) continue;
            rows.push({ p, s, r, date });
          }
        }
      }
      rows.sort((a, b) => (b.date ?? "").localeCompare(a.date ?? ""));
      const page = paginate(rows, limit, cursor);
      const attendee = await attendeeResolver(page.items.flatMap((x) => x.r.attendees as string[]));
      return {
        data: {
          ...page,
          items: page.items.map(({ p, s, r, date }) => ({
            id: r.id, date, project: p, series: { id: s.id, name: s.name, type: s.type },
            attendees: (r.attendees as string[]).map(attendee),
            summaryPreview: r.summary.length > 200 ? `${r.summary.slice(0, 200)}…` : r.summary,
            hasExternalLink: !!r.externalLink,
          })),
        },
        count: page.items.length,
      };
    });

  // 8. get_meeting
  register("get_meeting", "會議紀錄內容",
    "取得單一會議紀錄的完整內容（會議摘要與決議事項）、出席者與外部紀錄連結。",
    { meetingId: z.string().describe("會議紀錄 id（list_meetings 回傳的 id）") },
    async ({ meetingId }) => {
      const r = await meetingsService.getMeetingRecord(ctx, meetingId);
      const project = await getReadableProject(ctx, r.series.projectId);
      const attendee = await attendeeResolver(r.attendees as string[]);
      return {
        data: {
          id: r.id, date: isoDay(r.date), project,
          series: { id: r.series.id, name: r.series.name, type: r.series.type },
          attendees: (r.attendees as string[]).map(attendee),
          summary: r.summary,
          externalLink: isHttpUrl(r.externalLink) ? r.externalLink : null,
        },
        count: 1,
      };
    });

  // 9. get_weekly_report_data
  register("get_weekly_report_data", "週報資料",
    "取得指定週次的週報資料（與網頁週報相同的彙整邏輯）：本週完成、進行中、個人工時、活躍風險、下週預計與週報備註。週一至週日為一週，weekStart 可填該週任一天。日期同時提供 ISO 與民國年（ROC）格式。",
    {
      projectId: z.string().describe("專案 id"),
      weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必須是 YYYY-MM-DD").describe("該週任一天，YYYY-MM-DD"),
    },
    async ({ projectId, weekStart }) => {
      const project = await getReadableProject(ctx, projectId);
      const r = await reports.getWeeklyReportData(ctx, projectId, weekStart);
      const { projectId: _pid, ...rest } = r;
      return {
        data: {
          project, ...rest,
          weekStartROC: toROC(r.weekStart), weekEndROC: toROC(r.weekEnd),
        },
        count: 1,
      };
    });

  // 10. list_okrs
  register("list_okrs", "OKR",
    "列出 OKR 目標與關鍵結果（KR）進度。KR 進度 = 目前值 ÷ 目標值（上限 100%），目標進度為各 KR 進度的平均（與網頁相同）。from / to 篩選與目標期間（startDate～endDate）有重疊的目標。未指定 projectId 時涵蓋所有可見專案。",
    {
      projectId: z.string().optional().describe("專案 id；不填則查詢所有可見專案"),
      from: dateParam("期間下限，YYYY-MM-DD"),
      to: dateParam("期間上限，YYYY-MM-DD"),
      ...pageShape,
    },
    async ({ projectId, from, to, limit, cursor }) => {
      const rows = [];
      for (const p of await projectsInScope(ctx, projectId)) {
        for (const o of await okrsService.listOkrs(ctx, p.id)) {
          const start = isoDay(o.startDate);
          const end = isoDay(o.endDate);
          if (from && end && end < from) continue;
          if (to && start && start > to) continue;
          rows.push({ p, o, start, end });
        }
      }
      const page = paginate(rows, limit, cursor);
      const krProgress = (kr: { targetValue: number; currentValue: number }) =>
        kr.targetValue > 0 ? Math.min((kr.currentValue / kr.targetValue) * 100, 100) : 0;
      return {
        data: {
          ...page,
          items: page.items.map(({ p, o, start, end }) => ({
            id: o.id, title: o.title, description: o.description, project: p, startDate: start, endDate: end,
            progress: o.keyResults.length ? Math.round(o.keyResults.reduce((s, kr) => s + krProgress(kr), 0) / o.keyResults.length) : 0,
            keyResults: o.keyResults.map((kr) => ({
              id: kr.id, title: kr.title, currentValue: kr.currentValue, targetValue: kr.targetValue, unit: kr.unit,
              progress: Math.round(krProgress(kr)),
            })),
          })),
        },
        count: page.items.length,
      };
    });

  // 11. search
  register("search", "全文搜尋",
    "全文搜尋任務、子任務、風險與會議紀錄（比對邏輯與網頁 Ctrl+K 相同：不分大小寫的部分比對，每個專案每類最多 20 筆）。未指定 projectId 時搜尋所有可見專案。",
    {
      query: z.string().min(1).max(200).describe("搜尋關鍵字"),
      types: z.array(z.enum(["tasks", "subtasks", "risks", "meetings"])).optional().describe("只搜尋指定類型；不填則全部"),
      projectId: z.string().optional().describe("專案 id；不填則搜尋所有可見專案"),
      ...pageShape,
    },
    async ({ query, types, projectId, limit, cursor }) => {
      const want = (t: string) => !types || types.includes(t as never);
      const rows: Record<string, unknown>[] = [];
      for (const p of await projectsInScope(ctx, projectId)) {
        const r = await searchProject(ctx, p.id, query);
        if (want("tasks")) for (const t of r.tasks) rows.push({ type: "task", id: t.id, title: t.title, project: p, status: COLUMN_LABELS[t.columnId] ?? t.columnId });
        if (want("subtasks")) for (const s of r.subtasks) rows.push({ type: "subtask", id: s.id, title: s.title, project: p, parentTask: { id: s.task.id, name: s.task.title } });
        if (want("risks")) for (const x of r.risks) rows.push({ type: "risk", id: x.id, title: x.title, project: p, score: risksService.riskScore(x) });
        if (want("meetings")) for (const m of r.meetings) {
          rows.push({ type: "meeting", id: m.id, title: `${m.series.name} ${m.date}`, date: isoDay(m.date), project: p, series: { id: m.series.id, name: m.series.name } });
        }
      }
      const page = paginate(rows, limit, cursor);
      return { data: page, count: page.items.length };
    });

  // 12. get_activity_log
  register("get_activity_log", "活動紀錄",
    "列出活動紀錄（誰在什麼時候對什麼做了哪些操作），依時間新到舊。未指定 projectId 時涵蓋所有可見專案。from / to 為台灣時區日期（含頭尾），userId 為操作者的使用者 id。",
    {
      projectId: z.string().optional().describe("專案 id；不填則查詢所有可見專案"),
      from: dateParam("日期下限（含），YYYY-MM-DD"),
      to: dateParam("日期上限（含），YYYY-MM-DD"),
      userId: z.string().optional().describe("操作者的使用者 id"),
      ...pageShape,
    },
    async ({ projectId, from, to, userId, limit, cursor }) => {
      const rows = [];
      for (const p of await projectsInScope(ctx, projectId)) {
        for (const a of await listActivities(ctx, p.id, { from, to, userId, take: 1000 })) rows.push({ p, a });
      }
      rows.sort((x, y) => y.a.createdAt.getTime() - x.a.createdAt.getTime());
      const page = paginate(rows, limit, cursor);
      return {
        data: {
          ...page,
          items: page.items.map(({ p, a }) => ({
            id: a.id, date: isoDay(a.createdAt), time: a.createdAt.toISOString(), project: p,
            user: { id: a.user.id, name: a.user.name }, action: a.action, target: a.target, detail: a.detail,
          })),
        },
        count: page.items.length,
      };
    });

  return server;
}
