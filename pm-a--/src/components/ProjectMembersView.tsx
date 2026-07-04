import { useState, useEffect } from "react";
import { X } from "lucide-react";
import { getProjectMembers, addProjectMember, removeProjectMember, updateProjectMemberRole, getUsers, transferOwner } from "../api";
import { ListSkeleton, Skeleton, useDelayedLoading } from "./LoadingEmpty";

export function AddMemberModal({ availableUsers, onAdd, onClose, currentUser, currentProjectRole }: {
  availableUsers: any[];
  onAdd: (userId: string, role: string) => void;
  onClose: () => void;
  currentUser: any;
  currentProjectRole: string;
}) {
  const [selectedGroupId, setSelectedGroupId] = useState("");
  const [selectedUserId, setSelectedUserId] = useState("");
  const [selectedRole, setSelectedRole] = useState("member");

  const groupMap = new Map<string, { id: string; name: string; color: string }>();
  availableUsers.forEach(u => { if (u.group) groupMap.set(u.group.id, u.group); });
  const allGroups = Array.from(groupMap.values());
  const groups = currentProjectRole === "group_leader"
    ? allGroups.filter(g => g.id === currentUser?.group?.id)
    : allGroups;

  const filteredUsers = selectedGroupId
    ? availableUsers.filter(u => u.group?.id === selectedGroupId)
    : [];

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: 520 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-label">邀請成員加入專案</span>
          <button className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">

          {/* 選擇組別 */}
          <div className="field">
            <label className="field-label">選擇組別</label>
            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
              {groups.length === 0 ? (
                <p style={{ fontSize: 12, color: "#475569" }}>沒有可邀請的使用者</p>
              ) : groups.map(g => (
                <button key={g.id}
                  onClick={() => { setSelectedGroupId(g.id); setSelectedUserId(""); }}
                  style={{
                    background: selectedGroupId === g.id ? g.color + "22" : "transparent",
                    border: `1px solid ${selectedGroupId === g.id ? g.color : "#ffffff15"}`,
                    color: selectedGroupId === g.id ? g.color : "#64748b",
                    borderRadius: 8, padding: "6px 14px", fontSize: 12, fontWeight: 600, cursor: "pointer"
                  }}>
                  {g.name}
                </button>
              ))}
            </div>
          </div>

          {/* 選擇人員 */}
          {selectedGroupId && (
            <div className="field">
              <label className="field-label">選擇人員</label>
              {filteredUsers.length === 0 ? (
                <p style={{ fontSize: 12, color: "#475569" }}>該組別沒有可邀請的人員</p>
              ) : (
                <div style={{ maxHeight: 180, overflowY: "auto", display: "flex", flexDirection: "column", gap: 4 }}>
                  {filteredUsers.map(u => (
                    <div key={u.id} onClick={() => setSelectedUserId(u.id)} style={{
                      display: "flex", alignItems: "center", justifyContent: "space-between",
                      padding: "8px 12px", borderRadius: 8, cursor: "pointer",
                      background: selectedUserId === u.id ? "#6366f122" : "#0f1117",
                      border: `1px solid ${selectedUserId === u.id ? "#6366f1" : "#ffffff08"}`,
                    }}>
                      <div>
                        <span style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 600 }}>{u.name}</span>
                        <span style={{ fontSize: 11, color: "#64748b", marginLeft: 8 }}>({u.memberId})</span>
                      </div>
                      <span style={{ fontSize: 11, color: "#475569" }}>{u.email}</span>
                    </div>
                  ))}
                </div>
              )}
            </div>
          )}

          {/* 角色選擇 */}
          {selectedUserId && (
            <div className="field">
              <label className="field-label">指定專案角色</label>
              <div style={{ display: "flex", gap: 6 }}>
                {[
                  { value: "pm",           label: "PM",           color: "#f59e0b" },
                  { value: "group_leader", label: "Group Leader", color: "#8b5cf6" },
                  { value: "member",       label: "Member",       color: "#6366f1" },
                  { value: "viewer",       label: "Viewer",       color: "#64748b" },
                ].map(r => (
                  <button key={r.value} onClick={() => setSelectedRole(r.value)} style={{
                    flex: 1, borderRadius: 8, padding: 8, fontSize: 12, fontWeight: 600, cursor: "pointer",
                    background: selectedRole === r.value ? r.color + "22" : "transparent",
                    border: `1px solid ${selectedRole === r.value ? r.color : "#ffffff15"}`,
                    color: selectedRole === r.value ? r.color : "#64748b"
                  }}>{r.label}</button>
                ))}
              </div>
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-cancel" onClick={onClose}>取消</button>
          <button className="btn-save" onClick={() => { if (selectedUserId) onAdd(selectedUserId, selectedRole); }}
            style={{ opacity: selectedUserId ? 1 : 0.4 }}>
            邀請加入
          </button>
        </div>
      </div>
    </div>
  );
}

// ── TransferOwnerModal ────────────────────────────────────────────────

function TransferOwnerModal({ projectId, projectName, members, currentOwnerId, onSuccess, onClose }: {
  projectId: string;
  projectName: string;
  members: any[];
  currentOwnerId: string;
  onSuccess: () => void;
  onClose: () => void;
}) {
  const [selectedUserId, setSelectedUserId] = useState("");
  const [confirmInput, setConfirmInput] = useState("");
  const [saving, setSaving] = useState(false);

  const candidates = members.filter(m => m.userId !== currentOwnerId && m.role !== "owner");
  const isConfirmed = confirmInput.trim() === projectName.trim();

  const handleTransfer = async () => {
    if (!selectedUserId || !isConfirmed) return;
    setSaving(true);
    try {
      await transferOwner(projectId, selectedUserId);
      onSuccess();
      onClose();
    } catch (err: any) {
      alert(err.message || "轉移失敗");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay">
      <div className="modal" style={{ width: 480 }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <span className="modal-label">轉移 Owner</span>
          <button className="modal-close" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          <div style={{ background: "#f59e0b18", border: "1px solid #f59e0b44", borderRadius: 8, padding: "10px 14px", fontSize: 12, color: "#f59e0b", lineHeight: 1.6 }}>
            ⚠️ 轉移後你將降級為 PM，此操作無法自行撤銷。
          </div>

          <div className="field">
            <label className="field-label">選擇新 Owner</label>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 200, overflowY: "auto" }}>
              {candidates.length === 0 ? (
                <p style={{ fontSize: 12, color: "#475569", textAlign: "center", padding: 12 }}>沒有可選擇的成員</p>
              ) : candidates.map(m => (
                <div key={m.userId} onClick={() => setSelectedUserId(m.userId)} style={{
                  display: "flex", alignItems: "center", gap: 10,
                  padding: "10px 12px", borderRadius: 8, cursor: "pointer",
                  background: selectedUserId === m.userId ? "#6366f122" : "#0f1117",
                  border: `1px solid ${selectedUserId === m.userId ? "#6366f1" : "#ffffff08"}`,
                }}>
                  <div style={{ flex: 1 }}>
                    <span style={{ fontSize: 13, color: "#e2e8f0", fontWeight: 600 }}>{m.user?.name}</span>
                    <span style={{ fontSize: 11, color: "#64748b", marginLeft: 8 }}>({m.user?.memberId})</span>
                  </div>
                  <span style={{ fontSize: 10, color: "#64748b" }}>{m.role}</span>
                </div>
              ))}
            </div>
          </div>

          {selectedUserId && (
            <div className="field">
              <label className="field-label">輸入專案名稱確認</label>
              <p style={{ fontSize: 12, color: "#64748b", marginBottom: 6 }}>請輸入「{projectName}」以確認操作</p>
              <input className="field-input" value={confirmInput}
                onChange={(e) => setConfirmInput(e.target.value)}
                placeholder={projectName} />
            </div>
          )}
        </div>
        <div className="modal-footer">
          <button className="btn-cancel" onClick={onClose}>取消</button>
          <button className="btn-save"
            disabled={!selectedUserId || !isConfirmed || saving}
            onClick={handleTransfer}
            style={{ background: "#ef4444", opacity: (!selectedUserId || !isConfirmed || saving) ? 0.4 : 1 }}>
            {saving ? "轉移中…" : "確認轉移"}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── AdminView ────────────────────────────────────────────────────────

export default function ProjectMembersView({ projectId, projectName, currentUser, currentProjectRole, onMembersChange }: {
  projectId: string;
  projectName: string;
  currentUser: any;
  currentProjectRole: string;
  onMembersChange?: () => void;
}) {
  const [members, setMembers] = useState<any[]>([]);
  const [allUsers, setAllUsers] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAddModal, setShowAddModal] = useState(false);
  const [showTransferModal, setShowTransferModal] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState<string | null>(null);

  useEffect(() => { loadData(); }, [projectId]);

  const loadData = async () => {
    try {
      setLoading(true);
      const [membersData, usersData] = await Promise.all([
        getProjectMembers(projectId),
        getUsers(),
      ]);
      setMembers(membersData);
      setAllUsers(usersData);
    } catch (err) {
      console.error("載入成員失敗:", err);
    } finally {
      setLoading(false);
    }
  };

  const handleRoleChange = async (userId: string, newRole: string) => {
    try {
      await updateProjectMemberRole(projectId, userId, newRole);
      setMembers(prev => prev.map(m => m.userId === userId ? { ...m, role: newRole } : m));
    } catch (err: any) {
      alert(err.message || "變更角色失敗");
    }
  };

  const handleRemove = async (userId: string) => {
    try {
      await removeProjectMember(projectId, userId);
      setMembers(prev => prev.filter(m => m.userId !== userId));
      onMembersChange?.();
    } catch (err: any) {
      alert(err.message || "移除成員失敗");
    }
  };

  const handleAdd = async (userId: string, role: string) => {
    try {
      const member = await addProjectMember(projectId, userId, role);
      setMembers(prev => [...prev, member]);
      setShowAddModal(false);
      onMembersChange?.();
    } catch (err: any) {
      alert(err.message || "邀請成員失敗");
    }
  };

  const PROJECT_ROLES = [
    { value: "owner",        label: "Owner",        color: "#ef4444" },
    { value: "pm",           label: "PM",           color: "#f59e0b" },
    { value: "group_leader", label: "Group Leader", color: "#8b5cf6" },
    { value: "member",       label: "Member",       color: "#6366f1" },
    { value: "viewer",       label: "Viewer",       color: "#64748b" },
  ];

  const memberUserIds = members.map(m => m.userId);
  const availableUsers = allUsers.filter(u => !memberUserIds.includes(u.id));

  const showSkeleton = useDelayedLoading(loading);
  if (loading) {
    if (!showSkeleton) return null;
    return (
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        <Skeleton width={160} height={22} />
        <div className="stats-grid-5" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
          {[0, 1, 2, 3, 4].map((i) => (
            <div key={i} style={{ background: "#161b27", borderRadius: 10, padding: "14px 18px", border: "1px solid #ffffff08" }}>
              <Skeleton width="60%" height={11} style={{ marginBottom: 8 }} />
              <Skeleton width={32} height={24} />
            </div>
          ))}
        </div>
        <ListSkeleton rows={4} />
      </div>
    );
  }

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
      <h2 style={{ color: "#f1f5f9", fontSize: 22, fontWeight: 700, margin: 0 }}>專案成員管理</h2>

      {/* 統計卡片 */}
      <div className="stats-grid-5" style={{ display: "grid", gridTemplateColumns: "repeat(5, 1fr)", gap: 12 }}>
        {PROJECT_ROLES.map(r => (
          <div key={r.value} style={{
            background: "#161b27", borderRadius: 10, padding: "14px 18px",
            border: `1px solid ${r.color}22`
          }}>
            <p style={{ fontSize: 11, color: "#64748b", marginBottom: 4 }}>{r.label}</p>
            <p style={{ fontSize: 24, fontWeight: 700, color: r.color }}>
              {members.filter(m => m.role === r.value).length}
            </p>
          </div>
        ))}
      </div>

      {/* 成員列表 */}
      <div style={{ background: "#161b27", borderRadius: 12, border: "1px solid #ffffff08", overflow: "hidden" }}>
        <div style={{
          display: "flex", alignItems: "center", justifyContent: "space-between",
          padding: "14px 20px", background: "#1a2030", borderBottom: "1px solid #ffffff08"
        }}>
          <span style={{ fontSize: 14, fontWeight: 600, color: "#e2e8f0" }}>
            {projectName} — 專案成員
          </span>
          <div style={{ display: "flex", gap: 8 }}>
            {(currentProjectRole === "owner" || currentProjectRole === "admin") && (
              <button onClick={() => setShowTransferModal(true)} style={{
                background: "#ef444418", border: "1px solid #ef444444",
                borderRadius: 8, color: "#ef4444", fontSize: 12, fontWeight: 600,
                padding: "6px 16px", cursor: "pointer"
              }}>
                轉移 Owner
              </button>
            )}
            <button onClick={() => setShowAddModal(true)} style={{
              background: "#6366f122", border: "1px solid #6366f144",
              borderRadius: 8, color: "#6366f1", fontSize: 12, fontWeight: 600,
              padding: "6px 16px", cursor: "pointer"
            }}>
              + 邀請成員
            </button>
          </div>
        </div>

        <div style={{
          display: "grid", gridTemplateColumns: "1fr 80px 100px 140px 120px 60px",
          padding: "10px 20px", borderBottom: "1px solid #ffffff08",
          fontSize: 11, color: "#475569", fontWeight: 600
        }}>
          <span>姓名</span>
          <span>組別</span>
          <span>員工編號</span>
          <span>Email</span>
          <span style={{ textAlign: "center" }}>專案角色</span>
          <span style={{ textAlign: "center" }}>操作</span>
        </div>

        {members.map((m) => {
          const canRemove = m.role !== "owner" && m.userId !== currentUser?.id &&
            (currentProjectRole !== "group_leader" || m.user?.group?.id === currentUser?.group?.id);
          const isConfirming = confirmRemove === m.userId;
          return (
            <div key={m.id} style={{
              display: "grid",
              gridTemplateColumns: isConfirming ? "1fr" : "1fr 80px 100px 140px 120px 60px",
              padding: "12px 20px", borderBottom: "1px solid #ffffff06",
              alignItems: "center", fontSize: 13
            }}>
              {isConfirming ? (
                <div style={{ display: "flex", alignItems: "center", gap: 12 }}>
                  <span style={{ flex: 1, fontSize: 13, color: "#ef4444" }}>
                    確定要將 <strong>{m.user?.name}</strong> 移出此專案嗎？
                  </span>
                  <button onClick={() => setConfirmRemove(null)}
                    style={{ background: "#ffffff12", border: "1px solid #ffffff20", borderRadius: 6, color: "#94a3b8", fontSize: 12, padding: "5px 14px", cursor: "pointer" }}>
                    取消
                  </button>
                  <button onClick={() => { handleRemove(m.userId); setConfirmRemove(null); }}
                    style={{ background: "#ef444422", border: "1px solid #ef444466", borderRadius: 6, color: "#ef4444", fontSize: 12, fontWeight: 600, padding: "5px 14px", cursor: "pointer" }}>
                    確認移除
                  </button>
                </div>
              ) : (
                <>
                  <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
                    <span style={{ color: "#e2e8f0", fontWeight: 600 }}>{m.user?.name || "未知"}</span>
                    {m.userId === currentUser?.id && (
                      <span style={{ fontSize: 9, padding: "1px 6px", borderRadius: 99, background: "#6366f122", color: "#6366f1" }}>你</span>
                    )}
                  </div>
                  <div>
                    {m.user?.group ? (
                      <span style={{
                        fontSize: 10, padding: "2px 7px", borderRadius: 99,
                        background: m.user.group.color + "22", color: m.user.group.color,
                        border: `1px solid ${m.user.group.color}33`
                      }}>{m.user.group.name}</span>
                    ) : (
                      <span style={{ fontSize: 10, color: "#475569" }}>未分組</span>
                    )}
                  </div>
                  <span style={{ color: "#94a3b8" }}>{m.user?.memberId || ""}</span>
                  <span style={{ color: "#64748b", fontSize: 11, overflow: "hidden", textOverflow: "ellipsis" }}>{m.user?.email || ""}</span>
                  <div style={{ textAlign: "center" }}>
                    {m.role === "owner" ? (
                      <span style={{ fontSize: 10, padding: "3px 10px", borderRadius: 99, background: "#ef444422", color: "#ef4444" }}>Owner</span>
                    ) : (
                      <select value={m.role} onChange={(e) => handleRoleChange(m.userId, e.target.value)} style={{
                        background: "#0f1117", border: "1px solid #ffffff12", borderRadius: 6,
                        color: "#e2e8f0", fontSize: 11, padding: "4px 8px", cursor: "pointer", outline: "none"
                      }}>
                        <option value="pm">PM</option>
                        <option value="group_leader">Group Leader</option>
                        <option value="member">Member</option>
                        <option value="viewer">Viewer</option>
                      </select>
                    )}
                  </div>
                  <div style={{ textAlign: "center" }}>
                    {canRemove && (
                      <button onClick={() => setConfirmRemove(m.userId)} style={{
                        background: "#ef444418", border: "1px solid #ef444433",
                        borderRadius: 6, color: "#ef4444", fontSize: 10,
                        padding: "4px 8px", cursor: "pointer"
                      }}>移除</button>
                    )}
                  </div>
                </>
              )}
            </div>
          );
        })}

        {members.length === 0 && (
          <div style={{ padding: 24, textAlign: "center", color: "#475569", fontSize: 13 }}>尚無成員</div>
        )}
      </div>

      {showAddModal && (
        <AddMemberModal
          availableUsers={availableUsers}
          onAdd={handleAdd}
          onClose={() => setShowAddModal(false)}
          currentUser={currentUser}
          currentProjectRole={currentProjectRole}
        />
      )}

      {showTransferModal && (
        <TransferOwnerModal
          projectId={projectId}
          projectName={projectName}
          members={members}
          currentOwnerId={currentUser?.id}
          onSuccess={loadData}
          onClose={() => setShowTransferModal(false)}
        />
      )}
    </div>
  );
}
