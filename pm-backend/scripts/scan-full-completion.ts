// 列出實際完成度已達 100%、但仍在「待處理」或「進行中」的主任務。只讀，不修改任何資料。
// 「完成度 100% 自動移到審查中」只在完成度變化時觸發，不回溯既有資料；這份清單交給 PM 自行判斷是否手動移動。
//
// 用法（PowerShell，使用 Railway Postgres 的 DATABASE_PUBLIC_URL）：
//   $env:SCAN_DATABASE_URL = "<DATABASE_PUBLIC_URL>"; npx tsx scripts/scan-full-completion.ts
//
// 實際完成度與 services/reports.ts getCompletion 相同：沒有子任務看自己，有子任務看子任務完成度平均（四捨五入）。
import pg from "pg";

const url = process.env.SCAN_DATABASE_URL;
if (!url) {
  console.error("請設定 SCAN_DATABASE_URL");
  process.exit(1);
}

const COLUMN_NAMES: Record<string, string> = { todo: "待處理", inprogress: "進行中" };

async function main() {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");
    const rows = (await client.query(`
      SELECT t.id, t.title, t."columnId", t.completion, p.name AS project, p."archivedAt",
             COUNT(s.id)::int AS "subCount", ROUND(AVG(s.completion))::int AS "subAvg"
      FROM "Task" t
      JOIN "Project" p ON p.id = t."projectId"
      LEFT JOIN "SubTask" s ON s."taskId" = t.id
      WHERE t."columnId" IN ('todo', 'inprogress')
      GROUP BY t.id, p.id
      ORDER BY p.name, t.title
    `)).rows.filter((r) => (r.subCount > 0 ? r.subAvg : r.completion) >= 100);
    await client.query("ROLLBACK");

    console.log(`完成度 100% 但仍在待處理／進行中的任務：${rows.length} 筆`);
    for (const r of rows) {
      const how = r.subCount > 0 ? `子任務 ${r.subCount} 個平均 ${r.subAvg}%` : `${r.completion}%`;
      console.log(`  [${r.project}${r.archivedAt ? "（已封存）" : ""}] 「${r.title}」 狀態：${COLUMN_NAMES[r.columnId]}，${how} (${r.id})`);
    }
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("掃描失敗：", err.message);
  process.exit(1);
});
