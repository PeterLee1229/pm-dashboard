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
    // 此任務屬於 B 組：另存為新工項會建立一筆 B 組任務，先被組別規則擋下
    expect(row.createNewBlockedReason).toContain("「B組」不是你的組別");

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

// 裁決 #4：組長只能變更「目前屬於自己組、或尚未分組」的任務的 groupId，且新的 groupId 只能是自己的組
describe("GroupLeader 變更任務組別", () => {
  it("繞道情境：先把別組的任務改成自己的組，第一步就被擋下，之後也無法改派", async () => {
    // B 組、尚未指派的任務：負責人規則本身擋不住，必須靠組別規則
    const t = await prisma.task.create({ data: { title: "B組未指派", groupId: f.groups.B.id, projectId: f.p1.id } });
    const step1 = await put(f.tokens.leader, t.id, { groupId: f.groups.A.id });
    expect(step1.status).toBe(403);
    expect(step1.body.error).toContain("B組");
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).groupId).toBe(f.groups.B.id);

    // 一次送出「改組 + 改派」也一樣被擋
    const combined = await put(f.tokens.leader, t.id, { groupId: f.groups.A.id, assignee: f.users.member.memberId });
    expect(combined.status).toBe(403);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: t.id } })).assignee).toBe("");
  });

  it("未分組 → 自己的組：允許", async () => {
    expect((await put(f.tokens.leader, f.tasks.unassigned.id, { groupId: f.groups.A.id })).status).toBe(200);
  });

  it("未分組 → 別組：403", async () => {
    expect((await put(f.tokens.leader, f.tasks.unassigned.id, { groupId: f.groups.B.id })).status).toBe(403);
  });

  it("自己的組 → 別組、自己的組 → 未分組：403", async () => {
    expect((await put(f.tokens.leader, f.tasks.ofMember.id, { groupId: f.groups.B.id })).status).toBe(403);
    const toNone = await put(f.tokens.leader, f.tasks.ofMember.id, { groupId: "" });
    expect(toNone.status).toBe(403);
    expect(toNone.body.error).toContain("未分組");
  });

  it("別組任務的 groupId 不變時，可以編輯其他欄位", async () => {
    expect((await put(f.tokens.leader, f.tasks.ofMemberB.id, { groupId: f.groups.B.id, description: "x" })).status).toBe(200);
  });

  it("建立任務時只能設為自己的組或不分組", async () => {
    const post = (groupId: string) => api().post(`/api/projects/${f.p1.id}/tasks`)
      .set("Authorization", `Bearer ${f.tokens.leader}`).send({ title: "新任務", groupId });
    expect((await post(f.groups.B.id)).status).toBe(403);
    expect((await post(f.groups.A.id)).status).toBe(201);
    expect((await post("")).status).toBe(201);
  });

  it("子工項的組別也適用：B 組子工項不能改成 A 組；新子工項不能設為 B 組", async () => {
    const [subA, subB] = f.tasks.withSubtasks.subtasks;
    const change = await put(f.tokens.leader, f.tasks.withSubtasks.id, {
      subtasks: [subA, { ...subB, groupId: f.groups.A.id }],
    });
    expect(change.status).toBe(403);
    const add = await put(f.tokens.leader, f.tasks.withSubtasks.id, {
      subtasks: [subA, subB, { title: "新子工項", groupId: f.groups.B.id }],
    });
    expect(add.status).toBe(403);
  });

  it("規則只套用在 GroupLeader：PM 可以任意變更組別", async () => {
    expect((await put(f.tokens.pm, f.tasks.ofMemberB.id, { groupId: f.groups.A.id })).status).toBe(200);
  });

  it("CSV 匯入：組長把別組任務改成自己的組列為錯誤", async () => {
    const res = await api().post(`/api/projects/${f.p1.id}/tasks/import/preview`)
      .set("Authorization", `Bearer ${f.tokens.leader}`)
      .send({ csv: `工項ID,類型,任務名稱,組別\n${f.tasks.ofMemberB.id},主工項,B組成員的任務,A組\n` });
    expect(res.body.summary.error).toBe(1);
    expect(res.body.rows[0].errors.join()).toContain("B組");
  });
});

// 裁決 #5：member 不能變更任何任務的 assignee（包括自己負責的任務）
describe("Member 不能改派任務", () => {
  it("不能改派自己負責的任務（改給別人或取消指派）", async () => {
    const toOther = await put(f.tokens.member, f.tasks.ofMember.id, { assignee: f.users.leader.memberId });
    expect(toOther.status).toBe(403);
    expect(toOther.body.error).toContain("負責人");
    expect((await put(f.tokens.member, f.tasks.ofMember.id, { assignee: "" })).status).toBe(403);
    expect((await prisma.task.findUniqueOrThrow({ where: { id: f.tasks.ofMember.id } })).assignee).toBe(f.users.member.memberId);
  });

  it("負責人不變時可以編輯自己的任務", async () => {
    const res = await put(f.tokens.member, f.tasks.ofMember.id, {
      assignee: f.users.member.memberId, description: "進度更新", completion: 50,
    });
    expect(res.status).toBe(200);
  });

  it("子工項：不能改派、不能刪除有負責人的子工項、不能新增有負責人的子工項；可以新增未指派的子工項", async () => {
    const own = await prisma.task.create({
      data: {
        title: "member 的任務（有子工項）", assignee: f.users.member.memberId, projectId: f.p1.id,
        subtasks: { create: [{ title: "子一", assignee: f.users.member.memberId }, { title: "子二" }] },
      },
      include: { subtasks: true },
    });
    const [s1, s2] = own.subtasks;
    expect((await put(f.tokens.member, own.id, { subtasks: [{ ...s1, assignee: f.users.leader.memberId }, s2] })).status).toBe(403);
    expect((await put(f.tokens.member, own.id, { subtasks: [s2] })).status).toBe(403);
    expect((await put(f.tokens.member, own.id, { subtasks: [s1, s2, { title: "新", assignee: f.users.member.memberId }] })).status).toBe(403);
    const ok = await put(f.tokens.member, own.id, { subtasks: [s1, s2, { title: "新（未指派）" }] });
    expect(ok.status).toBe(200);
    expect(ok.body.subtasks).toHaveLength(3);
  });

  it("Owner、PM 可以改派", async () => {
    expect((await put(f.tokens.owner, f.tasks.ofMember.id, { assignee: f.users.memberB.memberId })).status).toBe(200);
    expect((await put(f.tokens.pm, f.tasks.ofMember.id, { assignee: f.users.member.memberId })).status).toBe(200);
  });
});
