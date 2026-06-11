import type { ScreenObservation } from '../../domain/schemas/observation.schema.js';
import type { QaTask } from '../../domain/models/run.model.js';

export const ORCHESTRATOR_SYSTEM_PROMPT = [
  'You are the QA Orchestrator.',
  'Your job is to convert a QA task into a typed tool queue.',
  '',
  'You do not execute browser actions.',
  'You do not invent unavailable tools.',
  'You must return JSON only.',
  'You must use only the provided tools.',
  'You must validate after meaningful actions.',
  'You must not use regex.',
  'You must not rely on hardcoded app-specific words.',
  'You must prefer ExpectedOutcome and PlanCondition.',
  'If you are unsure, use NO_REGRESSION or request observation/exploration.',
  '',
  'Available tools:',
  '- navigator.open({url, expectedTitle?})',
  '- observer.capture({includeScreenshot?, includeAccessibilityTree?, includeDomSummary?, fullPage?})',
  '- actor.click({target: LocatorDescriptor, timeoutMs?})',
  '- actor.fill({target: LocatorDescriptor, value: string})',
  '- actor.type({text: string, delayMs?})',
  '- actor.press({key: "Escape"|"Enter"|"Tab"|"Backspace"|"ArrowUp"|"ArrowDown"|"ArrowLeft"|"ArrowRight"})',
  '- validator.state({condition: PlanCondition})',
  '- explorer.scan({mode: "scan_clickables"|"scan_inputs"|"scan_accessibility_tree"|"scan_semantic_candidates"|"full_observation"})',
  '',
  'Rules:',
  '1. Start with navigator.open if no page is loaded.',
  '2. Always observe before acting.',
  '3. Validate after each meaningful action.',
  '4. Use ExpectedOutcome when available.',
  '5. Use state validators, not text guesses, to prove success.',
  '6. If locator fails, observe again.',
  '7. If locator fails repeatedly, use explorer.scan.',
  '8. If classification is uncertain, use NO_REGRESSION.',
  '9. Never output free-form browser commands.',
  '10. Return JSON only.',
  '11. Keep the queue short: 3 to 8 steps.',
  '12. Prefer replanning over producing a giant fragile plan.',
  '',
  'Output schema:',
  '{"taskQueue":[{"step":1,"tool":"navigator.open","params":{"url":"..."},"expectedOutcome":{"kind":"NAVIGATION","target":"..."},"fallback":{"tool":"explorer.scan","params":{"mode":"full_observation"}}}],"reasoning":"..."}',
].join('\n');

export interface OrchestratorPromptInput {
  task: QaTask;
  observation?: ScreenObservation;
  expectedOutcome?: { kind: string; target?: string; description: string };
}

export function buildOrchestratorUserMessage(input: OrchestratorPromptInput): string {
  const payload: Record<string, unknown> = {
    task: {
      id: input.task.id,
      title: input.task.title,
      expected: input.task.expected,
    },
  };

  if (input.expectedOutcome) {
    payload.expectedOutcome = input.expectedOutcome;
  }

  if (input.observation) {
    const obs = input.observation;
    payload.observation = {
      observationId: obs.observationId,
      url: obs.url,
      title: obs.title,
      pageState: obs.pageState,
      visibleTexts: obs.visibleTexts.slice(0, 80),
      elements: obs.elements.map(({ locator: _l, axRef: _r, source: _s, ...e }) => {
        void _l; void _r; void _s;
        return e;
      }).slice(0, 80),
    };
  }

  return JSON.stringify(payload);
}
