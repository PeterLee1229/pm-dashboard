import type { Task, Column, Group } from "../types";
import { getCompletion, getEffectiveStartDate, getEffectiveEndDate } from "../helpers";

export default function GanttView({ columns, groups, onEditTask }: {
  columns: Column[];
  groups: Group[];
  onEditTask: (task: Task) => void;
}) {
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
  const groupWidth = 80;
  const labelWidth = 180;
  const frozenWidth = groupWidth + labelWidth;

  const days: Date[] = [];
  for (let i = 0; i <= totalDays; i++) {
    const d = new Date(minDate);
    d.setDate(minDate.getDate() + i);
    days.push(d);
  }

  const months: { label: string; span: number }[] = [];
  days.forEach((d) => {
    const label = `${d.getFullYear()}/${d.getMonth() + 1}`;
    if (months.length === 0 || months[months.length - 1].label !== label) {
      months.push({ label, span: 1 });
    } else {
      months[months.length - 1].span++;
    }
  });

  const today = new Date();
  today.setHours(0, 0, 0, 0);

  function dayOffset(date: Date) {
    return Math.floor((date.getTime() - minDate.getTime()) / 86400000);
  }

  return (
    <div id="gantt-container" style={{ display: "flex", background: "#161b27", borderRadius: 12, border: "1px solid #ffffff08", overflow: "hidden" }}>

      {/* 凍結左側面板 */}
      <div className="gantt-frozen" style={{ minWidth: frozenWidth, flexShrink: 0, zIndex: 1, borderRight: "1px solid #ffffff12" }}>
        {/* 月份列佔位 */}
        <div style={{ height: 37, background: "#1a2030", borderBottom: "1px solid #ffffff08", display: "flex", alignItems: "center", paddingLeft: 14 }}>
          <span style={{ fontSize: 11, color: "#475569" }}>組別 / 任務名稱</span>
        </div>
        {/* 日期列佔位 */}
        <div style={{ height: 33, background: "#1a2030", borderBottom: "1px solid #ffffff10" }} />

        {/* 任務列 */}
        {tasksWithDates.map((task) => {
          const group = groups.find((g) => g.id === task.groupId);
          return (
            <div key={task.id}>
              <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid #ffffff06", height: rowHeight }}>
                {/* 組別徽章 */}
                <div style={{ minWidth: groupWidth, padding: "0 6px", display: "flex", justifyContent: "center" }}>
                  {group && (
                    <span style={{
                      fontSize: 10, fontWeight: 600, padding: "2px 6px",
                      borderRadius: 4, background: group.color + "22",
                      border: `1px solid ${group.color}55`, color: group.color,
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis",
                      maxWidth: groupWidth - 12
                    }}>{group.name}</span>
                  )}
                </div>
                {/* 任務名稱 */}
                <div style={{
                  minWidth: labelWidth, padding: "0 14px",
                  fontSize: 12, fontWeight: 600, color: "#cbd5e1",
                  cursor: "pointer", whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
                }} onClick={() => onEditTask(task)}>{task.title}</div>
              </div>

              {task.subtasks
                .filter((s) => s.startDate && s.endDate)
                .sort((a, b) => new Date(a.startDate).getTime() - new Date(b.startDate).getTime())
                .map((sub) => (
                  <div key={sub.id} style={{ display: "flex", alignItems: "center", borderBottom: "1px solid #ffffff04", height: 36, background: "#ffffff02" }}>
                    <div style={{ minWidth: groupWidth }} />
                    <div style={{
                      minWidth: labelWidth, padding: "0 14px 0 28px",
                      fontSize: 11, color: "#64748b",
                      whiteSpace: "nowrap", overflow: "hidden", textOverflow: "ellipsis"
                    }}>↳ {sub.title}</div>
                  </div>
                ))}
            </div>
          );
        })}
      </div>

      {/* 可捲動右側面板 */}
      <div style={{ overflowX: "auto", position: "relative", flex: 1 }}>
        <div style={{ minWidth: days.length * dayWidth }}>

          {/* 月份列 */}
          <div style={{ display: "flex", borderBottom: "1px solid #ffffff08" }}>
            {months.map((m, i) => (
              <div key={i} style={{
                minWidth: m.span * dayWidth, padding: "8px 0",
                textAlign: "center", fontSize: 11, fontWeight: 600,
                color: "#94a3b8", background: "#1a2030",
                borderLeft: i > 0 ? "1px solid #ffffff08" : "none"
              }}>{m.label}</div>
            ))}
          </div>

          {/* 日期列 */}
          <div style={{ display: "flex", borderBottom: "1px solid #ffffff10" }}>
            {days.map((d, i) => {
              const isToday = d.getTime() === today.getTime();
              const isWeekend = d.getDay() === 0 || d.getDay() === 6;
              return (
                <div key={i} style={{
                  minWidth: dayWidth, textAlign: "center",
                  padding: "6px 0", fontSize: 10,
                  color: isToday ? "#6366f1" : isWeekend ? "#475569" : "#64748b",
                  fontWeight: isToday ? 700 : 400,
                  background: isToday ? "#6366f111" : "#1a2030",
                  borderLeft: "1px solid #ffffff06"
                }}>{d.getDate()}</div>
              );
            })}
          </div>

          {/* 任務列 */}
          {tasksWithDates.map((task) => {
            const start = new Date(getEffectiveStartDate(task));
            const end = new Date(getEffectiveEndDate(task));
            const offsetX = dayOffset(start);
            const width = Math.max(1, dayOffset(end) - offsetX + 1);
            const completion = getCompletion(task);
            const group = groups.find((g) => g.id === task.groupId);
            const barColor = group?.color || "#6366f1";

            return (
              <div key={task.id}>
                <div style={{ display: "flex", alignItems: "center", borderBottom: "1px solid #ffffff06", position: "relative", height: rowHeight }}>
                  {days.map((d, i) => {
                    const isToday = d.getTime() === today.getTime();
                    const isWeekend = d.getDay() === 0 || d.getDay() === 6;
                    return (
                      <div key={i} style={{
                        minWidth: dayWidth, height: "100%",
                        background: isToday ? "#6366f108" : isWeekend ? "#ffffff03" : "transparent",
                        borderLeft: "1px solid #ffffff04"
                      }} />
                    );
                  })}

                  <div style={{
                    position: "absolute", left: offsetX * dayWidth,
                    width: width * dayWidth - 4, height: 24,
                    borderRadius: 6, background: barColor + "33",
                    border: `1px solid ${barColor}66`,
                    cursor: "pointer", overflow: "hidden"
                  }} onClick={() => onEditTask(task)}>
                    <div style={{
                      position: "absolute", top: 0, left: 0,
                      height: "100%", width: `${completion}%`,
                      background: barColor + "66", borderRadius: 6,
                      transition: "width .3s"
                    }} />
                    <div style={{
                      position: "absolute", inset: 0, display: "flex",
                      alignItems: "center", paddingLeft: 8,
                      fontSize: 10, fontWeight: 600, color: "#e2e8f0",
                      whiteSpace: "nowrap", overflow: "hidden"
                    }}>{completion}%</div>
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
                      <div key={sub.id} style={{ display: "flex", alignItems: "center", borderBottom: "1px solid #ffffff04", position: "relative", height: 36, background: "#ffffff02" }}>
                        {days.map((_, i) => (
                          <div key={i} style={{ minWidth: dayWidth, height: "100%", borderLeft: "1px solid #ffffff03" }} />
                        ))}

                        <div style={{
                          position: "absolute", left: sOffsetX * dayWidth,
                          width: sWidth * dayWidth - 4, height: 18,
                          borderRadius: 4, background: "#10b98122",
                          border: "1px solid #10b98144", overflow: "hidden"
                        }}>
                          <div style={{ position: "absolute", top: 0, left: 0, height: "100%", width: `${sub.completion}%`, background: "#10b98155", borderRadius: 4 }} />
                          <div style={{
                            position: "absolute", inset: 0, display: "flex",
                            alignItems: "center", paddingLeft: 6,
                            fontSize: 9, color: "#94a3b8"
                          }}>{sub.completion}%</div>
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
                left: todayOffset * dayWidth + dayWidth / 2,
                width: 2, background: "#6366f1", opacity: 0.6, pointerEvents: "none"
              }} />
            );
          })()}
        </div>
      </div>
    </div>
  );
}

// ── Weekly Report View ───────────────────────────────────────────────
