import { resolveTestDatabaseUrl } from "./testDb";

// 必須在任何 src 模組載入前設定（src/db.ts 載入時即建立連線池）
process.env.DATABASE_URL = resolveTestDatabaseUrl();
process.env.JWT_SECRET = "test-jwt-secret";
// 前端計算依賴瀏覽器本地時區；一致性測試以台灣時區執行
process.env.TZ = "Asia/Taipei";
