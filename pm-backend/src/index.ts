import "dotenv/config";
import express from "express";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import cors from "cors";

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
  origin: ["http://localhost:5173", "https://pm-dashboard-delta-eight.vercel.app"],
  credentials: true,
}));

app.get("/", (_req, res) => {
  res.json({ message: "PM Dashboard API 運作中" });
});

// ── Auth middleware ────────────────────────────────────────────────────

function authMiddleware(req: any, res: any, next: any) {
  const token = req.headers.authorization?.split(" ")[1];
  if (!token) return res.status(401).json({ error: "未登入" });
  try {
    req.user = jwt.verify(token, JWT_SECRET);
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
    include: { subtasks: true },
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

    const updated = await prisma.task.findUnique({
      where: { id: req.params.id },
      include: { subtasks: true }
    });
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
      id: true, name: true, memberId: true, email: true, role: true, createdAt: true,
      _count: { select: { projectMemberships: true } }
    }
  });
  res.json(users);
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

// ── 啟動伺服器 ────────────────────────────────────────────────────────

app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
}).on("error", (err) => {
  console.error("Server error:", err);
});
