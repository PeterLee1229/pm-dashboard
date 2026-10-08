// 週報、OKR、搜尋、活動紀錄
import { z } from "zod";
import { getReadableProject } from "../../services/projects";
import * as okrsService from "../../services/okrs";
import * as risksService from "../../services/risks";
import * as reports from "../../services/reports";
import { searchProject } from "../../services/search";
import { listActivities } from "../../services/activity";
import { READ_ANNOTATIONS, defineTool, serviceCtx } from "../types";
import { COLUMN_LABELS, dateParam, isoDay, pageShape, paginate, projectsInScope, toROC } from "../format";

export const getWeeklyReportDataTool = defineTool({
  name: "get_weekly_report_data",
  title: "週報資料",
  description: "取得指定週次的週報資料（與網頁週報相同的彙整邏輯）：本週完成、進行中、個人工時、活躍風險、下週預計與週報備註。週一至週日為一週，weekStart 可填該週任一天。日期同時提供 ISO 與民國年（ROC）格式。",
  inputSchema: z.object({
    projectId: z.string().describe("專案 id"),
    weekStart: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必須是 YYYY-MM-DD").describe("該週任一天，YYYY-MM-DD"),
  }),
  scope: "pm:read",
  annotations: READ_ANNOTATIONS,
  handler: async (tc, { projectId, weekStart }) => {
    const ctx = serviceCtx(tc);
    const project = await getReadableProject(ctx, projectId);
    const r = await reports.getWeeklyReportData(ctx, projectId, weekStart);
    const { projectId: _pid, ...rest } = r;
    return {
      data: { project, ...rest, weekStartROC: toROC(r.weekStart), weekEndROC: toROC(r.weekEnd) },
      count: 1,
    };
  },
});

export const listOkrsTool = defineTool({
  name: "list_okrs",
  title: "OKR",
  description: "列出 OKR 目標與關鍵結果（KR）進度。KR 進度 = 目前值 ÷ 目標值（上限 100%），目標進度為各 KR 進度的平均（與網頁相同）。from / to 篩選與目標期間（startDate～endDate）有重疊的目標。未指定 projectId 時涵蓋所有可見專案。",
  inputSchema: z.object({
    projectId: z.string().optional().describe("專案 id；不填則查詢所有可見且未封存的專案（指定已封存專案的 id 仍可查詢）"),
    from: dateParam("期間下限，YYYY-MM-DD"),
    to: dateParam("期間上限，YYYY-MM-DD"),
    ...pageShape,
  }),
  scope: "pm:read",
  annotations: READ_ANNOTATIONS,
  handler: async (tc, { projectId, from, to, limit, cursor }) => {
    const ctx = serviceCtx(tc);
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
  },
});

export const searchTool = defineTool({
  name: "search",
  title: "全文搜尋",
  description: "全文搜尋任務、子任務、風險與會議紀錄（比對邏輯與網頁 Ctrl+K 相同：不分大小寫的部分比對，每個專案每類最多 20 筆）。未指定 projectId 時搜尋所有可見專案。",
  inputSchema: z.object({
    query: z.string().min(1).max(200).describe("搜尋關鍵字"),
    types: z.array(z.enum(["tasks", "subtasks", "risks", "meetings"])).optional().describe("只搜尋指定類型；不填則全部"),
    projectId: z.string().optional().describe("專案 id；不填則搜尋所有可見且未封存的專案（指定已封存專案的 id 仍可搜尋）"),
    ...pageShape,
  }),
  scope: "pm:read",
  annotations: READ_ANNOTATIONS,
  handler: async (tc, { query, types, projectId, limit, cursor }) => {
    const ctx = serviceCtx(tc);
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
  },
});

export const getActivityLogTool = defineTool({
  name: "get_activity_log",
  title: "活動紀錄",
  description: "列出活動紀錄（誰在什麼時候對什麼做了哪些操作），依時間新到舊。未指定 projectId 時涵蓋所有可見專案。from / to 為台灣時區日期（含頭尾），userId 為操作者的使用者 id。source 為 web（網頁）或 mcp（經由 AI 工具）。",
  inputSchema: z.object({
    projectId: z.string().optional().describe("專案 id；不填則查詢所有可見且未封存的專案（指定已封存專案的 id 仍可查詢）"),
    from: dateParam("日期下限（含），YYYY-MM-DD"),
    to: dateParam("日期上限（含），YYYY-MM-DD"),
    userId: z.string().optional().describe("操作者的使用者 id"),
    ...pageShape,
  }),
  scope: "pm:read",
  annotations: READ_ANNOTATIONS,
  handler: async (tc, { projectId, from, to, userId, limit, cursor }) => {
    const ctx = serviceCtx(tc);
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
          // Phase 2 新增：操作來源（web / mcp / assistant）
          source: a.source, ...(a.clientName ? { clientName: a.clientName } : {}),
        })),
      },
      count: page.items.length,
    };
  },
});
