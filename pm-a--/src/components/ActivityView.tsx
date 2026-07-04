import { useState, useEffect } from "react";
import { getActivities } from "../api";
import { EmptyState, ListSkeleton, Skeleton, useDelayedLoading } from "./LoadingEmpty";

export default function ActivityView({ projectId }: { projectId: string }) {
  const [activities, setActivities] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState("all");

  useEffect(() => {
    loadActivities();
  }, [projectId]);

  const loadActivities = async () => {
    try {
      setLoading(true);
      const data = await getActivities(projectId);
      setActivities(data);
    } catch (err) {
      console.error("載入活動紀錄失敗:", err);
    } finally {
      setLoading(false);
    }
  };

  const ACTION_CONFIG: Record<string, { icon: string; color: string; label: string }> = {
    create: { icon: "➕", color: "#10b981", label: "建立" },
    update: { icon: "✏️", color: "#6366f1", label: "更新" },
    delete: { icon: "🗑️", color: "#ef4444", label: "刪除" },
    move:   { icon: "🔄", color: "#f59e0b", label: "移動" },
    invite: { icon: "👋", color: "#8b5cf6", label: "邀請" },
    remove: { icon: "🚫", color: "#ef4444", label: "移除" },
    comment: { icon: "💬", color: "#06b6d4", label: "評論" },
  };

  const TARGET_LABELS: Record<string, string> = {
    project: "專案",
    task: "任務",
    risk: "風險",
    meeting: "會議",
    meeting_series: "會議系列",
    meeting_record: "會議紀錄",
    member: "成員",
    comment: "評論",
  };

  const filteredActivities = filter === "all"
    ? activities
    : activities.filter(a => a.target === filter);

  const groupedByDate: Record<string, any[]> = {};
  filteredActivities.forEach(a => {
    const date = new Date(a.createdAt).toLocaleDateString("zh-TW");
    if (!groupedByDate[date]) groupedByDate[date] = [];
    groupedByDate[date].push(a);
  });

  const showSkeleton = useDelayedLoading(loading);
  if (loading) {
    if (!showSkeleton) return null;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
        <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} width={64} height={28} radius={8} />
          ))}
        </div>
        <div className="stats-grid-3" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
          {[0, 1, 2].map((i) => (
            <div key={i} style={{ background: "#161b27", borderRadius: 10, padding: "14px 18px", border: "1px solid #ffffff08" }}>
              <Skeleton width="50%" height={11} style={{ marginBottom: 8 }} />
              <Skeleton width="30%" height={22} />
            </div>
          ))}
        </div>
        <ListSkeleton rows={6} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* 篩選 */}
      <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
        {[
          { id: "all", label: "全部" },
          { id: "task", label: "任務" },
          { id: "risk", label: "風險" },
          { id: "meeting_series", label: "會議" },
          { id: "member", label: "成員" },
          { id: "comment", label: "評論" },
        ].map(f => (
          <button key={f.id} onClick={() => setFilter(f.id)} style={{
            background: filter === f.id ? "#6366f122" : "transparent",
            border: `1px solid ${filter === f.id ? "#6366f1" : "#ffffff15"}`,
            color: filter === f.id ? "#6366f1" : "#64748b",
            borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer"
          }}>{f.label}</button>
        ))}
      </div>

      {/* 統計 */}
      <div className="stats-grid-3" style={{ display: "grid", gridTemplateColumns: "repeat(3, 1fr)", gap: 12 }}>
        <div style={{ background: "#161b27", borderRadius: 10, padding: "14px 18px", border: "1px solid #10b98122" }}>
          <p style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>今日活動</p>
          <p style={{ fontSize: 24, fontWeight: 700, color: "#10b981" }}>
            {activities.filter(a => new Date(a.createdAt).toDateString() === new Date().toDateString()).length}
          </p>
        </div>
        <div style={{ background: "#161b27", borderRadius: 10, padding: "14px 18px", border: "1px solid #6366f122" }}>
          <p style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>本週活動</p>
          <p style={{ fontSize: 24, fontWeight: 700, color: "#6366f1" }}>
            {activities.filter(a => {
              const d = new Date(a.createdAt);
              const now = new Date();
              const weekAgo = new Date(now.getTime() - 7 * 86400000);
              return d >= weekAgo;
            }).length}
          </p>
        </div>
        <div style={{ background: "#161b27", borderRadius: 10, padding: "14px 18px", border: "1px solid #f59e0b22" }}>
          <p style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>總活動數</p>
          <p style={{ fontSize: 24, fontWeight: 700, color: "#f59e0b" }}>{activities.length}</p>
        </div>
      </div>

      {/* 時間線 */}
      <div style={{ background: "#161b27", borderRadius: 12, border: "1px solid #ffffff08", overflow: "hidden" }}>
        {Object.keys(groupedByDate).length === 0 ? (
          <EmptyState icon="🕒" title="目前無活動紀錄" />
        ) : Object.entries(groupedByDate).map(([date, acts]) => (
          <div key={date}>
            <div style={{
              padding: "10px 20px", background: "#1a2030",
              borderBottom: "1px solid #ffffff08",
              fontSize: 12, fontWeight: 600, color: "#94a3b8"
            }}>{date}</div>

            {acts.map((a: any) => {
              const actionCfg = ACTION_CONFIG[a.action] || { icon: "📌", color: "#64748b", label: a.action };
              return (
                <div key={a.id} style={{
                  display: "flex", gap: 12, padding: "12px 20px",
                  borderBottom: "1px solid #ffffff06", alignItems: "flex-start"
                }}>
                  <div style={{
                    width: 28, height: 28, borderRadius: 99, flexShrink: 0,
                    background: actionCfg.color + "18",
                    display: "flex", alignItems: "center", justifyContent: "center",
                    fontSize: 13
                  }}>{actionCfg.icon}</div>

                  <div style={{ flex: 1 }}>
                    <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 3 }}>
                      <span style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0" }}>{a.user?.name || "系統"}</span>
                      <span style={{
                        fontSize: 10, padding: "1px 6px", borderRadius: 99,
                        background: actionCfg.color + "18", color: actionCfg.color
                      }}>{actionCfg.label}{TARGET_LABELS[a.target] || a.target}</span>
                    </div>
                    <p style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.5 }}>{a.detail}</p>
                  </div>

                  <span style={{ fontSize: 10, color: "#475569", flexShrink: 0, marginTop: 2 }}>
                    {new Date(a.createdAt).toLocaleTimeString("zh-TW", { hour: "2-digit", minute: "2-digit" })}
                  </span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

// ── Sidebar ──────────────────────────────────────────────────────────
