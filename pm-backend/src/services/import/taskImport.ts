// ── 工項 CSV 匯入：比對 → 預覽 → 確認寫入 ─────────────────────────────
// 比對與正規化的通用邏輯在 ./diff，這裡只放工項專屬的欄位定義與判定規則。

import { parse } from "csv-parse/sync";
import type { Prisma, PrismaClient } from "@prisma/client";
import {
  FieldChange, FieldSpec,
  normalizeText, normalizeKey, isBlank, parseDate, parseNumber, parseEnum,
  diffFields, findDuplicates, canonicalHeader, buildHeaderMap,
} from "./diff";
import { AssigneeInfo, checkLeaderAssignChange, checkLeaderGroupChange } from "../permissions";

// ── 欄位定義 ─────────────────────────────────────────────────────────

export const IMPORT_SOURCE_LABEL = "CSV 匯入";

const HEADER_ALIASES: Record<string, string[]> = {
  id:         ["工項ID", "任務ID", "taskId"],
  parentId:   ["父工項ID", "父任務ID", "parentId", "parentTaskId"],
  type:       ["類型"],
  title:      ["任務名稱", "工項名稱", "名稱"],
  group:      ["組別"],
  assignee:   ["指派人", "負責人"],
  priority:   ["優先級", "優先順序"],
  status:     ["狀態"],
  startDate:  ["開始日期"],
  endDate:    ["結束日期"],
  completion: ["完成度", "進度"],
};

const TASK_TYPES = ["主工項", "主任務", "task"];
const SUBTASK_TYPES = ["子工項", "子任務", "subtask"];

const PRIORITY_ALIASES: Record<string, string[]> = {
  high:   ["高", "高優先", "高優先級"],
  medium: ["中", "中優先", "中優先級", "普通"],
  low:    ["低", "低優先", "低優先級"],
};
const PRIORITY_LABELS: Record<string, string> = { high: "高", medium: "中", low: "低" };

const STATUS_ALIASES: Record<string, string[]> = {
  todo:       ["待處理", "待辦", "未開始"],
  inprogress: ["進行中", "in progress", "doing"],
  review:     ["審查中", "待審查", "審核中"],
  done:       ["已完成", "完成"],
};
const STATUS_LABELS: Record<string, string> = { todo: "待處理", inprogress: "進行中", review: "審查中", done: "已完成" };

const UNASSIGNED = ["未指派"];
const UNGROUPED = ["未分組"];

// ── 型別 ─────────────────────────────────────────────────────────────

type Kind = "task" | "subtask";
export type RowStatus = "new" | "modified" | "unchanged" | "error";
export type Decision = "import" | "update" | "skip" | "create_new";

/** 檔案提供、已正規化的值；undefined = 檔案未提供此欄，不比對也不寫入 */
type TaskData = {
  title?: string;
  groupId?: string;
  assignee?: string;
  priority?: string;
  columnId?: string;
  startDate?: string;
  endDate?: string;
  completion?: number;
};

type ExistingSubTask = {
  id: string; title: string; groupId: string; assignee: string;
  startDate: string; endDate: string; completion: number; taskId: string;
};
type ExistingTask = {
  id: string; title: string; priority: string; columnId: string; groupId: string; assignee: string;
  startDate: string; endDate: string; completion: number; updatedAt: Date;
  subtasks: ExistingSubTask[];
};

export type ImportContext = {
  tasks: ExistingTask[];
  users: { memberId: string; email: string; name: string; groupId: string | null }[];
  projectMemberIds: Set<string>;
  groups: { id: string; name: string }[];
  /** 檔案中出現、但屬於其他專案的工項/子工項 id */
  foreignIds: Set<string>;
};

type RawRow = { rowNumber: number; cells: Record<string, string> };
export type ParsedCsv = { rows: RawRow[]; fields: Set<string> };

export type PlanRow = {
  key: string;
  rowNumber: number;
  kind: Kind;
  status: RowStatus;
  title: string;
  targetId?: string;
  /** 父工項在檔案中的列 key */
  parentKey?: string;
  /** 既有父工項 id（父工項為新增時為空，寫入時再關聯） */
  parentTaskId?: string;
  parentTitle?: string;
  data: TaskData;
  changes: FieldChange[];
  errors: string[];
  /** 新增列的欄位摘要（顯示用） */
  fields: { label: string; value: string }[];
  /** 衝突偵測基準：工項為自身 updatedAt，子工項為父工項 updatedAt */
  baseline?: string;
  /** 「另存為新工項」違反權限規則時的原因（例如組長不可建立別組成員負責的工項） */
  createNewBlockedReason?: string;
};

export type MissingItem = { kind: Kind; id: string; title: string; parentTitle?: string; subtaskCount?: number };

export type ImportPlan = {
  projectId: string;
  userId: string;
  createdAt: string;
  rows: PlanRow[];
  missingInFile: MissingItem[];
  summary: { new: number; modified: number; unchanged: number; error: number };
};

export class ImportFormatError extends Error {}

// ── CSV 解析 ─────────────────────────────────────────────────────────

export function parseTaskCsv(csvText: string): ParsedCsv {
  let records: { record: string[]; info: { lines: number } }[];
  try {
    records = parse(csvText, {
      bom: true,
      skip_empty_lines: true,
      relax_column_count: true,
      info: true,
    }) as any;
  } catch (err: any) {
    throw new ImportFormatError("CSV 格式錯誤：" + (err.message || ""));
  }
  if (records.length === 0) throw new ImportFormatError("CSV 沒有內容");

  const headerMap = buildHeaderMap(HEADER_ALIASES);
  const header = records[0].record.map((h) => headerMap.get(canonicalHeader(h)) ?? null);
  if (!header.includes("title")) throw new ImportFormatError("CSV 缺少必要欄位「任務名稱」");

  const fields = new Set(header.filter((h): h is string => !!h));
  const rows: RawRow[] = [];
  for (const { record, info } of records.slice(1)) {
    if (record.every((c) => isBlank(c))) continue;
    const cells: Record<string, string> = {};
    header.forEach((f, i) => {
      if (f && cells[f] === undefined) cells[f] = record[i] ?? "";
    });
    rows.push({ rowNumber: info.lines, cells });
  }
  if (rows.length === 0) throw new ImportFormatError("CSV 至少需要一筆資料");
  return { rows, fields };
}

/** 檔案中出現的所有 工項ID / 父工項ID，用於查詢是否屬於其他專案 */
export function collectIds(parsed: ParsedCsv): string[] {
  const ids = new Set<string>();
  for (const r of parsed.rows) {
    for (const f of ["id", "parentId"]) {
      const v = normalizeText(r.cells[f]);
      if (v) ids.add(v);
    }
  }
  return [...ids];
}

// ── 載入比對所需的既有資料 ───────────────────────────────────────────

export async function loadImportContext(prisma: PrismaClient, projectId: string, fileIds: string[]): Promise<ImportContext> {
  const [tasks, users, members, groups] = await Promise.all([
    prisma.task.findMany({
      where: { projectId },
      select: {
        id: true, title: true, priority: true, columnId: true, groupId: true, assignee: true,
        startDate: true, endDate: true, completion: true, updatedAt: true,
        subtasks: {
          select: {
            id: true, title: true, groupId: true, assignee: true,
            startDate: true, endDate: true, completion: true, taskId: true,
          },
        },
      },
      orderBy: { createdAt: "asc" },
    }),
    prisma.user.findMany({ select: { memberId: true, email: true, name: true, groupId: true } }),
    prisma.projectMember.findMany({ where: { projectId }, select: { user: { select: { memberId: true } } } }),
    prisma.group.findMany({ select: { id: true, name: true } }),
  ]);

  const localIds = new Set<string>();
  for (const t of tasks) {
    localIds.add(t.id);
    for (const s of t.subtasks) localIds.add(s.id);
  }
  const unknown = fileIds.filter((id) => !localIds.has(id));
  const foreignIds = new Set<string>();
  if (unknown.length > 0) {
    const [ft, fs] = await Promise.all([
      prisma.task.findMany({ where: { id: { in: unknown } }, select: { id: true } }),
      prisma.subTask.findMany({ where: { id: { in: unknown } }, select: { id: true } }),
    ]);
    for (const x of [...ft, ...fs]) foreignIds.add(x.id);
  }

  return {
    tasks,
    users,
    projectMemberIds: new Set(members.map((m) => m.user.memberId)),
    groups,
    foreignIds,
  };
}

// ── 比對 ─────────────────────────────────────────────────────────────

type WorkRow = {
  key: string;
  rowNumber: number;
  kind: Kind;
  id: string;
  parentIdRaw: string;
  assigneeRaw?: string;
  data: TaskData;
  errors: string[];
  parentRow?: WorkRow;
  parentTaskId?: string;
  target?: ExistingTask | ExistingSubTask;
  children: WorkRow[];
};

export function buildImportPlan(
  parsed: ParsedCsv, ctx: ImportContext, meta: { projectId: string; userId: string },
  perms: {
    canMarkDone: boolean;
    /** 匯入者為組長時提供其組別，套用組長人力調整規則 */
    leader?: { groupId: string | null };
  } = { canMarkDone: true },
): ImportPlan {
  const has = (f: string) => parsed.fields.has(f);
  const tasksById = new Map(ctx.tasks.map((t) => [t.id, t]));
  const subtasksById = new Map<string, ExistingSubTask>();
  for (const t of ctx.tasks) for (const s of t.subtasks) subtasksById.set(s.id, s);

  const groupName = (id: string) => ctx.groups.find((g) => g.id === id)?.name ?? id;
  const userByMemberId = new Map(ctx.users.map((u) => [u.memberId, u]));
  const userByEmail = new Map(ctx.users.map((u) => [u.email.toLowerCase(), u]));
  const assigneeDisplay = (memberId: string) => {
    if (!memberId) return "";
    const u = userByMemberId.get(memberId);
    return u ? `${u.name}（${u.memberId}）` : memberId;
  };

  const notFoundReason = (id: string, what: string) =>
    ctx.foreignIds.has(id) ? `${what}「${id}」屬於其他專案，不可匯入` : `${what}「${id}」不存在於本專案`;

  // 1. 逐列解析與欄位正規化
  const rows: WorkRow[] = parsed.rows.map(({ rowNumber, cells }) => {
    const row: WorkRow = {
      key: `r${rowNumber}`, rowNumber, kind: "task",
      id: normalizeText(cells.id), parentIdRaw: normalizeText(cells.parentId),
      data: {}, errors: [], children: [],
    };

    const typeRaw = normalizeText(cells.type);
    const typeKey = typeRaw.toLowerCase();
    if (SUBTASK_TYPES.includes(typeKey) || SUBTASK_TYPES.includes(typeRaw)) row.kind = "subtask";
    else if (TASK_TYPES.includes(typeKey) || TASK_TYPES.includes(typeRaw)) row.kind = "task";
    else if (!typeRaw) row.kind = row.parentIdRaw ? "subtask" : "task";
    else row.errors.push(`類型必須是「主工項」或「子工項」，目前是「${typeRaw}」`);

    if (row.kind === "task" && row.parentIdRaw) row.errors.push("主工項不應填寫父工項ID");

    const title = normalizeText(cells.title);
    if (!title) row.errors.push("缺少任務名稱");
    row.data.title = title;

    if (has("group")) {
      const g = normalizeText(cells.group);
      if (!g || UNGROUPED.includes(g)) row.data.groupId = "";
      else {
        const found = ctx.groups.find((x) => normalizeKey(x.name) === normalizeKey(g) || x.id === g);
        if (found) row.data.groupId = found.id;
        else row.errors.push(`找不到組別「${g}」`);
      }
    }

    if (has("assignee")) row.assigneeRaw = normalizeText(cells.assignee);

    if (row.kind === "task") {
      // 空白代表不變更（新增時用預設值）
      if (has("priority")) {
        const p = parseEnum(cells.priority, PRIORITY_ALIASES, "優先級");
        if (!p.ok) row.errors.push(p.error);
        else if (p.value !== null) row.data.priority = p.value;
      }
      if (has("status")) {
        const s = parseEnum(cells.status, STATUS_ALIASES, "狀態");
        if (!s.ok) row.errors.push(s.error);
        else if (s.value !== null) row.data.columnId = s.value;
      }
    }

    for (const f of ["startDate", "endDate"] as const) {
      if (!has(f)) continue;
      const d = parseDate(cells[f]);
      if (!d.ok) row.errors.push(`${f === "startDate" ? "開始日期" : "結束日期"}：${d.error}`);
      else row.data[f] = d.value;
    }

    if (has("completion")) {
      const n = parseNumber(cells.completion);
      if (!n.ok) row.errors.push(`完成度：${n.error}`);
      else if (n.value !== null) {
        if (n.value < 0 || n.value > 100) row.errors.push(`完成度必須介於 0～100，目前是「${normalizeText(cells.completion)}」`);
        else row.data.completion = Math.round(n.value);
      }
    }
    return row;
  });

  const mains = rows.filter((r) => r.kind === "task");
  const subs = rows.filter((r) => r.kind === "subtask");

  // 2. 子工項關聯到父工項（父工項ID > 既有子工項的父工項 > 檔案中前一個主工項）
  const mainRowById = new Map<string, WorkRow>();
  for (const r of mains) if (r.id && !mainRowById.has(r.id)) mainRowById.set(r.id, r);

  let lastMain: WorkRow | undefined;
  for (const row of rows) {
    if (row.kind === "task") { lastMain = row; continue; }
    if (row.parentIdRaw) {
      const pr = mainRowById.get(row.parentIdRaw);
      if (pr) row.parentRow = pr;
      else if (tasksById.has(row.parentIdRaw)) row.parentTaskId = row.parentIdRaw;
      else row.errors.push(notFoundReason(row.parentIdRaw, "父工項ID"));
    } else if (row.id && subtasksById.has(row.id)) {
      const tid = subtasksById.get(row.id)!.taskId;
      const pr = mainRowById.get(tid);
      if (pr) row.parentRow = pr;
      else row.parentTaskId = tid;
    } else if (lastMain) {
      row.parentRow = lastMain;
    } else {
      row.errors.push("子工項前面沒有主工項，也未填父工項ID");
    }
    if (row.parentRow) row.parentRow.children.push(row);
  }

  // 負責人：以帳號（員工編號 / email）比對；只有名稱時解析為帳號
  const resolveAssignee = (row: WorkRow, existing: string | undefined) => {
    if (row.assigneeRaw === undefined) return;
    const raw = row.assigneeRaw;
    if (!raw || UNASSIGNED.includes(raw)) { row.data.assignee = ""; return; }

    const paren = raw.match(/^(.*?)\s*[（(]\s*([^（）()]+?)\s*[）)]$/);
    const candidate = paren ? paren[2] : raw;
    let user = userByMemberId.get(candidate) ?? userByEmail.get(candidate.toLowerCase());
    if (!user && !paren) {
      const sameName = ctx.users.filter((u) => ctx.projectMemberIds.has(u.memberId) && normalizeKey(u.name) === normalizeKey(raw));
      if (sameName.length > 1) {
        row.errors.push(`負責人「${raw}」有 ${sameName.length} 位同名成員，請改填員工編號或 email`);
        return;
      }
      user = sameName[0] ?? ctx.users.find((u) => normalizeKey(u.name) === normalizeKey(raw));
    }
    if (!user) {
      if (existing !== undefined && candidate === existing) { row.data.assignee = existing; return; }
      row.errors.push(`負責人「${raw}」無法對應到帳號`);
      return;
    }
    if (user.memberId !== existing && !ctx.projectMemberIds.has(user.memberId)) {
      row.errors.push(`負責人「${user.name}」不是本專案成員`);
      return;
    }
    row.data.assignee = user.memberId;
  };

  const markDuplicates = (list: WorkRow[], keyOf: (r: WorkRow) => string | null) => {
    const dups = findDuplicates(list.map(keyOf));
    for (const [i, others] of dups) {
      list[i].errors.push(`檔案內重複：與第 ${others.map((j) => list[j].rowNumber).join("、")} 列為同一工項，請修正檔案`);
    }
  };

  // 3. 主工項判定
  for (const row of mains) {
    if (row.id) {
      const t = tasksById.get(row.id);
      if (t) row.target = t;
      else if (subtasksById.has(row.id)) row.errors.push(`工項ID「${row.id}」是子工項，類型應為「子工項」`);
      else row.errors.push(notFoundReason(row.id, "工項ID"));
    } else if (row.data.title) {
      const key = normalizeKey(row.data.title);
      const matches = ctx.tasks.filter((t) => normalizeKey(t.title) === key);
      if (matches.length === 1) row.target = matches[0];
      else if (matches.length > 1) row.errors.push(`無法判定：本專案有 ${matches.length} 筆同名工項「${row.data.title}」，請填入工項ID`);
    }
    resolveAssignee(row, row.target?.assignee);
  }
  markDuplicates(mains, (r) =>
    r.target ? `t:${r.target.id}` : r.id ? `id:${r.id}` : r.data.title ? `n:${normalizeKey(r.data.title)}` : null);

  // 4. 子工項判定（以父工項結果為前提）
  for (const row of subs) {
    if (row.parentRow && row.parentRow.errors.length > 0) {
      row.errors.push(`父工項（第 ${row.parentRow.rowNumber} 列）有錯誤，子工項一併不匯入`);
    }
    if (row.id) {
      const s = subtasksById.get(row.id);
      if (s) {
        row.target = s;
        if (row.parentIdRaw && row.parentIdRaw !== s.taskId) row.errors.push("子工項不可變更父工項");
      } else if (tasksById.has(row.id)) row.errors.push(`工項ID「${row.id}」是主工項，類型應為「主工項」`);
      else row.errors.push(notFoundReason(row.id, "工項ID"));
    } else if (row.data.title) {
      // 父工項為新增 → 子工項一律新增
      const parent = row.parentRow
        ? (row.parentRow.target as ExistingTask | undefined)
        : row.parentTaskId ? tasksById.get(row.parentTaskId) : undefined;
      if (parent) {
        const key = normalizeKey(row.data.title);
        const matches = parent.subtasks.filter((s) => normalizeKey(s.title) === key);
        if (matches.length === 1) row.target = matches[0];
        else if (matches.length > 1) row.errors.push(`無法判定：父工項下有 ${matches.length} 筆同名子工項「${row.data.title}」，請填入工項ID`);
      }
    }
    resolveAssignee(row, row.target?.assignee);
  }
  markDuplicates(subs, (r) => {
    if (r.target) return `s:${r.target.id}`;
    if (r.id) return `id:${r.id}`;
    if (!r.data.title) return null;
    const parentRef = r.parentRow ? (r.parentRow.target?.id ?? r.parentRow.key) : r.parentTaskId;
    return parentRef ? `n:${parentRef}:${normalizeKey(r.data.title)}` : null;
  });

  // 5. 欄位差異
  const commonSpecs: FieldSpec[] = [
    { field: "title", label: "任務名稱" },
    { field: "groupId", label: "組別", format: (v) => (v ? groupName(v) : "") },
    { field: "assignee", label: "指派人", format: (v) => assigneeDisplay(v) },
  ];
  const taskSpecs: FieldSpec[] = [
    ...commonSpecs,
    { field: "priority", label: "優先級", format: (v) => PRIORITY_LABELS[v] ?? v ?? "" },
    { field: "columnId", label: "狀態", format: (v) => STATUS_LABELS[v] ?? v ?? "" },
    { field: "startDate", label: "開始日期" },
    { field: "endDate", label: "結束日期" },
    { field: "completion", label: "完成度", format: (v) => (v === null || v === undefined || v === "" ? "" : `${v}%`) },
  ];
  const subSpecs = taskSpecs.filter((s) => !["priority", "columnId"].includes(s.field));
  const normDate = (v: string) => { const d = parseDate(v); return d.ok ? d.value : v; };

  const leaderUsers = new Map<string, AssigneeInfo>(ctx.users.map((u) => [u.memberId, { groupId: u.groupId, name: u.name }]));
  const groupNames = new Map(ctx.groups.map((g) => [g.id, g.name]));

  const planRows: PlanRow[] = rows.map((row) => {
    const specs = row.kind === "task" ? taskSpecs : subSpecs;
    let data = row.data;
    const parentTask = row.kind === "subtask"
      ? (row.parentRow ? (row.parentRow.target as ExistingTask | undefined) : row.parentTaskId ? tasksById.get(row.parentTaskId) : undefined)
      : undefined;

    let status: RowStatus;
    let changes: FieldChange[] = [];
    if (row.errors.length > 0) status = "error";
    else if (!row.target) status = "new";
    else {
      // 有子工項的主工項，日期與完成度由子工項推算（畫面上也不可編輯），不比對也不寫入
      if (row.kind === "task" && ((row.target as ExistingTask).subtasks.length > 0 || row.children.length > 0)) {
        const { startDate, endDate, completion, ...rest } = data;
        data = rest;
      }
      const t = row.target as any;
      const old = {
        title: normalizeText(t.title), groupId: t.groupId, assignee: t.assignee,
        priority: t.priority, columnId: t.columnId,
        startDate: normDate(t.startDate), endDate: normDate(t.endDate), completion: t.completion,
      };
      changes = diffFields(specs, old, data);
      status = changes.length > 0 ? "modified" : "unchanged";
    }

    const setsDone = row.kind === "task" && data.columnId === "done"
      && (status === "new" || changes.some((c) => c.field === "columnId"));
    if (setsDone && !perms.canMarkDone) {
      row.errors.push("只有 PM 以上可以將任務標記為「已完成」");
      status = "error";
      changes = [];
    }

    // 組長人力調整規則（與 PUT /api/tasks/:id 一致）：組別與負責人
    let createNewBlockedReason: string | undefined;
    if (perms.leader && status !== "error") {
      const leaderGroupId = perms.leader.groupId;
      const currentGroup = status === "new" ? "" : (row.target?.groupId ?? "");
      const nextGroup = data.groupId ?? currentGroup;
      const current = status === "new" ? "" : (row.target?.assignee ?? "");
      const next = data.assignee ?? current;
      const error = checkLeaderGroupChange(leaderGroupId, groupNames, currentGroup, nextGroup)
        ?? checkLeaderAssignChange(leaderGroupId, leaderUsers, current, next);
      if (error) {
        row.errors.push(error);
        status = "error";
        changes = [];
      } else if (status === "modified") {
        // 另存為新工項 = 以 nextGroup / next 新增一筆，視同從未分組、未指派改過去
        createNewBlockedReason = (checkLeaderGroupChange(leaderGroupId, groupNames, "", nextGroup)
          ?? checkLeaderAssignChange(leaderGroupId, leaderUsers, "", next)) ?? undefined;
      }
    }

    const fields = status === "new"
      ? specs.filter((s) => s.field !== "title" && data[s.field as keyof TaskData] !== undefined && data[s.field as keyof TaskData] !== "")
          .map((s) => ({ label: s.label, value: s.format ? s.format(data[s.field as keyof TaskData]) : String(data[s.field as keyof TaskData]) }))
      : [];

    const baselineTask = row.kind === "task" ? (row.target as ExistingTask | undefined) : parentTask;

    return {
      key: row.key,
      rowNumber: row.rowNumber,
      kind: row.kind,
      status,
      title: row.data.title || (row.target?.title ?? ""),
      targetId: row.target?.id,
      parentKey: row.parentRow?.key,
      parentTaskId: parentTask?.id,
      parentTitle: row.kind === "subtask" ? (row.parentRow?.data.title || parentTask?.title) : undefined,
      data,
      changes,
      errors: row.errors,
      fields,
      baseline: baselineTask?.updatedAt.toISOString(),
      createNewBlockedReason,
    };
  });

  // 6. 系統中存在、但檔案未出現的工項（僅提示）
  const presentTasks = new Set<string>();
  const presentSubs = new Set<string>();
  for (const r of rows) {
    if (r.kind === "task" && r.target) presentTasks.add(r.target.id);
    if (r.kind === "subtask") {
      if (r.target) presentSubs.add(r.target.id);
      if (r.parentTaskId) presentTasks.add(r.parentTaskId);
    }
  }
  const missingInFile: MissingItem[] = [];
  for (const t of ctx.tasks) {
    if (!presentTasks.has(t.id)) {
      missingInFile.push({ kind: "task", id: t.id, title: t.title, subtaskCount: t.subtasks.length });
      continue;
    }
    for (const s of t.subtasks) {
      if (!presentSubs.has(s.id)) missingInFile.push({ kind: "subtask", id: s.id, title: s.title, parentTitle: t.title });
    }
  }

  const summary = { new: 0, modified: 0, unchanged: 0, error: 0 };
  for (const r of planRows) summary[r.status]++;

  return { ...meta, createdAt: new Date().toISOString(), rows: planRows, missingInFile, summary };
}

/** 預覽回應：不列出無變動的列 */
export function toPreviewResponse(plan: ImportPlan, previewToken: string) {
  return {
    previewToken,
    summary: plan.summary,
    rows: plan.rows
      .filter((r) => r.status !== "unchanged")
      .map(({ data, baseline, ...rest }) => rest),
    missingInFile: plan.missingInFile,
  };
}

// ── 正式寫入 ─────────────────────────────────────────────────────────

const ALLOWED: Record<RowStatus, Decision[]> = {
  new: ["import", "skip"],
  modified: ["update", "skip", "create_new"],
  unchanged: ["skip"],
  error: ["skip"],
};
const DEFAULT_DECISION: Record<RowStatus, Decision> = { new: "import", modified: "update", unchanged: "skip", error: "skip" };

export type CommitResult = {
  created: number;
  updated: number;
  skipped: number;
  conflicts: { key: string; rowNumber: number; title: string; reason: string }[];
  notImported: { key: string; rowNumber: number; title: string; reason: string }[];
};

type Tx = Prisma.TransactionClient;

function changeSummary(changes: FieldChange[]): string {
  return changes.map((c) => `${c.fieldLabel}：${c.oldValue} → ${c.newValue}`).join("；");
}

function withCompletedAt(patch: Record<string, any>, prevColumnId: string | null) {
  if (patch.columnId === undefined) return patch;
  if (patch.columnId === "done" && prevColumnId !== "done") return { ...patch, completedAt: new Date() };
  if (patch.columnId !== "done" && prevColumnId === "done") return { ...patch, completedAt: null };
  return patch;
}

export async function commitImportPlan(
  prisma: PrismaClient, plan: ImportPlan, decisionsInput: Record<string, string>, userId: string,
): Promise<CommitResult> {
  const decisionOf = (r: PlanRow): Decision => {
    const d = decisionsInput?.[r.key] as Decision | undefined;
    return d && ALLOWED[r.status].includes(d) ? d : DEFAULT_DECISION[r.status];
  };

  return prisma.$transaction(async (tx: Tx) => {
    const result: CommitResult = { created: 0, updated: 0, skipped: 0, conflicts: [], notImported: [] };
    const active = plan.rows.filter((r) => decisionOf(r) !== "skip");
    result.skipped = plan.rows.filter((r) => (r.status === "new" || r.status === "modified") && decisionOf(r) === "skip").length;

    // 1. 寫入前重新驗證：預覽後被他人修改的工項不覆蓋
    const baselineIds = [...new Set(active.map((r) => (r.kind === "task" ? r.targetId : r.parentTaskId)).filter((x): x is string => !!x))];
    const current = await tx.task.findMany({
      where: { id: { in: baselineIds }, projectId: plan.projectId },
      select: { id: true, updatedAt: true, subtasks: { select: { id: true } } },
    });
    const currentById = new Map(current.map((t) => [t.id, t]));
    const newTitlesSincePreview = new Set(
      (await tx.task.findMany({
        where: { projectId: plan.projectId, createdAt: { gt: new Date(plan.createdAt) } },
        select: { title: true },
      })).map((t) => normalizeKey(t.title)),
    );

    const conflictReason = (r: PlanRow): string | null => {
      const decision = decisionOf(r);
      if (r.kind === "task") {
        if (decision === "import") {
          return newTitlesSincePreview.has(normalizeKey(r.data.title)) ? "預覽後已有他人建立同名工項，請重新預覽" : null;
        }
        const cur = currentById.get(r.targetId!);
        if (!cur) return "預覽後此工項已被刪除";
        if (decision === "update" && cur.updatedAt.toISOString() !== r.baseline) return "預覽後此工項已被他人修改，未覆蓋";
        return null;
      }
      if (!r.parentTaskId) return null; // 父工項為本次新增
      const cur = currentById.get(r.parentTaskId);
      if (!cur) return "預覽後父工項已被刪除";
      if (r.targetId && !cur.subtasks.some((s) => s.id === r.targetId)) return "預覽後此子工項已被刪除";
      if (cur.updatedAt.toISOString() !== r.baseline) return "預覽後父工項已被他人修改，未覆蓋";
      return null;
    };

    const blocked = new Set<string>();
    for (const r of active) {
      if (decisionOf(r) === "create_new" && r.createNewBlockedReason) {
        blocked.add(r.key);
        result.notImported.push({ key: r.key, rowNumber: r.rowNumber, title: r.title, reason: r.createNewBlockedReason });
        continue;
      }
      const reason = conflictReason(r);
      if (reason) {
        blocked.add(r.key);
        result.conflicts.push({ key: r.key, rowNumber: r.rowNumber, title: r.title, reason });
      }
    }

    // 2. 主工項
    const createdTaskIdByKey = new Map<string, string>();
    for (const r of active.filter((x) => x.kind === "task" && !blocked.has(x.key))) {
      const decision = decisionOf(r);
      if (decision === "update") {
        const patch = withCompletedAt(
          Object.fromEntries(r.changes.map((c) => [c.field, r.data[c.field as keyof TaskData]])),
          (await tx.task.findUnique({ where: { id: r.targetId! }, select: { columnId: true } }))?.columnId ?? null,
        );
        // 樂觀鎖：updatedAt 必須與預覽時相同
        const res = await tx.task.updateMany({ where: { id: r.targetId!, updatedAt: new Date(r.baseline!) }, data: patch });
        if (res.count === 0) {
          result.conflicts.push({ key: r.key, rowNumber: r.rowNumber, title: r.title, reason: "預覽後此工項已被他人修改，未覆蓋" });
          continue;
        }
        await tx.activityLog.create({
          data: {
            userId, action: "update", target: "task", targetId: r.targetId, projectId: plan.projectId,
            detail: `${IMPORT_SOURCE_LABEL}：更新工項「${r.title}」— ${changeSummary(r.changes)}`,
          },
        });
        result.updated++;
        continue;
      }

      // import / create_new
      const base = decision === "create_new"
        ? await tx.task.findUnique({ where: { id: r.targetId! } })
        : null;
      const columnId = r.data.columnId ?? base?.columnId ?? "todo";
      const task = await tx.task.create({
        data: {
          title: r.data.title!,
          description: base?.description ?? "",
          priority: r.data.priority ?? base?.priority ?? "medium",
          columnId,
          groupId: r.data.groupId ?? base?.groupId ?? "",
          assignee: r.data.assignee ?? base?.assignee ?? "",
          startDate: r.data.startDate ?? base?.startDate ?? "",
          endDate: r.data.endDate ?? base?.endDate ?? "",
          completion: r.data.completion ?? base?.completion ?? 0,
          timeLogs: [],
          completedAt: columnId === "done" ? new Date() : null,
          projectId: plan.projectId,
        },
      });
      createdTaskIdByKey.set(r.key, task.id);
      await tx.activityLog.create({
        data: {
          userId, action: "create", target: "task", targetId: task.id, projectId: plan.projectId,
          detail: `${IMPORT_SOURCE_LABEL}：新增工項「${task.title}」${decision === "create_new" ? "（另存為新工項）" : ""}`,
        },
      });
      result.created++;
    }

    // 3. 子工項
    for (const r of active.filter((x) => x.kind === "subtask" && !blocked.has(x.key))) {
      const decision = decisionOf(r);
      const parentId = r.parentTaskId ?? (r.parentKey ? createdTaskIdByKey.get(r.parentKey) : undefined);
      if (!parentId) {
        result.notImported.push({ key: r.key, rowNumber: r.rowNumber, title: r.title, reason: "父工項未匯入，子工項一併略過" });
        continue;
      }
      const label = `${r.parentTitle ? `${r.parentTitle} › ` : ""}${r.title}`;

      if (decision === "update") {
        const patch = Object.fromEntries(r.changes.map((c) => [c.field, r.data[c.field as keyof TaskData]]));
        await tx.subTask.update({ where: { id: r.targetId! }, data: patch });
        await tx.activityLog.create({
          data: {
            userId, action: "update", target: "task", targetId: parentId, projectId: plan.projectId,
            detail: `${IMPORT_SOURCE_LABEL}：更新子工項「${label}」— ${changeSummary(r.changes)}`,
          },
        });
        result.updated++;
        continue;
      }

      const base = decision === "create_new" ? await tx.subTask.findUnique({ where: { id: r.targetId! } }) : null;
      await tx.subTask.create({
        data: {
          title: r.data.title!,
          description: base?.description ?? "",
          groupId: r.data.groupId ?? base?.groupId ?? "",
          assignee: r.data.assignee ?? base?.assignee ?? "",
          startDate: r.data.startDate ?? base?.startDate ?? "",
          endDate: r.data.endDate ?? base?.endDate ?? "",
          completion: r.data.completion ?? base?.completion ?? 0,
          timeLogs: [],
          taskId: parentId,
        },
      });
      await tx.activityLog.create({
        data: {
          userId, action: "create", target: "task", targetId: parentId, projectId: plan.projectId,
          detail: `${IMPORT_SOURCE_LABEL}：新增子工項「${label}」${decision === "create_new" ? "（另存為新工項）" : ""}`,
        },
      });
      result.created++;
    }

    return result;
  }, { timeout: 60_000, maxWait: 10_000 });
}
