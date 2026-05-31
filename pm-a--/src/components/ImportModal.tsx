import { useState } from "react";
import { X } from "lucide-react";
import { importTasks } from "../api";

export default function ImportModal({ projectId, onClose, onSuccess }: {
  projectId: string;
  onClose: () => void;
  onSuccess: () => void;
}) {
  const [step, setStep] = useState<"upload" | "preview" | "result">("upload");
  const [csvText, setCsvText] = useState("");
  const [previewRows, setPreviewRows] = useState<any[]>([]);
  const [headers, setHeaders] = useState<string[]>([]);
  const [importing, setImporting] = useState(false);
  const [result, setResult] = useState<any>(null);
  const [error, setError] = useState("");
  const [warnings, setWarnings] = useState<string[]>([]);

  const handleFileUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = (event) => {
      const text = event.target?.result as string;
      setCsvText(text);
      parsePreview(text);
    };
    reader.readAsText(file, "utf-8");
  };

  const parsePreview = (text: string) => {
    try {
      const cleanText = text.replace(/^﻿/, "");
      const rows = cleanText.trim().split("\n").map(line => {
        const result: string[] = [];
        let current = "";
        let inQuotes = false;
        for (const char of line) {
          if (char === '"') { inQuotes = !inQuotes; }
          else if (char === "," && !inQuotes) { result.push(current.trim()); current = ""; }
          else { current += char; }
        }
        result.push(current.trim());
        return result;
      });

      if (rows.length < 2) { setError("CSV 至少需要標題列和一筆資料"); return; }

      const hdrs = rows[0];
      const dataRows = rows.slice(1).filter(r => r.some(cell => cell));

      const typeIdx = hdrs.findIndex(h => h === "類型" || h === "type");
      const titleIdx = hdrs.findIndex(h => h === "任務名稱" || h === "title");

      if (typeIdx === -1 || titleIdx === -1) {
        setError("CSV 缺少必要欄位：「類型」和「任務名稱」");
        return;
      }

      const warns: string[] = [];
      let hasParent = false;

      dataRows.forEach((row, i) => {
        const type = row[typeIdx] || "";
        const title = row[titleIdx] || "";
        const rowNum = i + 2;

        if (!type) {
          warns.push(`第 ${rowNum} 列：缺少「類型」，請填入「主工項」或「子工項」`);
        } else if (!["主工項", "子工項", "subtask", "子任務"].includes(type)) {
          warns.push(`第 ${rowNum} 列：「類型」必須是「主工項」或「子工項」，目前是「${type}」`);
        }

        if (!title) {
          warns.push(`第 ${rowNum} 列：缺少「任務名稱」`);
        }

        if (type === "子工項" || type === "subtask" || type === "子任務") {
          if (!hasParent) warns.push(`第 ${rowNum} 列：子工項「${title}」前面沒有主工項`);
        } else if (type === "主工項") {
          hasParent = true;
        }
      });

      setHeaders(hdrs);
      setPreviewRows(dataRows);
      setWarnings(warns);
      setError("");
      setStep("preview");
    } catch {
      setError("CSV 格式解析失敗");
    }
  };

  const handleImport = async () => {
    try {
      setImporting(true);
      setError("");
      const res = await importTasks(projectId, csvText);
      setResult(res);
      setStep("result");
      onSuccess();
    } catch (err: any) {
      setError(err.message || "匯入失敗");
    } finally {
      setImporting(false);
    }
  };

  const hasBlockingErrors = warnings.some(w => w.includes("缺少"));

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" style={{ width: 680 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-label">
            {step === "upload" ? "匯入任務" : step === "preview" ? "預覽匯入資料" : "匯入結果"}
          </span>
          <button className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="modal-body" style={{ maxHeight: "65vh", overflowY: "auto" }}>

          {step === "upload" && (
            <>
              <div style={{ border: "2px dashed #ffffff15", borderRadius: 12, padding: 40, textAlign: "center" }}>
                <p style={{ fontSize: 32, marginBottom: 12 }}>📄</p>
                <p style={{ fontSize: 14, color: "#e2e8f0", marginBottom: 8 }}>上傳 CSV 檔案</p>
                <p style={{ fontSize: 12, color: "#64748b", marginBottom: 16 }}>支援 UTF-8 編碼的 CSV 檔案</p>
                <input type="file" accept=".csv" onChange={handleFileUpload}
                  style={{ display: "none" }} id="csv-upload" />
                <label htmlFor="csv-upload" style={{
                  display: "inline-block", background: "#6366f1", border: "none",
                  borderRadius: 8, color: "#fff", fontSize: 13, fontWeight: 600,
                  padding: "10px 24px", cursor: "pointer"
                }}>選擇檔案</label>
              </div>

              <div style={{ marginTop: 16, display: "flex", alignItems: "center", justifyContent: "space-between" }}>
                <button onClick={() => window.open(`${import.meta.env.VITE_API_URL || "http://localhost:3000/api"}/templates/tasks`, "_blank")} style={{
                  background: "#10b98122", border: "1px solid #10b98144",
                  borderRadius: 8, color: "#10b981", fontSize: 12, fontWeight: 600,
                  padding: "8px 16px", cursor: "pointer"
                }}>📥 下載匯入模板</button>
                <p style={{ fontSize: 11, color: "#475569" }}>
                  模板欄位：類型、任務名稱、優先級、開始日期、結束日期、完成度
                </p>
              </div>
            </>
          )}

          {step === "preview" && (
            <>
              <div style={{ marginBottom: 12 }}>
                <p style={{ fontSize: 13, color: "#e2e8f0", marginBottom: 4 }}>
                  共 {previewRows.length} 筆資料待匯入
                </p>
                {warnings.length === 0 ? (
                  <p style={{ fontSize: 11, color: "#10b981" }}>✅ 資料檢查通過，請確認後按「確認匯入」</p>
                ) : (
                  <div style={{
                    background: "#f59e0b18", border: "1px solid #f59e0b33", borderRadius: 8,
                    padding: "10px 14px", marginTop: 8
                  }}>
                    <p style={{ fontSize: 12, fontWeight: 600, color: "#f59e0b", marginBottom: 6 }}>
                      ⚠️ 發現 {warnings.length} 個問題，建議修正後再匯入：
                    </p>
                    {warnings.map((w, i) => (
                      <p key={i} style={{ fontSize: 11, color: "#f59e0b", lineHeight: 1.6 }}>• {w}</p>
                    ))}
                  </div>
                )}
              </div>
              <div style={{ overflowX: "auto", borderRadius: 8, border: "1px solid #ffffff08" }}>
                <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 11 }}>
                  <thead>
                    <tr>
                      {headers.map((h, i) => (
                        <th key={i} style={{
                          background: "#1a2030", color: "#94a3b8", fontWeight: 600,
                          padding: "8px 10px", textAlign: "left", borderBottom: "1px solid #ffffff08",
                          whiteSpace: "nowrap"
                        }}>{h}</th>
                      ))}
                    </tr>
                  </thead>
                  <tbody>
                    {previewRows.map((row, i) => (
                      <tr key={i}>
                        {row.map((cell: string, j: number) => (
                          <td key={j} style={{
                            padding: "6px 10px", borderBottom: "1px solid #ffffff06",
                            color: row[0] === "子工項" ? "#64748b" : "#e2e8f0",
                            paddingLeft: row[0] === "子工項" && j === 1 ? 24 : 10,
                          }}>{cell}</td>
                        ))}
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </>
          )}

          {step === "result" && result && (
            <div style={{ textAlign: "center", padding: 20 }}>
              <p style={{ fontSize: 48, marginBottom: 12 }}>✅</p>
              <p style={{ fontSize: 16, fontWeight: 600, color: "#10b981", marginBottom: 8 }}>匯入成功！</p>
              <p style={{ fontSize: 13, color: "#94a3b8", marginBottom: 20 }}>共匯入 {result.imported} 筆資料</p>
              <div style={{ textAlign: "left", maxHeight: 200, overflowY: "auto" }}>
                {result.details?.map((d: any, i: number) => (
                  <div key={i} style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 0", fontSize: 12, color: "#94a3b8" }}>
                    <span style={{
                      fontSize: 9, padding: "1px 6px", borderRadius: 99,
                      background: d.type === "task" ? "#6366f122" : "#10b98122",
                      color: d.type === "task" ? "#6366f1" : "#10b981"
                    }}>{d.type === "task" ? "主工項" : "子工項"}</span>
                    <span>{d.title}</span>
                    {d.parentTask && <span style={{ fontSize: 10, color: "#475569" }}>← {d.parentTask}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {error && (
            <div style={{
              background: "#ef444418", border: "1px solid #ef444433", borderRadius: 8,
              color: "#ef4444", fontSize: 12, padding: "10px 14px", marginTop: 12
            }}>{error}</div>
          )}
        </div>

        <div className="modal-footer">
          {step === "upload" && <button className="btn-cancel" onClick={onClose}>取消</button>}
          {step === "preview" && (
            <>
              <button className="btn-cancel" onClick={() => { setStep("upload"); setWarnings([]); }}>返回</button>
              <button className="btn-save" onClick={handleImport}
                disabled={importing || hasBlockingErrors}
                style={{ opacity: hasBlockingErrors ? 0.4 : 1 }}>
                {importing ? "匯入中..." : hasBlockingErrors ? "請先修正錯誤" : "確認匯入"}
              </button>
            </>
          )}
          {step === "result" && (
            <button className="btn-save" style={{ flex: 1 }} onClick={onClose}>完成</button>
          )}
        </div>
      </div>
    </div>
  );
}

// ── OKRView ───────────────────────────────────────────────────────────
