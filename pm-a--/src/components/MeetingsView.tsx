import { useState } from "react";
import { X, Flag } from "lucide-react";
import type { Group, MeetingRecord, MeetingSeries, Member } from "../types";
import { memberDisplay, findMemberById } from "../helpers";

export function NewRecordForm({ groups, onSave, onCancel }: {
  groups: Group[];
  onSave: (record: MeetingRecord) => void;
  onCancel: () => void;
}) {
  const [date, setDate] = useState(new Date().toISOString().split("T")[0]);
  const [attendees, setAttendees] = useState<string[]>([]);
  const [selectedGroupIds, setSelectedGroupIds] = useState<string[]>([]);
  const [summary, setSummary] = useState("");
  const [externalLink, setExternalLink] = useState("");

  const toggleAttendee = (name: string) =>
    setAttendees((prev) => prev.includes(name) ? prev.filter((x) => x !== name) : [...prev, name]);

  const filteredMembers: Member[] = selectedGroupIds.length === 0
    ? []
    : (() => {
        const map = new Map<string, Member>();
        groups.filter((g) => selectedGroupIds.includes(g.id))
          .flatMap((g) => g.members || [])
          .forEach((m) => map.set(m.id, m));
        return Array.from(map.values());
      })();

  return (
    <div style={{ background: "#1a2030", borderRadius: 10, padding: 16, border: "1px solid #6366f133" }}>
      <p style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0", marginBottom: 12 }}>新增會議紀錄</p>

      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: "#64748b", marginBottom: 4, display: "block" }}>日期</label>
        <input type="date" className="field-input" value={date}
          onChange={(e) => setDate(e.target.value)} style={{ colorScheme: "dark" }} />
      </div>

      {/* 組別篩選 */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: "#64748b", marginBottom: 6, display: "block" }}>選擇組別</label>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
          {groups.map((g) => {
            const active = selectedGroupIds.includes(g.id);
            return (
              <button key={g.id} onClick={() => {
                if (active) {
                  const newIds = selectedGroupIds.filter((x) => x !== g.id);
                  setSelectedGroupIds(newIds);
                  const remainingIds = groups.filter((gr) => newIds.includes(gr.id))
                    .flatMap((gr) => gr.members || []).map((m) => m.id);
                  setAttendees(attendees.filter((a) => remainingIds.includes(a)));
                } else {
                  setSelectedGroupIds([...selectedGroupIds, g.id]);
                }
              }} style={{
                background: active ? g.color + "22" : "transparent",
                border: `1px solid ${active ? g.color : "#ffffff15"}`,
                color: active ? g.color : "#64748b",
                borderRadius: 8, padding: "4px 12px", fontSize: 11, fontWeight: 600, cursor: "pointer"
              }}>{g.name}</button>
            );
          })}
        </div>
      </div>

      {/* 出席人員 */}
      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: "#64748b", marginBottom: 6, display: "block" }}>出席人員</label>
        {selectedGroupIds.length === 0 ? (
          <p style={{ fontSize: 11, color: "#475569" }}>請先選擇組別</p>
        ) : filteredMembers.length === 0 ? (
          <p style={{ fontSize: 11, color: "#475569" }}>所選組別尚無成員</p>
        ) : (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
            {filteredMembers.map((m) => {
              const active = attendees.includes(m.id);
              const memberGroup = groups.find((g) => selectedGroupIds.includes(g.id) && g.members.some((gm) => gm.id === m.id));
              const mColor = memberGroup?.color || "#6366f1";
              return (
                <button key={m.id} onClick={() => toggleAttendee(m.id)} style={{
                  background: active ? mColor + "22" : "transparent",
                  border: `1px solid ${active ? mColor : "#ffffff15"}`,
                  color: active ? mColor : "#64748b",
                  borderRadius: 99, padding: "4px 12px", fontSize: 11, cursor: "pointer"
                }}>{memberDisplay(m)}</button>
              );
            })}
          </div>
        )}
      </div>

      <div style={{ marginBottom: 12 }}>
        <label style={{ fontSize: 11, color: "#64748b", marginBottom: 4, display: "block" }}>會議摘要（結論 + 行動事項）</label>
        <textarea className="field-input field-textarea" value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="輸入會議重點結論與待辦事項..." rows={4} />
      </div>

      <div style={{ marginBottom: 14 }}>
        <label style={{ fontSize: 11, color: "#64748b", marginBottom: 4, display: "block" }}>外部連結（選填）</label>
        <input className="field-input" value={externalLink}
          onChange={(e) => setExternalLink(e.target.value)}
          placeholder="貼上 Google Docs / Notion 連結..." />
      </div>

      <div style={{ display: "flex", gap: 8 }}>
        <button className="btn-cancel" style={{ flex: 1 }} onClick={onCancel}>取消</button>
        <button className="btn-save" style={{ flex: 2 }} onClick={() => {
          if (date) onSave({ id: "mr" + Date.now(), date, attendees, summary, externalLink });
        }}>儲存紀錄</button>
      </div>
    </div>
  );
}

export function NewSeriesModal({ onSave, onClose }: {
  onSave: (series: MeetingSeries) => void;
  onClose: () => void;
}) {
  const [name, setName] = useState("");
  const [type, setType] = useState<"regular" | "adhoc">("regular");

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-label">新增會議系列</span>
          <button className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <div className="field">
            <label className="field-label"><Flag size={13} /> 會議名稱</label>
            <input className="field-input" value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="例如：每週專案進度會議" />
          </div>
          <div className="field">
            <label className="field-label"><Flag size={13} /> 會議類型</label>
            <div style={{ display: "flex", gap: 8 }}>
              {([["regular", "定期會議", "#6366f1"], ["adhoc", "臨時會議", "#f59e0b"]] as const).map(([val, label, color]) => (
                <button key={val} onClick={() => setType(val)} style={{
                  flex: 1, borderRadius: 8, padding: 10, fontSize: 13, fontWeight: 600, cursor: "pointer",
                  background: type === val ? color + "22" : "transparent",
                  border: `1px solid ${type === val ? color : "#ffffff15"}`,
                  color: type === val ? color : "#64748b"
                }}>{label}</button>
              ))}
            </div>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-cancel" onClick={onClose}>取消</button>
          <button className="btn-save" onClick={() => {
            if (name.trim()) {
              onSave({ id: "ms" + Date.now(), name: name.trim(), type, records: [] });
              onClose();
            }
          }}>建立</button>
        </div>
      </div>
    </div>
  );
}

export function MeetingRecordCard({ record, groups, seriesId, onDelete, onUpdate }: {
  record: MeetingRecord;
  groups: Group[];
  seriesId: string;
  onDelete: (seriesId: string, recordId: string) => void;
  onUpdate?: (seriesId: string, recordId: string, data: any) => void;
}) {
  const [expanded, setExpanded] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editSummary, setEditSummary] = useState(record.summary);
  const [editLink, setEditLink] = useState(record.externalLink);

  const lines = record.summary.split("\n");
  const needsTruncate = lines.length > 3 || record.summary.length > 150;
  const displayText = (!expanded && needsTruncate)
    ? lines.slice(0, 3).join("\n").slice(0, 150) + "..."
    : record.summary;

  return (
    <div style={{ background: "#0f1117", borderRadius: 10, padding: 14, border: "1px solid #ffffff08" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 10 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "#e2e8f0" }}>{record.date}</span>
        <div style={{ display: "flex", gap: 6 }}>
          {onUpdate && (
            <button onClick={() => {
              if (!editing) { setEditSummary(record.summary); setEditLink(record.externalLink); }
              setEditing(!editing);
            }} style={{
              background: "#6366f118", border: "1px solid #6366f133",
              borderRadius: 4, color: "#6366f1", cursor: "pointer",
              padding: "3px 8px", fontSize: 10,
            }}>
              {editing ? "取消" : "編輯"}
            </button>
          )}
          <button onClick={() => onDelete(seriesId, record.id)}
            style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", padding: 2, display: "flex" }}>
            <X size={12} />
          </button>
        </div>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 4, marginBottom: 8 }}>
        {record.attendees.map((aId: string) => {
          const member = findMemberById(groups, aId);
          return (
            <span key={aId} style={{ fontSize: 10, padding: "2px 8px", borderRadius: 99, background: "#6366f118", color: "#6366f1", border: "1px solid #6366f133" }}>
              {member ? memberDisplay(member) : aId}
            </span>
          );
        })}
      </div>

      {editing ? (
        <div>
          <label style={{ fontSize: 11, color: "#64748b", marginBottom: 4, display: "block" }}>會議摘要</label>
          <textarea className="field-input field-textarea" value={editSummary}
            onChange={(e) => setEditSummary(e.target.value)}
            rows={6} style={{ marginBottom: 10 }} />
          <label style={{ fontSize: 11, color: "#64748b", marginBottom: 4, display: "block" }}>外部連結</label>
          <input className="field-input" value={editLink}
            onChange={(e) => setEditLink(e.target.value)}
            placeholder="貼上 Google Docs / Notion 連結..."
            style={{ marginBottom: 10 }} />
          <div style={{ display: "flex", gap: 8 }}>
            <button onClick={() => {
              if (onUpdate) { onUpdate(seriesId, record.id, { summary: editSummary, externalLink: editLink }); setEditing(false); }
            }} style={{
              background: "#6366f1", border: "none", borderRadius: 6,
              color: "#fff", fontSize: 12, fontWeight: 600, padding: "6px 16px", cursor: "pointer",
            }}>
              儲存
            </button>
            <button onClick={() => { setEditing(false); setEditSummary(record.summary); setEditLink(record.externalLink); }}
              style={{
                background: "#ffffff10", border: "none", borderRadius: 6,
                color: "#94a3b8", fontSize: 12, padding: "6px 16px", cursor: "pointer",
              }}>
              取消
            </button>
          </div>
        </div>
      ) : (
        record.summary && (
          <div>
            <p style={{ fontSize: 12, color: "#94a3b8", lineHeight: 1.6, marginBottom: 4, whiteSpace: "pre-wrap" }}>
              {displayText}
            </p>
            {needsTruncate && (
              <button onClick={() => setExpanded(!expanded)}
                style={{ background: "none", border: "none", color: "#6366f1", fontSize: 11, cursor: "pointer", padding: 0 }}>
                {expanded ? "收合 ▲" : "展開全文 ▼"}
              </button>
            )}
          </div>
        )
      )}

      {record.externalLink && !editing && (
        <a href={record.externalLink} target="_blank" rel="noopener noreferrer"
          style={{ fontSize: 11, color: "#6366f1", textDecoration: "none", display: "inline-block", marginTop: 8 }}>
          📎 查看完整記錄 →
        </a>
      )}
    </div>
  );
}

export default function MeetingsView({ meetings, groups, onCreateSeries, onDeleteSeries, onCreateRecord, onDeleteRecord, onUpdateRecord }: {
  meetings: MeetingSeries[];
  groups: Group[];
  onCreateSeries: (name: string, type: string) => void;
  onDeleteSeries: (id: string) => void;
  onCreateRecord: (seriesId: string, record: any) => void;
  onDeleteRecord: (seriesId: string, recordId: string) => void;
  onUpdateRecord: (seriesId: string, recordId: string, data: any) => void;
}) {
  const [showSeriesModal, setShowSeriesModal] = useState(false);
  const [expandedIds, setExpandedIds] = useState<string[]>([]);
  const [addingRecordId, setAddingRecordId] = useState<string | null>(null);

  const toggleExpand = (id: string) =>
    setExpandedIds((prev) => prev.includes(id) ? prev.filter((x) => x !== id) : [...prev, id]);

  const handleDeleteSeries = (id: string) => onDeleteSeries(id);

  const handleDeleteRecord = (seriesId: string, recordId: string) => onDeleteRecord(seriesId, recordId);

  const renderSeries = (series: MeetingSeries) => {
    const isExpanded = expandedIds.includes(series.id);
    const typeColor = series.type === "regular" ? "#6366f1" : "#f59e0b";
    const typeLabel = series.type === "regular" ? "定期" : "臨時";

    return (
      <div key={series.id} style={{ background: "#161b27", borderRadius: 12, border: "1px solid #ffffff08", overflow: "hidden" }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 16px", background: "#1a2030", cursor: "pointer",
          borderBottom: isExpanded ? "1px solid #ffffff08" : "none"
        }} onClick={() => toggleExpand(series.id)}>
          <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
            <span style={{
              fontSize: 10, fontWeight: 600, padding: "2px 8px", borderRadius: 99,
              background: typeColor + "22", color: typeColor, border: `1px solid ${typeColor}44`
            }}>{typeLabel}</span>
            <span style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>{series.name}</span>
            <span style={{ fontSize: 11, color: "#475569" }}>{series.records.length} 筆紀錄</span>
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
            <button onClick={(e) => {
              e.stopPropagation();
              setAddingRecordId(series.id);
              setExpandedIds((prev) => prev.includes(series.id) ? prev : [...prev, series.id]);
            }} style={{ background: "#10b98122", border: "1px solid #10b98144", borderRadius: 6, color: "#10b981", fontSize: 11, padding: "4px 10px", cursor: "pointer" }}>
              + 新增紀錄
            </button>
            <button onClick={(e) => { e.stopPropagation(); handleDeleteSeries(series.id); }}
              style={{ background: "none", border: "none", color: "#ef4444", cursor: "pointer", padding: 4, display: "flex" }}>
              <X size={14} />
            </button>
            <span style={{ color: "#475569", fontSize: 14, transition: "transform .2s", display: "inline-block", transform: isExpanded ? "rotate(180deg)" : "rotate(0)" }}>▼</span>
          </div>
        </div>

        {isExpanded && (
          <div style={{ padding: 12, display: "flex", flexDirection: "column", gap: 8 }}>
            {addingRecordId === series.id && (
              <NewRecordForm
                groups={groups}
                onSave={(record) => {
                  onCreateRecord(series.id, record);
                  setAddingRecordId(null);
                }}
                onCancel={() => setAddingRecordId(null)}
              />
            )}

            {series.records.length === 0 && addingRecordId !== series.id && (
              <p style={{ fontSize: 12, color: "#475569", textAlign: "center", padding: 16 }}>尚無會議紀錄</p>
            )}

            {series.records.map((record) => (
              <MeetingRecordCard
                key={record.id}
                record={record}
                groups={groups}
                seriesId={series.id}
                onDelete={handleDeleteRecord}
                onUpdate={onUpdateRecord}
              />
            ))}
          </div>
        )}
      </div>
    );
  };

  const regularMeetings = meetings.filter((m) => m.type === "regular");
  const adhocMeetings   = meetings.filter((m) => m.type === "adhoc");

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 16 }}>
      <div style={{ display: "flex", justifyContent: "flex-end" }}>
        <button onClick={() => setShowSeriesModal(true)} style={{
          background: "#6366f122", border: "1px solid #6366f144",
          borderRadius: 8, color: "#6366f1", fontSize: 13, fontWeight: 600,
          padding: "8px 20px", cursor: "pointer"
        }}>+ 新增會議系列</button>
      </div>

      {regularMeetings.length > 0 && (
        <div>
          <p style={{ fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 8, textTransform: "uppercase", letterSpacing: ".05em" }}>定期會議</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{regularMeetings.map(renderSeries)}</div>
        </div>
      )}

      {adhocMeetings.length > 0 && (
        <div>
          <p style={{ fontSize: 12, fontWeight: 600, color: "#475569", marginBottom: 8, textTransform: "uppercase", letterSpacing: ".05em" }}>臨時會議</p>
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>{adhocMeetings.map(renderSeries)}</div>
        </div>
      )}

      {meetings.length === 0 && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", justifyContent: "center", height: 300, color: "#475569", gap: 12 }}>
          <p style={{ fontSize: 48 }}>📋</p>
          <p style={{ fontSize: 15 }}>尚無會議記錄</p>
          <p style={{ fontSize: 13 }}>點右上角「+ 新增會議系列」開始</p>
        </div>
      )}

      {showSeriesModal && (
        <NewSeriesModal
          onSave={(series) => { onCreateSeries(series.name, series.type); setShowSeriesModal(false); }}
          onClose={() => setShowSeriesModal(false)}
        />
      )}
    </div>
  );
}

// ── Dashboard View ───────────────────────────────────────────────────
