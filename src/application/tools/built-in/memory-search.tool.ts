import type { QaTool } from '../qa-tool.js';
import {
  MemorySearchInputSchema,
  MemorySearchOutputSchema,
  ToolResultSchema,
  type MemorySearchInput,
  type ToolResult,
} from './contracts.js';
import { executeProjectMemorySearch } from './memory-tool-support.js';
import { ok } from './support.js';

async function runMemorySearch(input: MemorySearchInput, context: Parameters<QaTool<MemorySearchInput, ToolResult>['execute']>[1]): Promise<ToolResult> {
  const result = await executeProjectMemorySearch(input, context);
  return ok(MemorySearchOutputSchema.parse(result));
}

export const MemorySearchTool: QaTool<MemorySearchInput, ToolResult> = {
  name: 'qa.memory.search',
  description: 'Search project memory chunks indexed with BM25 without browser access.',
  inputSchema: MemorySearchInputSchema,
  outputSchema: ToolResultSchema,
  execute: runMemorySearch,
};

export const SearchProjectMemoryTool: QaTool<MemorySearchInput, ToolResult> = {
  name: 'search_project_memory',
  description: 'ClickUp alias for qa.memory.search — search project memory chunks indexed with BM25.',
  inputSchema: MemorySearchInputSchema,
  outputSchema: ToolResultSchema,
  execute: runMemorySearch,
};
