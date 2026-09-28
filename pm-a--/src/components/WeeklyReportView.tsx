import { useState, useEffect } from "react";
import type { Column, Group, Risk, WeeklyReport } from "../types";
import { RISK_STATUS_CONFIG, getWeekRange, formatDateStr, findMemberById } from "../helpers";
import { computeWeeklyReport, toWeeklyReportData } from "../reportCalc";

const toWesternDate = (dateStr: string) => {
  const d = new Date(dateStr + "T00:00:00");
  return `${d.getFullYear()}/${d.getMonth() + 1}/${d.getDate()}`;
};
import { exportWeeklyReportPDF, buildWeeklyReportMarkdown } from "../exportUtils";

export default function WeeklyReportView({ columns, groups, risks, weeklyReports, onSaveNotes, projectName, canEditNotes }: {
  columns: Column[];
  groups: Group[];
  risks: Risk[];
  weeklyReports: WeeklyReport[];
  onSaveNotes: (weekStart: string, weekEnd: string, notes: string) => void;
  projectName: string;
  /** manage_weekly：編輯週報備註 */
  canEditNotes: boolean;
}) {
  const [weekOffset, setWeekOffset] = useState(0);
  const [hoursFilter, setHoursFilter] = useState<"week" | "month" | "all">("week");
  const [copied, setCopied] = useState(false);

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

  const {
    completedTasks, inProgressTasks, weekHoursMap, monthHoursMap, allHoursMap, totalWeekHours, activeRisks, nextWeekTasks,
  } = computeWeeklyReport(columns, groups, risks, targetDate);

  const HOURS_FILTER_MAP: Record<"week" | "month" | "all", Record<string, number>> = {
    week: weekHoursMap, month: monthHoursMap, all: allHoursMap,
  };
  const displayedHoursMap = HOURS_FILTER_MAP[hoursFilter];
  const totalDisplayedHours = Math.round(Object.values(displayedHoursMap).reduce((s, h) => s + h, 0) * 10) / 10;

  const buildReportData = () => toWeeklyReportData(
    { weekStart, weekEnd, completedTasks, inProgressTasks, weekHoursMap, monthHoursMap, allHoursMap, totalWeekHours, activeRisks, nextWeekTasks },
    groups, notes,
  );

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>

      {/* 週次選擇 */}
      <div className="weekly-toolbar" style={{
        display: "flex", alignItems: "center", justifyContent: "center", gap: 20,
        background: "#161b27", borderRadius: 12, padding: "14px 20px", border: "1px solid #ffffff08"
      }}>
        <button onClick={() => setWeekOffset(weekOffset - 1)}
          style={{ background: "#ffffff10", border: "none", borderRadius: 8, color: "#e2e8f0", fontSize: 18, padding: "4px 14px", cursor: "pointer" }}>
          ◀
        </button>
        <div className="weekly-toolbar-title" style={{ textAlign: "center" }}>
          <p style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0" }}>
            {toWesternDate(weekStartStr)} ~ {toWesternDate(weekEndStr)}
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
          const weekLabel = `${toWesternDate(weekStartStr)} ~ ${toWesternDate(weekEndStr)}`;
          exportWeeklyReportPDF(projectName, weekLabel, buildReportData());
        }}
          style={{
            background: "#8b5cf622", border: "1px solid #8b5cf644",
            borderRadius: 8, color: "#8b5cf6", fontSize: 12, fontWeight: 600,
            padding: "6px 14px", cursor: "pointer"
          }}>
          匯出 PDF
        </button>
        <button onClick={async () => {
          const weekLabel = `${toWesternDate(weekStartStr)} ~ ${toWesternDate(weekEndStr)}`;
          const markdown = buildWeeklyReportMarkdown(projectName, weekLabel, buildReportData());
          await navigator.clipboard.writeText(markdown);
          setCopied(true);
          setTimeout(() => setCopied(false), 2000);
        }}
          style={{
            background: copied ? "#10b98122" : "#10b98118", border: `1px solid ${copied ? "#10b981" : "#10b98144"}`,
            borderRadius: 8, color: "#10b981", fontSize: 12, fontWeight: 600,
            padding: "6px 14px", cursor: "pointer"
          }}>
          {copied ? "已複製 ✓" : "複製 Markdown"}
        </button>
      </div>

      {/* 統計卡片 */}
      <div className="stats-grid-4" style={{ display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12 }}>
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

      <div className="charts-grid" style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>

        {/* 本週完成 */}
        <div style={{ background: "#161b27", borderRadius: 12, padding: 18, border: "1px solid #ffffff08" }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#10b981", marginBottom: 12 }}>✅ 本週完成</p>
          {completedTasks.length === 0 ? (
            <p style={{ fontSize: 12, color: "#475569" }}>無</p>
          ) : completedTasks.map((t) => (
            <div key={t.id} style={{ marginBottom: 6 }}>
              {t.subtasks.length === 0 ? (
                <div style={{ fontSize: 12, color: "#94a3b8" }}>{t.title}</div>
              ) : (
                <>
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>{t.title}</div>
                  <div style={{ paddingLeft: 14, marginTop: 2 }}>
                    {t.subtasks.map((sub) => (
                      <div key={sub.id} style={{ fontSize: 11, color: "#64748b", padding: "1px 0" }}>
                        {sub.title}
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        {/* 進行中 */}
        <div style={{ background: "#161b27", borderRadius: 12, padding: 18, border: "1px solid #ffffff08" }}>
          <p style={{ fontSize: 13, fontWeight: 600, color: "#f59e0b", marginBottom: 12 }}>🔄 進行中</p>
          {inProgressTasks.length === 0 ? (
            <p style={{ fontSize: 12, color: "#475569" }}>無</p>
          ) : inProgressTasks.map((t) => (
            <div key={t.id} style={{ marginBottom: 6 }}>
              {t.subtasks.length === 0 ? (
                <div style={{ fontSize: 12, color: "#94a3b8", display: "flex", justifyContent: "space-between" }}>
                  <span>{t.title}</span>
                  <span style={{ fontSize: 11, color: "#6366f1", flexShrink: 0, paddingLeft: 8 }}>{t.completion}%</span>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: 12, color: "#94a3b8" }}>{t.title}</div>
                  <div style={{ paddingLeft: 14, marginTop: 2 }}>
                    {t.subtasks.map((sub) => (
                      <div key={sub.id} style={{ fontSize: 11, color: "#64748b", padding: "1px 0", display: "flex", justifyContent: "space-between" }}>
                        <span>{sub.title}</span>
                        <span style={{ fontSize: 10, color: "#6366f1", flexShrink: 0, paddingLeft: 8 }}>{sub.completion}%</span>
                      </div>
                    ))}
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        {/* 工時統計 */}
        <div style={{ background: "#161b27", borderRadius: 12, padding: 18, border: "1px solid #ffffff08" }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12, flexWrap: "wrap", gap: 8 }}>
            <p style={{ fontSize: 13, fontWeight: 600, color: "#6366f1" }}>⏱ 個人工時累計（{totalDisplayedHours} h）</p>
            <div style={{ display: "flex", gap: 4 }}>
              {([["week", "本週"], ["month", "本月"], ["all", "全部"]] as const).map(([val, label]) => (
                <button key={val} onClick={() => setHoursFilter(val)} style={{
                  background: hoursFilter === val ? "#6366f122" : "transparent",
                  border: `1px solid ${hoursFilter === val ? "#6366f166" : "#ffffff15"}`,
                  color: hoursFilter === val ? "#6366f1" : "#64748b",
                  borderRadius: 6, fontSize: 11, fontWeight: 600, padding: "3px 10px", cursor: "pointer",
                }}>{label}</button>
              ))}
            </div>
          </div>
          {Object.keys(displayedHoursMap).length === 0 ? (
            <p style={{ fontSize: 12, color: "#475569" }}>此範圍無工時紀錄</p>
          ) : Object.entries(displayedHoursMap)
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
          onChange={(e) => setNotes(e.target.value)} readOnly={!canEditNotes}
          placeholder={canEditNotes ? "輸入本週備註、特殊事項..." : "（僅 Owner / PM 可編輯備註）"} rows={4} />
        {canEditNotes && <button onClick={handleSaveNotes}
          style={{
            marginTop: 10, background: "#6366f1", border: "none", borderRadius: 8,
            color: "#fff", fontSize: 13, fontWeight: 600, padding: "8px 20px", cursor: "pointer"
          }}>
          儲存備註
        </button>}
      </div>
    </div>
  );
}

// ── ProjectMembersView ───────────────────────────────────────────────
