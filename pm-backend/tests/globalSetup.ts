import { execSync } from "node:child_process";
import path from "node:path";
import pg from "pg";
import { resolveTestDatabaseUrl } from "./testDb";

/** 建立測試資料庫（若不存在）並套用所有 migration */
export default async function setup() {
  const testUrl = resolveTestDatabaseUrl();
  const dbName = new URL(testUrl).pathname.replace(/^\//, "");
  const adminUrl = new URL(testUrl);
  adminUrl.pathname = "/postgres";

  const client = new pg.Client({ connectionString: adminUrl.toString() });
  await client.connect();
  const exists = await client.query("SELECT 1 FROM pg_database WHERE datname = $1", [dbName]);
  if (exists.rowCount === 0) await client.query(`CREATE DATABASE "${dbName}"`);
  await client.end();

  execSync("npx prisma migrate deploy", {
    cwd: path.join(__dirname, ".."),
    env: { ...process.env, DATABASE_URL: testUrl },
    stdio: "pipe",
  });
}
