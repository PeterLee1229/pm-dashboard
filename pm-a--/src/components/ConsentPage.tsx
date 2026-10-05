import { useEffect, useState } from "react";
import LoginPage from "../LoginPage";
import { decideOAuthConsent, getCurrentUser, getOAuthConsent, isLoggedIn } from "../api";

type ConsentInfo = { mcpEnabled: boolean; mcpWriteEnabled: boolean; clientName: string; redirectHost: string; scopes: string[] };

const scopeRow: React.CSSProperties = {
  display: "flex", gap: 10, alignItems: "flex-start", padding: "12px 14px", borderRadius: 10,
  border: "1px solid #ffffff12", background: "#0f1117",
};

const page: React.CSSProperties = {
  minHeight: "100vh", background: "#0f1117", color: "#e2e8f0",
  fontFamily: "'Segoe UI', system-ui, sans-serif",
  display: "flex", alignItems: "center", justifyContent: "center", padding: 16,
};
const card: React.CSSProperties = {
  width: "100%", maxWidth: 440, background: "#161b27", borderRadius: 16,
  border: "1px solid #ffffff10", padding: "32px 28px",
};

/** /oauth/consent：AI 服務（例如 claude.ai）要求以使用者身分讀取資料時的授權同意頁 */
export default function ConsentPage() {
  const request = new URLSearchParams(window.location.search).get("request") || "";
  const [loggedIn, setLoggedIn] = useState(isLoggedIn());
  const [info, setInfo] = useState<ConsentInfo | null>(null);
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  // 寫入預設勾選（AI 服務有要求時）；使用者可以取消
  const [writeChoice, setWriteChoice] = useState<boolean | null>(null);

  useEffect(() => {
    if (!loggedIn || !request) return;
    getOAuthConsent(request)
      .then(setInfo)
      .catch((err: Error) => {
        // 登入過期時 apiFetch 會清除 token，回到登入畫面
        if (!isLoggedIn()) setLoggedIn(false);
        else setError(err.message);
      });
  }, [loggedIn, request]);

  // 未登入時先登入，登入後留在同一頁繼續授權
  if (!loggedIn) return <LoginPage onLogin={() => setLoggedIn(true)} />;

  const decide = async (approve: boolean) => {
    setSubmitting(true);
    try {
      const scopes = approve ? ["pm:read", ...(writeRequested && allowWrite ? ["pm:write"] : [])] : undefined;
      const { redirectUrl } = await decideOAuthConsent(request, approve, scopes);
      window.location.href = redirectUrl;
    } catch (err) {
      setError((err as Error).message);
      setSubmitting(false);
    }
  };

  const user = getCurrentUser();
  const writeRequested = !!info?.scopes.includes("pm:write");
  const allowWrite = writeChoice ?? true;

  return (
    <div style={page}>
      <div style={card}>
        <p style={{ fontSize: 12, color: "#6366f1", fontWeight: 600, marginBottom: 8 }}>PM Dashboard</p>
        <h1 style={{ fontSize: 20, fontWeight: 700, marginBottom: 20 }}>授權 AI 連線</h1>

        {!request || error ? (
          <p style={{ fontSize: 14, color: "#f87171", lineHeight: 1.6 }}>{error || "缺少授權請求，請回到 AI 服務重新連線"}</p>
        ) : !info ? (
          <p style={{ fontSize: 14, color: "#64748b" }}>載入中...</p>
        ) : !info.mcpEnabled ? (
          <div>
            <p style={{ fontSize: 15, fontWeight: 600, color: "#f59e0b", marginBottom: 8 }}>系統未開放 AI 連線</p>
            <p style={{ fontSize: 13, color: "#94a3b8", lineHeight: 1.6 }}>請聯繫系統管理員開啟「AI 連線（MCP）」後再試一次。</p>
          </div>
        ) : (
          <>
            <p style={{ fontSize: 15, lineHeight: 1.7, marginBottom: 16 }}>
              <strong style={{ color: "#f1f5f9" }}>{info.clientName}</strong>
              <span style={{ color: "#94a3b8" }}>（{info.redirectHost}）</span>
              要求以你的身分存取 PM Dashboard 資料。
            </p>
            <div style={{ display: "flex", flexDirection: "column", gap: 8, marginBottom: 16 }}>
              <label style={{ ...scopeRow, cursor: "default" }}>
                <input type="checkbox" checked disabled style={{ marginTop: 3 }} />
                <span>
                  <strong style={{ fontSize: 14, color: "#e2e8f0" }}>讀取</strong>
                  <span style={{ fontSize: 11, color: "#64748b", marginLeft: 6 }}>（必要）</span>
                  <span style={{ display: "block", fontSize: 12, color: "#94a3b8", marginTop: 2, lineHeight: 1.6 }}>
                    讀取專案、任務、會議、風險、週報、OKR 與活動紀錄
                  </span>
                </span>
              </label>
              {writeRequested && (
                <label style={{ ...scopeRow, cursor: "pointer", borderColor: allowWrite ? "#6366f155" : "#ffffff12" }}>
                  <input type="checkbox" checked={allowWrite} onChange={(e) => setWriteChoice(e.target.checked)} style={{ marginTop: 3 }} />
                  <span>
                    <strong style={{ fontSize: 14, color: "#e2e8f0" }}>寫入</strong>
                    <span style={{ fontSize: 11, color: "#64748b", marginLeft: 6 }}>（可取消）</span>
                    <span style={{ display: "block", fontSize: 12, color: "#94a3b8", marginTop: 2, lineHeight: 1.6 }}>
                      建立與更新任務、新增留言、會議紀錄與風險。不能刪除任何資料，操作會標示「via {info.clientName}」並留下稽核紀錄
                    </span>
                    {!info.mcpWriteEnabled && (
                      <span style={{ display: "block", fontSize: 11, color: "#f59e0b", marginTop: 4 }}>
                        系統目前尚未開放 AI 寫入，管理員開啟後才能使用
                      </span>
                    )}
                  </span>
                </label>
              )}
            </div>
            <ul style={{ fontSize: 12, color: "#64748b", lineHeight: 1.8, paddingLeft: 18, marginBottom: 20 }}>
              <li>可存取的範圍依你在各專案的角色而定，與你在網頁上的權限相同</li>
              <li>資料會傳送到這個 AI 服務；你可以隨時在「已授權的 AI 連線」撤銷</li>
            </ul>
            {user && (
              <p style={{ fontSize: 12, color: "#64748b", marginBottom: 20 }}>
                目前登入：{user.name}（{user.memberId}）
              </p>
            )}
            <div style={{ display: "flex", gap: 10 }}>
              <button disabled={submitting} onClick={() => decide(false)} style={{
                flex: 1, padding: "10px 0", borderRadius: 8, border: "1px solid #ffffff20",
                background: "transparent", color: "#94a3b8", fontSize: 14, cursor: "pointer",
              }}>拒絕</button>
              <button disabled={submitting} onClick={() => decide(true)} style={{
                flex: 1, padding: "10px 0", borderRadius: 8, border: "none",
                background: "#6366f1", color: "#fff", fontSize: 14, fontWeight: 600, cursor: "pointer",
                opacity: submitting ? 0.6 : 1,
              }}>允許</button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
