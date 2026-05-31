import { useState } from "react";
import { X } from "lucide-react";
import { BarChart, Bar, XAxis, YAxis, Tooltip, PieChart, Pie, Cell, ResponsiveContainer } from "recharts";
import type { Column, Group } from "../types";
import { getCompletion, getTotalHours, findMemberById, memberDisplay } from "../helpers";

export default function DashboardView({ columns, groups }: { columns: Column[]; groups: Group[] }) {
  const [selectedGroup, setSelectedGroup] = useState<Group | null>(null);

  const allTasks = columns.flatMap((c) => c.tasks);
  const allSubtasks = allTasks.flatMap((t) => t.subtasks);

  const columnData = columns.map((c) => ({ name: c.title, 數量: c.tasks.length }));

  const priorityCount = { high: 0, medium: 0, low: 0 };
  allTasks.forEach((t) => { priorityCount[t.priority]++; });
  const priorityData = [
    { name: "高優先", value: priorityCount.high, color: "#f87171" },
    { name: "中優先", value: priorityCount.medium, color: "#facc15" },
    { name: "低優先", value: priorityCount.low, color: "#4ade80" },
  ].filter((d) => d.value > 0);

  const groupTaskData: { id: string; name: string; 任務數: number; color: string }[] = groups.map((g) => {
    const count = allTasks.filter((t) => t.groupId === g.id).length;
    return { id: g.id, name: g.name, 任務數: count, color: g.color };
  }).filter((d) => d.任務數 > 0);
  const ungroupedCount = allTasks.filter((t) => !t.groupId).length;
  if (ungroupedCount > 0) {
    groupTaskData.push({ id: "none", name: "未分組", 任務數: ungroupedCount, color: "#475569" });
  }

  const hoursMap: Record<string, number> = {};
  allTasks.forEach((t) => {
    if (t.subtasks.length === 0 && t.assignee) {
      hoursMap[t.assignee] = (hoursMap[t.assignee] || 0) + getTotalHours(t.timeLogs || []);
    }
  });
  allTasks.forEach((t) => {
    t.subtasks.forEach((s) => {
      if (s.assignee) {
        hoursMap[s.assignee] = (hoursMap[s.assignee] || 0) + getTotalHours(s.timeLogs || []);
      }
    });
  });
  const hoursData = Object.entries(hoursMap).map(([memberId, hours]) => {
    const member = findMemberById(groups, memberId);
    return { name: member ? member.name : memberId, 工時: Math.round(hours * 10) / 10 };
  });

  const totalCompletion = allTasks.length > 0
    ? Math.round(allTasks.reduce((sum, t) => sum + getCompletion(t), 0) / allTasks.length)
    : 0;

  const doneTasks = columns.find((c) => c.id === "done")?.tasks.length ?? 0;

  const TOOLTIP_STYLE = {
    background: "#1a2030", border: "1px solid #ffffff15",
    borderRadius: 8, color: "#e2e8f0", fontSize: 12
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <div className="stats-grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 14 }}>
        {[
          { label: "總任務數", value: allTasks.length, color: "#6366f1" },
          { label: "已完成", value: doneTasks, color: "#10b981" },
          { label: "整體完成度", value: `${totalCompletion}%`, color: "#f59e0b" },
          { label: "子工項數", value: allSubtasks.length, color: "#8b5cf6" },
        ].map((card) => (
          <div key={card.label} style={{
            background: "#161b27", borderRadius: 12, padding: "20px 24px",
            border: `1px solid ${card.color}22`
          }}>
            <p style={{ fontSize: 12, color: "#64748b", marginBottom: 8 }}>{card.label}</p>
            <p style={{ fontSize: 28, fontWeight: 700, color: card.color }}>{card.value}</p>
          </div>
        ))}
      </div>

      <div className="charts-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <div style={{ background: "#161b27", borderRadius: 12, padding: 20, border: "1px solid #ffffff08" }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#cbd5e1", marginBottom: 16 }}>各階段任務數</p>
          <ResponsiveContainer width="100%" height={200}>
            <BarChart data={columnData} barSize={32}>
              <XAxis dataKey="name" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
              <YAxis tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
              <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#ffffff06" }} />
              <Bar dataKey="數量" radius={[6, 6, 0, 0]}>
                {columnData.map((_, i) => (
                  <Cell key={i} fill={["#6366f1", "#f59e0b", "#8b5cf6", "#10b981"][i % 4]} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        </div>

        <div style={{ background: "#161b27", borderRadius: 12, padding: 20, border: "1px solid #ffffff08" }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#cbd5e1", marginBottom: 16 }}>優先級分布</p>
          {priorityData.length === 0 ? (
            <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontSize: 13 }}>尚無資料</div>
          ) : (
            <div style={{ display: "flex", alignItems: "center", gap: 24 }}>
              <ResponsiveContainer width="60%" height={200}>
                <PieChart>
                  <Pie data={priorityData} cx="50%" cy="50%" innerRadius={50} outerRadius={80} dataKey="value" paddingAngle={3}>
                    {priorityData.map((entry, i) => <Cell key={i} fill={entry.color} />)}
                  </Pie>
                  <Tooltip contentStyle={TOOLTIP_STYLE} />
                </PieChart>
              </ResponsiveContainer>
              <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
                {priorityData.map((d) => (
                  <div key={d.name} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <div style={{ width: 10, height: 10, borderRadius: 99, background: d.color }} />
                    <span style={{ fontSize: 12, color: "#94a3b8" }}>{d.name}</span>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0" }}>{d.value}</span>
                  </div>
                ))}
              </div>
            </div>
          )}
        </div>

        <div style={{ background: "#161b27", borderRadius: 12, padding: 20, border: "1px solid #ffffff08" }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#cbd5e1", marginBottom: 16 }}>各組別任務數</p>
          {groupTaskData.length === 0 ? (
            <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontSize: 13 }}>尚無資料</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={groupTaskData} barSize={32} layout="vertical">
                <XAxis type="number" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} allowDecimals={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} width={60} />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#ffffff06" }} />
                <Bar dataKey="任務數" radius={[0, 6, 6, 0]} cursor="pointer"
                  onClick={(data: { id?: string }) => {
                    const group = groups.find((g) => g.id === data.id);
                    if (group) setSelectedGroup(group);
                  }}>
                  {groupTaskData.map((d, i) => <Cell key={i} fill={d.color} />)}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          )}
          <p style={{ fontSize: 11, color: "#475569", marginTop: 8 }}>點擊組別查看成員工項與工時</p>
        </div>

        <div style={{ background: "#161b27", borderRadius: 12, padding: 20, border: "1px solid #ffffff08" }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#cbd5e1", marginBottom: 16 }}>各成員累計工時（小時）</p>
          {hoursData.length === 0 ? (
            <div style={{ height: 200, display: "flex", alignItems: "center", justifyContent: "center", color: "#475569", fontSize: 13 }}>尚無計時紀錄</div>
          ) : (
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={hoursData} barSize={32} layout="vertical">
                <XAxis type="number" tick={{ fill: "#64748b", fontSize: 11 }} axisLine={false} tickLine={false} />
                <YAxis type="category" dataKey="name" tick={{ fill: "#94a3b8", fontSize: 11 }} axisLine={false} tickLine={false} width={60} />
                <Tooltip contentStyle={TOOLTIP_STYLE} cursor={{ fill: "#ffffff06" }} />
                <Bar dataKey="工時" fill="#10b981" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </div>
      </div>

      {selectedGroup && (() => {
        const groupTasks = allTasks.filter((t) => t.groupId === selectedGroup.id);

        const memberStats: Record<string, { tasks: string[]; hours: number }> = {};

        groupTasks.forEach((t) => {
          if (t.subtasks.length === 0 && t.assignee) {
            if (!memberStats[t.assignee]) memberStats[t.assignee] = { tasks: [], hours: 0 };
            memberStats[t.assignee].tasks.push(t.title);
            memberStats[t.assignee].hours += getTotalHours(t.timeLogs || []);
          }
        });

        groupTasks.forEach((t) => {
          t.subtasks.forEach((s) => {
            if (s.assignee) {
              if (!memberStats[s.assignee]) memberStats[s.assignee] = { tasks: [], hours: 0 };
              memberStats[s.assignee].tasks.push(`${t.title} → ${s.title}`);
              memberStats[s.assignee].hours += getTotalHours(s.timeLogs || []);
            }
          });
        });

        selectedGroup.members.forEach((m) => {
          if (!memberStats[m.id]) memberStats[m.id] = { tasks: [], hours: 0 };
        });

        const memberList = Object.entries(memberStats).sort((a, b) => a[0].localeCompare(b[0]));

        return (
          <div className="modal-overlay" onClick={() => setSelectedGroup(null)}>
            <div className="modal" style={{ width: 600 }} onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <div style={{ width: 12, height: 12, borderRadius: 99, background: selectedGroup.color }} />
                  <span className="modal-label">{selectedGroup.name} — 成員工項與工時</span>
                </div>
                <button className="modal-close" onClick={() => setSelectedGroup(null)}><X size={16} /></button>
              </div>
              <div className="modal-body" style={{ maxHeight: "65vh", overflowY: "auto" }}>
                {memberList.length === 0 ? (
                  <p style={{ fontSize: 13, color: "#475569", textAlign: "center", padding: 20 }}>該組別尚無成員</p>
                ) : (
                  memberList.map(([memberId, stats]) => {
                    const member = findMemberById([selectedGroup], memberId);
                    const displayName = member ? memberDisplay(member) : memberId;
                    return (
                      <div key={memberId} style={{ background: "#0f1117", borderRadius: 10, padding: 14, border: "1px solid #ffffff08" }}>
                        <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
                          <span style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>{displayName}</span>
                          <span style={{ fontSize: 11, padding: "3px 10px", borderRadius: 99, background: "#10b98122", color: "#10b981", border: "1px solid #10b98133" }}>
                            工時：{stats.hours > 0 ? `${Math.round(stats.hours * 10) / 10} 小時` : "0 小時"}
                          </span>
                        </div>
                        {stats.tasks.length > 0 ? (
                          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
                            {stats.tasks.map((taskName, i) => (
                              <div key={i} style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12, color: "#94a3b8" }}>
                                <div style={{ width: 4, height: 4, borderRadius: 99, background: selectedGroup.color, flexShrink: 0 }} />
                                {taskName}
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p style={{ fontSize: 12, color: "#475569" }}>尚無指派工項</p>
                        )}
                      </div>
                    );
                  })
                )}
              </div>
              <div className="modal-footer">
                <button className="btn-save" style={{ flex: 1 }} onClick={() => setSelectedGroup(null)}>關閉</button>
              </div>
            </div>
          </div>
        );
      })()}
    </div>
  );
}

// ── Risk Modal ───────────────────────────────────────────────────────
