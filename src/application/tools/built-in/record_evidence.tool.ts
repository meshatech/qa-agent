import type { QaTool } from '../qa-tool.js';
import {
  EvidenceRecordInputSchema,
  ToolResultSchema,
  type EvidenceRecordInput,
  type ToolResult,
} from './contracts.js';
import { contextService, ok } from './support.js';

interface EvidenceRecorderService {
  record(runDir: string, input: Record<string, unknown>): Promise<unknown>;
}

interface RecordedBug {
  bugId?: string;
  path?: string;
}

const SENSITIVE_TEXT_PATTERNS: Array<[RegExp, string]> = [
  [/\b(Bearer\s+)[A-Za-z0-9._~+/-]+=*/gi, '$1***'],
  [/\b(token|password|secret|api[_-]?key)=([^\s;&]+)/gi, '$1=***'],
];

export const EvidenceRecordTool: QaTool<EvidenceRecordInput, ToolResult> = {
  name: 'qa.evidence.record',
  description: 'Record runtime evidence through EvidenceService without exposing direct browser actions.',
  inputSchema: EvidenceRecordInputSchema,
  outputSchema: ToolResultSchema,
  async execute(input, context) {
    const runDir = input.runDir ?? context.runDir;
    if (!runDir) throw new Error('qa.evidence.record requires input.runDir or context.runDir');

    const evidence = contextService<EvidenceRecorderService>(context, 'evidence');
    const sanitizedReason = maskSensitiveText(input.reason);
    const requested = evidenceRequest(input, sanitizedReason);
    const bug = await evidence.record(runDir, {
      ...input.evidence,
      runId: input.runId ?? context.runId,
      scenarioId: input.scenarioId ?? context.scenarioId,
      config: input.config ?? context.config ?? input.evidence.config,
      rawMessage: sanitizedReason,
      reason: sanitizedReason,
      status: input.status,
      outputConfig: input.outputConfig,
    });
    const relativePaths = buildRelativePaths(bug, input);
    const artifactPaths = relativePaths.map((path) => `${trimTrailingSlash(runDir)}/${path}`);

    return ok({
      evidenceBundle: {
        bug,
        requested,
        outputConfig: input.outputConfig,
      },
      artifactPaths,
      relativePaths,
    });
  },
};

function evidenceRequest(input: EvidenceRecordInput, reason: string): Record<string, unknown> {
  return {
    runId: input.runId,
    scenarioId: input.scenarioId,
    reason,
    status: input.status,
    includeScreenshot: input.includeScreenshot,
    includeVideo: input.includeVideo,
    includeTrace: input.includeTrace,
    includeDomSnapshot: input.includeDomSnapshot,
    includeConsoleLog: input.includeConsoleLog,
    includeNetworkLog: input.includeNetworkLog,
  };
}

function buildRelativePaths(bug: unknown, input: EvidenceRecordInput): string[] {
  const bugPath = bugDirectory(bug, input);
  const paths = [
    `${bugPath}/bug.json`,
    `${bugPath}/bug-report.md`,
    `${bugPath}/observation.json`,
  ];

  if (input.includeScreenshot) paths.push(`${bugPath}/screenshot.png`);
  if (input.includeDomSnapshot) paths.push(`${bugPath}/dom-snapshot.html`);
  if (input.includeConsoleLog) paths.push(`${bugPath}/console.log`);
  if (input.includeNetworkLog) paths.push(`${bugPath}/network.json`);
  if (input.includeTrace) paths.push(`${bugPath}/trace.zip`);
  if (input.includeVideo) paths.push(`${bugPath}/video.webm`);

  return paths;
}

function bugDirectory(bug: unknown, input: EvidenceRecordInput): string {
  const recordedBug = bug as RecordedBug | undefined;
  if (recordedBug?.path) return recordedBug.path;
  if (recordedBug?.bugId) return `bugs/${recordedBug.bugId}`;
  return `bugs/${input.runId ?? input.scenarioId ?? 'evidence'}`;
}

function maskSensitiveText(value: string): string {
  return SENSITIVE_TEXT_PATTERNS.reduce((text, [pattern, replacement]) => text.replace(pattern, replacement), value);
}

function trimTrailingSlash(value: string): string {
  return value.replace(/[\\/]+$/, '');
}
