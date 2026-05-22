import type { PlanCondition, RuntimeStateSnapshot } from '../../../domain/schemas/execution-plan.schema.js';
import type { ScreenObservation } from '../../../domain/schemas/observation.schema.js';
import type { ConditionEvaluateInput } from './contracts.js';

export function evaluateCondition(input: ConditionEvaluateInput): Record<string, unknown> {
  const { condition, observation, before, after } = input;
  const evaluation = conditionEvaluation(condition, observation, before, after);
  return {
    conditionId: 'tool:condition',
    phase: 'tool',
    type: condition.type,
    passed: evaluation.passed,
    expected: evaluation.expected,
    actual: evaluation.actual,
    before,
    after,
    severity: evaluation.passed ? 'INFO' : 'ERROR',
    reason: evaluation.passed ? 'condition passed' : 'condition failed',
  };
}

function conditionEvaluation(condition: PlanCondition, observation: ScreenObservation, before?: RuntimeStateSnapshot, after?: RuntimeStateSnapshot): { passed: boolean; expected: unknown; actual: unknown } {
  if (condition.type === 'text_visible') {
    return { passed: visibleTextIncludes(observation, condition.text), expected: condition.text, actual: observation.visibleTexts.slice(0, 8) };
  }
  if (condition.type === 'text_any_visible') {
    return { passed: condition.texts.some((text) => visibleTextIncludes(observation, text)), expected: condition.texts, actual: observation.visibleTexts.slice(0, 8) };
  }
  if (condition.type === 'url_contains') {
    return { passed: observation.url.includes(condition.value), expected: condition.value, actual: observation.url };
  }
  if (isRuntimeStateCondition(condition)) {
    return runtimeConditionEvaluation(condition, observation, before, after);
  }
  return { passed: true, expected: condition, actual: undefined };
}

function visibleTextIncludes(observation: ScreenObservation, text: string): boolean {
  return observationText(observation).some((value) => value.toLowerCase().includes(text.toLowerCase()));
}

function observationText(observation: ScreenObservation): string[] {
  return [
    ...observation.visibleTexts,
    ...observation.elements.flatMap((element) => [element.name, element.text ?? '']),
  ];
}

function isRuntimeStateCondition(condition: PlanCondition): boolean {
  return ['ui_state', 'auth_state', 'menu_state', 'route_state', 'attribute_state', 'storage_state'].includes(condition.type);
}

function runtimeConditionEvaluation(condition: PlanCondition, observation: ScreenObservation, before?: RuntimeStateSnapshot, after?: RuntimeStateSnapshot): { passed: boolean; expected: unknown; actual: unknown } {
  const currentValue = runtimeValue(condition, after ?? before);
  const beforeValue = runtimeValue(condition, before);
  const expected = 'expected' in condition ? condition.expected : condition;
  const actual = { before: beforeValue, after: currentValue };

  if (!('expected' in condition)) return { passed: true, expected, actual };
  if (condition.expected === 'changed') return { passed: JSON.stringify(beforeValue) !== JSON.stringify(currentValue), expected, actual };
  if (condition.expected === 'unchanged' || condition.expected === 'same') return { passed: JSON.stringify(beforeValue) === JSON.stringify(currentValue), expected, actual };
  if (condition.expected === 'exists') return { passed: currentValue !== undefined && currentValue !== null && currentValue !== false && currentValue !== '', expected, actual };
  if (condition.expected === 'not_exists') return { passed: currentValue === undefined || currentValue === null || currentValue === false || currentValue === '', expected, actual };
  if (condition.type === 'route_state' && condition.expected === 'matches') {
    return { passed: Boolean((condition.expectedUrl && observation.url.includes(condition.expectedUrl)) || (condition.expectedUrlPattern && new RegExp(condition.expectedUrlPattern).test(observation.url))), expected, actual };
  }
  return { passed: String(currentValue).toLowerCase().includes(String(condition.expected).toLowerCase()), expected, actual };
}

function runtimeValue(condition: PlanCondition, state?: RuntimeStateSnapshot): unknown {
  if (!state) return undefined;
  if (condition.type === 'ui_state') return state.semanticStates[condition.semanticKey] ?? state.semanticStates.visibleTextSignature;
  if (condition.type === 'auth_state') return state.semanticStates.auth;
  if (condition.type === 'menu_state') return state.semanticStates[condition.semanticKey] ?? state.semanticStates.menuOpen;
  if (condition.type === 'route_state') return state.url;
  if (condition.type === 'attribute_state') return state.attributes[`${JSON.stringify(condition.target)}::${condition.attribute}`];
  if (condition.type === 'storage_state') return state.storage[`${condition.storage}:${condition.key}`];
  return undefined;
}
