import { beforeEach, describe, expect, it } from "vitest";
import { prisma } from "../src/db";
import { checkLeaderAssignChange } from "../src/services/permissions";
import { Fixture, api, resetAndSeed } from "./fixtures";

let f: Fixture;
beforeEach(async () => { f = await resetAndSeed(); });

const put = (token: string, taskId: string, body: object) =>
  api().put(`/api/tasks/${taskId}`).set("Authorization", `Bearer ${token}`).send(body);

describe("PUT /api/tasks/:id 欄位白名單", () => {
  it("projectId、id、createdAt、completedAt 不會被寫入", async () => {
    const before = await prisma.task.findUniqueOrThrow({ where: { id: f.tasks.ofMember.id } });
    const res = await put(f.tokens.owner, f.tasks.ofMember.id, {
      title: "新標題", projectId: f.p2.id, id: "hijack", createdAt: "2000-01-01T00:00:00Z", completedAt: "2000-01-01T00:00:00Z",
    });
    expect(res.status).toBe(200);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: f.tasks.ofMember.id } });
    expect(after.title).toBe("新標題");
    expect(after.projectId).toBe(f.p1.id);
    expect(after.createdAt).toEqual(before.createdAt);
    expect(after.completedAt).toBeNull();
    expect(await prisma.task.findUnique({ where: { id: "hijack" } })).toBeNull();
  });

  it("Member 無法把自己的任務搬到別的專案", async () => {
    const res = await put(f.tokens.member, f.tasks.ofMember.id, { projectId: f.p2.id });
    expect(res.status).toBe(200);
    const after = await prisma.task.findUniqueOrThrow({ where: { id: f.tasks.ofMember.id } });
    expect(after.projectId).toBe(f.p1.id);
  });

  it("欄位型別錯誤回 400", async () => {
    expect((await put(f.tokens.owner, f.tasks.ofMember.id, { completion: 150 })).status).toBe(400);
    expect((await put(f.tokens.owner, f.tasks.ofMember.id, { priority: "urgent" })).status).toBe(400);
    expect((await put(f.tokens.owner, f.tasks.ofMember.id, { columnId: "archived" })).status).toBe(400);
  });

  it("子工項不能掛到別的任務下", async () => {
    const res = await put(f.tokens.owner, f.tasks.withSubtasks.id, {
      subtasks: f.tasks.withSubtasks.subtasks.map((s) => ({ ...s, taskId: f.tasks.ofMember.id })),
    });
    expect(res.status).toBe(200);
    const subs = await prisma.subTask.findMany({ where: { taskId: f.tasks.ofMember.id } });
    expect(subs).toHaveLength(0);
  });
});

describe("移入／移出「已完成」", () => {
  it("GroupLeader 與 Member 不能移入已完成；PM 可以", async () => {
    expect((await put(f.tokens.leader, f.tasks.ofMember.id, { columnId: "done" })).status).toBe(403);
    expect((await put(f.tokens.member, f.tasks.ofMember.id, { columnId: "done" })).status).toBe(403);
    const ok = await put(f.tokens.pm, f.tasks.ofMember.id, { columnId: "done" });
    expect(ok.status).toBe(200);
    expect(ok.body.completedAt).toBeTruthy();
  });

  it("GroupLeader 不能把任務從已完成移出", async () => {
    const res = await put(f.tokens.leader, f.tasks.done.id, { columnId: "inprogress" });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain("已完成移出");
  });

  it("建立任務時直接放在已完成欄也受同樣限制", async () => {
    const res = await api().post(`/api/projects/${f.p1.id}/tasks`).set("Authorization", `Bearer ${f.tokens.leader}`)
      .send({ title: "x", columnId: "done" });
    expect(res.status).toBe(403);
  });
});

describe("GroupLeader 人力調整規則", () => {
  it("可以指派給自組成員", async () => {
    const res = await put(f.tokens.leader, f.tasks.unassigned.id, { assignee: f.users.member.memberId });
    expect(res.status).toBe(200);
    expect(res.body.assignee).toBe(f.users.member.memberId);
  });

  it("指派給別組成員得 403，並說明原因", async () => {
    const res = await put(f.tokens.leader, f.tasks.unassigned.id, { assignee: f.users.memberB.memberId });
    expect(res.status).toBe(403);
    expect(res.body.error).toContain("不屬於你的組別");
    expect(res.body.error).toContain("B組成員");
  });

  it("變更別組 assignee 的任務得 403（即使改成自組成員或取消指派）", async () => {
    const toMine = await put(f.tokens.leader, f.tasks.ofMemberB.id, { assignee: f.users.member.memberId });
    expect(toMine.status).toBe(403);
    expect(toMine.body.error).toContain("目前負責人");
    const toNone = await put(f.tokens.leader, f.tasks.ofMemberB.id, { assignee: "" });
    expect(toNone.status).toBe(403);
    const unchanged = await prisma.task.findUniqueOrThrow({ where: { id: f.tasks.ofMemberB.id } });
    expect(unchanged.assignee).toBe(f.users.memberB.memberId);
  });

  it("可以編輯別組任務的其他欄位（assignee 不變）", async () => {
    const res = await put(f.tokens.leader, f.tasks.ofMemberB.id, { description: "補充說明", assignee: f.users.memberB.memberId });
    expect(res.status).toBe(200);
  });

  it("可以改派自組成員的任務，或取消指派", async () => {
    expect((await put(f.tokens.leader, f.tasks.ofMember.id, { assignee: f.users.leader.memberId })).status).toBe(200);
    expect((await put(f.tokens.leader, f.tasks.ofMember.id, { assignee: "" })).status).toBe(200);
  });

  it("建立任務時只能指派給自組成員", async () => {
    const post = (assignee: string) => api().post(`/api/projects/${f.p1.id}/tasks`)
      .set("Authorization", `Bearer ${f.tokens.leader}`).send({ title: "新任務", assignee });
    expect((await post(f.users.memberB.memberId)).status).toBe(403);
    expect((await post(f.users.member.memberId)).status).toBe(201);
  });

  it("子工項：不能改派別組成員的子工項、不能刪除別組成員的子工項、不能新增別組成員的子工項", async () => {
    const [subA, subB] = f.tasks.withSubtasks.subtasks;
    const base = [{ ...subA }, { ...subB }];

    const reassignB = await put(f.tokens.leader, f.tasks.withSubtasks.id, {
      subtasks: [base[0], { ...subB, assignee: f.users.member.memberId }],
    });
    expect(reassignB.status).toBe(403);

    const removeB = await put(f.tokens.leader, f.tasks.withSubtasks.id, { subtasks: [base[0]] });
    expect(removeB.status).toBe(403);

    const addB = await put(f.tokens.leader, f.tasks.withSubtasks.id, {
      subtasks: [...base, { title: "新子工項", assignee: f.users.memberB.memberId }],
    });
    expect(addB.status).toBe(403);

    expect(await prisma.subTask.count({ where: { taskId: f.tasks.withSubtasks.id } })).toBe(2);
  });

  it("子工項：可以改派自組成員的子工項、可以新增自組成員的子工項", async () => {
    const [subA, subB] = f.tasks.withSubtasks.subtasks;
    const res = await put(f.tokens.leader, f.tasks.withSubtasks.id, {
      subtasks: [{ ...subA, assignee: f.users.leader.memberId }, subB, { title: "新子工項", assignee: f.users.member.memberId }],
    });
    expect(res.status).toBe(200);
    expect(res.body.subtasks).toHaveLength(3);
  });

  it("規則只套用在 GroupLeader：PM 可以任意改派", async () => {
    expect((await put(f.tokens.pm, f.tasks.ofMemberB.id, { assignee: f.users.member.memberId })).status).toBe(200);
  });

  it("組長沒有組別時不能指派給任何人", () => {
    const users = new Map([["E-1", { groupId: "g", name: "某人" }]]);
    expect(checkLeaderAssignChange(null, users, "", "E-1")).toContain("不屬於你的組別");
    expect(checkLeaderAssignChange(null, users, "", "")).toBeNull();
  });

  it("負責人不是系統帳號（自由輸入的值）時視為別組", () => {
    const users = new Map([["E-1", { groupId: "g", name: "某人" }]]);
    expect(checkLeaderAssignChange("g", users, "外包廠商", "E-1")).toContain("目前負責人");
  });
});

describe("CSV 匯入套用 GroupLeader 規則", () => {
  const header = "工項ID,類型,任務名稱,指派人\n";
  const preview = (token: string, csv: string) => api().post(`/api/projects/${f.p1.id}/tasks/import/preview`)
    .set("Authorization", `Bearer ${token}`).send({ csv });

  it("新增別組成員負責的工項列為錯誤", async () => {
    const res = await preview(f.tokens.leader, header + `,主工項,新工項,${f.users.memberB.memberId}\n`);
    expect(res.status).toBe(200);
    expect(res.body.summary.error).toBe(1);
    expect(res.body.rows[0].errors.join()).toContain("不屬於你的組別");
  });

  it("改派別組成員負責的既有工項列為錯誤", async () => {
    const res = await preview(f.tokens.leader, header + `${f.tasks.ofMemberB.id},主工項,B組成員的任務,${f.users.member.memberId}\n`);
    expect(res.body.summary.error).toBe(1);
    expect(res.body.rows[0].errors.join()).toContain("目前負責人");
  });

  it("別組任務的其他欄位可更新，但不能「另存為新工項」", async () => {
    const res = await preview(f.tokens.leader, header + `${f.tasks.ofMemberB.id},主工項,B組任務改名,${f.users.memberB.memberId}\n`);
    expect(res.body.summary.modified).toBe(1);
    const row = res.body.rows[0];
    expect(row.createNewBlockedReason).toContain("不屬於你的組別");

    const commit = await api().post(`/api/projects/${f.p1.id}/tasks/import/commit`)
      .set("Authorization", `Bearer ${f.tokens.leader}`)
      .send({ previewToken: res.body.previewToken, decisions: { [row.key]: "create_new" } });
    expect(commit.status).toBe(200);
    expect(commit.body.created).toBe(0);
    expect(commit.body.notImported).toHaveLength(1);
  });

  it("PM 匯入不受組長規則限制", async () => {
    const res = await preview(f.tokens.pm, header + `,主工項,新工項,${f.users.memberB.memberId}\n`);
    expect(res.body.summary.new).toBe(1);
  });

  it("Member 與非成員不能匯入", async () => {
    expect((await preview(f.tokens.member, header + ",主工項,x,\n")).status).toBe(403);
    expect((await preview(f.tokens.outsider, header + ",主工項,x,\n")).status).toBe(404);
  });
});

describe("輸入驗證", () => {
  it("附件連結只接受 http/https", async () => {
    const post = (url: string) => api().post(`/api/tasks/${f.tasks.ofMember.id}/attachments`)
      .set("Authorization", `Bearer ${f.tokens.owner}`).send({ name: "x", url });
    expect((await post("javascript:alert(1)")).status).toBe(400);
    expect((await post("https://drive.google.com/file")).status).toBe(201);
  });

  it("會議紀錄外部連結只接受 http/https 或空白", async () => {
    const putRecord = (externalLink: string) => api().put(`/api/meeting-records/${f.record.id}`)
      .set("Authorization", `Bearer ${f.tokens.owner}`).send({ externalLink });
    expect((await putRecord("javascript:alert(1)")).status).toBe(400);
    expect((await putRecord("")).status).toBe(200);
  });

  it("專案成員角色只接受五種專案角色（不可指定 admin）", async () => {
    const res = await api().put(`/api/projects/${f.p1.id}/members/${f.users.member.id}`)
      .set("Authorization", `Bearer ${f.tokens.owner}`).send({ role: "admin" });
    expect(res.status).toBe(400);
  });

  it("風險更新忽略 projectId 等不可更新欄位", async () => {
    const res = await api().put(`/api/risks/${f.risk.id}`).set("Authorization", `Bearer ${f.tokens.owner}`)
      .send({ ...f.risk, projectId: f.p2.id, title: "改名" });
    expect(res.status).toBe(200);
    const after = await prisma.risk.findUniqueOrThrow({ where: { id: f.risk.id } });
    expect(after.projectId).toBe(f.p1.id);
    expect(after.title).toBe("改名");
  });
});
