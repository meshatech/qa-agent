import {
  DemandContextSchema,
  type DemandContext,
} from '../schemas/demand-context.schema.js';

export interface ConsumedDemandContext {
  taskId: string;
  title: string;
  description: string;
  acceptanceCriteria: string[];
}

export function consumeDemandContext(demand: DemandContext): ConsumedDemandContext {
  const validated = DemandContextSchema.parse(demand);
  const seen = new Set<string>();
  const acceptanceCriteria: string[] = [];

  for (const criterion of validated.acceptanceCriteria) {
    const normalized = criterion.trim();
    if (!normalized || seen.has(normalized)) {
      continue;
    }
    seen.add(normalized);
    acceptanceCriteria.push(normalized);
  }

  return {
    taskId: validated.taskId,
    title: validated.title,
    description: validated.description.trim(),
    acceptanceCriteria,
  };
}
