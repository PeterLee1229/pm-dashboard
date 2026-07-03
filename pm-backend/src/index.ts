import "dotenv/config";
import express from "express";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import cors from "cors";
import { parse } from "csv-parse/sync";
import cron from "node-cron";
import { checkDueTasks } from "./scheduler";

const pool = new pg.Pool({ connectionString: process.env.DATABASE_URL });
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });
const JWT_SECRET = process.env.JWT_SECRET!;
if (!JWT_SECRET) {
  console.error("JWT_SECRET is not set. Set the JWT_SECRET environment variable.");
  process.exit(1);
}

const app = express();
app.use(express.json());

app.use(cors({
  origin: [
    "http://localhost:5173",
    "https://pm-dashboard-delta-eight.vercel.app",
    /\.vercel\.app$/,
    /\.railway\.app$/,
  ],
  credentials: true,
}));

app.get("/", (_req, res) => {
  res.json({ message: "PM Dashboard API 運作中" });
});

// ── Auth middleware ────────────────────────────────────────────────────

async function authMiddleware(req: any, res: any, next: any) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "未登入" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
    const dbUser = await prisma.user.findUnique({
      where: { id: req.user.userId }, select: { isActive: true }
    });
    if (dbUser?.isActive === false) return res.status(403).json({ error: "帳號已被停用" });
    next();
  } catch {
    res.status(401).json({ error: "通行證無效" });
  }
}

// ── Permission helpers ─────────────────────────────────────────────────

async function getProjectRole(userId: string, projectId: string): Promise<string | null> {
  const membership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId } }
  });
  return membership?.role || null;
}

async function isAdmin(userId: string): Promise<boolean> {
  const user = await prisma.user.findUnique({ where: { id: userId } });
  return user?.role === "admin";
}

function requireProjectRole(...roles: string[]) {
  return async (req: any, res: any, next: any) => {
    const projectId = req.params.projectId;
    if (!projectId) return res.status(400).json({ error: "缺少專案 ID" });

    if (await isAdmin(req.user.userId)) {
      req.userRole = "admin";
      return next();
    }

    const role = await getProjectRole(req.user.userId, projectId);
    if (!role || !roles.includes(role)) {
      return res.status(403).json({ error: "權限不足" });
    }

    req.userRole = role;
    next();
  };
}

async function createNotification(userId: string, type: string, title: string, message: string, projectId?: string, taskId?: string) {
  return prisma.notification.create({
    data: { userId, type, title, message, projectId, taskId }
  });
}

async function logActivity(userId: string, action: string, target: string, detail: string, projectId?: string, targetId?: string) {
  return prisma.activityLog.create({
    data: { userId, action, target, detail, projectId, targetId }
  });
}

// ── 認證 API ──────────────────────────────────────────────────────────

app.post("/api/auth/register", async (req, res) => {
  try {
    const hashedPassword = await bcrypt.hash(req.body.password, 10);
    const user = await prisma.user.create({
      data: {
        email: req.body.email,
        password: hashedPassword,
        name: req.body.name,
        memberId: req.body.memberId,
        role: req.body.role || "user",
        groupId: req.body.groupId || null,
      },
      include: { group: { select: { id: true, name: true, color: true } } }
    });
    res.status(201).json({
      id: user.id, name: user.name, memberId: user.memberId,
      group: (user as any).group
    });
  } catch (err: any) {
    if (err.code === "P2002") {
      return res.status(400).json({ error: "Email 或員工編號已被使用" });
    }
    res.status(500).json({ error: "註冊失敗" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    console.log("登入嘗試:", req.body.email);

    const user = await prisma.user.findUnique({
      where: { email: req.body.email },
      include: { group: true }
    });

    console.log("查到使用者:", user ? user.email : "找不到");

    if (!user) return res.status(401).json({ error: "帳號不存在" });

    const valid = await bcrypt.compare(req.body.password, user.password);
    console.log("密碼驗證:", valid);

    if (!valid) return res.status(401).json({ error: "密碼錯誤" });
    if (user.isActive === false) return res.status(403).json({ error: "此帳號已被停用，請聯繫管理員" });

    const token = jwt.sign(
      { userId: user.id, role: user.role },
      JWT_SECRET,
      { expiresIn: "7d" }
    );

    res.json({
      token,
      user: {
        id: user.id,
        name: user.name,
        memberId: user.memberId,
        role: user.role,
        group: user.group ? { id: user.group.id, name: user.group.name, color: user.group.color } : null
      }
    });
  } catch (err) {
    console.error("登入錯誤完整訊息:", err);
    res.status(500).json({ error: "登入失敗" });
  }
});

// ── 使用者 API ────────────────────────────────────────────────────────

app.get("/api/users", authMiddleware, async (_req: any, res) => {
  const users = await prisma.user.findMany({
    select: {
      id: true, name: true, memberId: true, email: true, role: true,
      group: { select: { id: true, name: true, color: true } }
    }
  });
  res.json(users);
});

app.get("/api/groups", async (_req, res) => {
  const groups = await prisma.group.findMany({
    orderBy: { name: "asc" },
    include: {
      users: { select: { id: true, name: true, memberId: true, email: true } }
    }
  });
  res.json(groups);
});

// ── 專案 API ──────────────────────────────────────────────────────────

app.get("/api/projects", authMiddleware, async (req: any, res) => {
  try {
    const isAdminUser = await isAdmin(req.user.userId);

    const projects = await prisma.project.findMany({
      where: isAdminUser ? {} : {
        members: { some: { userId: req.user.userId } }
      },
      include: {
        members: {
          include: {
            user: {
              select: {
                id: true, name: true, memberId: true, email: true,
                group: { select: { id: true, name: true, color: true } }
              }
            }
          }
        }
      }
    });

    const result = projects.map(p => {
      const myMembership = p.members.find(m => m.userId === req.user.userId);
      return {
        ...p,
        userRole: isAdminUser ? "admin" : (myMembership?.role || "viewer"),
      };
    });

    res.json(result);
  } catch (err) {
    console.error("取得專案錯誤:", err);
    res.status(500).json({ error: "取得專案失敗" });
  }
});

app.post("/api/projects", authMiddleware, async (req: any, res) => {
  const project = await prisma.project.create({
    data: {
      name: req.body.name,
      description: req.body.description || "",
      color: req.body.color || "#6366f1",
      ownerId: req.user.userId,
    }
  });

  await prisma.projectMember.create({
    data: {
      projectId: project.id,
      userId: req.user.userId,
      role: "owner",
    }
  });

  await logActivity(req.user.userId, "create", "project", project.name, project.id, project.id);
  res.status(201).json(project);
});

app.put("/api/projects/:id", authMiddleware, async (req: any, res) => {
  try {
    if (!(await isAdmin(req.user.userId))) {
      const role = await getProjectRole(req.user.userId, req.params.id);
      if (!role || !["owner", "pm"].includes(role)) {
        return res.status(403).json({ error: "權限不足" });
      }
    }
    const project = await prisma.project.update({
      where: { id: req.params.id },
      data: { name: req.body.name, description: req.body.description, color: req.body.color }
    });
    res.json(project);
  } catch {
    res.status(404).json({ error: "找不到專案" });
  }
});

app.delete("/api/projects/:id", authMiddleware, async (req: any, res) => {
  try {
    if (!(await isAdmin(req.user.userId))) {
      const role = await getProjectRole(req.user.userId, req.params.id);
      if (role !== "owner") {
        return res.status(403).json({ error: "只有專案擁有者可以刪除專案" });
      }
    }
    await prisma.project.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: "找不到專案" });
  }
});

// ── 專案成員 API ──────────────────────────────────────────────────────

app.get("/api/projects/:projectId/members", authMiddleware, async (req: any, res) => {
  const { projectId } = req.params;
  const role = await getProjectRole(req.user.userId, projectId);
  if (!role && !(await isAdmin(req.user.userId))) {
    return res.status(403).json({ error: "權限不足" });
  }
  const members = await prisma.projectMember.findMany({
    where: { projectId },
    include: {
      user: {
        select: {
          id: true, name: true, memberId: true, email: true,
          group: { select: { id: true, name: true, color: true } }
        }
      }
    },
    orderBy: { id: "asc" }
  });
  res.json(members);
});

app.post("/api/projects/:projectId/members", authMiddleware, async (req: any, res) => {
  const { projectId } = req.params;

  if (!(await isAdmin(req.user.userId))) {
    const role = await getProjectRole(req.user.userId, projectId);
    if (!role) return res.status(403).json({ error: "權限不足" });

    const targetRole = req.body.role || "member";
    if (role === "pm" && ["owner", "pm"].includes(targetRole)) {
      return res.status(403).json({ error: "PM 不能指定 Owner 或 PM 角色" });
    }
    if (role === "group_leader" && ["owner", "pm", "group_leader"].includes(targetRole)) {
      return res.status(403).json({ error: "組長只能邀請 Member 或 Viewer" });
    }
    if (!["owner", "pm", "group_leader"].includes(role)) {
      return res.status(403).json({ error: "權限不足" });
    }
  }

  try {
    const member = await prisma.projectMember.create({
      data: {
        projectId,
        userId: req.body.userId,
        role: req.body.role || "member",
      },
      include: { user: { select: { id: true, name: true, memberId: true, email: true } } }
    });

    const project = await prisma.project.findUnique({ where: { id: projectId } });
    await createNotification(
      req.body.userId, "project_invited", "專案邀請",
      `你被邀請加入專案「${project?.name || ""}」，角色為 ${req.body.role || "member"}`,
      projectId
    );

    const invitedUser = await prisma.user.findUnique({ where: { id: req.body.userId }, select: { name: true } });
    await logActivity(req.user.userId, "invite", "member", invitedUser?.name || req.body.userId, projectId, req.body.userId);
    res.status(201).json(member);
  } catch {
    res.status(400).json({ error: "新增成員失敗（可能已是成員）" });
  }
});

app.delete("/api/projects/:projectId/members/:userId", authMiddleware, async (req: any, res) => {
  const { projectId, userId } = req.params;

  if (!(await isAdmin(req.user.userId))) {
    const role = await getProjectRole(req.user.userId, projectId);
    if (!role) return res.status(403).json({ error: "權限不足" });

    const target = await prisma.projectMember.findUnique({
      where: { projectId_userId: { projectId, userId } }
    });
    if (!target) return res.status(404).json({ error: "找不到成員" });

    if (target.role === "owner") return res.status(403).json({ error: "不能移除專案擁有者" });
    if (role === "pm" && target.role === "pm") return res.status(403).json({ error: "PM 不能移除其他 PM" });
    if (role === "group_leader" && !["member", "viewer"].includes(target.role)) {
      return res.status(403).json({ error: "組長只能移除 Member 或 Viewer" });
    }
    if (["member", "viewer"].includes(role)) return res.status(403).json({ error: "權限不足" });
  }

  const removedUser = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
  await logActivity(req.user.userId, "remove", "member", removedUser?.name || userId, projectId, userId);
  await prisma.projectMember.deleteMany({ where: { projectId, userId } });
  res.json({ success: true });
});

app.put("/api/projects/:projectId/members/:userId", authMiddleware, async (req: any, res) => {
  const { projectId, userId } = req.params;

  if (!(await isAdmin(req.user.userId))) {
    const role = await getProjectRole(req.user.userId, projectId);
    if (role !== "owner") return res.status(403).json({ error: "只有專案擁有者可以變更角色" });
  }

  await prisma.projectMember.updateMany({
    where: { projectId, userId },
    data: { role: req.body.role }
  });
  res.json({ success: true });
});

app.post("/api/projects/:projectId/transfer-owner", authMiddleware, async (req: any, res) => {
  const { projectId } = req.params;
  const { newOwnerId } = req.body;

  if (!(await isAdmin(req.user.userId))) {
    const role = await getProjectRole(req.user.userId, projectId);
    if (role !== "owner") return res.status(403).json({ error: "只有專案擁有者可以轉移權限" });
  }

  const newOwnerMembership = await prisma.projectMember.findUnique({
    where: { projectId_userId: { projectId, userId: newOwnerId } }
  });
  if (!newOwnerMembership) return res.status(400).json({ error: "該使用者不是專案成員" });

  await prisma.projectMember.updateMany({ where: { projectId, role: "owner" }, data: { role: "pm" } });
  await prisma.projectMember.updateMany({ where: { projectId, userId: newOwnerId }, data: { role: "owner" } });
  await prisma.project.update({ where: { id: projectId }, data: { ownerId: newOwnerId } });

  res.json({ success: true });
});

// ── 任務 API ──────────────────────────────────────────────────────────

app.get("/api/projects/:projectId/tasks", authMiddleware, async (req: any, res) => {
  const tasks = await prisma.task.findMany({
    where: { projectId: req.params.projectId },
    include: {
      subtasks: true,
      attachments: {
        include: { uploader: { select: { id: true, name: true, memberId: true } } },
        orderBy: { createdAt: "desc" }
      }
    },
    orderBy: { createdAt: "asc" }
  });
  res.json(tasks);
});

app.post("/api/projects/:projectId/tasks", authMiddleware, requireProjectRole("owner", "pm", "group_leader"), async (req: any, res) => {
  const task = await prisma.task.create({
    data: {
      title: req.body.title,
      description: req.body.description || "",
      priority: req.body.priority || "medium",
      assignee: req.body.assignee || "",
      groupId: req.body.groupId || "",
      columnId: req.body.columnId || "todo",
      startDate: req.body.startDate || "",
      endDate: req.body.endDate || "",
      completion: req.body.completion || 0,
      timeLogs: req.body.timeLogs || [],
      projectId: req.params.projectId,
    },
    include: { subtasks: true }
  });

  if (task.assignee) {
    const assigneeUser = await prisma.user.findFirst({ where: { memberId: task.assignee } });
    if (assigneeUser && assigneeUser.id !== req.user.userId) {
      const project = await prisma.project.findUnique({ where: { id: req.params.projectId } });
      await createNotification(
        assigneeUser.id, "task_assigned", "新任務指派",
        `你被指派了新任務「${task.title}」在專案「${project?.name || ""}」中`,
        req.params.projectId, task.id
      );
    }
  }

  await logActivity(req.user.userId, "create", "task", task.title, req.params.projectId, task.id);
  res.status(201).json(task);
});

app.put("/api/tasks/:id", authMiddleware, async (req: any, res) => {
  try {
    const task = await prisma.task.findUnique({ where: { id: req.params.id } });
    if (!task) return res.status(404).json({ error: "找不到任務" });

    if (!(await isAdmin(req.user.userId))) {
      const role = await getProjectRole(req.user.userId, task.projectId);
      if (!role) return res.status(403).json({ error: "權限不足" });

      if (role === "viewer") return res.status(403).json({ error: "權限不足" });

      if (role === "member") {
        const user = await prisma.user.findUnique({ where: { id: req.user.userId } });
        if (task.assignee !== user?.memberId) {
          return res.status(403).json({ error: "只能編輯自己的任務" });
        }
      }

      if (req.body.columnId === "done" && !["owner", "pm"].includes(role)) {
        return res.status(403).json({ error: "只有 PM 以上可以將任務標記為已完成" });
      }
    }

    const { subtasks, ...taskData } = req.body;

    if (req.body.columnId === "done" && task.columnId !== "done") {
      taskData.completedAt = new Date();
    } else if (req.body.columnId && req.body.columnId !== "done" && task.columnId === "done") {
      taskData.completedAt = null;
    }

    await prisma.task.update({ where: { id: req.params.id }, data: taskData });

    if (subtasks && Array.isArray(subtasks)) {
      await prisma.subTask.deleteMany({ where: { taskId: req.params.id } });
      for (const sub of subtasks) {
        await prisma.subTask.create({
          data: {
            title: sub.title || "",
            description: sub.description || "",
            assignee: sub.assignee || "",
            groupId: sub.groupId || "",
            startDate: sub.startDate || "",
            endDate: sub.endDate || "",
            completion: sub.completion || 0,
            timeLogs: sub.timeLogs || [],
            taskId: req.params.id,
          }
        });
      }
    }

    if (req.body.columnId && req.body.columnId !== task.columnId && task.assignee) {
      const columnNames: Record<string, string> = {
        todo: "待處理", inprogress: "進行中", review: "審查中", done: "已完成"
      };
      const assigneeUser = await prisma.user.findFirst({ where: { memberId: task.assignee } });
      if (assigneeUser && assigneeUser.id !== req.user.userId) {
        await createNotification(
          assigneeUser.id, "task_moved", "任務狀態變更",
          `任務「${task.title}」已移至「${columnNames[req.body.columnId] || req.body.columnId}」`,
          task.projectId, task.id
        );
      }
    }

    const updated = await prisma.task.findUnique({
      where: { id: req.params.id },
      include: { subtasks: true }
    });

    if (req.body.columnId && req.body.columnId !== task.columnId) {
      await logActivity(req.user.userId, "move", "task", `${task.title} → ${req.body.columnId}`, task.projectId, task.id);
    } else {
      await logActivity(req.user.userId, "update", "task", task.title, task.projectId, task.id);
    }

    res.json(updated);
  } catch {
    res.status(404).json({ error: "找不到任務" });
  }
});

app.delete("/api/tasks/:id", authMiddleware, async (req: any, res) => {
  try {
    const task = await prisma.task.findUnique({ where: { id: req.params.id } });
    if (!task) return res.status(404).json({ error: "找不到任務" });

    if (!(await isAdmin(req.user.userId))) {
      const role = await getProjectRole(req.user.userId, task.projectId);
      if (!role || !["owner", "pm", "group_leader"].includes(role)) {
        return res.status(403).json({ error: "權限不足" });
      }
    }

    await logActivity(req.user.userId, "delete", "task", task.title, task.projectId, task.id);
    await prisma.task.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: "找不到任務" });
  }
});

// ── 組別 API ──────────────────────────────────────────────────────────

// 回傳所有系統組別（含組員），projectId 保留在 URL 路徑以維持前端相容
app.get("/api/projects/:projectId/groups", authMiddleware, async (_req: any, res) => {
  const groups = await prisma.group.findMany({
    orderBy: { name: "asc" },
    include: {
      users: { select: { id: true, name: true, memberId: true, email: true } }
    }
  });
  res.json(groups);
});

// 建立系統組別（Admin 或 owner/pm 可操作）
app.post("/api/projects/:projectId/groups", authMiddleware, requireProjectRole("owner", "pm"), async (req: any, res) => {
  try {
    const group = await prisma.group.create({
      data: { name: req.body.name, color: req.body.color || "#6366f1" }
    });
    res.status(201).json(group);
  } catch (err: any) {
    if (err.code === "P2002") return res.status(400).json({ error: "組別名稱已存在" });
    res.status(500).json({ error: "建立失敗" });
  }
});

app.put("/api/groups/:id", authMiddleware, async (req: any, res) => {
  if (!(await isAdmin(req.user.userId))) {
    return res.status(403).json({ error: "需要管理員權限" });
  }
  try {
    const updated = await prisma.group.update({
      where: { id: req.params.id },
      data: { name: req.body.name, color: req.body.color }
    });
    res.json(updated);
  } catch {
    res.status(404).json({ error: "找不到組別" });
  }
});

app.delete("/api/groups/:id", authMiddleware, async (req: any, res) => {
  if (!(await isAdmin(req.user.userId))) {
    return res.status(403).json({ error: "需要管理員權限" });
  }
  try {
    await prisma.group.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: "找不到組別" });
  }
});

// ── 會議 API ──────────────────────────────────────────────────────────

app.get("/api/projects/:projectId/meetings", authMiddleware, async (req: any, res) => {
  const series = await prisma.meetingSeries.findMany({
    where: { projectId: req.params.projectId },
    include: { records: { orderBy: { date: "desc" } } },
    orderBy: { createdAt: "asc" }
  });
  res.json(series);
});

app.post("/api/projects/:projectId/meetings", authMiddleware, requireProjectRole("owner", "pm", "group_leader"), async (req: any, res) => {
  const series = await prisma.meetingSeries.create({
    data: {
      name: req.body.name,
      type: req.body.type || "regular",
      projectId: req.params.projectId,
    },
    include: { records: true }
  });
  await logActivity(req.user.userId, "create", "meeting_series", series.name, req.params.projectId, series.id);
  res.status(201).json(series);
});

app.delete("/api/meetings/:id", authMiddleware, async (req: any, res) => {
  const series = await prisma.meetingSeries.findUnique({ where: { id: req.params.id } });
  if (!series) return res.status(404).json({ error: "找不到會議系列" });

  if (!(await isAdmin(req.user.userId))) {
    const role = await getProjectRole(req.user.userId, series.projectId);
    if (!role || !["owner", "pm", "group_leader"].includes(role)) {
      return res.status(403).json({ error: "權限不足" });
    }
  }

  await prisma.meetingRecord.deleteMany({ where: { seriesId: req.params.id } });
  await prisma.meetingSeries.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

app.post("/api/meetings/:seriesId/records", authMiddleware, async (req: any, res) => {
  const record = await prisma.meetingRecord.create({
    data: {
      date: req.body.date,
      attendees: req.body.attendees || [],
      summary: req.body.summary || "",
      externalLink: req.body.externalLink || "",
      seriesId: req.params.seriesId,
    }
  });
  const seriesForLog = await prisma.meetingSeries.findUnique({ where: { id: req.params.seriesId } });
  await logActivity(req.user.userId, "create", "meeting_record", record.date, seriesForLog?.projectId, record.id);
  res.status(201).json(record);
});

app.put("/api/meeting-records/:id", authMiddleware, async (req: any, res) => {
  const record = await prisma.meetingRecord.update({
    where: { id: req.params.id },
    data: {
      summary: req.body.summary,
      attendees: req.body.attendees,
      externalLink: req.body.externalLink,
    }
  });
  res.json(record);
});

app.delete("/api/meeting-records/:id", authMiddleware, async (req: any, res) => {
  await prisma.meetingRecord.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// ── 風險 API ──────────────────────────────────────────────────────────

app.get("/api/projects/:projectId/risks", authMiddleware, async (req: any, res) => {
  const risks = await prisma.risk.findMany({
    where: { projectId: req.params.projectId },
    orderBy: { createdAt: "asc" }
  });
  res.json(risks);
});

app.post("/api/projects/:projectId/risks", authMiddleware, requireProjectRole("owner", "pm", "group_leader"), async (req: any, res) => {
  const risk = await prisma.risk.create({
    data: {
      title: req.body.title,
      description: req.body.description || "",
      probability: req.body.probability || "medium",
      impact: req.body.impact || "medium",
      countermeasure: req.body.countermeasure || "",
      ownerId: req.body.ownerId || "",
      ownerGroupId: req.body.ownerGroupId || "",
      status: req.body.status || "monitoring",
      createdDate: req.body.createdDate || new Date().toISOString().split("T")[0],
      projectId: req.params.projectId,
    }
  });
  await logActivity(req.user.userId, "create", "risk", risk.title, req.params.projectId, risk.id);
  res.status(201).json(risk);
});

app.put("/api/risks/:id", authMiddleware, async (req: any, res) => {
  const risk = await prisma.risk.findUnique({ where: { id: req.params.id } });
  if (!risk) return res.status(404).json({ error: "找不到風險" });

  if (!(await isAdmin(req.user.userId))) {
    const role = await getProjectRole(req.user.userId, risk.projectId);
    if (!role || !["owner", "pm", "group_leader"].includes(role)) {
      return res.status(403).json({ error: "權限不足" });
    }
  }

  const updated = await prisma.risk.update({
    where: { id: req.params.id },
    data: {
      title: req.body.title,
      description: req.body.description,
      probability: req.body.probability,
      impact: req.body.impact,
      countermeasure: req.body.countermeasure,
      ownerId: req.body.ownerId,
      ownerGroupId: req.body.ownerGroupId,
      status: req.body.status,
    }
  });

  if (req.body.status && req.body.status !== risk.status) {
    const statusNames: Record<string, string> = {
      monitoring: "監控中", occurred: "已發生", resolved: "已解除"
    };
    const projectMembers = await prisma.projectMember.findMany({
      where: { projectId: risk.projectId }
    });
    for (const pm of projectMembers) {
      if (pm.userId !== req.user.userId) {
        await createNotification(
          pm.userId, "risk_updated", "風險狀態變更",
          `風險「${risk.title}」狀態已變更為「${statusNames[req.body.status] || req.body.status}」`,
          risk.projectId
        );
      }
    }
  }

  await logActivity(req.user.userId, "update", "risk", risk.title, risk.projectId, risk.id);
  res.json(updated);
});

app.delete("/api/risks/:id", authMiddleware, async (req: any, res) => {
  const risk = await prisma.risk.findUnique({ where: { id: req.params.id } });
  if (!risk) return res.status(404).json({ error: "找不到風險" });

  if (!(await isAdmin(req.user.userId))) {
    const role = await getProjectRole(req.user.userId, risk.projectId);
    if (!role || !["owner", "pm", "group_leader"].includes(role)) {
      return res.status(403).json({ error: "權限不足" });
    }
  }

  await prisma.risk.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// ── 週報 API ──────────────────────────────────────────────────────────

app.get("/api/projects/:projectId/weekly-reports", authMiddleware, async (req: any, res) => {
  const reports = await prisma.weeklyReport.findMany({
    where: { projectId: req.params.projectId },
    orderBy: { weekStart: "desc" }
  });
  res.json(reports);
});

app.put("/api/projects/:projectId/weekly-reports", authMiddleware, requireProjectRole("owner", "pm"), async (req: any, res) => {
  const report = await prisma.weeklyReport.upsert({
    where: {
      projectId_weekStart: {
        projectId: req.params.projectId,
        weekStart: req.body.weekStart,
      }
    },
    update: { notes: req.body.notes },
    create: {
      weekStart: req.body.weekStart,
      weekEnd: req.body.weekEnd,
      notes: req.body.notes || "",
      projectId: req.params.projectId,
    }
  });
  res.json(report);
});

// ── Admin API ─────────────────────────────────────────────────────────

app.get("/api/admin/users", authMiddleware, async (req: any, res) => {
  if (!(await isAdmin(req.user.userId))) {
    return res.status(403).json({ error: "需要管理員權限" });
  }
  const users = await prisma.user.findMany({
    select: {
      id: true, name: true, memberId: true, email: true, role: true, isActive: true, createdAt: true,
      _count: { select: { projectMemberships: true } }
    }
  });
  res.json(users);
});

app.put("/api/admin/users/:id/toggle-active", authMiddleware, async (req: any, res) => {
  if (!(await isAdmin(req.user.userId))) {
    return res.status(403).json({ error: "需要管理員權限" });
  }
  if (req.params.id === req.user.userId) {
    return res.status(400).json({ error: "不能停用自己的帳號" });
  }
  const user = await prisma.user.findUnique({ where: { id: req.params.id } });
  if (!user) return res.status(404).json({ error: "使用者不存在" });
  const updated = await prisma.user.update({
    where: { id: req.params.id },
    data: { isActive: !user.isActive },
    select: { id: true, isActive: true },
  });
  res.json(updated);
});

app.put("/api/admin/users/:id", authMiddleware, async (req: any, res) => {
  if (!(await isAdmin(req.user.userId))) {
    return res.status(403).json({ error: "需要管理員權限" });
  }
  const user = await prisma.user.update({
    where: { id: req.params.id },
    data: { role: req.body.role },
    select: { id: true, name: true, memberId: true, email: true, role: true }
  });
  res.json(user);
});

// ── Admin 組別管理 ────────────────────────────────────────────────────

app.post("/api/admin/groups", authMiddleware, async (req: any, res) => {
  if (!(await isAdmin(req.user.userId))) {
    return res.status(403).json({ error: "需要管理員權限" });
  }
  try {
    const group = await prisma.group.create({
      data: { name: req.body.name, color: req.body.color || "#6366f1" }
    });
    res.status(201).json(group);
  } catch (err: any) {
    if (err.code === "P2002") return res.status(400).json({ error: "組別名稱已存在" });
    res.status(500).json({ error: "建立失敗" });
  }
});

app.put("/api/admin/groups/:id", authMiddleware, async (req: any, res) => {
  if (!(await isAdmin(req.user.userId))) {
    return res.status(403).json({ error: "需要管理員權限" });
  }
  try {
    const group = await prisma.group.update({
      where: { id: req.params.id },
      data: { name: req.body.name, color: req.body.color }
    });
    res.json(group);
  } catch (err: any) {
    if (err.code === "P2002") return res.status(400).json({ error: "組別名稱已存在" });
    res.status(500).json({ error: "更新失敗" });
  }
});

app.delete("/api/admin/groups/:id", authMiddleware, async (req: any, res) => {
  if (!(await isAdmin(req.user.userId))) {
    return res.status(403).json({ error: "需要管理員權限" });
  }
  await prisma.group.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// ── 附件 API ──────────────────────────────────────────────────────────

app.get("/api/tasks/:taskId/attachments", authMiddleware, async (req: any, res) => {
  const attachments = await prisma.attachment.findMany({
    where: { taskId: req.params.taskId },
    include: {
      uploader: { select: { id: true, name: true, memberId: true } }
    },
    orderBy: { createdAt: "desc" }
  });
  res.json(attachments);
});

app.post("/api/tasks/:taskId/attachments", authMiddleware, async (req: any, res) => {
  const attachment = await prisma.attachment.create({
    data: {
      name: req.body.name,
      url: req.body.url,
      type: req.body.type || "link",
      taskId: req.params.taskId,
      uploaderId: req.user.userId,
    },
    include: {
      uploader: { select: { id: true, name: true, memberId: true } }
    }
  });

  const task = await prisma.task.findUnique({ where: { id: req.params.taskId } });
  if (task) {
    await logActivity(req.user.userId, "create", "attachment", `在任務「${task.title}」新增附件「${req.body.name}」`, task.projectId, attachment.id);
  }

  res.status(201).json(attachment);
});

app.delete("/api/attachments/:id", authMiddleware, async (req: any, res) => {
  const attachment = await prisma.attachment.findUnique({
    where: { id: req.params.id },
    include: { task: true }
  });
  if (!attachment) return res.status(404).json({ error: "找不到附件" });

  if (attachment.uploaderId !== req.user.userId && !(await isAdmin(req.user.userId))) {
    const role = await getProjectRole(req.user.userId, attachment.task.projectId);
    if (!role || !["owner", "pm"].includes(role)) {
      return res.status(403).json({ error: "權限不足" });
    }
  }

  await prisma.attachment.delete({ where: { id: req.params.id } });
  await logActivity(req.user.userId, "delete", "attachment", `刪除附件「${attachment.name}」`, attachment.task.projectId, req.params.id);

  res.json({ success: true });
});

// ── 評論 API ──────────────────────────────────────────────────────────

app.get("/api/tasks/:taskId/comments", authMiddleware, async (req: any, res) => {
  const comments = await prisma.comment.findMany({
    where: { taskId: req.params.taskId },
    include: {
      user: {
        select: { id: true, name: true, memberId: true, group: { select: { name: true, color: true } } }
      }
    },
    orderBy: { createdAt: "asc" }
  });
  res.json(comments);
});

app.post("/api/tasks/:taskId/comments", authMiddleware, async (req: any, res) => {
  const comment = await prisma.comment.create({
    data: {
      content: req.body.content,
      taskId: req.params.taskId,
      userId: req.user.userId,
    },
    include: {
      user: {
        select: { id: true, name: true, memberId: true, group: { select: { name: true, color: true } } }
      }
    }
  });

  const task = await prisma.task.findUnique({ where: { id: req.params.taskId } });
  if (task && task.assignee) {
    const assigneeUser = await prisma.user.findFirst({ where: { memberId: task.assignee } });
    if (assigneeUser && assigneeUser.id !== req.user.userId) {
      await createNotification(
        assigneeUser.id, "comment_added", "新評論",
        `在任務「${task.title}」中有新的評論`,
        task.projectId, task.id
      );
    }
  }

  if (task) {
    await logActivity(req.user.userId, "comment", "task", task.title, task.projectId, task.id);
  }
  res.status(201).json(comment);
});

app.delete("/api/comments/:id", authMiddleware, async (req: any, res) => {
  const comment = await prisma.comment.findUnique({ where: { id: req.params.id } });
  if (!comment) return res.status(404).json({ error: "找不到評論" });

  if (comment.userId !== req.user.userId && !(await isAdmin(req.user.userId))) {
    return res.status(403).json({ error: "只能刪除自己的評論" });
  }

  await prisma.comment.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// ── 通知 API ──────────────────────────────────────────────────────────

app.get("/api/notifications", authMiddleware, async (req: any, res) => {
  const notifications = await prisma.notification.findMany({
    where: { userId: req.user.userId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });
  res.json(notifications);
});

app.get("/api/notifications/unread-count", authMiddleware, async (req: any, res) => {
  const count = await prisma.notification.count({
    where: { userId: req.user.userId, isRead: false }
  });
  res.json({ count });
});

app.put("/api/notifications/read-all", authMiddleware, async (req: any, res) => {
  await prisma.notification.updateMany({
    where: { userId: req.user.userId, isRead: false },
    data: { isRead: true }
  });
  res.json({ success: true });
});

app.put("/api/notifications/:id/read", authMiddleware, async (req: any, res) => {
  await prisma.notification.update({
    where: { id: req.params.id },
    data: { isRead: true }
  });
  res.json({ success: true });
});

// ── 活動紀錄 API ──────────────────────────────────────────────────────

app.get("/api/projects/:projectId/activities", authMiddleware, async (req: any, res) => {
  const { projectId } = req.params;

  if (!(await isAdmin(req.user.userId))) {
    const role = await getProjectRole(req.user.userId, projectId);
    if (!role) return res.status(403).json({ error: "權限不足" });
  }

  const activities = await prisma.activityLog.findMany({
    where: { projectId },
    include: {
      user: { select: { id: true, name: true, memberId: true } }
    },
    orderBy: { createdAt: "desc" },
    take: 100,
  });
  res.json(activities);
});

// ── 搜尋 API ──────────────────────────────────────────────────────────

app.get("/api/projects/:projectId/search", authMiddleware, async (req: any, res) => {
  const query = (req.query.q as string || "").trim();
  if (!query) return res.json({ tasks: [], risks: [], meetings: [] });

  const tasks = await prisma.task.findMany({
    where: {
      projectId: req.params.projectId,
      OR: [
        { title: { contains: query, mode: "insensitive" } },
        { description: { contains: query, mode: "insensitive" } },
        { assignee: { contains: query, mode: "insensitive" } },
      ]
    },
    include: { subtasks: true },
    take: 20,
  });

  const subtasks = await prisma.subTask.findMany({
    where: {
      task: { projectId: req.params.projectId },
      OR: [
        { title: { contains: query, mode: "insensitive" } },
        { description: { contains: query, mode: "insensitive" } },
        { assignee: { contains: query, mode: "insensitive" } },
      ]
    },
    include: { task: { select: { id: true, title: true } } },
    take: 20,
  });

  const risks = await prisma.risk.findMany({
    where: {
      projectId: req.params.projectId,
      OR: [
        { title: { contains: query, mode: "insensitive" } },
        { description: { contains: query, mode: "insensitive" } },
        { countermeasure: { contains: query, mode: "insensitive" } },
      ]
    },
    take: 20,
  });

  const meetingRecords = await prisma.meetingRecord.findMany({
    where: {
      series: { projectId: req.params.projectId },
      OR: [
        { summary: { contains: query, mode: "insensitive" } },
      ]
    },
    include: { series: { select: { id: true, name: true } } },
    take: 20,
  });

  res.json({ tasks, subtasks, risks, meetings: meetingRecords });
});

// ── OKR API ───────────────────────────────────────────────────────────

app.get("/api/projects/:projectId/okrs", authMiddleware, async (req: any, res) => {
  const objectives = await prisma.objective.findMany({
    where: { projectId: req.params.projectId },
    include: { keyResults: { orderBy: { createdAt: "asc" } } },
    orderBy: { createdAt: "asc" }
  });
  res.json(objectives);
});

app.post("/api/projects/:projectId/okrs", authMiddleware, requireProjectRole("owner", "pm"), async (req: any, res) => {
  const objective = await prisma.objective.create({
    data: {
      title: req.body.title,
      description: req.body.description || "",
      startDate: req.body.startDate || "",
      endDate: req.body.endDate || "",
      projectId: req.params.projectId,
    },
    include: { keyResults: true }
  });

  await logActivity(req.user.userId, "create", "okr", `建立目標「${objective.title}」`, req.params.projectId, objective.id);

  res.status(201).json(objective);
});

app.put("/api/okrs/:id", authMiddleware, async (req: any, res) => {
  const objective = await prisma.objective.findUnique({ where: { id: req.params.id } });
  if (!objective) return res.status(404).json({ error: "找不到目標" });

  const updated = await prisma.objective.update({
    where: { id: req.params.id },
    data: {
      title: req.body.title,
      description: req.body.description,
      startDate: req.body.startDate,
      endDate: req.body.endDate,
    },
    include: { keyResults: true }
  });

  await logActivity(req.user.userId, "update", "okr", `更新目標「${updated.title}」`, objective.projectId, updated.id);

  res.json(updated);
});

app.delete("/api/okrs/:id", authMiddleware, async (req: any, res) => {
  const objective = await prisma.objective.findUnique({ where: { id: req.params.id } });
  if (!objective) return res.status(404).json({ error: "找不到目標" });

  await prisma.keyResult.deleteMany({ where: { objectiveId: req.params.id } });
  await prisma.objective.delete({ where: { id: req.params.id } });

  await logActivity(req.user.userId, "delete", "okr", `刪除目標「${objective.title}」`, objective.projectId, req.params.id);

  res.json({ success: true });
});

app.post("/api/okrs/:objectiveId/key-results", authMiddleware, async (req: any, res) => {
  const kr = await prisma.keyResult.create({
    data: {
      title: req.body.title,
      targetValue: req.body.targetValue || 100,
      currentValue: req.body.currentValue || 0,
      unit: req.body.unit || "%",
      objectiveId: req.params.objectiveId,
    }
  });
  res.status(201).json(kr);
});

app.put("/api/key-results/:id", authMiddleware, async (req: any, res) => {
  const kr = await prisma.keyResult.update({
    where: { id: req.params.id },
    data: {
      title: req.body.title,
      targetValue: req.body.targetValue,
      currentValue: req.body.currentValue,
      unit: req.body.unit,
    }
  });
  res.json(kr);
});

app.delete("/api/key-results/:id", authMiddleware, async (req: any, res) => {
  await prisma.keyResult.delete({ where: { id: req.params.id } });
  res.json({ success: true });
});

// ── 匯入 API ──────────────────────────────────────────────────────────

function normalizeDate(dateStr: string): string {
  if (!dateStr) return "";
  const cleaned = dateStr.replace(/\//g, "-");
  const parts = cleaned.split("-");
  if (parts.length !== 3) return dateStr;
  const year = parts[0];
  const month = parts[1].padStart(2, "0");
  const day = parts[2].padStart(2, "0");
  return `${year}-${month}-${day}`;
}

app.post("/api/projects/:projectId/import/tasks", authMiddleware, requireProjectRole("owner", "pm"), async (req: any, res) => {
  try {
    const csvText = req.body.csv;
    if (!csvText) return res.status(400).json({ error: "缺少 CSV 資料" });

    const records = parse(csvText, {
      columns: true,
      skip_empty_lines: true,
      trim: true,
      bom: true,
    });

    const results: any[] = [];
    let currentParentTask: any = null;

    for (const row of records) {
      const type = row["類型"] || row["type"] || "";
      const title = row["任務名稱"] || row["title"] || "";
      const priority = row["優先級"] || row["priority"] || "medium";
      const startDate = row["開始日期"] || row["startDate"] || "";
      const endDate = row["結束日期"] || row["endDate"] || "";
      const completionStr = (row["完成度"] || row["completion"] || "0").replace("%", "").trim();
      const completion = parseInt(completionStr) || 0;

      if (!title) continue;

      let normalizedPriority = "medium";
      if (priority.includes("高") || priority.toLowerCase() === "high") normalizedPriority = "high";
      else if (priority.includes("低") || priority.toLowerCase() === "low") normalizedPriority = "low";

      if (type === "子工項" || type === "subtask" || type === "子任務") {
        if (currentParentTask) {
          const subtask = await prisma.subTask.create({
            data: {
              title,
              startDate: normalizeDate(startDate),
              endDate: normalizeDate(endDate),
              completion: Math.min(completion, 100),
              timeLogs: [],
              taskId: currentParentTask.id,
            }
          });
          results.push({ type: "subtask", title, parentTask: currentParentTask.title, id: subtask.id });
        }
      } else {
        const task = await prisma.task.create({
          data: {
            title,
            priority: normalizedPriority,
            columnId: "todo",
            startDate: normalizeDate(startDate),
            endDate: normalizeDate(endDate),
            completion: Math.min(completion, 100),
            timeLogs: [],
            projectId: req.params.projectId,
          }
        });
        currentParentTask = task;
        results.push({ type: "task", title, id: task.id });

        await logActivity(req.user.userId, "create", "task", `匯入任務「${title}」`, req.params.projectId, task.id);
      }
    }

    res.json({ success: true, imported: results.length, details: results });
  } catch (err: any) {
    console.error("匯入錯誤:", err);
    res.status(400).json({ error: "CSV 格式錯誤：" + (err.message || "") });
  }
});

app.get("/api/templates/tasks", (_req, res) => {
  const BOM = "﻿";
  const csv = BOM + "類型,任務名稱,優先級,開始日期,結束日期,完成度\n" +
    "主工項,買電腦,高優先,2026-06-01,2026-07-01,0%\n" +
    "子工項,估價,,2026-06-01,2026-06-10,0%\n" +
    "子工項,採購,,2026-06-11,2026-06-20,0%\n" +
    "子工項,驗收,,2026-06-21,2026-07-01,0%\n" +
    "主工項,網路建置,中優先,2026-06-10,2026-07-15,0%\n";

  res.setHeader("Content-Type", "text/csv; charset=utf-8");
  res.setHeader("Content-Disposition", "attachment; filename=task_import_template.csv");
  res.send(csv);
});

// ── 排程：每天早上 8 點（台灣時間 UTC+8 = UTC 0 點）──────────────────

cron.schedule("0 0 * * *", () => {
  checkDueTasks().catch(console.error);
});
checkDueTasks().catch(console.error); // 啟動時也跑一次

// ── 啟動伺服器 ────────────────────────────────────────────────────────

const PORT = process.env.PORT || 3000;
app.listen(PORT, () => {
  console.log(`Server running on port ${PORT}`);
}).on("error", (err) => {
  console.error("Server error:", err);
});
