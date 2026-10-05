// 工具註冊表：所有工具只在這裡登記一次，MCP server（adapters/mcp.ts）與 Phase 3 內建助理（adapters/anthropic.ts）共用。

import type { ToolDef } from "./types";
import { getProjectSummaryTool, listProjectsTool } from "./read/projects";
import { getTaskTool, listOverdueTasksTool, listTasksTool } from "./read/tasks";
import { listRisksTool } from "./read/risks";
import { getMeetingTool, listMeetingsTool } from "./read/meetings";
import { getActivityLogTool, getWeeklyReportDataTool, listOkrsTool, searchTool } from "./read/misc";
import { createTasksTool } from "./write/createTasks";
import { updateTaskTool } from "./write/updateTask";
import { addCommentTool, createMeetingRecordTool, createRiskTool } from "./write/misc";

export const readTools: ToolDef[] = [
  listProjectsTool, getProjectSummaryTool, listTasksTool, getTaskTool, listOverdueTasksTool, listRisksTool,
  listMeetingsTool, getMeetingTool, getWeeklyReportDataTool, listOkrsTool, searchTool, getActivityLogTool,
] as unknown as ToolDef[];

export const writeTools: ToolDef[] = [
  createTasksTool, updateTaskTool, addCommentTool, createMeetingRecordTool, createRiskTool,
] as unknown as ToolDef[];

export const allTools: ToolDef[] = [...readTools, ...writeTools];

const byName = new Map(allTools.map((t) => [t.name, t]));
export const findTool = (name: string) => byName.get(name);
export const isWriteTool = (name: string) => byName.get(name)?.scope === "pm:write";
