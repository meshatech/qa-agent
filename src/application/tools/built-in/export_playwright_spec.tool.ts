import { dirname, join } from 'node:path';
import { mkdir, readFile, writeFile } from 'node:fs/promises';

import type { QaRunResult } from '../../../domain/models/run.model.js';
import type { QaTool } from '../qa-tool.js';
import {
  SpecExportInputSchema,
  ToolResultSchema,
  type SpecExportInput,
  type ToolResult,
} from './contracts.js';
import { contextService, ok } from './support.js';

interface PlaywrightSpecExporterService {
  export(result: QaRunResult): string;
}

interface ExecutionLog {
  runId?: string;
  steps?: QaRunResult['steps'];
  bugs?: QaRunResult['bugs'];
}

const SENSITIVE_TEXT_PATTERNS: Array<[RegExp, string]> = [
  [/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1***'],
  [/\b(token|password|secret|api[_-]?key)=([^\s;&'"]+)/gi, '$1=***'],
  [/\b(token|password|secret|api[_-]?key)\s*=\s*["'][^"']+["']/gi, '$1 = "***"'],
  [/(["']?(?:token|password|secret|apiKey|api_key)["']?\s*:\s*["'])[^"']+(["'])/gi, '$1***$2'],
  [/(\.fill\(\s*["'])[^"']*(password|secret|token|api[_-]?key)[^"']*(["']\s*\))/gi, '$1***$3'],
];

export const SpecExportTool: QaTool<SpecExportInput, ToolResult> = {
  name: 'qa.spec.export',
  description: 'Export an experimental Playwright spec after execution without participating in runtime execution.',
  inputSchema: SpecExportInputSchema,
  outputSchema: ToolResultSchema,
  async execute(input, context) {
    const warnings: string[] = [
      'Experimental export: generated spec is an artifact only and is not used by Agent QA runtime.',
    ];
    const exporter = contextService<PlaywrightSpecExporterService>(context, 'specExporter');
    const result = await resultFromInput(input, context.runDir, warnings);
    if (!result) return ok({ generatedSpecPath: undefined, warnings });

    const spec = maybeSanitize(exporter.export(result), input.sanitizeSensitiveData);
    const generatedSpecPath = input.outputPath ?? defaultOutputPath(input.executionLogPath, context.runDir);
    if (!generatedSpecPath) {
      warnings.push('Spec export skipped because outputPath could not be resolved.');
      return ok({ generatedSpecPath: undefined, warnings });
    }

    await mkdir(dirname(generatedSpecPath), { recursive: true });
    await writeFile(generatedSpecPath, spec, 'utf8');

    return ok({ generatedSpecPath, warnings });
  },
};

async function resultFromInput(input: SpecExportInput, runDir: string | undefined, warnings: string[]): Promise<QaRunResult | undefined> {
  if (input.result) return normalizeResult(input.result, runDir);
  if (!input.executionLogPath) return undefined;

  let rawLog: string;
  try {
    rawLog = await readFile(input.executionLogPath, 'utf8');
  } catch (error) {
    warnings.push(`Spec export skipped because executionLogPath could not be read: ${(error as Error).message}`);
    return undefined;
  }

  try {
    const log = JSON.parse(rawLog) as ExecutionLog;
    const steps = Array.isArray(log.steps) ? log.steps : [];
    if (steps.length === 0) warnings.push('Execution log has no steps to export.');
    return {
      status: log.bugs && log.bugs.length > 0 ? 'FAILED' : 'PASSED',
      runDir: runDir ?? dirname(input.executionLogPath),
      steps,
      bugs: Array.isArray(log.bugs) ? log.bugs : [],
    };
  } catch (error) {
    warnings.push(`Spec export skipped because executionLogPath is not valid JSON: ${(error as Error).message}`);
    return undefined;
  }
}

function normalizeResult(value: unknown, runDir: string | undefined): QaRunResult {
  const result = value as Partial<QaRunResult>;
  return {
    status: result.status ?? 'PASSED',
    runDir: result.runDir ?? runDir ?? '.',
    steps: Array.isArray(result.steps) ? result.steps : [],
    bugs: Array.isArray(result.bugs) ? result.bugs : [],
    scenarios: result.scenarios,
    metrics: result.metrics,
    startedAt: result.startedAt,
    finishedAt: result.finishedAt,
  };
}

function defaultOutputPath(executionLogPath: string | undefined, runDir: string | undefined): string | undefined {
  if (runDir) return join(runDir, 'generated-test.spec.ts');
  if (executionLogPath) return join(dirname(executionLogPath), 'generated-test.spec.ts');
  return undefined;
}

function maybeSanitize(value: string, enabled: boolean): string {
  if (!enabled) return value;
  return SENSITIVE_TEXT_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}
