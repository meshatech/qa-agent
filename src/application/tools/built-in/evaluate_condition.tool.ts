import type { QaTool } from '../qa-tool.js';
import { evaluateCondition } from './condition-evaluator.js';
import {
  ConditionEvaluateInputSchema,
  ToolResultSchema,
  type ConditionEvaluateInput,
  type ToolResult,
} from './contracts.js';
import { ok } from './support.js';

export const ConditionEvaluateTool: QaTool<ConditionEvaluateInput, ToolResult> = {
  name: 'qa.condition.evaluate',
  description: 'Evaluate a PlanCondition against observation/runtime snapshots for internal executor use.',
  internalOnly: true,
  inputSchema: ConditionEvaluateInputSchema,
  outputSchema: ToolResultSchema,
  async execute(input) {
    return ok(evaluateCondition(input));
  },
};
