// 完成度 100% 自動移到審查中：各觸發路徑（網頁更新、子任務增刪改、建立、CSV 匯入、MCP）、
// 已完成不受影響、降到 100 以下移回進行中、手動拖回不會再被推回、活動紀錄
import { afterAll, beforeEach, describe, expect, it } from "vitest";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { InMemoryTransport } from "@modelcontextprotocol/sdk/inMemory.js";
import { prisma } from "../src/db";
import { buildMcpServer } from "../src/tools/adapters/mcp";
import { AUTO_BACK_MESSAGE, AUTO_REVIEW_MESSAGE, autoStatusFor } from "../src/services/completionSync";
import { Fixture, api, resetAndSeed } from "./fixtures";

let f: Fixture;
const clients: Client[] = [];
beforeEach(async () => {
  f = await resetAndSeed();
  await prisma.systemSetting.create({ data: { id: 1, mcpEnabled: true, mcpWriteEnabled: true } });
});
afterAll(async () => { await Promise.all(clients.map((c) => c.close())); });

const owner = () => ({ Authorization: `Bearer ${f.tokens.owner}` });
const put = (taskId: string, body: object) => api().put(`/api/tasks/${taskId}`).set(owner()).send(body);
const columnOf = async (taskId: string) => (await prisma.task.findUniqueOrThrow({ where: { id: taskId } })).columnId;
const autoLogs = (taskId: string) => prisma.activityLog.findMany({
  where: { targetId: taskId, detail: { contains: "自動移" } }, orderBy: { createdAt: "asc" },
});

async function tool(name: string, args: Record<string, unknown>) {
  const u = f.users.owner;
  const server = buildMcpServer({ userId: u.id, systemRole: u.role }, { clientId: "t", clientName: "Claude", scopes: ["pm:read", "pm:write"] });
  const [a, b] = InMemoryTransport.createLinkedPair();
  const client = new Client({ name: "t", version: "1" });
  await Promise.all([server.connect(a), client.connect(b)]);
  clients.push(client);
  const r = await client.callTool({ name, arguments: args });
  return { isError: !!r.isError, body: JSON.parse((r.content as { text: string }[])[0].text) };
}

describe("判斷規則", () => {
  it.each([
    ["todo", 90, 100, "review"],
    ["inprogress", 0, 100, "review"],
    ["review", 100, 80, "inprogress"],
    ["inprogress", 100, 100, null], // 沒有「從未滿變成 100」：手動拖回後不再推回
    ["review", 80, 70, null],       // 手動放到審查中、未滿 100 的任務不受影響
    ["done", 90, 100, null],
    ["done", 100, 50, null],
    ["todo", 100, 50, null],
  ] as const)("%s %i%% → %i%% ⇒ %s", (col, before, after, to) => {
    expect(autoStatusFor(col, before, after)?.to ?? null).toBe(to);
  });
});

describe("網頁更新任務（PUT /api/tasks/:id）", () => {
  it("進行中的任務完成度改成 100 → 審查中，回傳 statusAutoChanged 並寫入活動紀錄", async () => {
    const res = await put(f.tasks.ofMember.id, { completion: 100 });
    expect(res.status).toBe(200);
    expect(res.body.columnId).toBe("review");
    expect(res.body.statusAutoChanged).toEqual({ from: "inprogress", to: "review" });
    const logs = await autoLogs(f.tasks.ofMember.id);
    expect(logs.map((l) => l.detail)).toEqual([`A組成員的任務：${AUTO_REVIEW_MESSAGE}`]);
    expect(logs[0]).toMatchObject({ action: "move", userId: f.users.owner.id, source: "web" });
  });

  it("待處理的任務也會移動；沒有變化時 statusAutoChanged 為 null", async () => {
    expect((await put(f.tasks.unassigned.id, { completion: 100 })).body.columnId).toBe("review");
    const res = await put(f.tasks.ofMemberB.id, { completion: 99 });
    expect(res.body.columnId).toBe("todo");
    expect(res.body.statusAutoChanged).toBeNull();
  });

  it("前端整筆儲存時送出原本的狀態，仍會自動移動", async () => {
    const res = await put(f.tasks.ofMember.id, { completion: 100, columnId: "inprogress", title: "A組成員的任務" });
    expect(res.body.columnId).toBe("review");
  });

  it("同一次請求明確改了狀態時以指定的為準", async () => {
    const res = await put(f.tasks.ofMember.id, { completion: 100, columnId: "todo" });
    expect(res.body.columnId).toBe("todo");
    expect(res.body.statusAutoChanged).toBeNull();
    expect(await autoLogs(f.tasks.ofMember.id)).toHaveLength(0);
  });

  it("已完成的任務不受影響（不會自動設為已完成，也不會被移出）", async () => {
    expect((await put(f.tasks.done.id, { completion: 50 })).body.columnId).toBe("done");
    expect((await put(f.tasks.done.id, { completion: 100 })).body.columnId).toBe("done");
    expect(await autoLogs(f.tasks.done.id)).toHaveLength(0);
  });

  it("審查中的任務從 100 降到未滿 100 → 移回進行中", async () => {
    await put(f.tasks.ofMember.id, { completion: 100 });
    const res = await put(f.tasks.ofMember.id, { completion: 80 });
    expect(res.body.columnId).toBe("inprogress");
    expect(res.body.statusAutoChanged).toEqual({ from: "review", to: "inprogress" });
    expect((await autoLogs(f.tasks.ofMember.id)).map((l) => l.detail)).toEqual([
      `A組成員的任務：${AUTO_REVIEW_MESSAGE}`, `A組成員的任務：${AUTO_BACK_MESSAGE}`,
    ]);
  });

  it("手動放到審查中、未滿 100 的任務改完成度不會被移出", async () => {
    await put(f.tasks.ofMember.id, { columnId: "review", completion: 60 });
    expect((await put(f.tasks.ofMember.id, { completion: 70 })).body.columnId).toBe("review");
  });

  it("100% 的任務手動拖回進行中後，之後的編輯不會再把它推回審查中", async () => {
    await put(f.tasks.ofMember.id, { completion: 100 });
    expect((await put(f.tasks.ofMember.id, { columnId: "inprogress" })).body.columnId).toBe("inprogress");
    expect((await put(f.tasks.ofMember.id, { title: "改名" })).body.columnId).toBe("inprogress");
    expect((await put(f.tasks.ofMember.id, { completion: 100, columnId: "inprogress" })).body.columnId).toBe("inprogress");
    // 降下來再回到 100 是新的變化，會再次觸發
    await put(f.tasks.ofMember.id, { completion: 90 });
    expect((await put(f.tasks.ofMember.id, { completion: 100 })).body.columnId).toBe("review");
  });
});

describe("子任務", () => {
  const subs = () => f.tasks.withSubtasks.subtasks.map((s) => ({ ...s }));

  it("子任務全部 100% → 主任務移到審查中；新增 0% 的子任務 → 移回進行中；刪掉它 → 再回到審查中", async () => {
    const id = f.tasks.withSubtasks.id;
    const full = subs().map((s) => ({ ...s, completion: 100 }));
    let res = await put(id, { subtasks: full });
    expect(res.body.columnId).toBe("review");

    res = await put(id, { subtasks: [...full, { id: "new-sub", title: "新子任務", completion: 0 }] });
    expect(res.body.columnId).toBe("inprogress");

    res = await put(id, { subtasks: full });
    expect(res.body.columnId).toBe("review");
  });

  it("有子任務時看子任務平均（四捨五入），不看主任務自己的完成度", async () => {
    const id = f.tasks.withSubtasks.id;
    const [a, b] = subs();
    let res = await put(id, { completion: 100, subtasks: [{ ...a, completion: 100 }, { ...b, completion: 98 }] });
    expect(res.body.columnId).toBe("todo"); // 平均 99
    res = await put(id, { subtasks: [{ ...a, completion: 100 }, { ...b, completion: 99 }] });
    expect(res.body.columnId).toBe("review"); // 平均 99.5 → 100
  });
});

describe("建立任務", () => {
  it("建立時完成度就是 100 → 審查中；未滿 100 → 維持指定的欄位", async () => {
    const mk = (body: object) => api().post(`/api/projects/${f.p1.id}/tasks`).set(owner()).send(body);
    const full = await mk({ title: "已做完的事", completion: 100, columnId: "todo" });
    expect(full.status).toBe(201);
    expect(full.body.columnId).toBe("review");
    expect(full.body.statusAutoChanged).toEqual({ from: "todo", to: "review" });
    const half = await mk({ title: "做一半", completion: 50, columnId: "inprogress" });
    expect(half.body.columnId).toBe("inprogress");
  });
});

describe("CSV 匯入", () => {
  async function importCsv(csv: string) {
    const preview = await api().post(`/api/projects/${f.p1.id}/tasks/import/preview`).set(owner()).send({ csv });
    expect(preview.status, JSON.stringify(preview.body)).toBe(200);
    const commit = await api().post(`/api/projects/${f.p1.id}/tasks/import/commit`).set(owner())
      .send({ previewToken: preview.body.previewToken, decisions: {} });
    expect(commit.status, JSON.stringify(commit.body)).toBe(200);
    return commit.body;
  }

  it("更新既有工項的完成度為 100 → 審查中，結果列出自動移動的工項", async () => {
    const body = await importCsv(`工項ID,類型,任務名稱,完成度\n${f.tasks.ofMember.id},主工項,A組成員的任務,100%\n`);
    expect(await columnOf(f.tasks.ofMember.id)).toBe("review");
    expect(body.statusAutoChanged).toEqual([{ taskId: f.tasks.ofMember.id, from: "inprogress", to: "review" }]);
    expect((await autoLogs(f.tasks.ofMember.id)).map((l) => l.detail)).toEqual([`A組成員的任務：${AUTO_REVIEW_MESSAGE}`]);
  });

  it("同一列也改了狀態時以 CSV 的狀態為準", async () => {
    await importCsv(`工項ID,類型,任務名稱,狀態,完成度\n${f.tasks.ofMember.id},主工項,A組成員的任務,待處理,100%\n`);
    expect(await columnOf(f.tasks.ofMember.id)).toBe("todo");
  });

  it("新增完成度 100 的工項 → 審查中；子工項更新讓主工項達 100 → 審查中", async () => {
    const [a, b] = f.tasks.withSubtasks.subtasks;
    const body = await importCsv([
      "工項ID,父工項ID,類型,任務名稱,完成度",
      ",,主工項,匯入的完成工項,100%",
      `${a.id},${f.tasks.withSubtasks.id},子工項,${a.title},100%`,
      `${b.id},${f.tasks.withSubtasks.id},子工項,${b.title},100%`,
    ].join("\n") + "\n");
    const created = await prisma.task.findFirstOrThrow({ where: { title: "匯入的完成工項" } });
    expect(created.columnId).toBe("review");
    expect(await columnOf(f.tasks.withSubtasks.id)).toBe("review");
    expect(body.statusAutoChanged).toHaveLength(2);
  });
});

describe("MCP", () => {
  it("update_task 把完成度改成 100 → 審查中，回傳 statusAutoChanged，活動紀錄標示來源", async () => {
    const r = await tool("update_task", { taskId: f.tasks.ofMember.id, changes: { completion: 100 } });
    expect(r.isError, JSON.stringify(r.body)).toBe(false);
    expect(r.body.task.status.id).toBe("review");
    expect(r.body.statusAutoChanged).toEqual({ from: "inprogress", to: "review" });
    expect(r.body.diff.map((d: any) => d.field).sort()).toEqual(["completion", "status"]);
    const [log] = await autoLogs(f.tasks.ofMember.id);
    expect(log).toMatchObject({ source: "mcp", clientName: "Claude" });
  });

  it("update_task 同時指定 status 時以指定的為準", async () => {
    const r = await tool("update_task", { taskId: f.tasks.ofMember.id, changes: { completion: 100, status: "todo" } });
    expect(r.body.task.status.id).toBe("todo");
    expect(r.body.statusAutoChanged).toBeUndefined();
  });

  it("create_tasks 為 100% 的審查中任務新增子任務 → 移回進行中", async () => {
    await put(f.tasks.ofMember.id, { completion: 100 });
    const r = await tool("create_tasks", {
      projectId: f.p1.id, dryRun: false, tasks: [{ clientRef: "s", title: "補做", parentTaskId: f.tasks.ofMember.id }],
    });
    expect(r.isError, JSON.stringify(r.body)).toBe(false);
    expect(await columnOf(f.tasks.ofMember.id)).toBe("inprogress");
  });
});
