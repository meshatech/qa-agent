import type { BugContext } from '../../domain/schemas/bug-context.schema.js';
import type { DemandContext } from '../../domain/schemas/demand-context.schema.js';

/** Resultado da leitura de uma task ClickUp — sem lógica de negócio na porta. */
export interface ClickUpTaskReadResult {
  demand: DemandContext;
  bug?: BugContext;
  warnings?: string[];
}

export interface ClickUpReaderPort {
  readTask(
    taskId: string,
    token: string,
    options?: { configTeamId?: string },
  ): Promise<ClickUpTaskReadResult>;
  readConfiguredTask(
    token: string,
    configTaskId?: string,
    configTeamId?: string,
  ): Promise<ClickUpTaskReadResult>;
}
