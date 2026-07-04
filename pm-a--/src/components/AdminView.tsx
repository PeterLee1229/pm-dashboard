import { useState, useEffect } from "react";
import { getAdminUsers, updateAdminUser, toggleUserActive } from "../api";
import { ListSkeleton, Skeleton, useDelayedLoading } from "./LoadingEmpty";

export default function AdminView({ currentUser }: { currentUser: any }) {
  const [users, setUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState<string | null>(null);

  useEffect(() => {
    getAdminUsers()
      .then(setUsers)
      .catch(() => {})
      .finally(() => setLoading(false));
  }, []);

  const handleRoleChange = async (userId: string, newRole: string) => {
    setSaving(userId);
    try {
      await updateAdminUser(userId, { role: newRole });
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, role: newRole } : u));
    } catch {}
    setSaving(null);
  };

  const handleToggleActive = async (userId: string) => {
    setSaving(userId);
    try {
      const result = await toggleUserActive(userId);
      setUsers((prev) => prev.map((u) => u.id === userId ? { ...u, isActive: result.isActive } : u));
    } catch {}
    setSaving(null);
  };

  const adminCount    = users.filter((u) => u.role === "admin").length;
  const activeCount   = users.filter((u) => u._count?.projectMemberships > 0).length;
  const disabledCount = users.filter((u) => u.isActive === false).length;

  const showSkeleton = useDelayedLoading(loading);
  if (loading) {
    if (!showSkeleton) return null;
    return (
      <div className="admin-page" style={{ padding: "32px 40px", maxWidth: 960 }}>
        <Skeleton width={140} height={22} style={{ marginBottom: 24 }} />
        <div className="admin-stats" style={{ display: "flex", gap: 16, marginBottom: 32 }}>
          {[0, 1, 2, 3].map((i) => (
            <div key={i} style={{ flex: 1, background: "#1e293b", borderRadius: 12, padding: "20px 24px", border: "1px solid #ffffff10" }}>
              <Skeleton width={40} height={28} style={{ marginBottom: 8 }} />
              <Skeleton width={60} height={13} />
            </div>
          ))}
        </div>
        <ListSkeleton rows={4} />
      </div>
    );
  }

  return (
    <div className="admin-page" style={{ padding: "32px 40px", maxWidth: 960 }}>
      <h2 style={{ color: "#f1f5f9", fontSize: 22, fontWeight: 700, marginBottom: 24 }}>系統管理</h2>

      {/* 統計卡片 */}
      <div className="admin-stats" style={{ display: "flex", gap: 16, marginBottom: 32 }}>
        {[
          { label: "總使用者",   value: users.length,  color: "#6366f1" },
          { label: "管理員",     value: adminCount,    color: "#ef4444" },
          { label: "有專案成員", value: activeCount,   color: "#10b981" },
          { label: "已停用",     value: disabledCount, color: "#f59e0b" },
        ].map((s) => (
          <div key={s.label} style={{
            flex: 1, background: "#1e293b", borderRadius: 12, padding: "20px 24px",
            border: `1px solid ${s.color}44`
          }}>
            <div style={{ fontSize: 28, fontWeight: 700, color: s.color }}>{s.value}</div>
            <div style={{ fontSize: 13, color: "#64748b", marginTop: 4 }}>{s.label}</div>
          </div>
        ))}
      </div>

      {/* 使用者表格 */}
      <div className="admin-table-wrap" style={{ background: "#1e293b", borderRadius: 12, overflow: "hidden", border: "1px solid #ffffff10" }}>
        <table style={{ width: "100%", borderCollapse: "collapse" }}>
          <thead>
            <tr style={{ background: "#0f172a" }}>
              {["姓名", "員工編號", "Email", "系統角色", "所屬專案數", "操作"].map((h) => (
                <th key={h} style={{ padding: "12px 16px", textAlign: "left", fontSize: 12, color: "#64748b", fontWeight: 600 }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {users.map((u, i) => {
              const isDisabled = u.isActive === false;
              return (
                <tr key={u.id} style={{
                  borderTop: i > 0 ? "1px solid #ffffff08" : undefined,
                  background: isDisabled ? "#ef444408" : "transparent",
                  opacity: isDisabled ? 0.7 : 1,
                }}>
                  <td style={{ padding: "12px 16px", color: "#e2e8f0", fontSize: 14 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                      {u.name}
                      {isDisabled && (
                        <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 99, background: "#f59e0b22", color: "#f59e0b", border: "1px solid #f59e0b44" }}>已停用</span>
                      )}
                    </div>
                  </td>
                  <td style={{ padding: "12px 16px", color: "#94a3b8", fontSize: 13 }}>{u.memberId || "—"}</td>
                  <td style={{ padding: "12px 16px", color: "#94a3b8", fontSize: 13 }}>{u.email}</td>
                  <td style={{ padding: "12px 16px" }}>
                    {u.id === currentUser?.id ? (
                      <span style={{ fontSize: 12, color: "#ef4444", fontWeight: 600, background: "#ef444422", padding: "3px 8px", borderRadius: 6 }}>
                        {u.role === "admin" ? "管理員" : "一般使用者"}（本人）
                      </span>
                    ) : (
                      <select
                        value={u.role}
                        disabled={saving === u.id || isDisabled}
                        onChange={(e) => handleRoleChange(u.id, e.target.value)}
                        style={{
                          background: "#0f172a", color: "#e2e8f0", border: "1px solid #ffffff20",
                          borderRadius: 6, padding: "4px 8px", fontSize: 12, cursor: "pointer"
                        }}
                      >
                        <option value="user">一般使用者</option>
                        <option value="admin">管理員</option>
                      </select>
                    )}
                  </td>
                  <td style={{ padding: "12px 16px", color: "#94a3b8", fontSize: 13 }}>
                    {u._count?.projectMemberships ?? 0}
                  </td>
                  <td style={{ padding: "12px 16px" }}>
                    {u.id !== currentUser?.id && (
                      <button
                        disabled={saving === u.id}
                        onClick={() => handleToggleActive(u.id)}
                        title={isDisabled ? "重新啟用此帳號（可逆）" : "停用此帳號（可隨時重新啟用）"}
                        style={{
                          background: isDisabled ? "#10b98118" : "#f59e0b18",
                          border: `1px solid ${isDisabled ? "#10b98144" : "#f59e0b44"}`,
                          borderRadius: 6, color: isDisabled ? "#10b981" : "#f59e0b",
                          fontSize: 11, padding: "4px 10px", cursor: "pointer",
                          opacity: saving === u.id ? 0.5 : 1,
                        }}
                      >
                        {isDisabled ? "啟用" : "停用"}
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── App ──────────────────────────────────────────────────────────────
