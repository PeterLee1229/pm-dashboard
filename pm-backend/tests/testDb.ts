// 測試 DB 連線字串：優先使用 TEST_DATABASE_URL，否則使用 `npm run test:db` 啟動的本機測試容器
import { config } from "dotenv";
import path from "node:path";

const DEFAULT_TEST_DATABASE_URL = "postgresql://postgres:postgres@localhost:55432/pm_dashboard_test";

export function resolveTestDatabaseUrl(): string {
  config({ path: path.join(__dirname, "..", ".env"), quiet: true });
  const url = new URL(process.env.TEST_DATABASE_URL || DEFAULT_TEST_DATABASE_URL);
  const dbName = url.pathname.replace(/^\//, "");
  // 防呆：測試會清空整個資料庫，只允許名稱以 _test 結尾的資料庫
  if (!dbName.endsWith("_test")) throw new Error(`測試資料庫名稱必須以 _test 結尾，目前是「${dbName}」`);
  return url.toString();
}
