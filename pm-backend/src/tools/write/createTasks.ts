import { z } from "zod";
import { MAX_BATCH_TASKS, createTasksBatch } from "../../services/taskBatch";
import { defineTool, serviceCtx } from "../types";

const day = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "日期格式必須是 YYYY-MM-DD");

export const createTasksTool = defineTool({
  name: "create_tasks",
  title: "批次建立任務",
  description: [
    `在專案中批次建立任務（一次 1～${MAX_BATCH_TASKS} 筆），可同時建立主任務與子任務。`,
    "【使用流程】一定要先以 dryRun=true 預覽，把預覽結果（特別是 errors 與 possibleDuplicates 疑似重複）完整呈現給使用者確認；使用者同意後，再以 dryRun=false 並帶入相同的 batchKey 與相同的 tasks 正式寫入。",
    "dryRun=true（預設）：不寫入，回傳每一筆的驗證結果、解析後的負責人／組別／父任務名稱、與既有任務的疑似重複，以及摘要。",
    "dryRun=false：單一交易，全部成功或全部不寫入；只要有一筆錯誤（欄位或權限）整批拒絕並列出每筆錯誤。疑似重複不會擋下寫入。",
    "batchKey：冪等鍵（例如 UUID），24 小時內以相同 batchKey 重送會直接回傳第一次的結果，不會重複建立。",
    "子任務：parentTaskId 掛在既有任務底下，或 parentRef 填同批次另一筆主任務的 clientRef；子任務只有一層，沒有狀態與優先級。",
    "assigneeId 為員工編號（memberId，可由 list_tasks / get_task 回傳的 assignee.id 取得），必須是專案成員；groupId 為組別 id。已封存的專案為唯讀，無法寫入（需先在網頁解除封存）。權限與網頁相同：只有 Owner、PM、組長可以建立；組長只能指派給自己組的成員、設為自己的組。",
  ].join("\n"),
  inputSchema: z.object({
    projectId: z.string().describe("專案 id"),
    dryRun: z.boolean().default(true).describe("true（預設）只預覽不寫入；false 正式寫入"),
    batchKey: z.string().min(8).max(100).optional().describe("冪等鍵，正式寫入時建議帶入（與預覽時相同）"),
    tasks: z.array(z.object({
      clientRef: z.string().min(1).max(50).describe("批次內的暫時代號，例如 t1"),
      title: z.string().min(1).max(500).describe("任務名稱"),
      parentTaskId: z.string().optional().describe("掛在既有任務底下（成為子任務）"),
      parentRef: z.string().optional().describe("掛在同批次另一筆主任務底下，填對方的 clientRef"),
      description: z.string().max(20000).optional().describe("描述"),
      assigneeId: z.string().optional().describe("負責人的員工編號（memberId）"),
      groupId: z.string().optional().describe("組別 id"),
      startDate: day.optional().describe("開始日期 YYYY-MM-DD"),
      endDate: day.optional().describe("結束日期 YYYY-MM-DD"),
      priority: z.enum(["low", "medium", "high"]).optional().describe("優先級（僅主任務），預設 medium"),
      status: z.enum(["todo", "inprogress", "review", "done"]).optional().describe("看板欄位（僅主任務），預設 todo"),
    })).min(1).max(MAX_BATCH_TASKS),
  }),
  scope: "pm:write",
  annotations: { readOnlyHint: false, destructiveHint: false, idempotentHint: false, openWorldHint: false },
  handler: async (tc, { projectId, dryRun, batchKey, tasks }) => {
    const result = await createTasksBatch(serviceCtx(tc), projectId, { tasks }, { dryRun, batchKey });
    const affected = dryRun ? 0 : ((result as { created?: number }).created ?? 0);
    return {
      data: result,
      count: affected,
      audit: { dryRun, affected, ...(dryRun ? { previewCount: tasks.length } : {}), ...("replayed" in result ? { replayed: true } : {}) },
    };
  },
});
