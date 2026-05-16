import "dotenv/config";
import express from "express";
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
import pg from "pg";

const pool = new pg.Pool({
  connectionString: "postgresql://postgres:mysecret@localhost:5432/postgres",
});
const adapter = new PrismaPg(pool);
const prisma = new PrismaClient({ adapter });

const app = express();
app.use(express.json());

// 首頁
app.get("/", (req, res) => {
  res.json({ message: "PM Dashboard API 運作中" });
});

// ── Project API ────────────────────────────

// 取得所有專案
app.get("/api/projects", async (req, res) => {
  const projects = await prisma.project.findMany({
    include: { tasks: { include: { subtasks: true } } }
  });
  res.json(projects);
});

// 新增專案
app.post("/api/projects", async (req, res) => {
  const project = await prisma.project.create({
    data: {
      name: req.body.name,
      description: req.body.description || "",
      color: req.body.color || "#6366f1",
    }
  });
  res.status(201).json(project);
});

// ── Task API ───────────────────────────────

// 取得所有任務（可依專案篩選）
app.get("/api/tasks", async (req, res) => {
  const where = req.query.projectId
    ? { projectId: req.query.projectId as string }
    : {};
  const tasks = await prisma.task.findMany({
    where,
    include: { subtasks: true }
  });
  res.json(tasks);
});

// 取得單一任務
app.get("/api/tasks/:id", async (req, res) => {
  const task = await prisma.task.findUnique({
    where: { id: req.params.id },
    include: { subtasks: true }
  });
  if (!task) return res.status(404).json({ error: "找不到任務" });
  res.json(task);
});

// 新增任務
app.post("/api/tasks", async (req, res) => {
  const task = await prisma.task.create({
    data: {
      title: req.body.title,
      description: req.body.description || "",
      priority: req.body.priority || "medium",
      assignee: req.body.assignee || "",
      groupId: req.body.groupId || "",
      startDate: req.body.startDate || "",
      endDate: req.body.endDate || "",
      columnId: req.body.columnId || "todo",
      projectId: req.body.projectId,
    }
  });
  res.status(201).json(task);
});

// 更新任務
app.put("/api/tasks/:id", async (req, res) => {
  try {
    const task = await prisma.task.update({
      where: { id: req.params.id },
      data: req.body,
      include: { subtasks: true }
    });
    res.json(task);
  } catch {
    res.status(404).json({ error: "找不到任務" });
  }
});

// 刪除任務
app.delete("/api/tasks/:id", async (req, res) => {
  try {
    // 先刪子工項
    await prisma.subTask.deleteMany({ where: { taskId: req.params.id } });
    await prisma.task.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: "找不到任務" });
  }
});

// ── SubTask API ────────────────────────────

// 新增子工項
app.post("/api/subtasks", async (req, res) => {
  const subtask = await prisma.subTask.create({
    data: {
      title: req.body.title,
      description: req.body.description || "",
      assignee: req.body.assignee || "",
      groupId: req.body.groupId || "",
      startDate: req.body.startDate || "",
      endDate: req.body.endDate || "",
      taskId: req.body.taskId,
    }
  });
  res.status(201).json(subtask);
});

// 更新子工項
app.put("/api/subtasks/:id", async (req, res) => {
  try {
    const subtask = await prisma.subTask.update({
      where: { id: req.params.id },
      data: req.body,
    });
    res.json(subtask);
  } catch {
    res.status(404).json({ error: "找不到子工項" });
  }
});

// 刪除子工項
app.delete("/api/subtasks/:id", async (req, res) => {
  try {
    await prisma.subTask.delete({ where: { id: req.params.id } });
    res.json({ success: true });
  } catch {
    res.status(404).json({ error: "找不到子工項" });
  }
});

// 啟動伺服器
app.listen(3000, () => {
  console.log("Server running on http://localhost:3000");
}).on("error", (err) => {
  console.error("Server error:", err);
});
