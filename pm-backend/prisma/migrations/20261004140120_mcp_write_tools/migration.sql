-- AlterTable
ALTER TABLE "ActivityLog" ADD COLUMN     "clientName" TEXT,
ADD COLUMN     "source" TEXT NOT NULL DEFAULT 'web';

-- AlterTable
ALTER TABLE "SystemSetting" ADD COLUMN     "mcpWriteEnabled" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "ToolIdempotency" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tool" TEXT NOT NULL,
    "requestHash" TEXT NOT NULL,
    "resultJson" JSONB NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ToolIdempotency_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ToolIdempotency_expiresAt_idx" ON "ToolIdempotency"("expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "ToolIdempotency_userId_tool_key_key" ON "ToolIdempotency"("userId", "tool", "key");
