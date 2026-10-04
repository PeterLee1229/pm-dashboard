import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    globalSetup: ["./tests/globalSetup.ts"],
    setupFiles: ["./tests/setupEnv.ts"],
    // 所有測試共用同一個測試 DB，檔案之間不可平行執行
    fileParallelism: false,
    testTimeout: 30_000,
    hookTimeout: 120_000,
  },
});
