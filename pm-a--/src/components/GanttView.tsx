import { useState } from "react";
import type { Task, Column } from "../types";
import { getCompletion, getEffectiveStartDate, getEffectiveEndDate } from "../helpers";

type TimeScale = "day" | "week" | "month" | "year";

const HEADER_BG = "#1a2030";
const SCALE_LABELS: Record<TimeScale, string> = { day: "日", week: "週", month: "月", year: "年" };

export default function GanttView({ columns, onEditTask }: {
  columns: Column[];
  onEditTask: (task: Task) => void;
}) {
  const [timeScale, setTimeScale] = useState<TimeScale>("day");

  const allTasks = columns.flatMap((col) => col.tasks);
  const tasksWithDates = allTasks
    .filter((t) => getEffectiveStartDate(t) && getEffectiveEndDate(t))
    .sort((a, b) => new Date(getEffectiveStartDate(a)).getTime() - new Date(getEffectiveStartDate(b)).getTime());

  if (tasksWithDates.length === 0) {
    return (
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 300, color: "#475569", gap: 8 }}>
        <p style={{ fontSize: 15 }}>尚無設定日期的任務</p>
        <p style={{ fontSize: 13 }}>請先在任務編輯視窗設定開始與結束日期</p>
      </div>
    );
  }

  const allDates = tasksWithDates.flatMap((t) => [
    new Date(getEffectiveStartDate(t)),
    new Date(getEffectiveEndDate(t))
  ]);
  const minDate = new Date(Math.min(...allDates.map((d) => d.getTime())));
  const maxDate = new Date(Math.max(...allDates.map((d) => d.getTime())));
  minDate.setDate(minDate.getDate() - 2);
  maxDate.setDate(maxDate.getDate() + 2);

  const totalDays = Math.ceil((maxDate.getTime() - minDate.getTime()) / 86400000);
  const dayWidth = Math.max(32, Math.min(60, 800 / totalDays));
  const rowHeight = 44;
  const labelWidth = 220;

  const days: Date[] = [];
  for (let i = 0; i <= totalDays; i++) {
    const d = new Date(minDate);
    d.setDate(minDate.getDate() + i);
    days.push(d);
  }

  // ── Header group builders ─────────────────────────────────────────

  function buildGroups(fn: (d: Date) => string) {
    const groups: { label: string; span: number }[] = [];
    days.forEach((d) => {
      const label = fn(d);
      if (groups.length === 0 || groups[groups.length - 1].label !== label) {
        groups.push({ label, span: 1 });
      } else {
        groups[groups.length - 1].span++;
      }
    });
    return groups;
  }

  const monthGroups  = buildGroups((d) => `${d.getFullYear()}/${d.getMonth() + 1}`);
  const weekGroups   = buildGroups((d) => {
    const dow = d.getDay();
    const mon = new Date(d);
    mon.setDate(d.getDate() - (dow === 0 ? 6 : dow - 1));
    return `${mon.getMonth() + 1}/${mon.getDate()}`;
  });
  const monthLabels  = buildGroups((d) => `${d.getMonth() + 1}月`);
  const yearGroups   = buildGroups((d) => `${d.getFullYear()}`);

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function dayOffset(date: Date) {
    return Math.floor((date.getTime() - minDate.getTime()) / 86400000);
  }

  // ── Sticky style helpers ──────────────────────────────────────────

  const stickyLabel: React.CSSProperties = {
    width: labelWidth, flexShrink: 0,
    position: "sticky", left: 0, zIndex: 1,
    borderRight: "1px solid #ffffff12",
  };

  // Corner cell: both left + top sticky
  const corner = (top: number): React.CSSProperties => ({
    ...stickyLabel,
    top, zIndex: 4,
    background: HEADER_BG,
  });

  // Header row wrapper: sticky at given top offset
  const headerRow = (top: number): React.CSSProperties => ({
    display: "flex", position: "sticky", top, zIndex: 3,
    background: HEADER_BG,
  });

  // ── Header renderer ───────────────────────────────────────────────

  function HeaderGroups({ groups, style }: { groups: { label: string; span: number }[]; style?: React.CSSProperties }) {
    return (
      <>
        {groups.map((g, i) => (
          <div key={i} style={{
            minWidth: g.span * dayWidth, padding: "8px 0",
            textAlign: "center", fontSize: 11, fontWeight: 600,
            color: "#94a3b8",
            borderLeft: i > 0 ? "1px solid #ffffff08" : "none",
            ...style,
          }}>{g.label}</div>
        ))}
      </>
    );
  }

  function DayTicks() {
    return (
      <>
        {days.map((d, i) => {
          const isToday = d.getTime() === today.getTime();
          const isWeekend = d.getDay() === 0 || d.getDay() === 6;
          return (
            <div key={i} style={{
              minWidth: dayWidth, textAlign: "center", padding: "6px 0", fontSize: 10,
              color: isToday ? "#6366f1" : isWeekend ? "#475569" : "#64748b",
              fontWeight: isToday ? 700 : 400,
              background: isToday ? "#6366f111" : "transparent",
              borderLeft: "1px solid #ffffff06",
            }}>{d.getDate()}</div>
          );
        })}
      </>
    );
  }

  function renderHeaders() {
    const topLabel = (
      <div style={{ ...corner(0), height: 37, display: "flex", alignItems: "center", paddingLeft: 14 }}>
        <span style={{ fontSize: 11, color: "#475569" }}>任務名稱</span>
      </div>
    );
    const bottomCorner = (top: number) => (
      <div style={{ ...corner(top), height: 33 }} />
    );

    if (timeScale === "day") return (
      <>
        <div style={{ ...headerRow(0), borderBottom: "1px solid #ffffff08" }}>
          {topLabel}
          <HeaderGroups groups={monthGroups} />
        </div>
        <div style={{ ...headerRow(37), borderBottom: "1px solid #ffffff10" }}>
          {bottomCorner(37)}
          <DayTicks />
        </div>
      </>
    );

    if (timeScale === "week") return (
      <>
        <div style={{ ...headerRow(0), borderBottom: "1px solid #ffffff08" }}>
          {topLabel}
          <HeaderGroups groups={monthGroups} />
        </div>
        <div style={{ ...headerRow(37), borderBottom: "1px solid #ffffff10" }}>
          {bottomCorner(37)}
          {weekGroups.map((w, i) => (
            <div key={i} style={{
              minWidth: w.span * dayWidth, textAlign: "center", padding: "6px 0", fontSize: 10,
              color: "#64748b", borderLeft: i > 0 ? "1px solid #ffffff06" : "none",
            }}>{w.label}</div>
          ))}
        </div>
      </>
    );

    if (timeScale === "month") return (
      <>
        <div style={{ ...headerRow(0), borderBottom: "1px solid #ffffff08" }}>
          {topLabel}
          <HeaderGroups groups={yearGroups} />
        </div>
        <div style={{ ...headerRow(37), borderBottom: "1px solid #ffffff10" }}>
          {bottomCorner(37)}
          {monthLabels.map((m, i) => (
            <div key={i} style={{
              minWidth: m.span * dayWidth, textAlign: "center", padding: "6px 0", fontSize: 10,
              color: "#64748b", borderLeft: i > 0 ? "1px solid #ffffff06" : "none",
            }}>{m.label}</div>
          ))}
        </div>
      </>
    );

    // year
    return (
      <>
        <div style={{ ...headerRow(0), borderBottom: "1px solid #ffffff08" }}>
          {topLabel}
          <HeaderGroups groups={yearGroups} />
        </div>
        <div style={{ ...headerRow(37), borderBottom: "1px solid #ffffff10" }}>
          {bottomCorner(37)}
          {yearGroups.map((y, i) => (
            <div key={i} style={{
              minWidth: y.span * dayWidth, textAlign: "center", padding: "6px 0", fontSize: 10,
              color: "#64748b", borderLeft: i > 0 ? "1px solid #ffffff06" : "none",
            }}>Q1–Q4</div>
          ))}
        </div>
      </>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>

      {/* 時間刻度切換 */}
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        {(["day", "week", "month", "year"] as TimeScale[]).map((scale, i) => {
          const active = timeScale === scale;
          const radius = i === 0 ? "6px 0 0 6px" : i === 3 ? "0 6px 6px 0" : "0";
          return (
            <button key={scale} onClick={() => setTimeScale(scale)} style={{
              padding: "4px 16px", fontSize: 12, fontWeight: active ? 700 : 400,
              background: active ? "#6366f122" : "transparent",
              border: `1px solid ${active ? "#6366f166" : "#ffffff15"}`,
              borderLeft: i > 0 ? "none" : undefined,
              borderRadius: radius,
              color: active ? "#6366f1" : "#64748b",
              cursor: "pointer",
            }}>{SCALE_LABELS[scale]}</button>
          );
        })}
      </div>

      {/* 甘特圖主體 */}
      <div id="gantt-container" style={{
        background: "#161b27", borderRadius: 12, border: "1px solid #ffffff08",
        overflowX: "auto", overflowY: "auto",
        maxHeight: "calc(100vh - 220px)",
        position: "relative",
      }}>
        <div style={{ minWidth: labelWidth + days.length * dayWidth }}>

          {renderHeaders()}

          {/* 任務列 */}
          {tasksWithDates.map((task) => {
            const start = new Date(getEffectiveStartDate(task));
            const end = new Date(getEffectiveEndDate(task));
            const offsetX = dayOffset(start);
            const width = Math.max(1, dayOffset(end) - offsetX + 1);
            const completion = getCompletion(task);
            const barColor = "#6366f1";

            return (
              <div key={task.id}>
                <div style={{ display: "flex", minHeight: rowHeight, borderBottom: "1px solid #ffffff06" }}>
                  <div style={{
                    ...stickyLabel, padding: "8px 14px",
                    fontSize: 12, fontWeight: 600, color: "#cbd5e1",
                    cursor: "pointer", wordBreak: "break-word",
                    background: "#161b27", display: "flex", alignItems: "center",
                  }} onClick={() => onEditTask(task)}>{task.title}</div>

                  <div style={{ position: "relative", display: "flex", alignItems: "center", flex: 1, minHeight: rowHeight }}>
                    {days.map((d, i) => {
                      const isToday = d.getTime() === today.getTime();
                      const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                      return (
                        <div key={i} style={{
                          minWidth: dayWidth, alignSelf: "stretch",
                          background: isToday ? "#6366f108" : isWeekend ? "#ffffff03" : "transparent",
                          borderLeft: "1px solid #ffffff04",
                        }} />
                      );
                    })}
                    <div style={{
                      position: "absolute", left: offsetX * dayWidth,
                      width: width * dayWidth - 4, height: 24,
                      borderRadius: 6, background: barColor + "33",
                      border: `1px solid ${barColor}66`,
                      cursor: "pointer", overflow: "hidden",
                    }} onClick={() => onEditTask(task)}>
                      <div style={{
                        position: "absolute", top: 0, left: 0,
                        height: "100%", width: `${completion}%`,
                        background: barColor + "66", borderRadius: 6, transition: "width .3s",
                      }} />
                      <div style={{
                        position: "absolute", inset: 0, display: "flex",
                        alignItems: "center", paddingLeft: 8,
                        fontSize: 10, fontWeight: 600, color: "#e2e8f0",
                        whiteSpace: "nowrap", overflow: "hidden",
                      }}>{completion}%</div>
                    </div>
                  </div>
                </div>

                {task.subtasks
                  .filter((s) => s.startDate && s.endDate)
                  .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
                  .map((sub) => {
                    const sStart = new Date(sub.startDate);
                    const sEnd = new Date(sub.endDate);
                    const sOffsetX = dayOffset(sStart);
                    const sWidth = Math.max(1, dayOffset(sEnd) - sOffsetX + 1);

                    return (
                      <div key={sub.id} style={{ display: "flex", minHeight: 36, borderBottom: "1px solid #ffffff04", background: "#ffffff02" }}>
                        <div style={{
                          ...stickyLabel, padding: "6px 14px 6px 28px",
                          fontSize: 11, color: "#64748b",
                          wordBreak: "break-word", background: "#1a1f2e",
                          display: "flex", alignItems: "center",
                        }}>↳ {sub.title}</div>

                        <div style={{ position: "relative", display: "flex", alignItems: "center", flex: 1 }}>
                          {days.map((_, i) => (
                            <div key={i} style={{ minWidth: dayWidth, alignSelf: "stretch", borderLeft: "1px solid #ffffff03" }} />
                          ))}
                          <div style={{
                            position: "absolute", left: sOffsetX * dayWidth,
                            width: sWidth * dayWidth - 4, height: 18,
                            borderRadius: 4, background: "#10b98122",
                            border: "1px solid #10b98144", overflow: "hidden",
                          }}>
                            <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: `${sub.completion}%`, background: "#10b98155", borderRadius: 4 }} />
                            <div style={{
                              position: "absolute", inset: 0, display: "flex",
                              alignItems: "center", paddingLeft: 6,
                              fontSize: 9, color: "#94a3b8",
                            }}>{sub.completion}%</div>
                          </div>
                        </div>
                      </div>
                    );
                  })}
              </div>
            );
          })}

          {/* 今日線 */}
          {(() => {
            const todayOffset = dayOffset(today);
            if (todayOffset < 0 || todayOffset > totalDays) return null;
            return (
              <div style={{
                position: "absolute", top: 0, bottom: 0,
                left: labelWidth + todayOffset * dayWidth + dayWidth / 2,
                width: 2, background: "#6366f1", opacity: 0.6, pointerEvents: "none",
              }} />
            );
          })()}
        </div>
      </div>
    </div>
  );
}

// ── Weekly Report View ───────────────────────────────────────────────
