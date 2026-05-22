import type { RunConfig } from '../../../domain/schemas/config.schema.js';
import type { QaToolContext } from '../qa-tool-context.js';
import type { ToolIssue, ToolResult } from './contracts.js';

export function contextService<T extends object>(context: QaToolContext, key: string): T {
  const value = context.metadata?.[key];
  if (!value || typeof value !== 'object') throw new Error(`QaTool requires context.metadata.${key}`);
  return value as T;
}

export function configFrom(input: { config?: RunConfig }, context: QaToolContext, toolName: string): RunConfig {
  const config = input.config ?? context.config;
  if (!config) throw new Error(`${toolName} requires input.config or context.config`);
  return config;
}

export function ok(result?: unknown): ToolResult {
  return { ok: true, issues: [], result };
}

export function failed(issue: ToolIssue): ToolResult {
  return { ok: false, issues: [issue] };
}
