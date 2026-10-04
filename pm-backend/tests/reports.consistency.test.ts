// 前端（pm-a--/src/reportCalc.ts，瀏覽器本地時區）與後端（services/reports.ts，Asia/Taipei）
// 以同一份 fixture 計算，結果必須完全相同。setupEnv 已將 TZ 設為 Asia/Taipei，模擬台灣使用者的瀏覽器。
import { beforeAll, describe, expect, it } from "vitest";
import * as fe from "../../pm-a--/src/reportCalc";
import { getCompletion as feGetCompletion, normalizeDate as feNormalizeDate, formatDateStr as feFormatDateStr, getWeekRange as feGetWeekRange } from "../../pm-a--/src/helpers";
import type { Column, Group, Risk, Task } from "../../pm-a--/src/types";
import * as be from "../src/services/reports";
import { prisma } from "../src/db";
import { Fixture, api, resetAndSeed } from "./fixtures";

// ── Fixture ──────────────────────────────────────────────────────────
// 注意：開始／結束日期刻意避開週一（前端「下週」判斷在週一有已知差異，見最後一段測試）

const groups: be.ReportGroup[] = [
  { id: "gA", name: "A組", color: "#111111", members: [{ id: "E-a1", name: "阿一" }, { id: "E-a2", name: "阿二" }] },
  { id: "gB", name: "B組", color: "#222222", members: [{ id: "E-b1", name: "阿三" }] },
];

const log = (date: string, hours: number | null, id = date + hours) => ({ id, date, hours });
const sub = (id: string, o: Partial<be.ReportSubTask>): be.ReportSubTask => ({
  id, title: id, assignee: "", groupId: "", startDate: "", endDate: "", completion: 0, timeLogs: [], ...o,
});
const task = (id: string, o: Partial<be.ReportTask>): be.ReportTask => ({
  id, title: id, priority: "medium", assignee: "", groupId: "", startDate: "", endDate: "",
  completion: 0, timeLogs: [], columnId: "todo", completedAt: null, subtasks: [], ...o,
});

const tasks: be.ReportTask[] = [
  task("t1", { columnId: "inprogress", assignee: "E-a1", groupId: "gA", startDate: "2026-09-29", endDate: "2026-10-02", completion: 40,
    timeLogs: [log("2026-09-28", 2), log("2026-09-30", 1.5), log("2026-10-01", 3), log("2026-10-04", 0.25), log("2026-10-05", 4)] }),
  task("t2", { columnId: "inprogress", assignee: "E-b1", groupId: "gB", startDate: "2026-09-15", endDate: "2026-10-20", completion: 10,
    timeLogs: [log("2026-09-20", 1), log("2026-09-27", 2.3)] }),
  // 台北時間 9/28（週一）01:30 完成，UTC 仍是 9/27（週日）
  task("t3", { columnId: "done", assignee: "E-a2", groupId: "gA", startDate: "2026-09-22", endDate: "2026-09-25", completion: 100,
    completedAt: "2026-09-27T17:30:00.000Z", timeLogs: [log("2026-09-23", 5)] }),
  // 台北時間 9/27（週日）23:30 完成
  task("t4", { columnId: "done", assignee: "E-a1", completion: 100, completedAt: "2026-09-27T15:30:00.000Z" }),
  task("t5", { columnId: "done", completion: 100, completedAt: "2026-10-04T15:59:00.000Z" }),
  // 有子工項：日期與完成度由子工項推算
  task("t6", { columnId: "inprogress", groupId: "gB", subtasks: [
    sub("s1", { assignee: "E-b1", startDate: "2026-09-30", endDate: "2026-10-08", completion: 50, timeLogs: [log("2026-10-01", 2), log("2026-10-02", null)] }),
    sub("s2", { assignee: "E-a2", startDate: "2026-10-07", endDate: "2026-10-14", completion: 20, timeLogs: [log("2026-09-29", 1.2)] }),
    sub("s3", { assignee: "", startDate: "", endDate: "", completion: 100, timeLogs: [log("2026-09-30", 0.7)] }),
  ] }),
  // 子工項全數完成
  task("t7", { columnId: "review", subtasks: [sub("s4", { completion: 100, endDate: "2026-09-24" }), sub("s5", { completion: 100, endDate: "2026-10-09" })] }),
  // 負責人不在任何組別（自由輸入）與未指派
  task("t8", { columnId: "todo", assignee: "外包廠商", startDate: "2026-10-06", endDate: "2026-10-09", timeLogs: [log("2026-09-30", 8)] }),
  task("t9", { columnId: "todo", startDate: "2026-10-08", endDate: "2026-10-10", timeLogs: [log("2026-10-01", 1)] }),
  // 逾期（未完成）、到期日無效、沒有到期日
  task("t10", { columnId: "inprogress", assignee: "E-a2", startDate: "2026-09-01", endDate: "2026-09-10", completion: 90 }),
  task("t11", { columnId: "todo", endDate: "not-a-date" }),
  task("t12", { columnId: "todo" }),
  // 跨年
  task("t13", { columnId: "inprogress", assignee: "E-a1", startDate: "2026-12-29", endDate: "2027-01-06", completion: 5,
    timeLogs: [log("2026-12-31", 2), log("2027-01-01", 3)] }),
  task("t14", { columnId: "done", completion: 100, completedAt: "2026-12-31T16:30:00.000Z" }),
  // 看板上不存在的欄位：前端不顯示，不列入計算
  task("t15", { columnId: "archived", startDate: "2026-09-29", endDate: "2026-09-30", timeLogs: [log("2026-09-30", 100)] }),
  // 在已完成欄但完成度未滿
  task("t16", { columnId: "done", completion: 60, endDate: "2026-09-29", completedAt: "2026-09-29T02:00:00.000Z" }),
];

const risks: be.ReportRisk[] = [
  { id: "r1", title: "高風險", status: "monitoring", probability: "high", impact: "high" },
  { id: "r2", title: "已發生", status: "occurred", probability: "medium", impact: "mid-high" },
  { id: "r3", title: "已解除", status: "resolved", probability: "high", impact: "high" },
];

/** 依前端 App.tsx loadProjects 的方式組成看板欄位 */
function toColumns(list: be.ReportTask[]): Column[] {
  const map: Record<string, Task[]> = { todo: [], inprogress: [], review: [], done: [] };
  for (const t of list) {
    const col = t.columnId || "todo";
    if (!map[col]) map[col] = [];
    map[col].push({
      ...t, description: "", priority: t.priority as Task["priority"],
      completedAt: t.completedAt instanceof Date ? t.completedAt.toISOString() : t.completedAt,
      timeLogs: t.timeLogs as Task["timeLogs"],
      subtasks: t.subtasks.map((s) => ({ ...s, description: "", timeLogs: s.timeLogs as Task["timeLogs"] })),
    });
  }
  return [
    { id: "todo", title: "待處理", tasks: map.todo },
    { id: "inprogress", title: "進行中", tasks: map.inprogress },
    { id: "review", title: "審查中", tasks: map.review },
    { id: "done", title: "已完成", tasks: map.done },
  ];
}

const feRisks = risks as unknown as Risk[];
const feGroups = groups as Group[];
const localNoon = (day: string) => { const [y, m, d] = day.split("-").map(Number); return new Date(y, m - 1, d, 12); };
const hoursEntries = (map: Record<string, number>) => Object.entries(map)
  .sort((a, b) => b[1] - a[1]).map(([name, hours]) => ({ name, hours: Math.round(hours * 10) / 10 }));
const withoutId = <T extends { id: string }>(list: T[]) => list.map(({ id: _id, ...rest }) => rest);

function compareWeek(input: { tasks: be.ReportTask[]; groups: be.ReportGroup[]; risks: be.ReportRisk[] }, feCols: Column[], feGrps: Group[], feRsks: Risk[], weekStart: string) {
  const backend = be.buildWeeklyReport(input, weekStart);
  const calc = fe.computeWeeklyReport(feCols, feGrps, feRsks, localNoon(weekStart));
  const frontend = fe.toWeeklyReportData(calc, feGrps, "");

  expect(withoutId(backend.completedTasks)).toEqual(frontend.completedTasks);
  expect(withoutId(backend.inProgressTasks)).toEqual(frontend.inProgressTasks);
  expect(withoutId(backend.nextWeekTasks)).toEqual(frontend.nextWeekTasks);
  expect(backend.weekHours).toEqual(frontend.weekHours);
  expect(backend.totalHours).toBe(frontend.totalHours);
  expect(backend.activeRisks.map(({ title, status }) => ({ title, status }))).toEqual(frontend.activeRisks);
  expect(backend.monthHours).toEqual(hoursEntries(calc.monthHoursMap));
  expect(backend.allHours).toEqual(hoursEntries(calc.allHoursMap));
  return backend;
}

// ── 純函式比對 ────────────────────────────────────────────────────────

describe("週報彙整：前後端一致", () => {
  const WEEKS = ["2026-09-21", "2026-09-28", "2026-10-05", "2026-10-12", "2026-12-28", "2027-01-04"];

  it.each(WEEKS)("週一為 %s 的週", (weekStart) => {
    compareWeek({ tasks, groups, risks }, toColumns(tasks), feGroups, feRisks, weekStart);
  });

  it("傳入週中任一天都會對齊到該週週一", () => {
    const a = be.buildWeeklyReport({ tasks, groups, risks }, "2026-10-01");
    const b = be.buildWeeklyReport({ tasks, groups, risks }, "2026-09-28");
    expect(a).toEqual(b);
    expect(a.weekStart).toBe("2026-09-28");
    expect(a.weekEnd).toBe("2026-10-04");
  });

  it("fixture 確實涵蓋各區塊（避免空集合比對）", () => {
    const r = be.buildWeeklyReport({ tasks, groups, risks }, "2026-09-28");
    expect(r.completedTasks.map((t) => t.id)).toEqual(["t3", "t5", "t16"]);
    expect(r.inProgressTasks.length).toBeGreaterThan(0);
    expect(r.nextWeekTasks.length).toBeGreaterThan(0);
    expect(r.weekHours.length).toBeGreaterThan(2);
    expect(r.monthHours.length).toBeGreaterThan(0);
  });
});

describe("進度指標：前後端一致", () => {
  it("任務完成率與加權進度", () => {
    expect(be.computeProgress(tasks)).toEqual(fe.computeProgress(toColumns(tasks)));
  });

  it("空專案", () => {
    expect(be.computeProgress([])).toEqual(fe.computeProgress(toColumns([])));
  });

  it("任務完成度（含子工項平均）", () => {
    for (const t of tasks) expect(be.getCompletion(t)).toBe(feGetCompletion(t as unknown as Task));
  });

  it("日期正規化", () => {
    for (const d of ["2026/9/1", "2026-9-01", "2026-09-01", "", "abc", "2026/10/31"]) {
      expect(be.normalizeDate(d)).toBe(feNormalizeDate(d));
    }
  });
});

describe("逾期判斷：前後端一致", () => {
  const TODAYS = ["2026-09-10", "2026-09-11", "2026-09-30", "2026-10-03", "2027-01-07"];

  it.each(TODAYS)("今天為 %s", (today) => {
    for (const t of orderTasks(tasks)) {
      const feTask = toColumns([t]).flatMap((c) => c.tasks)[0];
      const b = be.getDueStatus(t, today);
      const f = fe.getDueStatus(feTask, localNoon(today));
      if (f === null) { expect(b).toBeNull(); continue; }
      expect(b, t.id).not.toBeNull();
      expect({ id: t.id, overdue: b!.isOverdue, soon: b!.isDueSoon }).toEqual({ id: t.id, overdue: f.isOverdue, soon: f.isDueSoon });
      if (!Number.isNaN(f.diffDays)) expect(b!.diffDays).toBe(f.diffDays);
    }
  });

  function orderTasks(list: be.ReportTask[]) {
    return list.filter((t) => be.COLUMN_ORDER.includes(t.columnId as any));
  }
});

// 裁決 #10：「進行中」改為區間重疊（startDate <= 週日 && endDate >= 週一），前後端都改
describe("週報「進行中」：區間重疊", () => {
  const WEEK = "2026-09-28"; // 週一 9/28 ～ 週日 10/4
  const cases: [string, string, string, boolean][] = [
    ["完全落在本週內", "2026-09-29", "2026-10-02", true],
    ["開始於上週、結束於下週（橫跨整週）", "2026-09-21", "2026-10-10", true],
    ["只有開始日在本週", "2026-10-03", "2026-10-15", true],
    ["只有結束日在本週", "2026-09-20", "2026-09-28", true],
    ["開始於本週日當天", "2026-10-04", "2026-10-20", true],
    ["完全不在本週（之後）", "2026-10-05", "2026-10-10", false],
    ["完全不在本週（之前）", "2026-09-01", "2026-09-27", false],
  ];

  it.each(cases)("%s", (_name, startDate, endDate, expected) => {
    const list = [task("x", { columnId: "inprogress", startDate, endDate, completion: 30 })];
    const backend = be.buildWeeklyReport({ tasks: list, groups, risks: [] }, WEEK);
    const frontend = fe.computeWeeklyReport(toColumns(list), feGroups, [], localNoon(WEEK));
    expect(backend.inProgressTasks.map((t) => t.id)).toEqual(expected ? ["x"] : []);
    expect(frontend.inProgressTasks.map((t) => t.id)).toEqual(expected ? ["x"] : []);
  });

  it("有子工項時，任一子工項與本週重疊即算", () => {
    const list = [task("x", { columnId: "inprogress", subtasks: [
      sub("a", { startDate: "2026-09-01", endDate: "2026-09-10", completion: 10 }),
      sub("b", { startDate: "2026-09-15", endDate: "2026-10-31", completion: 10 }),
    ] })];
    const backend = be.buildWeeklyReport({ tasks: list, groups, risks: [] }, WEEK);
    const frontend = fe.computeWeeklyReport(toColumns(list), feGroups, [], localNoon(WEEK));
    expect(backend.inProgressTasks.map((t) => t.id)).toEqual(["x"]);
    expect(frontend.inProgressTasks.map((t) => t.id)).toEqual(["x"]);
  });

  it("只有一端有日期時，以該日是否在本週判斷", () => {
    const list = [
      task("onlyStart", { columnId: "inprogress", startDate: "2026-09-30" }),
      task("onlyEndOutside", { columnId: "inprogress", endDate: "2026-10-08" }),
    ];
    const backend = be.buildWeeklyReport({ tasks: list, groups, risks: [] }, WEEK);
    const frontend = fe.computeWeeklyReport(toColumns(list), feGroups, [], localNoon(WEEK));
    expect(backend.inProgressTasks.map((t) => t.id)).toEqual(["onlyStart"]);
    expect(frontend.inProgressTasks.map((t) => t.id)).toEqual(["onlyStart"]);
  });
});

// 裁決 #9：後端採正確語意，前端這次不修。以下兩項是明確的「預期差異」，其餘情況前後端必須一致
describe("預期差異（前端 bug，下一批修正）", () => {
  // 9(a) 前端 computeWeeklyReport 的 nextWeekStart = 本週日 23:59:59.999 + 1 天 = 下週一 23:59:59.999，
  // 而日期字串 "YYYY-MM-DD" 解析為 08:00（台灣），因此開始或結束日恰為「下週一」的任務會被漏掉。
  // 後端採正確語意（下週一 ~ 下週日，含頭尾）。
  it("9(a) 結束日恰為下週一的任務：前端漏列、後端列入", () => {
    const edge = [task("edge", { columnId: "todo", startDate: "2026-09-30", endDate: "2026-10-05" })];
    const backend = be.buildWeeklyReport({ tasks: edge, groups, risks: [] }, "2026-09-28");
    const frontend = fe.computeWeeklyReport(toColumns(edge), feGroups, [], localNoon("2026-09-28"));
    expect(backend.nextWeekTasks.map((t) => t.id)).toEqual(["edge"]);
    expect(frontend.nextWeekTasks.map((t) => t.id)).toEqual([]);
  });

  // 有結束日時前端的重疊判斷仍會列入；只有開始日（下週一）、沒有結束日時才會漏掉
  it("9(a) 只有開始日且恰為下週一的任務：前端漏列、後端列入", () => {
    const edge = [task("edge", { columnId: "todo", startDate: "2026-10-05", endDate: "" })];
    const backend = be.buildWeeklyReport({ tasks: edge, groups, risks: [] }, "2026-09-28");
    const frontend = fe.computeWeeklyReport(toColumns(edge), feGroups, [], localNoon("2026-09-28"));
    expect(backend.nextWeekTasks.map((t) => t.id)).toEqual(["edge"]);
    expect(frontend.nextWeekTasks.map((t) => t.id)).toEqual([]);
  });

  // 9(b) 前端 formatDateStr 以 toISOString 截斷日期：台灣時區週一 00:00 = UTC 前一天 16:00，週次 key 變成週日。
  // 後端一律以週一（Asia/Taipei）為 key。
  it("9(b) 週次 key：前端得到週日，後端為週一", () => {
    for (const day of ["2026-09-28", "2026-09-30", "2026-10-04", "2027-01-01"]) {
      const feKey = feFormatDateStr(feGetWeekRange(localNoon(day)).start);
      const beKey = be.buildWeeklyReport({ tasks: [], groups, risks: [] }, day).weekStart;
      expect(be.mondayOf(day)).toBe(beKey);
      expect(feKey).toBe(be.addDays(beKey, -1));
    }
  });
});

// ── 透過 API 與資料庫的端到端比對 ─────────────────────────────────────

describe("GET /api/projects/:id/weekly-report-data 與前端以 API 資料計算的結果一致", () => {
  let f: Fixture;
  beforeAll(async () => {
    f = await resetAndSeed();
    const A = f.users.member.memberId;
    const B = f.users.memberB.memberId;
    await prisma.task.update({ where: { id: f.tasks.ofMember.id }, data: {
      startDate: "2026/9/29", endDate: "2026/10/2", completion: 30,
      timeLogs: [log("2026-09-28", 3), log("2026-10-01", 1.5), log("2026-10-06", 2)],
    } });
    await prisma.task.update({ where: { id: f.tasks.ofMemberB.id }, data: {
      columnId: "inprogress", startDate: "2026-10-01", endDate: "2026-10-09", timeLogs: [log("2026-09-30", 4)],
    } });
    await prisma.task.update({ where: { id: f.tasks.done.id }, data: { completedAt: new Date("2026-09-27T17:00:00Z") } });
    await prisma.subTask.updateMany({ where: { taskId: f.tasks.withSubtasks.id, assignee: A }, data: {
      startDate: "2026-10-07", endDate: "2026-10-08", completion: 40, timeLogs: [log("2026-09-29", 2)],
    } });
    await prisma.subTask.updateMany({ where: { taskId: f.tasks.withSubtasks.id, assignee: B }, data: {
      startDate: "2026-09-30", endDate: "2026-10-01", completion: 100, timeLogs: [log("2026-10-01", 1)],
    } });
    await prisma.weeklyReport.create({ data: { projectId: f.p1.id, weekStart: "2026-09-27", weekEnd: "2026-10-04", notes: "舊格式的週報備註" } });
  });

  it("2026-09-28 這一週", async () => {
    const auth = { Authorization: `Bearer ${f.tokens.viewer}` };
    const [tasksRes, membersRes, risksRes, reportRes] = await Promise.all([
      api().get(`/api/projects/${f.p1.id}/tasks`).set(auth),
      api().get(`/api/projects/${f.p1.id}/members`).set(auth),
      api().get(`/api/projects/${f.p1.id}/risks`).set(auth),
      api().get(`/api/projects/${f.p1.id}/weekly-report-data?weekStart=2026-09-28`).set(auth),
    ]);
    expect(reportRes.status).toBe(200);

    // 與前端 App.tsx 相同：日期正規化、依成員的系統組別分組
    const apiTasks: be.ReportTask[] = tasksRes.body.map((t: any) => ({
      ...t, startDate: feNormalizeDate(t.startDate || ""), endDate: feNormalizeDate(t.endDate || ""), timeLogs: t.timeLogs || [],
      subtasks: (t.subtasks || []).map((s: any) => ({ ...s, startDate: feNormalizeDate(s.startDate || ""), endDate: feNormalizeDate(s.endDate || ""), timeLogs: s.timeLogs || [] })),
    }));
    const groupMap = new Map<string, Group>();
    for (const pm of membersRes.body) {
      const g = pm.user.group;
      const id = g?.id || "ungrouped";
      if (!groupMap.has(id)) groupMap.set(id, { id, name: g?.name || "未分組", color: g?.color || "#64748b", members: [] });
      groupMap.get(id)!.members.push({ id: pm.user.memberId || pm.user.id, name: pm.user.name });
    }
    const apiGroups = [...groupMap.values()];

    const calc = fe.computeWeeklyReport(toColumns(apiTasks), apiGroups, risksRes.body, localNoon("2026-09-28"));
    const frontend = fe.toWeeklyReportData(calc, apiGroups, "舊格式的週報備註");
    const backend = reportRes.body;

    expect(withoutId(backend.completedTasks)).toEqual(frontend.completedTasks);
    expect(withoutId(backend.inProgressTasks)).toEqual(frontend.inProgressTasks);
    expect(withoutId(backend.nextWeekTasks)).toEqual(frontend.nextWeekTasks);
    expect(backend.weekHours).toEqual(frontend.weekHours);
    expect(backend.totalHours).toBe(frontend.totalHours);
    expect(backend.activeRisks.map(({ title, status }: any) => ({ title, status }))).toEqual(frontend.activeRisks);
    expect(backend.notes).toBe(frontend.notes);
    expect(backend.completedTasks.length + backend.inProgressTasks.length + backend.weekHours.length).toBeGreaterThan(3);
  });

  it("相容讀取：週一 key 與週日 key 都存在時，以週一 key 為準", async () => {
    await prisma.weeklyReport.create({ data: { projectId: f.p1.id, weekStart: "2026-09-28", weekEnd: "2026-10-04", notes: "新格式備註" } });
    const res = await api().get(`/api/projects/${f.p1.id}/weekly-report-data?weekStart=2026-09-30`).set("Authorization", `Bearer ${f.tokens.viewer}`);
    expect(res.body.notes).toBe("新格式備註");
    await prisma.weeklyReport.deleteMany({ where: { projectId: f.p1.id, weekStart: "2026-09-28" } });
  });

  it("weekStart 格式錯誤回 400", async () => {
    const res = await api().get(`/api/projects/${f.p1.id}/weekly-report-data?weekStart=2026/9/28`).set("Authorization", `Bearer ${f.tokens.viewer}`);
    expect(res.status).toBe(400);
  });

  it("專案摘要的進度與前端一致", async () => {
    const auth = { Authorization: `Bearer ${f.tokens.viewer}` };
    const [tasksRes, summaryRes] = await Promise.all([
      api().get(`/api/projects/${f.p1.id}/tasks`).set(auth),
      api().get(`/api/projects/${f.p1.id}/summary`).set(auth),
    ]);
    const feProgress = fe.computeProgress(toColumns(tasksRes.body.map((t: any) => ({ ...t, timeLogs: t.timeLogs || [] }))));
    expect(summaryRes.body).toMatchObject(feProgress);
    expect(summaryRes.body.highRiskCount).toBe(1);
  });
});
