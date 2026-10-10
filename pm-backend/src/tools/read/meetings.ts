import { z } from "zod";
import { getReadableProject } from "../../services/projects";
import * as meetingsService from "../../services/meetings";
import { makeUserResolver } from "../../services/users";
import { READ_ANNOTATIONS, defineTool, serviceCtx } from "../types";
import { dateParam, isHttpUrl, isoDay, pageShape, paginate, projectsInScope } from "../format";

export const listMeetingsTool = defineTool({
  name: "list_meetings",
  title: "會議紀錄列表",
  description: "列出會議紀錄（依日期新到舊），每筆附會議系列、出席者與摘要開頭。完整內容請用 get_meeting。未指定 projectId 時涵蓋所有可見專案。",
  inputSchema: z.object({
    projectId: z.string().optional().describe("專案 id；不填則查詢所有可見且未封存的專案（指定已封存專案的 id 仍可查詢）"),
    from: dateParam("會議日期下限（含），YYYY-MM-DD"),
    to: dateParam("會議日期上限（含），YYYY-MM-DD"),
    ...pageShape,
  }),
  scope: "pm:read",
  annotations: READ_ANNOTATIONS,
  handler: async (tc, { projectId, from, to, limit, cursor }) => {
    const ctx = serviceCtx(tc);
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
    const attendee = await makeUserResolver(page.items.flatMap((x) => x.r.attendees as string[]));
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
  },
});

export const getMeetingTool = defineTool({
  name: "get_meeting",
  title: "會議紀錄內容",
  description: "取得單一會議紀錄的完整內容（會議摘要與決議事項）、出席者與外部紀錄連結。",
  inputSchema: z.object({ meetingId: z.string().describe("會議紀錄 id（list_meetings 回傳的 id）") }),
  scope: "pm:read",
  annotations: READ_ANNOTATIONS,
  handler: async (tc, { meetingId }) => {
    const ctx = serviceCtx(tc);
    const r = await meetingsService.getMeetingRecord(ctx, meetingId);
    const project = await getReadableProject(ctx, r.series.projectId);
    const attendee = await makeUserResolver(r.attendees as string[]);
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
  },
});
