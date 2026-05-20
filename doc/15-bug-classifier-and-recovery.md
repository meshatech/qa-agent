# 15 — Bug Classifier + Recovery Policy

## Objetivo

Diferenciar **bug real** de **ruído**, e decidir quando recuperar vs registrar e seguir.

## Bug Classifier

### Entrada

```ts
export interface BugClassifierInput {
  signalType: BugSignalType;
  rawMessage: string;
  source?: string;                  // url do script ou endpoint
  status?: number;                  // se network
  consoleLevel?: 'log' | 'info' | 'warn' | 'error';
  url: string;                      // url atual
  context: {
    appDomains: string[];           // ver doc 17
    knownThirdPartyDomains?: string[];
    knownNoiseRegexes?: string[];
  };
}
```

### Saída

```ts
export interface BugClassification {
  isBug: boolean;
  severity: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  category: BugCategory;
  reason: string;
}

export type BugCategory =
  | 'APP_FAULT'
  | 'ASSERTION_FAULT'
  | 'NAVIGATION_FAULT'
  | 'THIRD_PARTY_NOISE'
  | 'TRACKING_NOISE'
  | 'DEPRECATION_WARNING'
  | 'BROWSER_EXTENSION_NOISE';
```

### Algoritmo

```ts
export function classify(input: BugClassifierInput): BugClassification {
  const { signalType, source, status, context, rawMessage } = input;

  // 1. Ruído conhecido por regex
  if (matchesAnyRegex(rawMessage, context.knownNoiseRegexes)) {
    return noise('DEPRECATION_WARNING', 'matched known noise regex');
  }

  // 2. Network
  if (signalType === 'APP_NETWORK_5XX' || signalType === 'APP_NETWORK_4XX_UNEXPECTED') {
    const isApp = isAppOrigin(source, context.appDomains);
    if (!isApp) {
      return noise('THIRD_PARTY_NOISE', `third-party endpoint ${source}`);
    }
    return bug('APP_FAULT', status && status >= 500 ? 'CRITICAL' : 'HIGH', `app ${status} on ${source}`);
  }

  // 3. Console exception
  if (signalType === 'APP_CONSOLE_EXCEPTION') {
    if (isFromBrowserExtension(source)) {
      return noise('BROWSER_EXTENSION_NOISE', 'extension origin');
    }
    if (!isAppOrigin(source, context.appDomains)) {
      return noise('THIRD_PARTY_NOISE', `script from ${source}`);
    }
    return bug('APP_FAULT', 'HIGH', `unhandled exception: ${rawMessage}`);
  }

  // 4. Assertion
  if (signalType === 'ASSERTION_FAILURE') {
    return bug('ASSERTION_FAULT', 'HIGH', rawMessage);
  }

  // 5. Tela quebrada
  if (signalType === 'LOADING_STUCK') return bug('APP_FAULT', 'HIGH', 'loading infinito');
  if (signalType === 'VISUAL_BROKEN') return bug('APP_FAULT', 'MEDIUM', 'layout quebrado');
  if (signalType === 'NAVIGATION_UNEXPECTED') return bug('NAVIGATION_FAULT', 'HIGH', 'rota inesperada');
  if (signalType === 'TIMEOUT') return bug('APP_FAULT', 'MEDIUM', 'timeout em ação crítica');

  // 6. Tracking
  if (signalType === 'TRACKING_ERROR') return noise('TRACKING_NOISE', 'analytics/pixel');

  return noise('THIRD_PARTY_NOISE', 'sinal não classificado');
}

function bug(category: BugCategory, severity: BugClassification['severity'], reason: string): BugClassification {
  return { isBug: true, category, severity, reason };
}

function noise(category: BugCategory, reason: string): BugClassification {
  return { isBug: false, category, severity: 'LOW', reason };
}
```

### Helpers

```ts
export function isAppOrigin(source: string | undefined, appDomains: string[]): boolean {
  if (!source) return false;
  try {
    const host = new URL(source).host;
    return appDomains.some((d) => host === d || host.endsWith(`.${d}`));
  } catch {
    return false;
  }
}

export function isFromBrowserExtension(source?: string): boolean {
  if (!source) return false;
  return /^(chrome-extension|moz-extension|webkit-extension):/.test(source);
}

const DEFAULT_NOISE_REGEXES = [
  /ResizeObserver loop limit exceeded/i,
  /Non-Error promise rejection captured/i,
  /favicon\.ico.*404/i,
  /google-analytics\.com/i,
  /googletagmanager\.com/i,
  /facebook\.net/i,
  /hotjar\.com/i,
  /sentry\.io/i,
];
```

## Severity Matrix

| Signal | App origin | Severity default |
|--------|-----------|------------------|
| Network 5xx | sim | CRITICAL |
| Network 4xx inesperado | sim | HIGH |
| Console exception | sim | HIGH |
| Assertion principal | — | HIGH |
| Loading stuck | — | HIGH |
| Navigation unexpected | — | HIGH |
| Timeout em ação crítica | — | MEDIUM |
| Visual broken | — | MEDIUM |
| Tracking failure | — | LOW (ruído) |
| Deprecation warning | — | LOW (ruído) |
| 404 favicon | — | LOW (ruído) |

---

## Recovery Policy

### Estrutura

```ts
export interface RecoveryPolicy {
  tryFallback(input: RecoveryInput): Promise<RecoveryResult>;
}

export interface RecoveryInput {
  task: QaTask;
  step: QaStep;
  observation: ScreenObservation;
  fallbackAction?: QaAction;
  budget: RecoveryBudget;
}

export interface RecoveryBudget {
  maxAttemptsPerTask: number;       // default 3
  maxFallbacksPerStep: number;      // default 1
  maxEmergencyActionsPerScenario: number; // default 5
}

export interface RecoveryResult {
  ok: boolean;
  exhausted: boolean;
  appliedAction?: QaAction;
  reason: string;
}
```

`step.boundExpectedAfterAction` é obrigatório quando a falha envolve validação pós-ação com `targetElementId`. Recovery nunca deve validar usando `el_*` antigo; deve usar o locator vinculado em `BoundExpectedAfterAction`.

### Decision tree

```txt
PASSO FALHOU
  ↓
attempts == maxAttemptsPerTask ?
  sim → RECOVERY_EXHAUSTED → BLOCKED + bug
  não → continua
  ↓
mesma falha 2x consecutiva ?
  sim → tentar caminho alternativo (ver abaixo)
  não → retry simples
  ↓
fallback_action existe ?
  sim → executar fallback (consome maxFallbacksPerStep)
  não → tentar press Escape (emergência)
  ↓
após fallback: validar de novo
  ok → continua run
  falhou → RECOVERY_EXHAUSTED
```

### Caminhos alternativos por sintoma

| Sintoma observado | Tentativa |
|-------------------|-----------|
| `hasModal && action falhou` | press Escape → reobserva → retry |
| `hasOverlay && click bloqueado` | clickOutside → retry |
| `isLoading prolongado` | waitForStable(5000) → retry |
| `LOCATOR_NOT_FOUND` após re-render | nova Observe → pedir LLM nova ação |
| `STALE_OBSERVATION` | nova Observe → reenviar |
| `hasValidationErrors após fill` | LLM nova ação com contexto erro |
| `NAVIGATION_UNEXPECTED` | abortScenario |

### Implementação

```ts
export class DefaultRecoveryPolicy implements RecoveryPolicy {
  async tryFallback(input: RecoveryInput): Promise<RecoveryResult> {
    const { task, step, observation, fallbackAction, budget } = input;

    if (task.attempts.length >= budget.maxAttemptsPerTask) {
      return { ok: false, exhausted: true, reason: 'maxAttemptsPerTask reached' };
    }

    // 1. fallback explícito da LLM
    if (fallbackAction) {
      const exec = await this.harness.executeAction(fallbackAction);
      await this.quiescence.waitForQuiescence();
      const newObs = await this.harness.observe();
      const validated = await this.harness.validate(step.boundExpectedAfterAction);
      if (validated.ok) {
        return { ok: true, exhausted: false, appliedAction: fallbackAction, reason: 'fallback recovered' };
      }
    }

    // 2. emergência por sintoma
    if (observation.pageState.hasModal || observation.pageState.hasOverlay) {
      const escape: QaAction = { type: 'press', key: 'Escape', reason: 'modal detected' };
      await this.harness.executeAction(escape);
      await this.quiescence.waitForQuiescence();
      const validated = await this.harness.validate(step.boundExpectedAfterAction);
      if (validated.ok) {
        return { ok: true, exhausted: false, appliedAction: escape, reason: 'escape recovered' };
      }
    }

    return { ok: false, exhausted: false, reason: 'no recovery succeeded' };
  }
}
```

### Logs obrigatórios

Toda tentativa de recovery vira `AttemptRecord` na task. Vai pro `execution-log.json` (doc 16).

### Estado pós-recovery

```txt
Sucesso  → step.status = VALIDATED, task continua
Falha    → próximo loop tenta outra ação ou marca BLOCKED
Exausto  → step.status = RECOVERY_ATTEMPTED + BUG_RECORDED, task BLOCKED
```
