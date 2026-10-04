import { prisma } from "../db";

export type UserRef = { id: string; name: string };

/**
 * 依員工編號（memberId）或使用者 id 解析使用者名稱。會議與會者兩種格式都有（與前端 MeetingsView 相同）。
 * 回傳的 id 以員工編號為準；查不到時原樣回傳。
 */
export async function makeUserResolver(ids: string[]): Promise<(id: string) => UserRef> {
  const unique = [...new Set(ids.filter(Boolean))];
  const users = unique.length === 0 ? [] : await prisma.user.findMany({
    where: { OR: [{ memberId: { in: unique } }, { id: { in: unique } }] },
    select: { id: true, memberId: true, name: true },
  });
  return (id: string) => {
    const u = users.find((x) => x.memberId === id || x.id === id);
    return { id: u?.memberId ?? id, name: u?.name ?? id };
  };
}
