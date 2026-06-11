import type { ScreenObservation } from '../../domain/schemas/observation.schema.js';
import type { ExecutionStep } from '../../domain/schemas/execution-plan.schema.js';
import type { ToolQueue } from '../../domain/schemas/tool-queue.schema.js';

export const ORCHESTRATOR_REPLAN_SYSTEM_PROMPT = [
  'You are the QA Orchestrator Replan Service.',
  'Given a failed step and current page state, return a replan decision.',
  '',
  'You do not execute browser actions.',
  'You do not invent unavailable tools.',
  'You must return JSON only.',
  'You must use only the provided tools.',
  '',
  'Available replan actions:',
  '- replace_remaining_steps: provide fromStep (1-based) and a new taskQueue',
  '- abort: stop the scenario with a reason',
  '',
  'Available tools for replacement steps:',
  '- observer.capture({includeScreenshot?, includeAccessibilityTree?, includeDomSummary?, fullPage?})',
  '- actor.click({target: LocatorDescriptor, timeoutMs?})',
  '- actor.fill({target: LocatorDescriptor, value: string})',
  '- actor.type({text: string, delayMs?})',
  '- actor.press({key: "Escape"|"Enter"|"Tab"|"Backspace"|"ArrowUp"|"ArrowDown"|"ArrowLeft"|"ArrowRight"})',
  '- validator.state({condition: PlanCondition})',
  '- explorer.scan({mode: "scan_clickables"|"scan_inputs"|"scan_accessibility_tree"|"scan_semantic_candidates"|"full_observation"})',
  '',
  'Rules:',
  '1. Prefer minimal replacement: only replace steps that need to change.',
  '2. If locator failed, use explorer.scan to find alternatives before acting.',
  '3. If validation failed, observer.capture first, then choose new validator.',
  '4. Never return more than 5 replacement steps.',
  '5. Never alter steps that already succeeded.',
  '6. If no reliable path exists, use abort.',
  '7. Return JSON only.',
].join('\n');

export interface OrchestratorReplanPromptInput {
  taskTitle: string;
  taskExpected: string;
  lastObservation: ScreenObservation;
  executedSteps: Array<{ stepId: string; tool: string; ok: boolean }>;
  failedStep: ExecutionStep;
  errorMessage: string;
  originalQueue: ToolQueue;
}

export function buildOrchestratorReplanUserMessage(input: OrchestratorReplanPromptInput): string {
  return JSON.stringify({
    task: { title: input.taskTitle, expected: input.taskExpected },
    observation: {
      observationId: input.lastObservation.observationId,
      url: input.lastObservation.url,
      title: input.lastObservation.title,
      pageState: input.lastObservation.pageState,
      visibleTexts: input.lastObservation.visibleTexts.slice(0, 40),
      elements: input.lastObservation.elements.map(({ locator: _l, axRef: _r, source: _s, ...e }) => {
        void _l; void _r; void _s;
        return e;
      }).slice(0, 40),
    },
    executedSteps: input.executedSteps,
    failedStep: {
      id: input.failedStep.id,
      description: input.failedStep.description,
      action: input.failedStep.action,
    },
    error: input.errorMessage,
    originalQueue: input.originalQueue.taskQueue.map((item) => ({
      step: item.step,
      tool: item.tool,
      params: item.params,
    })),
  });
}
