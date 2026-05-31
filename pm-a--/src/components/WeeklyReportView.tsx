import { useState, useEffect } from "react";
import type { Column, Group, Risk, WeeklyReport } from "../types";
import { RISK_STATUS_CONFIG, getCompletion, getEffectiveStartDate, getEffectiveEndDate, getWeekRange, formatDateStr, toROCDate, findMemberById, memberDisplay } from "../helpers";
import { exportWeeklyReportPDF } from "../exportUtils";

export default function WeeklyReportView({ columns, groups, risks, weeklyReports, onSaveNotes, projectName }: {
  columns: Column[];
  groups: Group[];
  risks: Risk[];
  weeklyReports: WeeklyReport[];
  onSaveNotes: (weekStart: string, weekEnd: string, notes: string) => void;
  projectName: string;
}) {
  const [weekOffset, setWeekOffset] = useState(0);

  const now = new Date();
  const targetDate = new Date(now);
  targetDate.setDate(now.getDate() + weekOffset * 7);
  const { start: weekStart, end: weekEnd } = getWeekRange(targetDate);
  const weekStartStr = formatDateStr(weekStart);
  const weekEndStr = formatDateStr(weekEnd);

  const existingReport = weeklyReports.find((r) => r.weekStart === weekStartStr);
  const [notes, setNotes] = useState(existingReport?.notes || "");

  useEffect(() => {
    const found = weeklyReports.find((r) => r.weekStart === weekStartStr);
    setNotes(found?.notes || "");
  }, [weekStartStr]);

  const handleSaveNotes = () => {
    onSaveNotes(weekStartStr, weekEndStr, notes);
  };

  const allTasks = columns.flatMap((c) => c.tasks);

  const isInWeek = (dateStr: string) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return d >= weekStart && d <= weekEnd;
  };

  const doneColumn = columns.find((c) => c.id === "done");
  const completedTasks = allTasks.filter((t) => {
    const comp = getCompletion(t);
    if (comp === 100) {
      const hasWeekLog = (t.timeLogs || []).some((l) => isInWeek(l.date));
      const subHasWeekLog = t.subtasks.some((s) => (s.timeLogs || []).some((l) => isInWeek(l.date)));
      return hasWeekLog || subHasWeekLog || (doneColumn?.tasks.some((dt) => dt.id === t.id) ?? false);
    }
    return false;
  });

  const inProgressTasks = allTasks.filter((t) => {
    const comp = getCompletion(t);
    if (comp >= 100) return false;
    const hasWeekLog = (t.timeLogs || []).some((l) => isInWeek(l.date));
    const subHasWeekLog = t.subtasks.some((s) => (s.timeLogs || []).some((l) => isInWeek(l.date)));
    return hasWeekLog || subHasWeekLog;
  });

  const weekHoursMap: Record<string, number> = {};
  allTasks.forEach((t) => {
    if (t.subtasks.length === 0) {
      (t.timeLogs || []).filter((l) => isInWeek(l.date)).forEach((l) => {
        const member = findMemberById(groups, t.assignee);
        const key = member ? memberDisplay(member) : t.assignee || "未指派";
        weekHoursMap[key] = (weekHoursMap[key] || 0) + l.hours;
      });
    }
    t.subtasks.forEach((s) => {
      (s.timeLogs || []).filter((l) => isInWeek(l.date)).forEach((l) => {
        const member = findMemberById(groups, s.assignee);
        const key = member ? memberDisplay(member) : s.assignee || "未指派";
        weekHoursMap[key] = (weekHoursMap[key] || 0) + l.hours;
      });
    });
  });
  const totalWeekHours = Math.round(Object.values(weekHoursMap).reduce((s, h) => s + h, 0) * 10) / 10;

  const activeRisks = risks.filter((r) => r.status !== "resolved");

  const nextWeekStart = new Date(weekEnd);
  nextWeekStart.setDate(nextWeekStart.getDate() + 1);
  const nextWeekEnd = new Date(nextWeekStart);
  nextWeekEnd.setDate(nextWeekStart.getDate() + 6);

  const isInNextWeek = (dateStr: string) => {
    if (!dateStr) return false;
    const d = new Date(dateStr);
    return d >= nextWeekStart && d <= nextWeekEnd;
  };

  const nextWeekTasks = allTasks.filter((t) => {
    const comp = getCompletion(t);
    if (comp >= 100) return false;
    const effectiveStart = getEffectiveStartDate(t);
    const effectiveEnd = getEffectiveEndDate(t);
    if (isInNextWeek(effectiveStart) || isInNextWeek(effectiveEnd)) return true;
    if (effectiveStart && effectiveEnd) {
      const s = new Date(effectiveStart);
      const e = new Date(effectiveEnd);
      if (s <= nextWeekEnd && e >= nextWeekStart) return true;
    }
    return false;
  });

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* 週次選擇 */}
      <div style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 20,
        background: "#161b27", borderRadius: 12, padding: "14px 20px", border: "1px solid #ffffff08"
      }}>
        <button onClick={() => setWeekOffset(weekOffset - 1)}
          style={{ background: "#ffffff10", border: "none", borderRadius: 8, color: "#e2e8f0", fontSize: 18, padding: "4px 14px", cursor: "pointer" }}>
          ◀
        </button>
        <div style={{ textAlign: "center" }}>
          <p style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0" }}>
            {toROCDate(weekStartStr)} ~ {toROCDate(weekEndStr)}
          </p>
          <p style={{ fontSize: 11, color: "#475569", marginTop: 2 }}>
            {weekOffset === 0 ? "本週" : weekOffset === -1 ? "上週" : weekOffset === 1 ? "下週" : ""}
          </p>
        </div>
        <button onClick={() => setWeekOffset(weekOffset + 1)}
          style={{ background: "#ffffff10", border: "none", borderRadius: 8, color: "#e2e8f0", fontSize: 18, padding: "4px 14px", cursor: "pointer" }}>
          ▶
        </button>
        <button onClick={() => setWeekOffset(0)}
          style={{ background: "#6366f122", border: "1px solid #6366f144", borderRadius: 8, color: "#6366f1", fontSize: 12, padding: "6px 14px", cursor: "pointer" }}>
          回到本週
        </button>
        <button onClick={() => {
          const weekLabel = `${toROCDate(weekStartStr)} ~ ${toROCDate(weekEndStr)}`;
          exportWeeklyReportPDF(projectName, weekLabel, {
            completedTasks: completedTasks.map((t) => ({
              title: t.title,
              group: groups.find((g) => g.id === t.groupId)?.name || "未分組",
            })),
            inProgressTasks: inProgressTasks.map((t) => ({
              title: t.title,
              group: groups.find((g) => g.id === t.groupId)?.name || "未分組",
              completion: getCompletion(t),
            })),
            weekHours: Object.entries(weekHoursMap)
              .sort((a, b) => b[1] - a[1])
              .map(([name, hours]) => ({ name, hours: Math.round(hours * 10) / 10 })),
            totalHours: totalWeekHours,
            activeRisks: activeRisks.map((r) => ({
              title: r.title,
              status: RISK_STATUS_CONFIG[r.status].label,
            })),
            nextWeekTasks: nextWeekTasks.map((t) => {
              const group = groups.find((g) => g.id === t.groupId);
              const assignee = findMemberById(groups, t.assignee);
              return {
                title: t.title,
                group: group?.name || "未分組",
                assignee: assignee ? memberDisplay(assignee) : "未指派",
              };
            }),
            notes,
          });
        }}
          style={{
            background: "#8b5cf622", border: "1px solid #8b5cf644",
            borderRadius: 8, color: "#8b5cf6", fontSize: 12, fontWeight: 600,
            padding: "6px 14px", cursor: "pointer"
          }}>
          匯出 PDF
        </button>
      </div>

      {/* 統計卡片 */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
        {[
          { label: "本週完成", value: completedTasks.length, unit: "項", color: "#10b981" },
          { label: "進行中",   value: inProgressTasks.length, unit: "項", color: "#f59e0b" },
          { label: "本週總工時", value: totalWeekHours, unit: "h", color: "#6366f1" },
          { label: "活躍風險", value: activeRisks.length, unit: "項", color: "#ef4444" },
        ].map((card) => (
          <div key={card.label} style={{
            background: "#161b27", borderRadius: 10, padding: "16px 20px",
            border: `1px solid ${card.color}22`
          }}>
            <p style={{ fontSize: 11, color: "#64748b", marginBottom: 6 }}>{card.label}</p>
            <p style={{ fontSize: 24, fontWeight: 700, color: card.color }}>
              {card.value} <span style={{ fontSize: 12, fontWeight: 400 }}>{card.unit}</span>
            </p>
          </div>
        ))}
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>

        {/* 本週完成 */}
        <div style={{ background: "#161b27", borderRadius: 12, padding: 18, border: "1px solid #ffffff08" }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#10b981", marginBottom: 12 }}>✅ 本週完成</p>
          {completedTasks.length === 0 ? (
            <p style={{ fontSize: 12, color: "#475569" }}>無</p>
          ) : completedTasks.map((t) => {
            const group = groups.find((g) => g.id === t.groupId);
            return (
              <div key={t.id} style={{ fontSize: 12, color: "#94a3b8", padding: "4px 0", display: "flex", gap: 8 }}>
                {group && <span style={{ fontSize: 10, color: group.color }}>[{group.name}]</span>}
                <span>{t.title}</span>
              </div>
            );
          })}
        </div>

        {/* 進行中 */}
        <div style={{ background: "#161b27", borderRadius: 12, padding: 18, border: "1px solid #ffffff08" }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#f59e0b", marginBottom: 12 }}>🔄 進行中</p>
          {inProgressTasks.length === 0 ? (
            <p style={{ fontSize: 12, color: "#475569" }}>無</p>
          ) : inProgressTasks.map((t) => {
            const group = groups.find((g) => g.id === t.groupId);
            const comp = getCompletion(t);
            return (
              <div key={t.id} style={{ fontSize: 12, color: "#94a3b8", padding: "4px 0", display: "flex", alignItems: "center", gap: 8 }}>
                {group && <span style={{ fontSize: 10, color: group.color }}>[{group.name}]</span>}
                <span style={{ flex: 1 }}>{t.title}</span>
                <span style={{ fontSize: 11, color: "#6366f1" }}>{comp}%</span>
              </div>
            );
          })}
        </div>

        {/* 工時統計 */}
        <div style={{ background: "#161b27", borderRadius: 12, padding: 18, border: "1px solid #ffffff08" }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#6366f1", marginBottom: 12 }}>⏱ 工時統計</p>
          {Object.keys(weekHoursMap).length === 0 ? (
            <p style={{ fontSize: 12, color: "#475569" }}>本週無工時紀錄</p>
          ) : Object.entries(weekHoursMap)
              .sort((a, b) => b[1] - a[1])
              .map(([name, hours]) => (
                <div key={name} style={{ display: "flex", justifyContent: "space-between", padding: "4px 0", fontSize: 12 }}>
                  <span style={{ color: "#94a3b8" }}>{name}</span>
                  <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{Math.round(hours * 10) / 10} h</span>
                </div>
              ))
          }
        </div>

        {/* 風險狀態 */}
        <div style={{ background: "#161b27", borderRadius: 12, padding: 18, border: "1px solid #ffffff08" }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#ef4444", marginBottom: 12 }}>⚠️ 風險狀態</p>
          {activeRisks.length === 0 ? (
            <p style={{ fontSize: 12, color: "#475569" }}>無活躍風險</p>
          ) : activeRisks.map((r) => {
            const statusCfg = RISK_STATUS_CONFIG[r.status];
            return (
              <div key={r.id} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 12 }}>
                <span style={{
                  fontSize: 9, padding: "1px 6px", borderRadius: 99,
                  background: statusCfg.color + "22", color: statusCfg.color
                }}>{statusCfg.label}</span>
                <span style={{ color: "#94a3b8" }}>{r.title}</span>
              </div>
            );
          })}
        </div>
      </div>

      {/* 下週預計工作 */}
      <div style={{ background: "#161b27", borderRadius: 12, padding: 18, border: "1px solid #ffffff08" }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: "#8b5cf6", marginBottom: 12 }}>📅 下週預計工作</p>
        {nextWeekTasks.length === 0 ? (
          <p style={{ fontSize: 12, color: "#475569" }}>無</p>
        ) : (
          <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 6 }}>
            {nextWeekTasks.map((t) => {
              const group = groups.find((g) => g.id === t.groupId);
              const assignee = findMemberById(groups, t.assignee);
              return (
                <div key={t.id} style={{ fontSize: 12, color: "#94a3b8", padding: "4px 0", display: "flex", gap: 8 }}>
                  {group && <span style={{ fontSize: 10, color: group.color }}>[{group.name}]</span>}
                  <span>{t.title}</span>
                  {assignee && <span style={{ fontSize: 10, color: "#475569" }}>- {assignee.name}</span>}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* PM 備註 */}
      <div style={{ background: "#161b27", borderRadius: 12, padding: 18, border: "1px solid #ffffff08" }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: "#cbd5e1", marginBottom: 12 }}>📝 PM 備註</p>
        <textarea className="field-input field-textarea" value={notes}
          onChange={(e) => setNotes(e.target.value)}
          placeholder="輸入本週備註、特殊事項..." rows={4} />
        <button onClick={handleSaveNotes}
          style={{
            marginTop: 10, background: "#6366f1", border: "none", borderRadius: 8,
            color: "#fff", fontSize: 13, fontWeight: 600, padding: "8px 20px", cursor: "pointer"
          }}>
          儲存備註
        </button>
      </div>
    </div>
  );
}

// ── ProjectMembersView ───────────────────────────────────────────────
