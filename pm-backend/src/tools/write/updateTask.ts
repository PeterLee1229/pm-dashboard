import { z } from "zod";
import { ConflictError } from "../../errors";
import { updateTask } from "../../services/tasks";
import { defineTool, serviceCtx } from "../types";
import { formatTaskDetail } from "../read/tasks";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必須是 YYYY-MM-DD");

/** 修改前後比對的欄位 */
const DIFF_FIELDS = ["title", "description", "status", "priority", "completion", "startDate", "endDate", "assignee", "group"] as const;

export const updateTaskTool = defineTool({
  name: "update_task",
  title: "更新任務",
  description: [
    "更新單一主任務的欄位（名稱、描述、狀態、完成度、日期、負責人、組別、優先級），回傳修改前後的差異。",
    "【使用流程】先用 get_task 讀取目前狀態，把回傳的 updatedAt 帶入 expectedUpdatedAt；若任務在這之間被他人修改，會拒絕寫入並回傳最新內容，請以最新內容與使用者重新確認。",
    "只需填入要修改的欄位。status 為看板欄位：todo、inprogress、review、done。assigneeId 為員工編號（memberId），填 null 代表取消指派；groupId 填 null 代表未分組。",
    "已封存的專案為唯讀，無法寫入（需先在網頁解除封存）。權限與網頁相同：Member 只能編輯自己負責的任務且不能改派；組長受組別規則限制；只有 PM 以上可以將任務移入或移出「已完成」。",
  ].join("\n"),
  inputSchema: z.object({
    taskId: z.string().describe("任務 id"),
    expectedUpdatedAt: z.string().optional().describe("樂觀鎖：get_task 回傳的 updatedAt"),
    changes: z.object({
      title: z.string().min(1).max(500).optional(),
      description: z.string().max(20000).optional(),
      status: z.enum(["todo", "inprogress", "review", "done"]).optional(),
      completion: z.number().int().min(0).max(100).optional().describe("完成度 0～100"),
      startDate: day.optional(),
      endDate: day.optional(),
      assigneeId: z.string().nullable().optional().describe("負責人的員工編號；null 代表取消指派"),
      groupId: z.string().nullable().optional().describe("組別 id；null 代表未分組"),
      priority: z.enum(["low", "medium", "high"]).optional(),
    }).refine((c) => Object.values(c).some((v) => v !== undefined), "changes 至少需要一個欄位"),
  }),
  scope: "pm:write",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: true, openWorldHint: false },
  handler: async (tc, { taskId, expectedUpdatedAt, changes }) => {
    const before = await formatTaskDetail(tc, taskId);
    // 欄位驗證與商業規則一律交給 tasks.updateTask（與 PUT /api/tasks/:id 相同）
    const input: Record<string, unknown> = {
      title: changes.title, description: changes.description, columnId: changes.status,
      completion: changes.completion, startDate: changes.startDate, endDate: changes.endDate, priority: changes.priority,
      assignee: changes.assigneeId === undefined ? undefined : (changes.assigneeId ?? ""),
      groupId: changes.groupId === undefined ? undefined : (changes.groupId ?? ""),
    };
    for (const k of Object.keys(input)) if (input[k] === undefined) delete input[k];
    try {
      await updateTask(serviceCtx(tc), taskId, input, { expectedUpdatedAt });
    } catch (err) {
      if (err instanceof ConflictError) throw new ConflictError(err.message, { latest: await formatTaskDetail(tc, taskId) });
      throw err;
    }
    const after = await formatTaskDetail(tc, taskId);
    const diff = DIFF_FIELDS
      .filter((f) => JSON.stringify(before[f]) !== JSON.stringify(after[f]))
      .map((f) => ({ field: f, before: before[f], after: after[f] }));
    const summarize = (v: unknown) => {
      const s = typeof v === "string" ? v : JSON.stringify(v);
      return s && s.length > 80 ? `${s.slice(0, 80)}…` : s;
    };
    return {
      data: { task: after, diff },
      count: 1,
      audit: { affected: 1, diff: diff.map((d) => ({ field: d.field, before: summarize(d.before), after: summarize(d.after) })) },
    };
  },
});
