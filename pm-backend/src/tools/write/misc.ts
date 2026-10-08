// add_comment、create_meeting_record、create_risk
import { z } from "zod";
import { BadRequestError } from "../../errors";
import { createComment } from "../../services/tasks";
import { createRecord, createSeries } from "../../services/meetings";
import { createRisk } from "../../services/risks";
import { getReadableProject } from "../../services/projects";
import { makeUserResolver } from "../../services/users";
import { defineTool, serviceCtx } from "../types";
import { isoDay } from "../format";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必須是 YYYY-MM-DD");
const WRITE_ANNOTATIONS = { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false } as const;

export const addCommentTool = defineTool({
  name: "add_comment",
  title: "新增留言",
  description: "在任務上新增一則留言（以你的身分發表，任務負責人會收到通知）。已封存的專案為唯讀，無法寫入（需先在網頁解除封存）。權限與網頁相同：Owner、PM、組長、Member 可以留言，Viewer 不行。",
  inputSchema: z.object({
    taskId: z.string().describe("任務 id"),
    content: z.string().trim().min(1).max(2000).describe("留言內容（1～2000 字）"),
  }),
  scope: "pm:write",
  annotations: WRITE_ANNOTATIONS,
  handler: async (tc, { taskId, content }) => {
    const c = await createComment(serviceCtx(tc), taskId, { content });
    return {
      data: { id: c.id, taskId, author: { id: c.user.id, name: c.user.name }, date: isoDay(c.createdAt), content: c.content },
      count: 1,
      audit: { affected: 1 },
    };
  },
});

export const createMeetingRecordTool = defineTool({
  name: "create_meeting_record",
  title: "新增會議紀錄",
  description: [
    "新增一筆會議紀錄。兩種用法擇一：",
    "1. 在既有的會議系列底下新增紀錄：填 seriesId（list_meetings 回傳的 series.id）。",
    "2. 在專案底下新建一個會議系列並附上第一筆紀錄：填 projectId 與 seriesName（可選 seriesType：regular 定期會議、adhoc 臨時會議）。",
    "紀錄內容：date（YYYY-MM-DD）、attendees（與會者的員工編號 memberId）、summary（會議摘要與決議事項）、externalLink（完整紀錄的 http/https 連結）。",
    "會議紀錄沒有獨立的決議事項或待辦欄位：決議請寫在 summary；需要追蹤的後續待辦，請另外用 create_tasks 建立任務。",
    "已封存的專案為唯讀，無法寫入（需先在網頁解除封存）。權限與網頁相同：只有 Owner、PM、組長可以管理會議。",
  ].join("\n"),
  inputSchema: z.object({
    seriesId: z.string().optional().describe("既有會議系列 id"),
    projectId: z.string().optional().describe("新建會議系列時的專案 id"),
    seriesName: z.string().trim().min(1).max(200).optional().describe("新建會議系列的名稱"),
    seriesType: z.enum(["regular", "adhoc"]).optional().describe("regular 定期會議（預設）、adhoc 臨時會議"),
    date: day.describe("會議日期 YYYY-MM-DD"),
    attendees: z.array(z.string()).max(200).optional().describe("與會者的員工編號（memberId）"),
    summary: z.string().max(100000).optional().describe("會議摘要與決議事項"),
    externalLink: z.string().max(2000).optional().describe("完整紀錄的 http/https 連結"),
  }),
  scope: "pm:write",
  annotations: WRITE_ANNOTATIONS,
  handler: async (tc, input) => {
    const ctx = serviceCtx(tc);
    const newSeries = !!(input.projectId || input.seriesName);
    if (input.seriesId && newSeries) throw new BadRequestError("seriesId 與 projectId／seriesName 只能擇一");
    if (!input.seriesId && !(input.projectId && input.seriesName)) {
      throw new BadRequestError("請填 seriesId（既有會議），或同時填 projectId 與 seriesName（新建會議）");
    }

    const attendees = input.attendees ?? [];
    const resolve = await makeUserResolver(attendees);
    const unknown = attendees.filter((id) => resolve(id).name === id);
    if (unknown.length > 0) throw new BadRequestError(`找不到與會者：${unknown.join("、")}（請填員工編號）`);

    // 新建會議時先建系列（同時完成權限檢查），再建紀錄
    const series = input.seriesId ? { id: input.seriesId, created: false } : {
      id: (await createSeries(ctx, input.projectId!, { name: input.seriesName, type: input.seriesType })).id,
      created: true,
    };
    const record = await createRecord(ctx, series.id, {
      date: input.date, attendees: attendees.map((id) => resolve(id).id), summary: input.summary, externalLink: input.externalLink,
    });
    return {
      data: {
        id: record.id, date: record.date, seriesId: series.id, seriesCreated: series.created,
        attendees: (record.attendees as string[]).map(resolve), summary: record.summary, externalLink: record.externalLink || null,
      },
      count: 1,
      audit: { affected: series.created ? 2 : 1, seriesCreated: series.created },
    };
  },
});

/** 1～5 分 → 風險矩陣等級（與前端 RISK_LEVELS 相同） */
const LEVEL_BY_SCORE = { 5: "high", 4: "mid-high", 3: "medium", 2: "mid-low", 1: "low" } as const;

export const createRiskTool = defineTool({
  name: "create_risk",
  title: "新增風險",
  description: "在專案的 5×5 風險矩陣新增一個風險項目。probability（發生機率）與 impact（衝擊程度）為 1～5 分（5 最高），風險分數 = 機率 × 衝擊。ownerId 為負責人的員工編號（memberId）；組長只能指定自己組的成員。已封存的專案為唯讀，無法寫入（需先在網頁解除封存）。權限與網頁相同：Owner、PM、組長、Member 都可以新增風險。",
  inputSchema: z.object({
    projectId: z.string().describe("專案 id"),
    title: z.string().trim().min(1).max(500).describe("風險名稱"),
    description: z.string().max(20000).optional().describe("風險描述"),
    probability: z.number().int().min(1).max(5).describe("發生機率 1～5"),
    impact: z.number().int().min(1).max(5).describe("衝擊程度 1～5"),
    ownerId: z.string().optional().describe("負責人的員工編號（memberId）"),
    mitigation: z.string().max(20000).optional().describe("因應對策"),
  }),
  scope: "pm:write",
  annotations: WRITE_ANNOTATIONS,
  handler: async (tc, input) => {
    const ctx = serviceCtx(tc);
    const project = await getReadableProject(ctx, input.projectId);
    const r = await createRisk(ctx, input.projectId, {
      title: input.title, description: input.description,
      probability: LEVEL_BY_SCORE[input.probability as 1 | 2 | 3 | 4 | 5],
      impact: LEVEL_BY_SCORE[input.impact as 1 | 2 | 3 | 4 | 5],
      ownerId: input.ownerId, countermeasure: input.mitigation,
    });
    const owner = r.ownerId ? (await makeUserResolver([r.ownerId]))(r.ownerId) : null;
    return {
      data: {
        id: r.id, project, title: r.title, probability: input.probability, impact: input.impact,
        score: input.probability * input.impact, owner, status: r.status, createdDate: r.createdDate,
      },
      count: 1,
      audit: { affected: 1 },
    };
  },
});
