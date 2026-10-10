import { useState } from "react";
import { X } from "lucide-react";
import { previewTaskImport, commitTaskImport } from "../api";

type RowStatus = "new" | "modified" | "error";
type Decision = "import" | "update" | "skip" | "create_new";

type PreviewRow = {
  key: string;
  rowNumber: number;
  kind: "task" | "subtask";
  status: RowStatus;
  title: string;
  targetId?: string;
  parentKey?: string;
  parentTitle?: string;
  changes: { field: string; fieldLabel: string; oldValue: string; newValue: string }[];
  errors: string[];
  fields: { label: string; value: string }[];
};

type Preview = {
  previewToken: string;
  summary: { new: number; modified: number; unchanged: number; error: number };
  rows: PreviewRow[];
  missingInFile: { kind: "task" | "subtask"; id: string; title: string; parentTitle?: string; subtaskCount?: number }[];
};

type CommitResult = {
  created: number;
  updated: number;
  skipped: number;
  conflicts: { key: string; rowNumber: number; title: string; reason: string }[];
  notImported: { key: string; rowNumber: number; title: string; reason: string }[];
  statusAutoChanged?: { taskId: string; from: string; to: "review" | "inprogress" }[];
};

const DEFAULT_DECISION: Record<RowStatus, Decision> = { new: "import", modified: "update", error: "skip" };
const OPTIONS: Record<"new" | "modified", { value: Decision; label: string }[]> = {
  new: [{ value: "import", label: "匯入" }, { value: "skip", label: "略過" }],
  modified: [{ value: "update", label: "更新" }, { value: "skip", label: "略過" }, { value: "create_new", label: "另存為新工項" }],
};
const TABS: { id: RowStatus; label: string; color: string }[] = [
  { id: "new", label: "新增", color: "#10b981" },
  { id: "modified", label: "修改", color: "#6366f1" },
  { id: "error", label: "錯誤", color: "#ef4444" },
];

export default function ImportModal({ projectId, onClose, onSuccess }: {
  projectId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [step, setStep] = useState<"upload" | "preview" | "result">("upload");
  const [loading, setLoading] = useState(false);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [decisions, setDecisions] = useState<Record<string, Decision>>({});
  const [tab, setTab] = useState<RowStatus>("new");
  const [showMissing, setShowMissing] = useState(false);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [error, setError] = useState("");
  const [showConfirmLeave, setShowConfirmLeave] = useState(false);

  const rows = preview?.rows ?? [];
  const rowByKey = new Map(rows.map((r) => [r.key, r]));
  const decisionOf = (r: PreviewRow): Decision => decisions[r.key] ?? DEFAULT_DECISION[r.status];

  // 新增的父工項被略過時，其新增子工項無處可掛，一併略過
  const parentSkipped = (r: PreviewRow) => {
    const parent = r.parentKey ? rowByKey.get(r.parentKey) : undefined;
    return !!parent && parent.status === "new" && decisionOf(parent) === "skip";
  };
  const effectiveDecision = (r: PreviewRow): Decision =>
    r.status === "new" && parentSkipped(r) ? "skip" : decisionOf(r);

  const isDirty = step === "preview" && rows.some((r) => decisionOf(r) !== DEFAULT_DECISION[r.status]);
  const handleClose = () => { if (isDirty) setShowConfirmLeave(true); else onClose(); };

  const counts = { create: 0, update: 0 };
  for (const r of rows) {
    const d = effectiveDecision(r);
    if (d === "import" || d === "create_new") counts.create++;
    if (d === "update") counts.update++;
  }

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file) return;
    const reader = new FileReader();
    reader.onload = async (event) => {
      try {
        setLoading(true);
        setError("");
        const data: Preview = await previewTaskImport(projectId, event.target?.result as string);
        setPreview(data);
        setDecisions({});
        setShowMissing(false);
        setTab(data.summary.new > 0 ? "new" : data.summary.modified > 0 ? "modified" : data.summary.error > 0 ? "error" : "new");
        setStep("preview");
      } catch (err) {
        setError(err instanceof Error ? err.message : "檔案比對失敗");
      } finally {
        setLoading(false);
      }
    };
    reader.readAsText(file, "utf-8");
  };

  const handleCommit = async () => {
    if (!preview) return;
    try {
      setLoading(true);
      setError("");
      const payload: Record<string, Decision> = {};
      for (const r of rows) if (r.status !== "error") payload[r.key] = effectiveDecision(r);
      const res: CommitResult = await commitTaskImport(projectId, preview.previewToken, payload);
      setResult(res);
      setStep("result");
      if (res.created + res.updated > 0) onSuccess();
    } catch (err) {
      setError(err instanceof Error ? err.message : "匯入失敗");
    } finally {
      setLoading(false);
    }
  };

  const setAll = (status: RowStatus, d: Decision) => {
    setDecisions((prev) => {
      const next = { ...prev };
      for (const r of rows) if (r.status === status) next[r.key] = d;
      return next;
    });
  };

  const tabRows = rows.filter((r) => r.status === tab);
  const summary = preview?.summary;

  return (
    <div className="modal-overlay" onClick={handleClose}>
      <div className="modal" style={{ width: 760, position: "relative" }} onClick={(e) => e.stopPropagation()}>
        <style>{IMPORT_CSS}</style>
        <div className="modal-header">
          <span className="modal-label">
            {step === "upload" ? "匯入任務" : step === "preview" ? "匯入預覽：確認差異" : "匯入結果"}
          </span>
          <button className="modal-close" onClick={handleClose}><X size={16} /></button>
        </div>

        <div className="modal-body" style={{ maxHeight: "65vh", overflowY: "auto" }}>

          {step === "upload" && (
            <>
              <div style={{ border: "2px dashed #ffffff15", borderRadius: 12, padding: 40, textAlign: "center" }}>
                <p style={{ fontSize: 32, marginBottom: 12 }}>📄</p>
                <p style={{ fontSize: 14, color: "#e2e8f0", marginBottom: 8 }}>上傳 CSV 檔案</p>
                <p style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>
                  支援 UTF-8 編碼的 CSV 檔案。系統會先比對既有工項，只列出新增與有變動的項目，確認後才寫入。
                </p>
                <input type="file" accept=".csv" onChange={handleFileUpload} disabled={loading}
                  style={{ display: "none" }} id="csv-upload" />
                <label htmlFor="csv-upload" style={{
                  display: "inline-block", background: "#6366f1", border: "none",
                  borderRadius: 8, color: "#fff", fontSize: 13, fontWeight: 600,
                  padding: "10px 24px", cursor: loading ? "wait" : "pointer", opacity: loading ? 0.6 : 1,
                }}>{loading ? "比對中..." : "選擇檔案"}</label>
              </div>

              <div className="imp-template-row">
                <button onClick={() => window.open(`${import.meta.env.VITE_API_URL || "http://localhost:3000/api"}/templates/tasks`, "_blank")} style={{
                  background: "#10b98122", border: "1px solid #10b98144",
                  borderRadius: 8, color: "#10b981", fontSize: 12, fontWeight: 600,
                  padding: "8px 16px", cursor: "pointer", flexShrink: 0,
                }}>📥 下載匯入模板</button>
                <p style={{ fontSize: 11, color: "#475569", lineHeight: 1.6 }}>
                  欄位：工項ID、父工項ID、類型、任務名稱、組別、指派人、優先級、狀態、開始日期、結束日期、完成度。<br />
                  新增工項時「工項ID」留空；要修改既有工項，建議先匯出 CSV 修改後再匯入。
                </p>
              </div>
            </>
          )}

          {step === "preview" && preview && summary && (
            <>
              <div className="imp-summary">
                新增 <b style={{ color: "#10b981" }}>{summary.new}</b> 筆、
                修改 <b style={{ color: "#818cf8" }}>{summary.modified}</b> 筆、
                錯誤 <b style={{ color: "#ef4444" }}>{summary.error}</b> 筆；
                另有 <b>{summary.unchanged}</b> 筆無變動已自動略過
              </div>

              {rows.length === 0 ? (
                <p style={{ fontSize: 13, color: "#94a3b8", textAlign: "center", padding: "24px 0" }}>
                  ✅ 檔案內容與系統一致，沒有需要匯入的變更。
                </p>
              ) : (
                <>
                  <div className="imp-tabs">
                    {TABS.map((t) => (
                      <button key={t.id} onClick={() => setTab(t.id)}
                        className={`imp-tab ${tab === t.id ? "active" : ""}`}
                        style={tab === t.id ? { borderColor: t.color, color: t.color } : undefined}>
                        {t.label}（{summary[t.id]}）
                      </button>
                    ))}
                    {tab !== "error" && tabRows.length > 0 && (
                      <div className="imp-bulk">
                        {tab === "new" ? (
                          <>
                            <button onClick={() => setAll("new", "import")}>全部匯入</button>
                            <button onClick={() => setAll("new", "skip")}>全部略過</button>
                          </>
                        ) : (
                          <>
                            <button onClick={() => setAll("modified", "update")}>全部更新</button>
                            <button onClick={() => setAll("modified", "skip")}>全部略過</button>
                          </>
                        )}
                      </div>
                    )}
                  </div>

                  {tabRows.length === 0 && (
                    <p style={{ fontSize: 12, color: "#64748b", textAlign: "center", padding: "16px 0" }}>此分類沒有資料</p>
                  )}

                  <div className="imp-list">
                    {tabRows.map((r) => (
                      <RowCard key={r.key} row={r}
                        decision={effectiveDecision(r)}
                        lockedReason={r.status === "new" && parentSkipped(r) ? "父工項已略過，此子工項一併略過" : undefined}
                        onChange={(d) => setDecisions((prev) => ({ ...prev, [r.key]: d }))} />
                    ))}
                  </div>
                </>
              )}

              {preview.missingInFile.length > 0 && (
                <div className="imp-missing">
                  <button className="imp-missing-toggle" onClick={() => setShowMissing((v) => !v)}>
                    {showMissing ? "▾" : "▸"} 以下 {preview.missingInFile.length} 筆工項未出現在本次匯入檔中（僅供參考，不會做任何變更）
                  </button>
                  {showMissing && (
                    <ul>
                      {preview.missingInFile.map((m) => (
                        <li key={m.id}>
                          <span className="imp-badge">{m.kind === "task" ? "主工項" : "子工項"}</span>
                          {m.parentTitle ? `${m.parentTitle} › ` : ""}{m.title}
                          {!!m.subtaskCount && <span className="imp-muted">（含 {m.subtaskCount} 個子工項）</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              )}
            </>
          )}

          {step === "result" && result && (
            <div style={{ padding: "8px 4px" }}>
              <div style={{ textAlign: "center", marginBottom: 16 }}>
                <p style={{ fontSize: 40, marginBottom: 8 }}>{result.conflicts.length > 0 ? "⚠️" : "✅"}</p>
                <p style={{ fontSize: 15, fontWeight: 600, color: "#e2e8f0" }}>
                  成功 {result.created + result.updated} 筆（新增 {result.created}、更新 {result.updated}）
                  {result.conflicts.length > 0 && <span style={{ color: "#f59e0b" }}>、衝突 {result.conflicts.length} 筆</span>}
                </p>
                {result.skipped > 0 && <p style={{ fontSize: 12, color: "#64748b", marginTop: 4 }}>依您的選擇略過 {result.skipped} 筆</p>}
                {(() => {
                  const moved = result.statusAutoChanged ?? [];
                  const toReview = moved.filter((m) => m.to === "review").length;
                  const back = moved.length - toReview;
                  return moved.length > 0 && (
                    <p style={{ fontSize: 12, color: "#a78bfa", marginTop: 4 }}>
                      {toReview > 0 && `${toReview} 個工項完成度達 100%，已移至審查中`}
                      {toReview > 0 && back > 0 && "；"}
                      {back > 0 && `${back} 個工項完成度低於 100%，已移回進行中`}
                    </p>
                  );
                })()}
              </div>
              {result.conflicts.length > 0 && (
                <ResultList title="衝突（未寫入，請重新匯出後再處理）" color="#f59e0b" items={result.conflicts} />
              )}
              {result.notImported.length > 0 && (
                <ResultList title="未匯入" color="#94a3b8" items={result.notImported} />
              )}
            </div>
          )}

          {error && (
            <div style={{
              background: "#ef444418", border: "1px solid #ef444433", borderRadius: 8,
              color: "#ef4444", fontSize: 12, padding: "10px 14px",
            }}>{error}</div>
          )}
        </div>

        {step === "preview" && summary && summary.error > 0 && rows.length > 0 && (
          <p className="imp-error-hint">⚠️ {summary.error} 筆錯誤列將不會匯入</p>
        )}

        <div className="modal-footer">
          {step === "upload" && <button className="btn-cancel" onClick={handleClose}>取消</button>}
          {step === "preview" && (
            <>
              <button className="btn-cancel" onClick={() => { if (isDirty) setShowConfirmLeave(true); else { setStep("upload"); setPreview(null); setError(""); } }}>
                重新上傳
              </button>
              {counts.create + counts.update > 0 ? (
                <button className="btn-save" onClick={handleCommit} disabled={loading}>
                  {loading ? "匯入中..." : `確認匯入（新增 ${counts.create}、更新 ${counts.update}）`}
                </button>
              ) : (
                <button className="btn-save" onClick={onClose}>沒有要寫入的項目，關閉</button>
              )}
            </>
          )}
          {step === "result" && (
            <button className="btn-save" style={{ flex: 1 }} onClick={onClose}>完成</button>
          )}
        </div>

        {showConfirmLeave && (
          <div style={{ position: "absolute", inset: 0, background: "#000000cc", display: "flex", alignItems: "center", justifyContent: "center", borderRadius: "inherit", zIndex: 10 }}>
            <div style={{ background: "#1e293b", border: "1px solid #ef444444", borderRadius: 12, padding: 24, width: 300, maxWidth: "90%", textAlign: "center" }}>
              <p style={{ fontSize: 15, fontWeight: 600, color: "#f1f5f9", marginBottom: 8 }}>放棄變更？</p>
              <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 20, lineHeight: 1.5 }}>
                你已調整過匯入選項，離開後將遺失。<br />確定要離開嗎？
              </p>
              <div style={{ display: "flex", gap: 10, justifyContent: "center" }}>
                <button className="btn-cancel" onClick={() => setShowConfirmLeave(false)}>繼續編輯</button>
                <button onClick={onClose}
                  style={{ background: "#ef4444", border: "none", color: "#fff", borderRadius: 8, padding: "8px 20px", cursor: "pointer", fontSize: 13, fontWeight: 600 }}>
                  放棄變更
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

function RowCard({ row, decision, lockedReason, onChange }: {
  row: PreviewRow;
  decision: Decision;
  lockedReason?: string;
  onChange: (d: Decision) => void;
}) {
  const options = row.status === "error" ? [] : OPTIONS[row.status];
  return (
    <div className={`imp-card imp-card-${row.status} ${decision === "skip" ? "imp-card-skipped" : ""}`}>
      <div className="imp-card-head">
        <div className="imp-card-title">
          <span className="imp-badge">{row.kind === "task" ? "主工項" : "子工項"}</span>
          <span className="imp-muted">第 {row.rowNumber} 列</span>
          <strong>{row.title || "（未命名）"}</strong>
          {row.parentTitle && <span className="imp-muted">← {row.parentTitle}</span>}
          {row.targetId && <code className="imp-id">{row.targetId}</code>}
        </div>
        {options.length > 0 && (
          <div className="imp-actions">
            {options.map((o) => (
              <button key={o.value} disabled={!!lockedReason}
                className={`imp-opt ${decision === o.value ? "active" : ""}`}
                onClick={() => onChange(o.value)}>{o.label}</button>
            ))}
          </div>
        )}
      </div>

      {row.status === "modified" && (
        <div className="imp-changes">
          {row.changes.map((c) => (
            <div key={c.field} className="imp-change">
              <span className="imp-field">{c.fieldLabel}：</span>
              <span className="imp-old">{c.oldValue}</span>
              <span className="imp-arrow">→</span>
              <span className="imp-new">{c.newValue}</span>
            </div>
          ))}
        </div>
      )}
      {row.status === "new" && row.fields.length > 0 && (
        <div className="imp-fields">
          {row.fields.map((f) => <span key={f.label}>{f.label}：{f.value}</span>)}
        </div>
      )}
      {row.status === "error" && (
        <ul className="imp-errors">
          {row.errors.map((e, i) => <li key={i}>{e}</li>)}
        </ul>
      )}
      {lockedReason && <p className="imp-muted" style={{ marginTop: 6 }}>{lockedReason}</p>}
    </div>
  );
}

function ResultList({ title, color, items }: {
  title: string;
  color: string;
  items: { key: string; rowNumber: number; title: string; reason: string }[];
}) {
  return (
    <div style={{ marginBottom: 12 }}>
      <p style={{ fontSize: 12, fontWeight: 600, color, marginBottom: 6 }}>{title}</p>
      {items.map((c) => (
        <div key={c.key} style={{ fontSize: 12, color: "#cbd5e1", padding: "6px 10px", background: "#0f1117", borderRadius: 6, marginBottom: 4 }}>
          <span style={{ color: "#64748b", marginRight: 8 }}>第 {c.rowNumber} 列</span>{c.title}
          <div style={{ fontSize: 11, color }}>{c.reason}</div>
        </div>
      ))}
    </div>
  );
}

const IMPORT_CSS = `
  .imp-template-row { margin-top: 16px; display: flex; align-items: center; gap: 12px; }
  .imp-summary { font-size: 13px; color: #cbd5e1; background: #0f1117; border: 1px solid #ffffff0d; border-radius: 8px; padding: 10px 14px; line-height: 1.6; }
  .imp-tabs { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .imp-tab { background: none; border: 1px solid #ffffff14; border-radius: 99px; color: #94a3b8; font-size: 12px; font-weight: 600; padding: 5px 14px; cursor: pointer; }
  .imp-tab.active { background: #ffffff08; }
  .imp-bulk { margin-left: auto; display: flex; gap: 6px; }
  .imp-bulk button { background: #ffffff0d; border: none; border-radius: 6px; color: #cbd5e1; font-size: 11px; padding: 5px 10px; cursor: pointer; }
  .imp-list { display: flex; flex-direction: column; gap: 8px; }
  .imp-card { background: #0f1117; border: 1px solid #ffffff0d; border-left: 3px solid #ffffff14; border-radius: 8px; padding: 10px 12px; }
  .imp-card-new { border-left-color: #10b981; }
  .imp-card-modified { border-left-color: #6366f1; }
  .imp-card-error { border-left-color: #ef4444; }
  .imp-card-skipped { opacity: .5; }
  .imp-card-head { display: flex; align-items: flex-start; justify-content: space-between; gap: 10px; }
  .imp-card-title { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; font-size: 13px; color: #e2e8f0; min-width: 0; }
  .imp-card-title strong { word-break: break-word; }
  .imp-badge { font-size: 10px; padding: 1px 7px; border-radius: 99px; background: #6366f122; color: #a5b4fc; white-space: nowrap; }
  .imp-muted { font-size: 11px; color: #64748b; }
  .imp-id { font-size: 10px; color: #64748b; background: #ffffff08; border-radius: 4px; padding: 1px 5px; word-break: break-all; }
  .imp-actions { display: flex; gap: 4px; flex-shrink: 0; }
  .imp-opt { background: #ffffff0a; border: 1px solid transparent; border-radius: 6px; color: #94a3b8; font-size: 11px; padding: 4px 10px; cursor: pointer; white-space: nowrap; }
  .imp-opt.active { background: #6366f133; border-color: #6366f1; color: #e0e7ff; font-weight: 600; }
  .imp-opt:disabled { cursor: not-allowed; opacity: .6; }
  .imp-changes { margin-top: 8px; display: flex; flex-direction: column; gap: 4px; }
  .imp-change { font-size: 12px; display: flex; flex-wrap: wrap; align-items: baseline; gap: 4px; }
  .imp-field { color: #94a3b8; }
  .imp-old { color: #94a3b8; text-decoration: line-through; text-decoration-color: #ef4444aa; }
  .imp-arrow { color: #475569; }
  .imp-new { color: #fbbf24; font-weight: 600; }
  .imp-fields { margin-top: 6px; display: flex; flex-wrap: wrap; gap: 4px 12px; font-size: 11px; color: #94a3b8; }
  .imp-errors { margin: 6px 0 0; padding-left: 18px; font-size: 12px; color: #f87171; line-height: 1.6; }
  .imp-missing { border-top: 1px solid #ffffff0d; padding-top: 10px; }
  .imp-missing-toggle { background: none; border: none; color: #94a3b8; font-size: 12px; cursor: pointer; padding: 0; text-align: left; }
  .imp-missing ul { list-style: none; margin: 8px 0 0; padding: 0; display: flex; flex-direction: column; gap: 4px; font-size: 12px; color: #cbd5e1; }
  .imp-missing li { display: flex; align-items: center; gap: 6px; flex-wrap: wrap; }
  .imp-error-hint { margin: 0; padding: 8px 20px 0; font-size: 12px; color: #f59e0b; }
  @media (max-width: 768px) {
    .imp-template-row { flex-direction: column; align-items: flex-start; }
    .imp-card-head { flex-direction: column; }
    .imp-actions { width: 100%; }
    .imp-actions .imp-opt { flex: 1; padding: 7px 4px; }
    .imp-bulk { margin-left: 0; width: 100%; }
    .imp-bulk button { flex: 1; padding: 7px; }
    .imp-change { flex-direction: column; gap: 1px; }
    .imp-arrow { display: none; }
  }
`;
