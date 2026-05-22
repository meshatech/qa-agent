import { readFile } from 'node:fs/promises';

import type { QaTool } from '../qa-tool.js';
import {
  MemorySearchInputSchema,
  ReportGenerateInputSchema,
  ToolResultSchema,
  type MemorySearchInput,
  type ReportGenerateInput,
  type ToolResult,
} from './contracts.js';
import { SpecExportTool } from './export_playwright_spec.tool.js';
import { PlanBuildTool } from './build_execution_plan.tool.js';
import { PlanExecuteTool } from './execute_execution_plan.tool.js';
import { EvidenceRecordTool } from './record_evidence.tool.js';
import { PlanReplanTool } from './request_replan.tool.js';
import { ScreenObserveTool } from './observe_screen.tool.js';
import { contextService, ok } from './support.js';

export const ReportGenerateTool: QaTool<ReportGenerateInput, ToolResult> = {
  name: 'qa.report.generate',
  description: 'Generate or read a report for an existing run without executing browser actions.',
  inputSchema: ReportGenerateInputSchema,
  outputSchema: ToolResultSchema,
  async execute(input, context) {
    const runsDir = input.runsDir ?? context.runDir;
    if (!runsDir) throw new Error('qa.report.generate requires input.runsDir or context.runDir');
    const report = contextService<{ execute(runsDir: string, runId: string | undefined, format: 'md' | 'json'): Promise<unknown> }>(context, 'reportRun');
    return ok({ format: input.format, report: await report.execute(runsDir, input.runId, input.format) });
  },
};

export const MemorySearchTool: QaTool<MemorySearchInput, ToolResult> = {
  name: 'qa.memory.search',
  description: 'Search project memory text for planner/replanner context without browser access.',
  inputSchema: MemorySearchInputSchema,
  outputSchema: ToolResultSchema,
  async execute(input) {
    const text = await readFile(input.memoryPath, 'utf8').catch(() => '');
    const query = input.query.toLowerCase();
    const matches = text
      .split(/\r?\n\r?\n/)
      .map((chunk) => chunk.trim())
      .filter((chunk) => chunk && chunk.toLowerCase().includes(query))
      .slice(0, input.limit);
    return ok({ matches });
  },
};

export const PUBLIC_QA_TOOL_CATALOG = [
  ScreenObserveTool,
  PlanBuildTool,
  PlanReplanTool,
  PlanExecuteTool,
  EvidenceRecordTool,
  ReportGenerateTool,
  SpecExportTool,
  MemorySearchTool,
];
