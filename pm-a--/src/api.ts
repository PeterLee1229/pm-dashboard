const API_URL = "http://localhost:3000/api";

function getToken(): string | null {
  return localStorage.getItem("pm-token");
}

export function setToken(token: string) {
  localStorage.setItem("pm-token", token);
}

export function clearToken() {
  localStorage.removeItem("pm-token");
}

export function isLoggedIn(): boolean {
  return !!getToken();
}

async function apiFetch(path: string, options: RequestInit = {}) {
  const token = getToken();
  const headers: Record<string, string> = {
    "Content-Type": "application/json",
    ...((options.headers as Record<string, string>) || {}),
  };

  if (token) {
    headers["Authorization"] = `Bearer ${token}`;
  }

  const response = await fetch(`${API_URL}${path}`, {
    ...options,
    headers,
  });

  if (response.status === 401) {
    clearToken();
    window.location.reload();
    throw new Error("登入已過期，請重新登入");
  }

  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "請求失敗");
  }

  return data;
}

// ── 認證 API ────────────────────────────────

export async function login(email: string, password: string) {
  const data = await apiFetch("/auth/login", {
    method: "POST",
    body: JSON.stringify({ email, password }),
  });
  setToken(data.token);
  return data;
}

export async function register(email: string, password: string, name: string, memberId: string) {
  return apiFetch("/auth/register", {
    method: "POST",
    body: JSON.stringify({ email, password, name, memberId }),
  });
}

// ── 專案 API ────────────────────────────────

export async function getProjects() {
  return apiFetch("/projects");
}

export async function createProject(project: any) {
  return apiFetch("/projects", {
    method: "POST",
    body: JSON.stringify(project),
  });
}

export async function updateProject(id: string, data: any) {
  return apiFetch(`/projects/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteProject(id: string) {
  return apiFetch(`/projects/${id}`, {
    method: "DELETE",
  });
}

// ── 專案任務 API ────────────────────────────

export async function getProjectTasks(projectId: string) {
  return apiFetch(`/projects/${projectId}/tasks`);
}

export async function createProjectTask(projectId: string, task: any) {
  return apiFetch(`/projects/${projectId}/tasks`, {
    method: "POST",
    body: JSON.stringify(task),
  });
}

export async function updateTask(id: string, data: any) {
  return apiFetch(`/tasks/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteTask(id: string) {
  return apiFetch(`/tasks/${id}`, {
    method: "DELETE",
  });
}

// ── 組別 API ────────────────────────────────

export async function getProjectGroups(projectId: string) {
  return apiFetch(`/projects/${projectId}/groups`);
}

export async function createGroup(projectId: string, data: any) {
  return apiFetch(`/projects/${projectId}/groups`, {
    method: "POST",
    body: JSON.stringify(data),
  });
}

export async function updateGroup(id: string, data: any) {
  return apiFetch(`/groups/${id}`, {
    method: "PUT",
    body: JSON.stringify(data),
  });
}

export async function deleteGroup(id: string) {
  return apiFetch(`/groups/${id}`, {
    method: "DELETE",
  });
}

export async function addGroupMember(groupId: string, userId: string) {
  return apiFetch(`/groups/${groupId}/members`, {
    method: "POST",
    body: JSON.stringify({ userId }),
  });
}

export async function removeGroupMember(groupId: string, userId: string) {
  return apiFetch(`/groups/${groupId}/members/${userId}`, {
    method: "DELETE",
  });
}

// ── 使用者 API ────────────────────────────────

export async function getUsers() {
  return apiFetch("/users");
}
