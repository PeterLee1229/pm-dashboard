// 回歸測試：12 支唯讀工具遷移到工具註冊表後，輸出必須與遷移前（Phase 1）完全相同。
// snapshot 於遷移前以 Phase 1 的實作產生（tests/__snapshots__/tools.snapshot.test.ts.snap）。
// 為了讓 snapshot 穩定：隨機 id 換成依出現順序編號的代號、與今天相關的日期與天數換成佔位字串，陣列依內容排序。
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { prisma } from "../src/db";
import { buildMcpServer } from "../src/tools/adapters/mcp";
import { todayInTaipei } from "../src/services/reports";
import { Fixture, resetAndSeed } from "./fixtures";

let f: Fixture;
const clients: Client[] = [];

beforeAll(async () => {
  f = await resetAndSeed();
  await prisma.task.update({ where: { id: f.tasks.ofMember.id }, data: { endDate: "2026-01-10", completion: 20, timeLogs: [{ id: "l1", date: "2026-01-05", hours: 3 }] } });
  await prisma.task.update({ where: { id: f.tasks.ofMemberB.id }, data: { endDate: "2099-12-31", description: "關鍵字在描述裡" } });
  await prisma.meetingRecord.update({ where: { id: f.record.id }, data: { attendees: [f.users.member.memberId, f.users.pm.memberId] } });
  await prisma.objective.update({ where: { id: f.objective.id }, data: { startDate: "2026-01-01", endDate: "2026-06-30" } });
  await prisma.keyResult.update({ where: { id: f.keyResult.id }, data: { targetValue: 10, currentValue: 4 } });
  // 固定完成時間：fixture 預設為「現在」，會讓週報的「本週完成」隨執行日期改變（snapshot 於 2026-10-04 產生，該週為 9/28～10/4）
  await prisma.task.update({ where: { id: f.tasks.done.id }, data: { completedAt: new Date("2026-09-30T02:00:00Z") } });
});
afterAll(async () => { await Promise.all(clients.map((c) => c.close())); });

const CUID = /^c[a-z0-9]{20,}$/;
const TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}/;
const RELATIVE_NUMBERS = new Set(["overdueDays", "daysLeft"]);
/** 固定日期欄位：即使剛好等於今天也不替換（否則 snapshot 會隨執行日期改變） */
const FIXED_DATE_KEYS = new Set(["weekStart", "weekEnd"]);

/** 去除隨機與時間相關的值，陣列依內容排序，再依出現順序替換 id */
function normalize(value: unknown): unknown {
  const today = todayInTaipei();
  const strip = (v: unknown): unknown => {
    if (Array.isArray(v)) {
      const items = v.map(strip);
      return items.sort((a, b) => JSON.stringify(a).localeCompare(JSON.stringify(b)));
    }
    if (v && typeof v === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, RELATIVE_NUMBERS.has(k) ? "<n>" : FIXED_DATE_KEYS.has(k) ? x : strip(x)]));
    }
    if (typeof v === "string") {
      if (CUID.test(v)) return "<id>";
      if (TIMESTAMP.test(v)) return "<timestamp>";
      if (v === today) return "<today>";
      if (v === "nextCursor") return v;
    }
    return v;
  };
  // 先排序（id 以 <id> 比較），再依排序後的出現順序編號，同一個 id 對應同一個代號
  const ids = new Map<string, string>();
  const number = (v: unknown, raw: unknown): unknown => {
    if (Array.isArray(v) && Array.isArray(raw)) {
      const pairs = raw.map((r) => ({ r, s: strip(r) })).sort((a, b) => JSON.stringify(a.s).localeCompare(JSON.stringify(b.s)));
      return pairs.map(({ r, s }) => number(s, r));
    }
    if (v && typeof v === "object" && raw && typeof raw === "object") {
      return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, number(x, (raw as Record<string, unknown>)[k])]));
    }
    if (v === "<id>" && typeof raw === "string") {
      if (!ids.has(raw)) ids.set(raw, `<id${ids.size + 1}>`);
      return ids.get(raw);
    }
    return v;
  };
  return number(strip(value), value);
}

async function call(userKey: keyof Fixture["users"], name: string, args: Record<string, unknown> = {}) {
  const user = f.users[userKey];
  const server = buildMcpServer({ userId: user.id, systemRole: user.role }, { clientId: "snapshot" });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "snapshot", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  clients.push(client);
  const res = await client.callTool({ name, arguments: args });
  const body = JSON.parse((res.content as { text: string }[])[0].text);
  return { isError: !!res.isError, body: normalize(withoutPhase2Additions(name, body)) };
}

/**
 * Phase 2 刻意新增、遷移前不存在的欄位（其餘輸出必須與遷移前完全相同）：
 * - get_task.updatedAt：update_task 的 expectedUpdatedAt（樂觀鎖）需要
 * - get_activity_log 每筆的 source / clientName：標示經由 AI 工具的操作（spec 第 4 節）
 */
function withoutPhase2Additions(name: string, body: any) {
  if (name === "get_task" && body && !body.error) {
    expect(body.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    const { updatedAt: _u, ...rest } = body;
    return rest;
  }
  // 專案封存（Phase 2 之後）：list_projects 每筆新增 archived
  if (name === "list_projects" && Array.isArray(body?.items)) {
    return { ...body, items: body.items.map(({ archived: _a, ...rest }: any) => { expect(_a).toBe(false); return rest; }) };
  }
  if (name === "get_activity_log" && Array.isArray(body?.items)) {
    return { ...body, items: body.items.map(({ source: _s, clientName: _c, ...rest }: any) => { expect(_s).toBeTruthy(); return rest; }) };
  }
  return body;
}

describe("12 支唯讀工具的輸出與遷移前相同", () => {
  const cases: [string, keyof Fixture["users"], () => Record<string, unknown>][] = [
    ["list_projects", "pm", () => ({})],
    ["get_project_summary", "pm", () => ({ projectId: f.p1.id })],
    ["list_tasks", "pm", () => ({ projectId: f.p1.id, limit: 200 })],
    ["list_tasks（篩選）", "pm", () => ({ assigneeId: f.users.memberB.memberId })],
    ["get_task", "pm", () => ({ taskId: f.tasks.withSubtasks.id })],
    ["get_task（含工時、留言、附件）", "member", () => ({ taskId: f.tasks.ofMember.id })],
    ["list_overdue_tasks", "admin", () => ({})],
    ["list_risks", "viewer", () => ({ projectId: f.p1.id })],
    ["list_meetings", "pm", () => ({})],
    ["get_meeting", "pm", () => ({ meetingId: f.record.id })],
    ["get_weekly_report_data", "pm", () => ({ projectId: f.p1.id, weekStart: "2026-09-30" })],
    ["list_okrs", "pm", () => ({})],
    ["search", "pm", () => ({ query: "任務", limit: 200 })],
    ["get_activity_log", "pm", () => ({ projectId: f.p1.id })],
    ["錯誤：非成員讀取任務", "outsider", () => ({ taskId: f.tasks.ofMember.id })],
  ];

  it.each(cases)("%s", async (label, user, args) => {
    const name = label.startsWith("錯誤") ? "get_task" : label.replace(/（.*）$/, "");
    expect(await call(user, name, args())).toMatchSnapshot();
  });
});
