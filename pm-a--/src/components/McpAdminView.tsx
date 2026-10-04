import { useEffect, useState } from "react";
import { getAdminUsers, getMcpAuditLogs, getMcpSettings, updateMcpSettings } from "../api";
import { formatDateTime } from "../helpers";

const TOOLS = [
  "list_projects", "get_project_summary", "list_tasks", "get_task", "list_overdue_tasks", "list_risks",
  "list_meetings", "get_meeting", "get_weekly_report_data", "list_okrs", "search", "get_activity_log",
];
const PAGE_SIZE = 50;

type AuditRow = {
  id: string; tool: string; success: boolean; errorCode: string | null; resultCount: number | null;
  durationMs: number; createdAt: string; params: unknown;
  user: { name: string; memberId: string } | null; clientName: string | null;
};

const input: React.CSSProperties = {
  background: "#0f172a", color: "#e2e8f0", border: "1px solid #ffffff20",
  borderRadius: 6, padding: "6px 8px", fontSize: 12, colorScheme: "dark",
};

/** 系統管理 → AI 連線（MCP）：系統開關與稽核紀錄（僅 Admin） */
export default function McpAdminView() {
  const [enabled, setEnabled] = useState<boolean | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  const [users, setUsers] = useState<{ id: string; name: string; memberId: string }[]>([]);
  const [filters, setFilters] = useState({ userId: "", tool: "", from: "", to: "" });
  const [offset, setOffset] = useState(0);
  const [logs, setLogs] = useState<{ total: number; items: AuditRow[] }>({ total: 0, items: [] });

  useEffect(() => {
    getMcpSettings().then((s) => setEnabled(s.mcpEnabled)).catch((e: Error) => setError(e.message));
    getAdminUsers().then(setUsers).catch(() => {});
  }, []);

  useEffect(() => {
    getMcpAuditLogs({ ...filters, limit: PAGE_SIZE, offset })
      .then(setLogs)
      .catch((e: Error) => setError(e.message));
  }, [filters, offset]);

  const save = async (value: boolean) => {
    setSaving(true);
    try {
      const s = await updateMcpSettings(value);
      setEnabled(s.mcpEnabled);
      setError("");
    } catch (e) {
      setError((e as Error).message);
    }
    setSaving(false);
    setConfirming(false);
  };

  const setFilter = (k: keyof typeof filters, v: string) => { setOffset(0); setFilters((f) => ({ ...f, [k]: v })); };

  return (
    <div style={{ padding: "0 40px 40px", maxWidth: 960 }}>
      <h3 style={{ color: "#f1f5f9", fontSize: 18, fontWeight: 700, marginBottom: 16 }}>AI 連線（MCP）</h3>
      {error && <p style={{ fontSize: 13, color: "#f87171", marginBottom: 12 }}>{error}</p>}

      {/* 系統開關 */}
      <div style={{ background: "#1e293b", borderRadius: 12, padding: "20px 24px", border: "1px solid #ffffff10", marginBottom: 24, display: "flex", alignItems: "center", gap: 16 }}>
        <div style={{ flex: 1 }}>
          <p style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0", marginBottom: 4 }}>
            允許 AI 服務連線
            <span style={{ fontSize: 12, padding: "2px 8px", borderRadius: 99, background: enabled ? "#10b98122" : "#64748b22", color: enabled ? "#10b981" : "#94a3b8" }}>
              {enabled === null ? "載入中" : enabled ? "已開啟" : "已關閉"}
            </span>
          </p>
          <p style={{ fontSize: 12, color: "#64748b", lineHeight: 1.6 }}>
            開啟後，使用者可以授權 claude.ai 等 AI 服務以本人身分唯讀 PM Dashboard 資料。關閉時，所有 AI 連線立即無法存取資料。
          </p>
        </div>
        {enabled !== null && (
          <button disabled={saving} onClick={() => (enabled ? save(false) : setConfirming(true))} style={{
            background: enabled ? "#ef444418" : "#6366f1", border: enabled ? "1px solid #ef444444" : "none",
            color: enabled ? "#ef4444" : "#fff", borderRadius: 8, padding: "8px 18px", fontSize: 13, fontWeight: 600, cursor: "pointer",
          }}>{enabled ? "關閉" : "開啟"}</button>
        )}
      </div>

      {confirming && (
        <div style={{ position: "fixed", inset: 0, background: "#000a", display: "flex", alignItems: "center", justifyContent: "center", zIndex: 1000, padding: 16 }}>
          <div style={{ background: "#161b27", borderRadius: 14, padding: 24, maxWidth: 440, border: "1px solid #ffffff15" }}>
            <p style={{ fontSize: 16, fontWeight: 700, color: "#f1f5f9", marginBottom: 12 }}>確定開啟 AI 連線？</p>
            <p style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.7, marginBottom: 20 }}>
              開啟後，使用者授權的資料（任務、會議、風險、週報等）將傳送至第三方 AI 服務（例如 Anthropic 的 claude.ai）。
              資料範圍依各使用者的專案角色而定，且僅能讀取。每次存取都會留下稽核紀錄，可隨時關閉。
            </p>
            <div style={{ display: "flex", gap: 10, justifyContent: "flex-end" }}>
              <button onClick={() => setConfirming(false)} style={{ background: "transparent", border: "1px solid #ffffff20", color: "#94a3b8", borderRadius: 8, padding: "8px 16px", fontSize: 13, cursor: "pointer" }}>取消</button>
              <button disabled={saving} onClick={() => save(true)} style={{ background: "#6366f1", border: "none", color: "#fff", borderRadius: 8, padding: "8px 16px", fontSize: 13, fontWeight: 600, cursor: "pointer" }}>確定開啟</button>
            </div>
          </div>
        </div>
      )}

      {/* 稽核紀錄 */}
      <p style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0", marginBottom: 12 }}>稽核紀錄（共 {logs.total} 筆）</p>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
        <select value={filters.userId} onChange={(e) => setFilter("userId", e.target.value)} style={input}>
          <option value="">全部使用者</option>
          {users.map((u) => <option key={u.id} value={u.id}>{u.name}（{u.memberId}）</option>)}
        </select>
        <select value={filters.tool} onChange={(e) => setFilter("tool", e.target.value)} style={input}>
          <option value="">全部工具</option>
          {TOOLS.map((t) => <option key={t} value={t}>{t}</option>)}
        </select>
        <input type="date" value={filters.from} onChange={(e) => setFilter("from", e.target.value)} style={input} />
        <span style={{ color: "#64748b", alignSelf: "center" }}>～</span>
        <input type="date" value={filters.to} onChange={(e) => setFilter("to", e.target.value)} style={input} />
      </div>

      <div style={{ background: "#1e293b", borderRadius: 12, overflow: "hidden", border: "1px solid #ffffff10" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#0f172a" }}>
              {["時間", "使用者", "AI 服務", "工具", "結果", "筆數", "耗時"].map((h) => (
                <th key={h} style={{ padding: "10px 12px", textAlign: "left", fontSize: 12, color: "#64748b", fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {logs.items.length === 0 ? (
              <tr><td colSpan={7} style={{ padding: 24, textAlign: "center", color: "#64748b", fontSize: 13 }}>沒有符合條件的紀錄</td></tr>
            ) : logs.items.map((r, i) => (
              <tr key={r.id} title={JSON.stringify(r.params)} style={{ borderTop: i > 0 ? "1px solid #ffffff08" : undefined }}>
                <td style={{ padding: "10px 12px", color: "#94a3b8", fontSize: 12, whiteSpace: "nowrap" }}>{formatDateTime(r.createdAt)}</td>
                <td style={{ padding: "10px 12px", color: "#e2e8f0", fontSize: 13 }}>{r.user ? `${r.user.name}（${r.user.memberId}）` : "（已刪除的使用者）"}</td>
                <td style={{ padding: "10px 12px", color: "#94a3b8", fontSize: 12 }}>{r.clientName || "—"}</td>
                <td style={{ padding: "10px 12px", color: "#94a3b8", fontSize: 12, fontFamily: "monospace" }}>{r.tool}</td>
                <td style={{ padding: "10px 12px", fontSize: 12 }}>
                  {r.success
                    ? <span style={{ color: "#10b981" }}>成功</span>
                    : <span style={{ color: "#ef4444" }}>失敗（{r.errorCode}）</span>}
                </td>
                <td style={{ padding: "10px 12px", color: "#94a3b8", fontSize: 12 }}>{r.resultCount ?? "—"}</td>
                <td style={{ padding: "10px 12px", color: "#94a3b8", fontSize: 12 }}>{r.durationMs} ms</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {logs.total > PAGE_SIZE && (
        <div style={{ display: "flex", gap: 8, justifyContent: "flex-end", alignItems: "center", marginTop: 12, fontSize: 12, color: "#64748b" }}>
          <span>{offset + 1}–{Math.min(offset + PAGE_SIZE, logs.total)} / {logs.total}</span>
          <button disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - PAGE_SIZE))} style={{ ...input, cursor: "pointer", opacity: offset === 0 ? 0.4 : 1 }}>上一頁</button>
          <button disabled={offset + PAGE_SIZE >= logs.total} onClick={() => setOffset(offset + PAGE_SIZE)} style={{ ...input, cursor: "pointer", opacity: offset + PAGE_SIZE >= logs.total ? 0.4 : 1 }}>下一頁</button>
        </div>
      )}
    </div>
  );
}
