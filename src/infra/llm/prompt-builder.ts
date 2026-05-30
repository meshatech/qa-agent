import type { ScreenObservation } from '../../domain/schemas/observation.schema.js';
import type { RunConfig } from '../../domain/schemas/config.schema.js';
import type { ReplanInput } from '../../application/ports/decision-provider.port.js';
import type { QaScenario } from '../../domain/models/run.model.js';

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
  'For logout/sign-out tasks, expected_after_action must prove a non-authenticated state after the click: URL clearly containing /login, /signin, or /auth; or visible login screen text/form. Never use no_console_errors for logout proof.',
  'For menu workflows, first click the menu trigger and expect a menu item/panel text to become visible; then use the next cycle to click the specific menu item.',
  'If the user asks to open a menu, theme, settings, or logout, expected_after_action must mention the resulting visible menu item/text or final state. Do not answer with no_console_errors.',
  'When no element id matches the target you need (e.g. icon-only buttons, avatars, images without text), use clickAtCoordinates with x,y from the element\'s bounds. Every element in the observation has bounds: {x, y, width, height}. Use the center point: x + width/2, y + height/2. Set risk to "HIGH".',
  'JSON shape:',
  '{"schemaVersion":"action.v1","observationId":"<same>","thought_summary":"short 1-2 sentences","action":{...},"expected_after_action":{...},"fallback_action":{"type":"press","key":"Escape","reason":"close popup"},"confidence":0.0..1.0}',
].join('\n');

export const CLASSIFY_OUTCOME_SYSTEM_PROMPT = [
  'You are Agent QA Outcome Classifier.',
  'Given a task title and expected result, translate it into the most specific ExpectedOutcome kind that describes the intended state change.',
  'Return ONLY JSON. No markdown.',
  'Single-task schema: {"kind":"AUTHENTICATION|DEAUTHENTICATION|NAVIGATION|APPEARANCE_CHANGE|DISCLOSURE|CONTENT_PRESENCE|DATA_ENTRY|NO_REGRESSION","target":"optional 1-3 word label likely to appear on the actual page button/link/field","description":"rationale in the same language as the input"}',
  'Batch schema when input contains tasks[]: {"outcomes":[{"kind":"AUTHENTICATION|DEAUTHENTICATION|NAVIGATION|APPEARANCE_CHANGE|DISCLOSURE|CONTENT_PRESENCE|DATA_ENTRY|NO_REGRESSION","target":"optional 1-3 word label likely to appear on the actual page button/link/field","description":"rationale in the same language as the input"}]}. Return exactly one outcome per input task, in the same order.',
  'Rules:',
  '- AUTHENTICATION   = prove user is logged in (any wording: login, sign in, enter credentials).',
  '- DEAUTHENTICATION = prove user is logged out (any wording: logout, sign out, end session, exit).',
  '- NAVIGATION       = navigate to a route/screen/section.',
  '- APPEARANCE_CHANGE= change visual theme, dark/light mode, color scheme.',
  '- DISCLOSURE       = open a menu, panel, accordion, dropdown, or settings.',
  '- CONTENT_PRESENCE = prove a specific content, text, or value is visible.',
  '- DATA_ENTRY       = fill, type, or input data into a form field.',
  '- NO_REGRESSION    = generic smoke check when none of the above apply or intent is unclear.',
  '- target MUST be a short label (1-3 words) that a real user would click or see on the page. Never return a full sentence or description as target.',
  '- For DISCLOSURE/DEAUTHENTICATION/APPEARANCE_CHANGE, include multiple likely labels separated by | (e.g. "Conta|Perfil|Avatar|Menu" or "Sair|Logout|Sign out"). The matcher will try all alternatives.',
  '- Apply the same rules to every item in batch mode. Do not degrade batch results to generic navigation or full-sentence targets.',
  '- If the expected state is logged out, anonymous, signed out, or back to a login/start screen after ending a session, classify as DEAUTHENTICATION, not NAVIGATION.',
  '- If the expected state is a changed visual mode, theme, appearance, color scheme, dark mode, or light mode, classify as APPEARANCE_CHANGE and return actionable alternatives separated by |.',
].join('\n');

export function buildClassifyOutcomeUserMessage(title: string, expected: string): string {
  return JSON.stringify({ task: { title, expected } });
}

export function buildClassifyOutcomesUserMessage(tasks: Array<{ id: string; title: string; expected: string }>): string {
  return JSON.stringify({ tasks });
}

export const PLAN_SYSTEM_PROMPT = [
  'You are Agent QA Planner.',
  'Return ONLY JSON. No markdown.',
  'Decompose the demand into 1..N scenarios with tasks. Tasks may declare dependsOn (array of task ids).',
  'Tasks must be small, atomic, and meaningful. Avoid vague tasks like "click button", "advance", "interact", or generic safety checks.',
  'Keep plans compact: prefer 3..6 high-signal tasks for authenticated smoke tests.',
  'Do not duplicate equivalent tasks. Put logout/sign-out as the final task when requested.',
  'If authPrecondition.alreadyHandled is true, DO NOT create login/email/password/submit-login tasks. Start from the authenticated area.',
  'Schema:',
  '{"scenarios":[{"id":"scenario-001","title":"...","intent":"POSITIVE|NEGATIVE|EDGE","tasks":[{"id":"T001","title":"...","expected":"...","intent":"POSITIVE|NEGATIVE|EDGE","dependsOn":["T0..."],"expectedOutcome":{"kind":"AUTHENTICATION|DEAUTHENTICATION|NAVIGATION|APPEARANCE_CHANGE|DISCLOSURE|CONTENT_PRESENCE|DATA_ENTRY|NO_REGRESSION","target":"optional semantic key or route","description":"rationale"}}]}]}',
].join('\n');

export const EXECUTION_PLAN_SYSTEM_PROMPT = [
  'You are Agent QA ExecutionPlan Planner.',
  'Return ONLY JSON conforming to ExecutionPlanSchema. No markdown.',
  'Small-model mode: prefer copying the provided executionPlanTemplate shape over inventing your own structure.',
  'MOST IMPORTANT CATALOG RULE: every step object MUST contain both "scenarioId" and "taskId". Copy them exactly from scenarioCatalog/executionPlanTemplate. Do not omit them even when the step id already contains the task id.',
  'Never return targetElementId or el_* ids. Plans must use LocatorDescriptor only.',
  'Never return CSS selectors. Allowed locator strategies are role, text, label, placeholder, testid, document, text_any, semantic.',
  'Locator strategy must be one of exactly: "role", "text", "label", "placeholder", "testid", "document", "text_any", "semantic". Values like "button", "menuitem", "link", "input", "css", "xpath" are INVALID as strategy.',
  'For buttons/menuitems/links use {"strategy":"role","role":"button|menuitem|link","name":"..."}; do not use {"strategy":"button"} or {"strategy":"menuitem"}.',
  'Stable runtime also accepts text_any and semantic locators. semantic locators MUST include candidates.',
  'Every step MUST include id, description, action.reason, postconditions array, assertions array, and onFailure.',
  'When scenarioCatalog exists, every step MUST include scenarioId and taskId copied exactly from one scenarioCatalog task.',
  'If one task needs multiple deterministic substeps, repeat the same scenarioId/taskId on those substeps.',
  'Do not use generic step ids like S001/S002 when scenarioCatalog exists. Use ids derived from the task id, e.g. T003-theme or T004-logout-click.',
  'Action locator field name MUST be "target". Never use action.locator. Never put postcondition inside action.',
  'Postconditions MUST be an array named "postconditions". Never use singular "postcondition".',
  'Use condition fields exactly: text_visible uses {"type":"text_visible","text":"..."}, text_any_visible uses {"type":"text_any_visible","texts":["..."]}, ui_state uses {"type":"ui_state","semanticKey":"appearance_mode","expected":"changed","source":"dom"}, auth_state uses {"type":"auth_state","expected":"anonymous"}.',
  'For mutable labels, use semantic or text_any instead of hardcoded single text.',
  'For state changes, prefer PlanCondition runtime-state types ui_state, attribute_state, storage_state, route_state, auth_state, or menu_state.',
  'Every step needs strong postconditions. no_console_errors cannot complete functional tasks.',
  'Causality rule: postconditions must be caused by the action in the same step.',
  'Passive actions waitForStable and assertVisible can only validate existing state. They MUST NOT use expected "changed" in ui_state, attribute_state, storage_state, menu_state, auth_state, or route_state.',
  'Only click/fill/select/press/navigate actions may expect a changed runtime state, and only when the action plausibly causes that change.',
  'If scenarioCatalog is provided, build the ExecutionPlan from those scenario/task ids exactly. Preserve scenarioId/taskId on every step.',
  'Do not invent extra functional steps beyond scenarioCatalog unless a task requires a deterministic substep, such as opening a menu before clicking an item.',
  'For each task, create one or more concrete steps whose postconditions prove that task expected result.',
  'Use HYBRID_GUARDED mode and version 1.',
  'If authPrecondition.alreadyHandled is true, NEVER include login page, email, password, submit-login, sign-in, or credential-fill steps. Start by validating the authenticated UI.',
  'Never invent placeholder UI strings such as "Authenticated area", "New theme", "login form", "login button", "logout button", or "change theme". Use visible app text from the demand, semantic locators with candidates, or runtime state conditions.',
  'Never use abstract acceptance phrases as visible UI text. Examples of abstract phrases: "Área autenticada", "Authenticated area", "Tema visual alterna", "Logout retorna". These describe the expected business result; they are not necessarily visible labels.',
  'For authenticated-area validation, prefer concrete UI labels such as inbox/menu/settings labels, e.g. text_any_visible ["Caixa de entrada","Inbox","Configurações","Settings"], not "Área autenticada".',
  'For appearance/theme changes, the postcondition must prove a state change using ui_state/attribute_state/storage_state with expected "changed".',
  'Do not confuse state semantic keys with action semantic keys. "appearance_mode" is only for ui_state. For a clickable theme/appearance action, use action.target.semanticKey "appearance_toggle".',
  'For appearance/theme action target, use candidates like text_any ["Tema escuro","Tema claro","Dark theme","Light theme","Escuro","Claro"]. Do not use inbox/settings labels as theme-toggle candidates.',
  'For logout/sign-out clicks, the postcondition must prove auth_state anonymous, a route_state matching /login, or login-screen text. Merely seeing "Sair" is only proof that the menu opened, not proof of logout.',
  'For logout in authenticated web apps, ALWAYS create two steps unless scenarioCatalog explicitly says logout is already visible: (1) open account/menu trigger and prove Sair/Logout visible, (2) click Sair/Logout menu item and prove auth_state anonymous or route_state /login.',
  'Do not create a single logout step with {"strategy":"role","role":"button","name":"Sair"} and empty preconditions. That is invalid because Sair is usually hidden inside a menu.',
  'For logout/menu actions, target MUST use strategy "semantic" with candidates. Never use strategy "role" with a single hardcoded name for logout or menu items.',
  'For the first logout preparation step, do not put "logout", "Sair", or "sign out" in the step id/description/reason. Name it as account menu opening, e.g. id "T004-account-menu", description "Open account menu", reason "open account menu". Reserve logout/sign-out words for the final click step only.',
  'Allowed actions: click, fill, select, press, clickOutside, clickAtCoordinates, waitForStable, navigate, assertVisible, abortScenario.',
  'Use placeholders {{uniqueName:key:prefix}}, {{uniqueEmail:key}} only in action values and {{ref:key}} in postconditions/assertions.',
  'Before returning JSON, silently check: no el_*, no CSS, every step has scenarioId/taskId, no passive step expects changed, logout proves anonymous/login, theme proves changed.',
  'Step shape example with required catalog ids: {"id":"T002-menu","scenarioId":"scenario-001","taskId":"T002","description":"Open account menu","preconditions":[],"action":{"type":"click","target":{"strategy":"semantic","semanticKey":"menu_trigger","intent":"open account menu","candidates":[{"strategy":"role","role":"button","name":"Conta e opções"},{"strategy":"text_any","texts":["Conta","Account","Menu"]}]},"reason":"open account menu"},"postconditions":[{"type":"menu_state","expected":"open"}],"assertions":[],"onFailure":"RECOVER"}',
  'Full schema shape: {"schemaVersion":"execution-plan.v1","planId":"...","version":1,"goal":"...","mode":"HYBRID_GUARDED","runtime":{"maxAttemptsPerStep":2,"maxReplansPerScenario":2,"destructiveActionPolicy":"BLOCK"},"steps":[...],"assertions":[]}',
].join('\n');

export const REPLAN_SYSTEM_PROMPT = [
  'You are Agent QA safe replanner.',
  'Return ONLY JSON conforming to PlanPatchSchema. No markdown.',
  'Never return targetElementId or el_* ids. Use LocatorDescriptor only.',
  'Never return CSS selectors.',
  'If replacing a locator for a mutable label, use semantic with candidates or text_any.',
  'Patch basePlanId and basePlanVersion must match the provided current plan.',
  'Do not remove critical assertions, do not remove primary postconditions, and do not weaken a functional task to CONTINUE_WITH_WARNING.',
  'Prefer minimal patches: replace current step or insert one recovery step before retrying.',
  'Operations: insert_after, replace_step, replace_remaining_steps, mark_blocked.',
].join('\n');

export function buildDecisionUserMessage(observation: ScreenObservation, runData: Record<string, string>, config: RunConfig): string {
  const reduced = {
    observationId: observation.observationId,
    url: observation.url,
    title: observation.title,
    pageState: observation.pageState,
    visibleTexts: observation.visibleTexts,
    elements: observation.elements.map(({ locator: _l, axRef: _r, source: _s, ariaLabel, title, alt, className, ...e }) => {
      void _l;
      void _r;
      void _s;
      return {
        ...e,
        extra: { ariaLabel, title, alt, className },
      };
    }),
    recentConsoleErrors: observation.consoleSignals.filter((c) => c.level === 'error').slice(-5),
    recentNetworkFailures: observation.networkSignals.filter((n) => n.failure || (n.status >= 400)).slice(-5),
  };
  return JSON.stringify({ task: config.demand, authPrecondition: authPrecondition(config), observation: reduced, runData });
}

export function buildPlanUserMessage(config: RunConfig): string {
  return JSON.stringify({ demand: config.demand, allowedRoutes: config.allowedRoutes, authPrecondition: authPrecondition(config) });
}

export function buildExecutionPlanUserMessage(config: RunConfig, scenarios: QaScenario[] = []): string {
  return JSON.stringify({
    demand: config.demand,
    allowedRoutes: config.allowedRoutes,
    authPrecondition: authPrecondition(config),
    runtime: config.runtime,
    scenarioCatalog: scenarios.map((scenario) => ({
      id: scenario.id,
      title: scenario.title,
      intent: scenario.intent,
      tasks: scenario.tasks.map((task) => ({
        id: task.id,
        title: task.title,
        expected: task.expected,
        dependsOn: task.dependsOn,
        intent: task.intent,
        expectedOutcome: task.expectedOutcome,
      })),
    })),
    executionPlanTemplate: scenarios.flatMap((scenario) => scenario.tasks.map((task) => taskTemplateHint(scenario.id, task))),
    requiredCatalogMapping: scenarios.flatMap((scenario) => scenario.tasks.map((task) => ({
      copyIntoEveryRelatedStep: { scenarioId: scenario.id, taskId: task.id },
      validStepIdPrefixes: [task.id],
      invalidIfMissing: ['scenarioId', 'taskId'],
    }))),
    rejectionRules: [
      'REJECTED if any step omits scenarioId.',
      'REJECTED if any step omits taskId.',
      'REJECTED if any step uses scenarioId/taskId not present in scenarioCatalog.',
      'REJECTED if waitForStable/assertVisible expects any runtime state changed.',
      'REJECTED if logout does not prove auth_state anonymous or route_state /login.',
      'REJECTED if any AUTHENTICATION task uses text_visible or text_any_visible as postcondition; must use auth_state expected authenticated.',
      'REJECTED if any postcondition copies the task title or acceptance criterion verbatim into text_visible/text_any_visible.',
    ],
    providerAgnosticRules: [
      'Every generated step must map to an existing scenarioCatalog taskId unless it is a deterministic substep for that same task.',
      'Copy scenarioId/taskId from executionPlanTemplate into every step.',
      'When a task is about authenticated state and authPrecondition.alreadyHandled is true, use waitForStable plus authenticated UI postconditions; do not create login steps.',
      'Do not copy abstract taskExpected text into text_visible/text_any_visible unless it is clearly an exact UI label.',
      'Do not attach expected "changed" to waitForStable or assertVisible.',
      'When a task is about a menu/account/settings panel, click the menu trigger and prove menu item visibility.',
      'When a task is about appearance/theme, use semantic locator candidates and prove ui_state/attribute_state/storage_state changed.',
      'When a task is about logout, open the menu if needed, click the logout action, and prove auth_state anonymous or route_state matches /login.',
    ],
  });
}

function taskTemplateHint(scenarioId: string, task: QaScenario['tasks'][number]): Record<string, unknown> {
  const kind = task.expectedOutcome?.kind;
  const base = {
    scenarioId,
    taskId: task.id,
    taskTitle: task.title,
    taskExpected: task.expected,
    expectedOutcomeKind: kind ?? 'NO_REGRESSION',
    required: ['copy scenarioId exactly', 'copy taskId exactly', 'include preconditions array', 'include postconditions array', 'include assertions array', 'include onFailure'],
  };
  switch (kind) {
    case 'DEAUTHENTICATION':
      return {
        ...base,
        recommendedShape: 'MUST use two steps by default: first open account/menu trigger and prove logout item visible; second click logout menu item and prove auth_state anonymous or route_state matches /login',
        recommendedSteps: [{
          idSuffix: 'account-menu',
          description: 'Open account menu',
          action: { type: 'click', target: { strategy: 'semantic', semanticKey: 'menu_trigger', intent: 'open account menu', candidates: [{ strategy: 'text_any', texts: [task.title] }] }, reason: 'open account menu' },
          postconditions: [{ type: 'menu_state', expected: 'open' }],
        }, {
          idSuffix: 'logout-click',
          preconditions: [{ type: 'menu_state', expected: 'open' }],
          action: {
            type: 'click',
            target: {
              strategy: 'semantic',
              semanticKey: 'logout_action',
              intent: 'sign out from the application',
              candidates: [{ strategy: 'text_any', texts: [task.title] }],
            },
            reason: 'click logout menu item',
          },
          postconditions: [{ type: 'auth_state', expected: 'anonymous' }],
        }],
        forbidden: ['do not finish logout by only seeing menu item text', 'do not use no_console_errors as logout proof', 'do not use a single logout click step with empty preconditions'],
      };
    case 'APPEARANCE_CHANGE':
      return {
        ...base,
        recommendedShape: 'click appearance/theme semantic locator with candidates, then postcondition ui_state appearance_mode expected changed',
        recommendedAction: {
          type: 'click',
          target: {
            strategy: 'semantic',
            semanticKey: 'appearance_toggle',
            intent: 'toggle application appearance mode',
            candidates: [{ strategy: 'text_any', texts: [task.title] }],
          },
          reason: 'toggle application appearance mode',
        },
        forbidden: ['do not use waitForStable as the action for a changed appearance state', 'do not expect changed without a click/select/press action'],
      };
    case 'DISCLOSURE':
      return {
        ...base,
        recommendedShape: 'click menu/account/settings trigger, then postcondition menu_state open',
        forbidden: ['do not use no_console_errors as menu proof'],
      };
    case 'AUTHENTICATION':
      return {
        ...base,
        recommendedShape: 'if authPrecondition.alreadyHandled is true, waitForStable and prove authenticated UI with auth_state expected authenticated ONLY; never use text_visible or text_any_visible',
        recommendedPostconditions: [{ type: 'auth_state', expected: 'authenticated' }],
        forbidden: ['do not create login/email/password/submit steps when auth is already handled', 'do not expect changed after waitForStable', 'do not use text_visible or text_any_visible for authentication tasks', 'do not use abstract phrases like "Área autenticada" or "Authenticated area" as visible text'],
      };
    default:
      return {
        ...base,
        recommendedShape: 'perform one concrete action and prove its result with a postcondition caused by that action',
        forbidden: ['do not use no_console_errors as the only proof for a functional task'],
      };
  }
}

export function buildReplanUserMessage(input: ReplanInput): string {
  const obs = input.observation;
  return JSON.stringify({
    reason: input.reason,
    message: input.message,
    currentPlan: input.plan,
    failedStep: input.failedStep,
    observation: {
      observationId: obs.observationId,
      url: obs.url,
      title: obs.title,
      pageState: obs.pageState,
      visibleTexts: obs.visibleTexts.slice(0, 80),
      elements: obs.elements.map(({ locator: _l, axRef: _r, source: _s, ...e }) => {
        void _l; void _r; void _s;
        return e;
      }).slice(0, 80),
    },
    history: input.history,
    runData: input.runData,
  });
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
