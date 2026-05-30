import { useState, useEffect } from "react";
import { login, register, getGroups } from "./api";
import { t } from "./i18n";

export default function LoginPage({ onLogin }: { onLogin: () => void }) {
  const [isRegister, setIsRegister] = useState(false);
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [name, setName] = useState("");
  const [memberId, setMemberId] = useState("");
  const [groupId, setGroupId] = useState("");
  const [groups, setGroups] = useState<any[]>([]);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [registerSuccess, setRegisterSuccess] = useState(false);

  useEffect(() => {
    getGroups().then(setGroups).catch(console.error);
  }, []);

  const handleSubmit = async () => {
    setError("");
    setLoading(true);
    try {
      if (isRegister) {
        if (!email || !password || !name || !memberId || !groupId) {
          setError(t("login.fillAll"));
          setLoading(false);
          return;
        }
        await register(email, password, name, memberId, groupId);
        setIsRegister(false);
        setError("");
        setPassword("");
        setRegisterSuccess(true);
      } else {
        if (!email || !password) {
          setError(t("login.fillLogin"));
          setLoading(false);
          return;
        }
        await login(email, password);
        onLogin();
      }
    } catch (err: any) {
      setError(err.message || "操作失敗");
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <style>{`
        .login-bg {
          min-height: 100vh; display: flex; align-items: center; justify-content: center;
          background: #0f1117; font-family: 'Segoe UI', system-ui, sans-serif;
        }
        .login-card {
          background: #161b27; border-radius: 16px; border: 1px solid #ffffff08;
          padding: 40px; width: 400px; max-width: 95vw;
          box-shadow: 0 24px 64px #000a;
        }
        .login-title {
          font-size: 22px; font-weight: 700; color: #f1f5f9;
          text-align: center; margin-bottom: 4px; letter-spacing: -0.5px;
        }
        .login-subtitle {
          font-size: 13px; color: #64748b; text-align: center; margin-bottom: 28px;
        }
        .login-field {
          display: flex; flex-direction: column; gap: 6px; margin-bottom: 16px;
        }
        .login-label {
          font-size: 12px; font-weight: 600; color: #64748b;
          text-transform: uppercase; letter-spacing: .04em;
        }
        .login-input {
          background: #0f1117; border: 1px solid #ffffff12; border-radius: 10px;
          padding: 12px 14px; color: #e2e8f0; font-size: 14px;
          outline: none; font-family: inherit; transition: border-color .15s;
          width: 100%; box-sizing: border-box;
        }
        .login-input:focus { border-color: #6366f1; }
        .login-input::placeholder { color: #475569; }
        .login-btn {
          width: 100%; background: #6366f1; border: none; border-radius: 10px;
          color: #fff; font-size: 14px; font-weight: 600; padding: 12px;
          cursor: pointer; transition: background .15s; margin-top: 8px;
        }
        .login-btn:hover { background: #4f46e5; }
        .login-btn:disabled { opacity: 0.5; cursor: not-allowed; }
        .login-error {
          background: #ef444418; border: 1px solid #ef444433; border-radius: 8px;
          color: #ef4444; font-size: 12px; padding: 10px 14px; margin-bottom: 16px;
        }
        .login-switch {
          text-align: center; margin-top: 20px; font-size: 13px; color: #64748b;
        }
        .login-switch button {
          background: none; border: none; color: #6366f1; cursor: pointer;
          font-size: 13px; font-weight: 600; padding: 0; margin-left: 4px;
        }
        .login-switch button:hover { text-decoration: underline; }
        .login-logo {
          font-size: 32px; text-align: center; margin-bottom: 16px;
        }
      `}</style>

      <div className="login-bg">
        <div className="login-card">
          <div className="login-logo">📋</div>
          <div className="login-title">{t("login.title")}</div>
          <div className="login-subtitle">
            {isRegister ? t("login.createAccount") : t("login.loginAccount")}
          </div>

          {error && <div className="login-error">{error}</div>}

          {registerSuccess && !isRegister && (
            <div style={{
              background: "#10b98118", border: "1px solid #10b98133", borderRadius: 8,
              color: "#10b981", fontSize: 12, padding: "10px 14px", marginBottom: 16
            }}>
              {t("login.registerSuccess")}
            </div>
          )}

          {isRegister && (
            <>
              <div className="login-field">
                <label className="login-label">{t("login.name")}</label>
                <input className="login-input" value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder={t("login.name")} />
              </div>
              <div className="login-field">
                <label className="login-label">{t("login.memberId")}</label>
                <input className="login-input" value={memberId}
                  onChange={(e) => setMemberId(e.target.value)}
                  placeholder="A001" />
              </div>
              <div className="login-field">
                <label className="login-label">{t("login.group")}</label>
                <select className="login-input" value={groupId}
                  onChange={(e) => setGroupId(e.target.value)}
                  style={{ cursor: "pointer" }}>
                  <option value="">{t("login.selectGroup")}</option>
                  {groups.map((g: any) => (
                    <option key={g.id} value={g.id}>{g.name}</option>
                  ))}
                </select>
              </div>
            </>
          )}

          <div className="login-field">
            <label className="login-label">{t("login.email")}</label>
            <input className="login-input" type="email" value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="name@company.com"
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }} />
          </div>

          <div className="login-field">
            <label className="login-label">{t("login.password")}</label>
            <input className="login-input" type="password" value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t("login.password")}
              onKeyDown={(e) => { if (e.key === "Enter") handleSubmit(); }} />
          </div>

          <button className="login-btn" onClick={handleSubmit} disabled={loading}>
            {loading ? t("login.processing") : isRegister ? t("login.registerBtn") : t("login.loginBtn")}
          </button>

          <div className="login-switch">
            {isRegister ? t("login.hasAccount") : t("login.noAccount")}
            <button onClick={() => { setIsRegister(!isRegister); setError(""); setRegisterSuccess(false); }}>
              {isRegister ? t("login.loginBtn") : t("login.registerBtn")}
            </button>
          </div>
        </div>
      </div>
    </>
  );
}
