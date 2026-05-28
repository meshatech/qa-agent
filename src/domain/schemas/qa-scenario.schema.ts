import { z } from 'zod';
import { ScenarioIntentSchema } from './scenario-intent.schema.js';

export const AttemptRecordSchema = z.object({
  actionType: z.string(),
  result: z.enum(['PASSED', 'FAILED', 'RECOVERED', 'BLOCKED']),
  reason: z.string().optional(),
  ts: z.string(),
}).strict();

export const QaTaskSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  expected: z.string().min(1),
  status: z.enum(['PENDING', 'PASSED', 'PASSED_WITH_WARNINGS', 'FAILED', 'BLOCKED', 'SKIPPED']),
  dependsOn: z.array(z.string()).optional(),
  intent: ScenarioIntentSchema.optional(),
  attempts: z.array(AttemptRecordSchema).optional(),
}).strict();

export const QaScenarioSchema = z.object({
  id: z.string().min(1),
  title: z.string().min(1),
  tasks: z.array(QaTaskSchema),
  status: z.enum(['PLANNED', 'RUNNING', 'PASSED', 'PASSED_WITH_WARNINGS', 'FAILED', 'PARTIAL', 'BLOCKED']),
  intent: ScenarioIntentSchema.optional(),
  preconditions: z.array(z.string()).optional(),
}).strict();

export type AttemptRecord = z.infer<typeof AttemptRecordSchema>;
export type QaTask = z.infer<typeof QaTaskSchema>;
export type QaScenario = z.infer<typeof QaScenarioSchema>;
