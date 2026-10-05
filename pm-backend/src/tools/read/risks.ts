import { z } from "zod";
import { getReadableProject } from "../../services/projects";
import * as risksService from "../../services/risks";
import { READ_ANNOTATIONS, defineTool, serviceCtx } from "../types";
import { RISK_LEVEL_LABELS, RISK_STATUS_LABELS, isoDay, makeDirectory, pageShape, paginate } from "../format";

export const listRisksTool = defineTool({
  name: "list_risks",
  title: "風險清單",
  description: "列出專案的 5×5 風險矩陣項目，含機率、衝擊（1～5 分）與風險分數（機率 × 衝擊，1～25；≥ 16 為高風險）。依分數由高到低排序。",
  inputSchema: z.object({
    projectId: z.string().describe("專案 id"),
    minScore: z.number().int().min(1).max(25).optional().describe("只列出分數大於等於此值的風險"),
    ...pageShape,
  }),
  scope: "pm:read",
  annotations: READ_ANNOTATIONS,
  handler: async (tc, { projectId, minScore, limit, cursor }) => {
    const ctx = serviceCtx(tc);
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
  },
});
