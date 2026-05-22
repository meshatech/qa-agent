import { Injectable } from '@nestjs/common';
import type { QaTool, QaToolDescriptor } from './qa-tool.js';
import type { QaToolContext } from './qa-tool-context.js';

export interface ListQaToolsOptions {
  includeInternal?: boolean;
}

export interface ExecuteQaToolOptions {
  includeInternal?: boolean;
}

const PUBLIC_PLAYWRIGHT_ACTION_TOOL_NAMES = new Set([
  'click',
  'fill',
  'press',
  'navigate',
  'selectOption',
  'uploadFile',
  'dragAndDrop',
  'evaluate',
  'playwright.click',
  'playwright.fill',
  'playwright.press',
  'playwright.navigate',
  'playwright.selectOption',
  'playwright.uploadFile',
  'playwright.dragAndDrop',
  'playwright.evaluate',
]);

@Injectable()
export class QaToolRegistry {
  private readonly tools = new Map<string, QaTool>();

  constructor(initialTools: QaTool[] = []) {
    for (const tool of initialTools) this.register(tool);
  }

  register(tool: QaTool): void {
    this.assertValidTool(tool);
    if (this.tools.has(tool.name)) throw new Error(`QaTool already registered: ${tool.name}`);
    this.tools.set(tool.name, tool);
  }

  registerMany(tools: QaTool[]): void {
    for (const tool of tools) this.register(tool);
  }

  get(name: string, options: ListQaToolsOptions = {}): QaTool | undefined {
    const tool = this.tools.get(name);
    if (!tool) return undefined;
    if (tool.internalOnly && !options.includeInternal) return undefined;
    return tool;
  }

  has(name: string, options: ListQaToolsOptions = {}): boolean {
    return this.get(name, options) !== undefined;
  }

  getOrThrow(name: string, options: ListQaToolsOptions = {}): QaTool {
    const tool = this.get(name, options);
    if (!tool) throw new Error(`QaTool not found or not accessible: ${name}`);
    return tool;
  }

  require(name: string, options: ListQaToolsOptions = {}): QaTool {
    return this.getOrThrow(name, options);
  }

  list(options: ListQaToolsOptions = {}): QaToolDescriptor[] {
    return [...this.tools.values()]
      .filter((tool) => options.includeInternal || !tool.internalOnly)
      .map((tool) => ({
        name: tool.name,
        description: tool.description,
        internalOnly: Boolean(tool.internalOnly),
      }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  listPublic(): QaToolDescriptor[] {
    return this.list();
  }

  listAll(): QaToolDescriptor[] {
    return this.list({ includeInternal: true });
  }

  async execute(name: string, input: unknown, context: QaToolContext, options: ExecuteQaToolOptions = {}): Promise<unknown> {
    const tool = this.require(name, options);
    const parsedInput = tool.inputSchema.parse(input);
    const output = await tool.execute(parsedInput, context);
    return tool.outputSchema ? tool.outputSchema.parse(output) : output;
  }

  private assertValidTool(tool: QaTool): void {
    if (!tool.name.trim()) throw new Error('QaTool name is required');
    if (!tool.description.trim()) throw new Error(`QaTool description is required: ${tool.name}`);
    if (!tool.inputSchema) throw new Error(`QaTool inputSchema is required: ${tool.name}`);
    if (typeof tool.execute !== 'function') throw new Error(`QaTool execute is required: ${tool.name}`);
    if (!tool.internalOnly && PUBLIC_PLAYWRIGHT_ACTION_TOOL_NAMES.has(tool.name)) {
      throw new Error(`Direct Playwright action cannot be registered as a public QaTool: ${tool.name}`);
    }
  }
}
