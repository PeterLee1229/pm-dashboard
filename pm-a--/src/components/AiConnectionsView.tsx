import { useEffect, useState } from "react";
import { getAiConnections, revokeAiConnection } from "../api";
import { formatDateTime } from "../helpers";
import { ListSkeleton, useDelayedLoading } from "./LoadingEmpty";

type Connection = { id: string; clientName: string; scope: string; grantedAt: string; lastUsedAt: string | null };

/** 個人設定 → 已授權的 AI 連線：列出目前有效的授權，可逐筆撤銷 */
export default function AiConnectionsView() {
  const [items, setItems] = useState<Connection[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [confirmId, setConfirmId] = useState<string | null>(null);

  useEffect(() => {
    getAiConnections()
      .then((data) => { setItems(data); setError(""); })
      .catch((err: Error) => setError(err.message))
      .finally(() => setLoading(false));
  }, []);

  const revoke = async (id: string) => {
    try {
      await revokeAiConnection(id);
      setItems((prev) => prev.filter((c) => c.id !== id));
    } catch (err) {
      setError((err as Error).message);
    }
    setConfirmId(null);
  };

  const showSkeleton = useDelayedLoading(loading);

  return (
    <div className="ai-page" style={{ padding: "32px 40px", maxWidth: 860 }}>
      <h2 style={{ color: "#f1f5f9", fontSize: 22, fontWeight: 700, marginBottom: 8 }}>已授權的 AI 連線</h2>
      <p style={{ fontSize: 13, color: "#64748b", marginBottom: 24, lineHeight: 1.6 }}>
        這些 AI 服務可以用你的身分「唯讀」PM Dashboard 資料，範圍與你在網頁上看到的相同。撤銷後，該服務需要重新授權才能再讀取。
      </p>

      {error && <p style={{ fontSize: 13, color: "#f87171", marginBottom: 16 }}>{error}</p>}

      {loading ? (showSkeleton ? <ListSkeleton rows={2} /> : null) : items.length === 0 ? (
        <div style={{ background: "#1e293b", borderRadius: 12, padding: 32, textAlign: "center", color: "#64748b", fontSize: 13, border: "1px solid #ffffff10" }}>
          目前沒有已授權的 AI 連線
        </div>
      ) : (
        <div className="admin-table-wrap" style={{ background: "#1e293b", borderRadius: 12, overflow: "hidden", border: "1px solid #ffffff10" }}>
          <table style={{ width: "100%", borderCollapse: "collapse" }}>
            <thead>
              <tr style={{ background: "#0f172a" }}>
                {["AI 服務", "權限", "授權時間", "最後使用時間", ""].map((h) => (
                  <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, color: "#64748b", fontWeight: 600 }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {items.map((c, i) => (
                <tr key={c.id} style={{ borderTop: i > 0 ? "1px solid #ffffff08" : undefined }}>
                  <td style={{ padding: "12px 16px", color: "#e2e8f0", fontSize: 14 }}>{c.clientName}</td>
                  <td style={{ padding: "12px 16px", color: "#94a3b8", fontSize: 13 }}>{c.scope === "pm:read" ? "唯讀" : c.scope}</td>
                  <td style={{ padding: "12px 16px", color: "#94a3b8", fontSize: 13 }}>{formatDateTime(c.grantedAt)}</td>
                  <td style={{ padding: "12px 16px", color: "#94a3b8", fontSize: 13 }}>{formatDateTime(c.lastUsedAt)}</td>
                  <td style={{ padding: "12px 16px", textAlign: "right" }}>
                    {confirmId === c.id ? (
                      <span style={{ display: "inline-flex", gap: 6 }}>
                        <button onClick={() => revoke(c.id)} style={{ background: "#ef4444", border: "none", borderRadius: 6, color: "#fff", fontSize: 11, padding: "4px 10px", cursor: "pointer" }}>確定撤銷</button>
                        <button onClick={() => setConfirmId(null)} style={{ background: "transparent", border: "1px solid #ffffff20", borderRadius: 6, color: "#94a3b8", fontSize: 11, padding: "4px 10px", cursor: "pointer" }}>取消</button>
                      </span>
                    ) : (
                      <button onClick={() => setConfirmId(c.id)} style={{ background: "#ef444418", border: "1px solid #ef444444", borderRadius: 6, color: "#ef4444", fontSize: 11, padding: "4px 10px", cursor: "pointer" }}>撤銷</button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
