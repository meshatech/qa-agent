import type { QaTool } from '../qa-tool.js';
import {
  ReportGenerateInputSchema,
  ToolResultSchema,
  type ReportGenerateInput,
  type ToolResult,
} from './contracts.js';
import { SpecExportTool } from './export_playwright_spec.tool.js';
import { PlanBuildTool } from './build_execution_plan.tool.js';
import { PlanExecuteTool } from './execute_execution_plan.tool.js';
import { EvidenceRecordTool } from './record_evidence.tool.js';
import { PlanReplanTool } from './request_replan.tool.js';
import { ScreenObserveTool } from './observe_screen.tool.js';
import { MemorySearchTool, SearchProjectMemoryTool } from './memory-search.tool.js';
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

export { MemorySearchTool, SearchProjectMemoryTool } from './memory-search.tool.js';

export const PUBLIC_QA_TOOL_CATALOG = [
  ScreenObserveTool,
  PlanBuildTool,
  PlanReplanTool,
  PlanExecuteTool,
  EvidenceRecordTool,
  ReportGenerateTool,
  SpecExportTool,
  MemorySearchTool,
  SearchProjectMemoryTool,
];
