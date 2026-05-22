import { readFile } from 'node:fs/promises';

import type { ExecutionPlan } from '../../../domain/schemas/execution-plan.schema.js';
import type { RunConfig } from '../../../domain/schemas/config.schema.js';
import { ScreenObservationSchema } from '../../../domain/schemas/observation.schema.js';
import type { QaTool } from '../qa-tool.js';
import {
  EvidenceRecordInputSchema,
  MemorySearchInputSchema,
  PlanBuildInputSchema,
  PlanExecuteInputSchema,
  PlanReplanInputSchema,
  ReportGenerateInputSchema,
  ScreenObserveInputSchema,
  SpecExportInputSchema,
  ToolResultSchema,
  type BrowserToolService,
  type EvidenceRecordInput,
  type MemorySearchInput,
  type PlanBuildInput,
  type PlanExecuteInput,
  type PlanReplanInput,
  type ReportGenerateInput,
  type ScreenObserveInput,
  type SpecExportInput,
  type ToolResult,
} from './contracts.js';
import { configFrom, contextService, ok } from './support.js';

export const ScreenObserveTool: QaTool<ScreenObserveInput, ToolResult> = {
  name: 'qa.screen.observe',
  description: 'Return a controlled ScreenObservation from the current browser session without executing actions.',
  inputSchema: ScreenObserveInputSchema,
  outputSchema: ToolResultSchema,
  async execute(input, context) {
    const browser = contextService<BrowserToolService>(context, 'browser');
    const observation = ScreenObservationSchema.parse(await browser.observe());
    const result: Record<string, unknown> = { observation };
    if (input.includeDom) result.domSnapshot = await browser.domSnapshot?.();
    if (input.includeScreenshot) result.screenshotBase64 = (await browser.screenshot?.())?.toString('base64');
    if (input.includeAccessibilityTree) result.accessibilityTree = observation.elements.map(({ id, role, name, text }) => ({ id, role, name, text }));
    return ok(result);
  },
};

export const PlanBuildTool: QaTool<PlanBuildInput, ToolResult> = {
  name: 'qa.plan.build',
  description: 'Build a validated ExecutionPlan from RunConfig and scenarios without executing browser actions.',
  inputSchema: PlanBuildInputSchema,
  outputSchema: ToolResultSchema,
  async execute(input, context) {
    const planner = contextService<{ build(config: RunConfig, scenarios: unknown[]): Promise<unknown> }>(context, 'executionPlanPlanner');
    return ok(await planner.build(configFrom(input, context, 'qa.plan.build'), input.scenarios));
  },
};

export const PlanReplanTool: QaTool<PlanReplanInput, ToolResult> = {
  name: 'qa.plan.replan',
  description: 'Request and validate a PlanPatch for a failed ExecutionPlan step.',
  inputSchema: PlanReplanInputSchema,
  outputSchema: ToolResultSchema,
  async execute(input, context) {
    const replanner = contextService<{ replan(input: unknown): Promise<unknown> }>(context, 'planReplanner');
    return ok(await replanner.replan({ ...input, config: configFrom(input, context, 'qa.plan.replan') }));
  },
};

export const PlanExecuteTool: QaTool<PlanExecuteInput, ToolResult> = {
  name: 'qa.plan.execute',
  description: 'Execute a validated ExecutionPlan through PlanExecutorService.',
  inputSchema: PlanExecuteInputSchema,
  outputSchema: ToolResultSchema,
  async execute(input, context) {
    const executor = contextService<{ execute(plan: ExecutionPlan, config: RunConfig): Promise<unknown> }>(context, 'planExecutor');
    return ok(await executor.execute(input.plan, configFrom(input, context, 'qa.plan.execute')));
  },
};

export const EvidenceRecordTool: QaTool<EvidenceRecordInput, ToolResult> = {
  name: 'qa.evidence.record',
  description: 'Record runtime evidence through EvidenceService under runtime control.',
  inputSchema: EvidenceRecordInputSchema,
  outputSchema: ToolResultSchema,
  async execute(input, context) {
    const runDir = input.runDir ?? context.runDir;
    if (!runDir) throw new Error('qa.evidence.record requires input.runDir or context.runDir');
    const evidence = contextService<{ record(runDir: string, input: unknown): Promise<unknown> }>(context, 'evidence');
    return ok(await evidence.record(runDir, input.evidence));
  },
};

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

export const SpecExportTool: QaTool<SpecExportInput, ToolResult> = {
  name: 'qa.spec.export',
  description: 'Export a Playwright spec from a completed QaRunResult without participating in runtime execution.',
  inputSchema: SpecExportInputSchema,
  outputSchema: ToolResultSchema,
  async execute(input, context) {
    const exporter = contextService<{ export(result: unknown): string }>(context, 'specExporter');
    return ok({ spec: exporter.export(input.result) });
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
