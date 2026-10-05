import { z } from "zod";

// service 丟出這些錯誤，由 route 層（index.ts 的 error handler）統一轉成 HTTP 狀態碼

/** details：附帶給呼叫端的結構化資訊（例如批次中每一筆的錯誤、衝突時的最新內容） */
export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export class NotFoundError extends HttpError {
  constructor(message = "找不到資料") { super(404, message); }
}

export class ForbiddenError extends HttpError {
  constructor(message = "權限不足", details?: unknown) { super(403, message, details); }
}

export class BadRequestError extends HttpError {
  constructor(message: string, details?: unknown) { super(400, message, details); }
}

/** 樂觀鎖衝突：資料在讀取後已被他人修改；details 附上最新內容 */
export class ConflictError extends HttpError {
  constructor(message: string, details?: unknown) { super(409, message, details); }
}

/** 以 zod 白名單驗證 request body；未列在 schema 的欄位一律丟棄 */
export function parseInput<S extends z.ZodType>(schema: S, input: unknown): z.infer<S> {
  const result = schema.safeParse(input ?? {});
  if (!result.success) {
    const issue = result.error.issues[0];
    const path = issue.path.length ? `「${issue.path.join(".")}」` : "";
    throw new BadRequestError(`輸入資料格式錯誤${path}：${issue.message}`);
  }
  return result.data;
}
