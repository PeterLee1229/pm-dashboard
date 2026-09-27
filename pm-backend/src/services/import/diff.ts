// ── 共用匯入比對模組 ────────────────────────────────────────────────────
// 正規化、欄位差異、檔案內重複偵測、預覽暫存。
// 與資料表無關，後續 OKR / 風險 / 會議等匯入可直接沿用。

import { randomUUID } from "crypto";

/** ok=false 時 error 為原因、value 無意義 */
export type ParseResult<T> = { ok: boolean; value?: T; error?: string };

export type FieldChange = {
  field: string;
  fieldLabel: string;
  oldValue: string;
  newValue: string;
};

// ── 正規化 ───────────────────────────────────────────────────────────

/** 去頭尾空白、全形/不斷行空白轉半形、連續空白合併；null/undefined 視為空字串 */
export function normalizeText(v: unknown): string {
  if (v === null || v === undefined) return "";
  return String(v).replace(/[　 ﻿]/g, " ").replace(/\s+/g, " ").trim();
}

/** 自然鍵比對用：正規化後再忽略大小寫 */
export function normalizeKey(v: unknown): string {
  return normalizeText(v).toLowerCase();
}

export function isBlank(v: unknown): boolean {
  return normalizeText(v) === "";
}

/**
 * 日期統一轉 YYYY-MM-DD。
 * 接受：2026-06-01、2026/6/1、2026.6.1、2026年6月1日、20260601、
 *       民國年 115/6/1、115-06-01、民國115年6月1日（2~3 位數年份視為民國年）
 */
export function parseDate(v: unknown): ParseResult<string> {
  const s = normalizeText(v).replace(/T.*$/, "");
  if (!s) return { ok: true, value: "" };

  let m = s.match(/^(民國)?\s*(\d{2,4})\s*[-/.年]\s*(\d{1,2})\s*[-/.月]\s*(\d{1,2})\s*日?$/);
  if (!m) {
    const compact = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (compact) m = [s, "", compact[1], compact[2], compact[3]] as unknown as RegExpMatchArray;
  }
  if (!m) return { ok: false, error: `日期格式無法辨識「${s}」` };

  let year = parseInt(m[2], 10);
  if (m[1] || m[2].length <= 3) year += 1911;
  const month = parseInt(m[3], 10);
  const day = parseInt(m[4], 10);

  const d = new Date(Date.UTC(year, month - 1, day));
  if (d.getUTCFullYear() !== year || d.getUTCMonth() !== month - 1 || d.getUTCDate() !== day) {
    return { ok: false, error: `日期不存在「${s}」` };
  }
  return { ok: true, value: `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}` };
}

/** 數值：去除 %、千分位後轉數字；空白回傳 null。`50` 與 `50.0` 相同 */
export function parseNumber(v: unknown): ParseResult<number | null> {
  const s = normalizeText(v).replace(/[%％,]/g, "").trim();
  if (!s) return { ok: true, value: null };
  const n = Number(s);
  if (!Number.isFinite(n)) return { ok: false, error: `不是有效的數字「${normalizeText(v)}」` };
  return { ok: true, value: n };
}

/**
 * 列舉欄位：接受中文顯示值或內部代碼，統一轉內部代碼。
 * aliases: { 內部代碼: [可接受的寫法...] }，比對時忽略大小寫與空白。
 */
export function parseEnum(v: unknown, aliases: Record<string, string[]>, fieldLabel: string): ParseResult<string | null> {
  const key = normalizeKey(v).replace(/\s/g, "");
  if (!key) return { ok: true, value: null };
  for (const [code, names] of Object.entries(aliases)) {
    if (key === code.toLowerCase() || names.some((n) => n.toLowerCase().replace(/\s/g, "") === key)) {
      return { ok: true, value: code };
    }
  }
  return { ok: false, error: `${fieldLabel}無法辨識「${normalizeText(v)}」` };
}

// ── 欄位差異 ─────────────────────────────────────────────────────────

export type FieldSpec = {
  field: string;
  label: string;
  /** 顯示用格式（例如 id → 名稱）；未提供時直接轉字串 */
  format?: (v: any) => string;
};

export const EMPTY_DISPLAY = "（空白）";

function sameValue(a: unknown, b: unknown): boolean {
  const na = a === null || a === undefined ? "" : a;
  const nb = b === null || b === undefined ? "" : b;
  if (typeof na === "number" || typeof nb === "number") {
    if (na === "" || nb === "") return na === nb;
    return Number(na) === Number(nb);
  }
  return String(na) === String(nb);
}

/**
 * 比對已正規化的新舊值。newValues 中為 undefined 的欄位代表「檔案未提供」，不列入比對。
 */
export function diffFields(specs: FieldSpec[], oldValues: Record<string, any>, newValues: Record<string, any>): FieldChange[] {
  const changes: FieldChange[] = [];
  for (const spec of specs) {
    if (newValues[spec.field] === undefined) continue;
    const oldV = oldValues[spec.field];
    const newV = newValues[spec.field];
    if (sameValue(oldV, newV)) continue;
    const fmt = (v: any) => {
      const s = spec.format ? spec.format(v) : v === null || v === undefined ? "" : String(v);
      return s === "" ? EMPTY_DISPLAY : s;
    };
    changes.push({ field: spec.field, fieldLabel: spec.label, oldValue: fmt(oldV), newValue: fmt(newV) });
  }
  return changes;
}

// ── 檔案內重複 ───────────────────────────────────────────────────────

/** 回傳 key 重複的索引 → 同 key 的其他索引；key 為 null 者不參與 */
export function findDuplicates(keys: (string | null)[]): Map<number, number[]> {
  const byKey = new Map<string, number[]>();
  keys.forEach((k, i) => {
    if (k === null) return;
    if (!byKey.has(k)) byKey.set(k, []);
    byKey.get(k)!.push(i);
  });
  const result = new Map<number, number[]>();
  for (const idxs of byKey.values()) {
    if (idxs.length < 2) continue;
    for (const i of idxs) result.set(i, idxs.filter((j) => j !== i));
  }
  return result;
}

// ── 表頭對應 ─────────────────────────────────────────────────────────

/** 表頭正規化：去 BOM/空白、去掉括號註解（如「工項ID（新增時留空）」）、忽略大小寫 */
export function canonicalHeader(h: string): string {
  return normalizeKey(h).replace(/[（(].*?[）)]/g, "").replace(/\s/g, "");
}

/** aliases: { 欄位代碼: [可接受的表頭...] } → 回傳 正規化表頭 → 欄位代碼 的對照 */
export function buildHeaderMap(aliases: Record<string, string[]>): Map<string, string> {
  const map = new Map<string, string>();
  for (const [field, names] of Object.entries(aliases)) {
    map.set(canonicalHeader(field), field);
    for (const n of names) map.set(canonicalHeader(n), field);
  }
  return map;
}

// ── 預覽暫存 ─────────────────────────────────────────────────────────

/**
 * 預覽結果暫存於記憶體，以 token 取回供正式匯入使用。
 * 伺服器重啟或逾時後 token 失效，使用者需重新上傳預覽。
 */
export class PreviewStore<T> {
  private entries = new Map<string, { data: T; expiresAt: number }>();

  constructor(private ttlMs: number) {}

  put(data: T): string {
    this.sweep();
    const token = randomUUID();
    this.entries.set(token, { data, expiresAt: Date.now() + this.ttlMs });
    return token;
  }

  get(token: string): T | null {
    const entry = this.entries.get(token);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.entries.delete(token);
      return null;
    }
    return entry.data;
  }

  delete(token: string) {
    this.entries.delete(token);
  }

  private sweep() {
    const now = Date.now();
    for (const [k, v] of this.entries) if (v.expiresAt < now) this.entries.delete(k);
  }
}
