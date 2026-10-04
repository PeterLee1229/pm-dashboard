// 掃描附件與會議外部連結中不符合規則（非 http/https）的資料。只讀，不修改任何資料。
//
// 用法（PowerShell，使用 Railway Postgres 的 DATABASE_PUBLIC_URL）：
//   $env:SCAN_DATABASE_URL = "<DATABASE_PUBLIC_URL>"; npx tsx scripts/scan-links.ts
//
// 規則與後端 services/tasks.ts、services/meetings.ts 相同：只接受 http:// 或 https://；會議連結允許空白。
import pg from "pg";

const url = process.env.SCAN_DATABASE_URL;
if (!url) {
  console.error("請設定 SCAN_DATABASE_URL");
  process.exit(1);
}

function isHttpUrl(v: string): boolean {
  try {
    const u = new URL(v.trim());
    return u.protocol === "https:" || u.protocol === "http:";
  } catch {
    return false;
  }
}

async function main() {
  const client = new pg.Client({ connectionString: url });
  await client.connect();
  try {
    await client.query("BEGIN TRANSACTION READ ONLY");

    const attachments = (await client.query(`
      SELECT a.id, a.name, a.url, t.title AS task, p.name AS project
      FROM "Attachment" a
      JOIN "Task" t ON t.id = a."taskId"
      JOIN "Project" p ON p.id = t."projectId"
    `)).rows.filter((r) => !isHttpUrl(r.url));

    const meetings = (await client.query(`
      SELECT r.id, r.date, r."externalLink" AS url, s.name AS series, p.name AS project
      FROM "MeetingRecord" r
      JOIN "MeetingSeries" s ON s.id = r."seriesId"
      JOIN "Project" p ON p.id = s."projectId"
      WHERE r."externalLink" <> ''
    `)).rows.filter((r) => !isHttpUrl(r.url));

    await client.query("ROLLBACK");

    console.log(`附件連結不符合規則：${attachments.length} 筆`);
    for (const r of attachments) console.log(`  [${r.project}] 任務「${r.task}」附件「${r.name}」(${r.id})：${JSON.stringify(r.url)}`);
    console.log(`會議外部連結不符合規則：${meetings.length} 筆`);
    for (const r of meetings) console.log(`  [${r.project}] ${r.series} ${r.date} (${r.id})：${JSON.stringify(r.url)}`);
  } finally {
    await client.end();
  }
}

main().catch((err) => {
  console.error("掃描失敗：", err.message);
  process.exit(1);
});
