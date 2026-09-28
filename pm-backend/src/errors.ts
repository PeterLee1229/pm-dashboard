import { z } from "zod";

// service 丟出這些錯誤，由 route 層（index.ts 的 error handler）統一轉成 HTTP 狀態碼

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export class NotFoundError extends HttpError {
  constructor(message = "找不到資料") { super(404, message); }
}

export class ForbiddenError extends HttpError {
  constructor(message = "權限不足") { super(403, message); }
}

export class BadRequestError extends HttpError {
  constructor(message: string) { super(400, message); }
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
