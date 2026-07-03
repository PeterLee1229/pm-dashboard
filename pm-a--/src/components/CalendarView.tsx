import { useState } from "react";
import type { Column, Group, MeetingSeries } from "../types";
import { getCompletion, getEffectiveStartDate, getEffectiveEndDate, findMemberById, memberDisplay } from "../helpers";

export default function CalendarView({ columns, meetings, groups }: {
  columns: Column[];
  meetings: MeetingSeries[];
  groups: Group[];
}) {
  const [currentDate, setCurrentDate] = useState(new Date());
  const [selectedDate, setSelectedDate] = useState<string | null>(null);

  const year = currentDate.getFullYear();
  const month = currentDate.getMonth();

  const firstDay = new Date(year, month, 1);
  const lastDay = new Date(year, month + 1, 0);
  const startDayOfWeek = firstDay.getDay();

  const prevMonthLast = new Date(year, month, 0).getDate();

  const days: { date: Date; currentMonth: boolean }[] = [];

  for (let i = startDayOfWeek - 1; i >= 0; i--) {
    days.push({ date: new Date(year, month - 1, prevMonthLast - i), currentMonth: false });
  }
  for (let d = 1; d <= lastDay.getDate(); d++) {
    days.push({ date: new Date(year, month, d), currentMonth: true });
  }
  const remaining = 42 - days.length;
  for (let d = 1; d <= remaining; d++) {
    days.push({ date: new Date(year, month + 1, d), currentMonth: false });
  }

  const allTasks = columns.flatMap(c => c.tasks);

  const getTasksForDate = (dateStr: string) => {
    return allTasks.filter(t => {
      const start = getEffectiveStartDate(t);
      const end = getEffectiveEndDate(t);
      if (!start && !end) return false;
      if (start === dateStr || end === dateStr) return true;
      if (start && end && dateStr >= start && dateStr <= end) return true;
      return false;
    });
  };

  const getMeetingsForDate = (dateStr: string) => {
    const records: { seriesName: string; record: any }[] = [];
    meetings.forEach(s => {
      s.records.forEach(r => {
        if (r.date === dateStr) {
          records.push({ seriesName: s.name, record: r });
        }
      });
    });
    return records;
  };

  const formatDateStr = (d: Date) => {
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
  };

  const today = new Date();
  const todayStr = formatDateStr(today);

  const prevMonth = () => setCurrentDate(new Date(year, month - 1, 1));
  const nextMonth = () => setCurrentDate(new Date(year, month + 1, 1));
  const goToday = () => setCurrentDate(new Date());

  const monthLabel = `${year} 年 ${month + 1} 月`;
  const WEEKDAYS = ["日", "一", "二", "三", "四", "五", "六"];

  const selectedTasks = selectedDate ? getTasksForDate(selectedDate) : [];
  const selectedMeetings = selectedDate ? getMeetingsForDate(selectedDate) : [];

  return (
    <div className="calendar-layout" style={{ display: "flex", gap: 16 }}>

      {/* 左側月曆 */}
      <div style={{ flex: 1 }}>
        {/* 月份切換 */}
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "center", gap: 20,
          marginBottom: 16
        }}>
          <button onClick={prevMonth} style={{
            background: "#ffffff10", border: "none", borderRadius: 8,
            color: "#e2e8f0", fontSize: 16, padding: "6px 14px", cursor: "pointer"
          }}>◀</button>
          <span style={{ fontSize: 16, fontWeight: 700, color: "#e2e8f0", minWidth: 140, textAlign: "center" }}>{monthLabel}</span>
          <button onClick={nextMonth} style={{
            background: "#ffffff10", border: "none", borderRadius: 8,
            color: "#e2e8f0", fontSize: 16, padding: "6px 14px", cursor: "pointer"
          }}>▶</button>
          <button onClick={goToday} style={{
            background: "#6366f122", border: "1px solid #6366f144",
            borderRadius: 8, color: "#6366f1", fontSize: 12, padding: "6px 14px", cursor: "pointer"
          }}>今天</button>
        </div>

        {/* 星期標題 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gap: 2, marginBottom: 4 }}>
          {WEEKDAYS.map(w => (
            <div key={w} style={{
              textAlign: "center", fontSize: 11, fontWeight: 600, color: "#475569", padding: "6px 0"
            }}>{w}</div>
          ))}
        </div>

        {/* 日期格子 */}
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, 1fr)", gridAutoRows: "minmax(80px, auto)", gap: 2 }}>
          {days.map((day, i) => {
            const dateStr = formatDateStr(day.date);
            const isToday = dateStr === todayStr;
            const isSelected = dateStr === selectedDate;
            const dayTasks = getTasksForDate(dateStr);
            const dayMeetings = getMeetingsForDate(dateStr);
            const isWeekend = day.date.getDay() === 0 || day.date.getDay() === 6;

            return (
              <div key={i} onClick={() => setSelectedDate(dateStr)} style={{
                minHeight: 80, padding: 4, borderRadius: 8, cursor: "pointer",
                background: isSelected ? "#6366f118" : isToday ? "#6366f108" : "#161b27",
                border: isSelected ? "1px solid #6366f1" : isToday ? "1px solid #6366f144" : "1px solid #ffffff06",
                opacity: day.currentMonth ? 1 : 0.3,
              }}>
                <div style={{
                  fontSize: 12, fontWeight: isToday ? 700 : 400,
                  color: isToday ? "#6366f1" : isWeekend ? "#475569" : "#94a3b8",
                  textAlign: "right", padding: "2px 4px"
                }}>{day.date.getDate()}</div>

                <div style={{ display: "flex", flexDirection: "column", gap: 2, marginTop: 2 }}>
                  {dayTasks.slice(0, 2).map(t => {
                    const group = groups.find(g => g.members?.some(m => m.id === t.assignee));
                    const color = group?.color || "#6366f1";
                    return (
                      <div key={t.id} style={{
                        fontSize: 9, padding: "1px 4px", borderRadius: 3,
                        background: color + "22", color: color,
                        overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                      }}>{t.title}</div>
                    );
                  })}
                  {dayTasks.length > 2 && (
                    <div style={{ fontSize: 9, color: "#475569" }}>+{dayTasks.length - 2} 更多</div>
                  )}
                  {dayMeetings.slice(0, 1).map((m, idx) => (
                    <div key={idx} style={{
                      fontSize: 9, padding: "1px 4px", borderRadius: 3,
                      background: "#10b98122", color: "#10b981",
                      overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap"
                    }}>📅 {m.seriesName}</div>
                  ))}
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 右側詳情面板 */}
      <div className="calendar-detail" style={{
        width: 320, background: "#161b27", borderRadius: 12,
        border: "1px solid #ffffff08", padding: 16, alignSelf: "flex-start"
      }}>
        <p style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0", marginBottom: 16 }}>
          {selectedDate || "請選擇日期"}
        </p>

        {!selectedDate ? (
          <p style={{ fontSize: 12, color: "#475569", textAlign: "center", padding: 20 }}>點擊日期查看詳情</p>
        ) : (
          <>
            <p style={{ fontSize: 12, fontWeight: 600, color: "#6366f1", marginBottom: 8 }}>📋 任務（{selectedTasks.length}）</p>
            {selectedTasks.length === 0 ? (
              <p style={{ fontSize: 11, color: "#475569", marginBottom: 16 }}>無任務</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6, marginBottom: 16 }}>
                {selectedTasks.map(t => {
                  const completion = getCompletion(t);
                  return (
                    <div key={t.id} style={{
                      background: "#0f1117", borderRadius: 8, padding: "8px 10px",
                      border: "1px solid #ffffff08"
                    }}>
                      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 4 }}>
                        <span style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0" }}>{t.title}</span>
                        <span style={{ fontSize: 10, color: "#6366f1" }}>{completion}%</span>
                      </div>
                      <div style={{ height: 3, background: "#ffffff10", borderRadius: 99, overflow: "hidden" }}>
                        <div style={{ height: "100%", width: `${completion}%`, background: "#6366f1", borderRadius: 99 }} />
                      </div>
                      {t.assignee && (
                        <span style={{ fontSize: 10, color: "#64748b", marginTop: 4, display: "block" }}>
                          {(() => {
                            const member = findMemberById(groups, t.assignee);
                            return member ? memberDisplay(member) : t.assignee;
                          })()}
                        </span>
                      )}
                    </div>
                  );
                })}
              </div>
            )}

            <p style={{ fontSize: 12, fontWeight: 600, color: "#10b981", marginBottom: 8 }}>📅 會議紀錄（{selectedMeetings.length}）</p>
            {selectedMeetings.length === 0 ? (
              <p style={{ fontSize: 11, color: "#475569" }}>無會議</p>
            ) : (
              <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                {selectedMeetings.map((m, i) => (
                  <div key={i} style={{
                    background: "#0f1117", borderRadius: 8, padding: "8px 10px",
                    border: "1px solid #ffffff08"
                  }}>
                    <span style={{ fontSize: 12, fontWeight: 600, color: "#e2e8f0" }}>{m.seriesName}</span>
                    {m.record.summary && (
                      <p style={{ fontSize: 11, color: "#64748b", marginTop: 4, lineHeight: 1.5 }}>
                        {m.record.summary.slice(0, 100)}{m.record.summary.length > 100 ? "..." : ""}
                      </p>
                    )}
                  </div>
                ))}
              </div>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── ActivityView ──────────────────────────────────────────────────────
