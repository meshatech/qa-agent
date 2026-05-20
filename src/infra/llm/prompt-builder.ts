import type { ScreenObservation } from '../../domain/schemas/observation.schema.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';

export const DECISION_SYSTEM_PROMPT = [
  'You are Agent QA, a reactive QA agent.',
  'Return ONLY valid JSON conforming to QaActionEnvelope. No markdown, no commentary.',
  'Choose exactly one safe action using a targetElementId from the provided observation.elements.',
  'targetElementId MUST be copied exactly from observation.elements.id, e.g. "el_001". Never return "1", "001", CSS selectors, labels, or element names as targetElementId.',
  'Every action object, including fallback_action, MUST include a non-empty reason string.',
  'Never invent CSS selectors. Never write Playwright code. Never reference element ids from past observations.',
  'observationId in your response MUST equal the observationId provided.',
  'For dynamic data use placeholders: {{uniqueName:key:prefix}}, {{uniqueEmail:key}}, {{ref:key}}.',
  'Use generators only inside action values. In expected_after_action, always use {{ref:key}} to validate the same generated value used by the action.',
  'Always include a fallback_action (e.g. press Escape or clickOutside) for flutuating UI states.',
  'When task is impossible, action.type = "abortScenario" with reason >= 10 chars.',
  'If auth is already handled and the current screen is authenticated, do not try to login again. Validate or navigate from the current authenticated screen.',
  'Allowed action types: click, fill, select, press, clickOutside, clickAtCoordinates, waitForStable, navigate, assertVisible, assertText, abortScenario.',
  'Allowed expected_after_action types: field_value_contains, element_visible, text_visible, url_contains, no_console_errors.',
  'Weak validation is invalid: after clicking an element, do not set expected_after_action to element_visible for the same target. Prove the actual state change instead.',
  'no_console_errors is not enough to complete functional tasks like logout, theme change, navigation, create/edit/delete, or opening menus. Use it only for tasks explicitly about console/errors.',
  'For logout/sign-out tasks, expected_after_action must prove a non-authenticated state after the click: URL clearly containing /login, /signin, or /auth; or visible login screen text/form such as "Entrar", "Login", "E-mail", "Senha", or "Acessar". Never use no_console_errors for logout proof.',
  'For menu workflows, first click the menu trigger and expect a menu item/panel text to become visible; then use the next cycle to click the specific menu item.',
  'JSON shape:',
  '{"schemaVersion":"action.v1","observationId":"<same>","thought_summary":"short 1-2 sentences","action":{...},"expected_after_action":{...},"fallback_action":{"type":"press","key":"Escape","reason":"close popup"},"confidence":0.0..1.0}',
].join('\n');

export const PLAN_SYSTEM_PROMPT = [
  'You are Agent QA Planner.',
  'Return ONLY JSON. No markdown.',
  'Decompose the demand into 1..N scenarios with tasks. Tasks may declare dependsOn (array of task ids).',
  'Tasks must be small and atomic (navigate, fill one field, click, assert).',
  'If authPrecondition.alreadyHandled is true, DO NOT create login/email/password/submit-login tasks. Start from the authenticated area.',
  'Schema:',
  '{"scenarios":[{"id":"scenario-001","title":"...","intent":"POSITIVE|NEGATIVE|EDGE","tasks":[{"id":"T001","title":"...","expected":"...","intent":"POSITIVE|NEGATIVE|EDGE","dependsOn":["T0..."]}]}]}',
].join('\n');

export function buildDecisionUserMessage(observation: ScreenObservation, runData: Record<string, string>, config: RunConfig): string {
  const reduced = {
    observationId: observation.observationId,
    url: observation.url,
    title: observation.title,
    pageState: observation.pageState,
    visibleTexts: observation.visibleTexts,
    elements: observation.elements.map(({ locator: _l, axRef: _r, source: _s, ...e }) => {
      void _l;
      void _r;
      void _s;
      return e;
    }),
    recentConsoleErrors: observation.consoleSignals.filter((c) => c.level === 'error').slice(-5),
    recentNetworkFailures: observation.networkSignals.filter((n) => n.failure || (n.status >= 400)).slice(-5),
  };
  return JSON.stringify({ task: config.demand, authPrecondition: authPrecondition(config), observation: reduced, runData });
}

export function buildPlanUserMessage(config: RunConfig): string {
  return JSON.stringify({ demand: config.demand, allowedRoutes: config.allowedRoutes, authPrecondition: authPrecondition(config) });
}

function authPrecondition(config: RunConfig): { alreadyHandled: boolean; kind: RunConfig['auth']['kind']; instruction: string } {
  const alreadyHandled = config.auth.kind !== 'none';
  return {
    alreadyHandled,
    kind: config.auth.kind,
    instruction: alreadyHandled
      ? 'The runtime performs authentication before scenarios start. Do not test login fields unless they are still visible after auth; continue from the authenticated application.'
      : 'No auth precondition is configured.',
  };
}
