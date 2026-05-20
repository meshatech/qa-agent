# 08 — Status e erros runtime

## QaStepStatus (atualizado)

```ts
export type QaStepStatus =
  | 'OBSERVED'
  | 'ACTION_SELECTED'
  | 'STALE_ACTION_REJECTED'
  | 'DYNAMIC_DATA_RESOLVED'
  | 'ACTION_EXECUTED'
  | 'QUIESCENCE_WAITED'
  | 'REOBSERVED'
  | 'VALIDATED'
  | 'RECOVERY_ATTEMPTED'
  | 'BUG_RECORDED';
```

## QaTaskStatus

```ts
export type QaTaskStatus =
  | 'PENDING'
  | 'OBSERVING'
  | 'DECIDING'
  | 'RUNNING'
  | 'VALIDATING'
  | 'PASSED'
  | 'FAILED'
  | 'BLOCKED'
  | 'SKIPPED';
```

## QaScenarioStatus

```ts
export type QaScenarioStatus =
  | 'PLANNED'
  | 'RUNNING'
  | 'PASSED'
  | 'FAILED'
  | 'PARTIAL'
  | 'BLOCKED';
```

## QaRuntimeErrorCode

```ts
export type QaRuntimeErrorCode =
  | 'STALE_OBSERVATION'
  | 'LOCATOR_NOT_FOUND'
  | 'QUIESCENCE_TIMEOUT'
  | 'DYNAMIC_DATA_KEY_NOT_FOUND'
  | 'ACTION_SCHEMA_INVALID'
  | 'UNSUPPORTED_ACTION_SCHEMA_VERSION'
  | 'CONCURRENT_ACTION_DENIED'
  | 'NAVIGATION_BLOCKED'
  | 'ASSERTION_FAILED'
  | 'RECOVERY_EXHAUSTED';
```

## Mapa erro → ação

| Código | Recuperável | Ação default |
|--------|-------------|--------------|
| `STALE_OBSERVATION` | Sim | Forçar nova Observe, pedir nova ação à LLM |
| `LOCATOR_NOT_FOUND` | Sim | Reobservar; se persistir, marcar `BLOCKED` |
| `QUIESCENCE_TIMEOUT` | Warning | Continuar com `stable=false` flag |
| `DYNAMIC_DATA_KEY_NOT_FOUND` | Não | Erro de programação. Aborta cenário |
| `ACTION_SCHEMA_INVALID` | Sim | Retry LLM com mensagem de schema |
| `UNSUPPORTED_ACTION_SCHEMA_VERSION` | Não | Abortar cenário. Versão de contrato incompatível |
| `CONCURRENT_ACTION_DENIED` | Sim | Aguardar ação em andamento terminar; se persistir, erro fatal do Harness |
| `NAVIGATION_BLOCKED` | Sim | Pedir nova ação à LLM dentro de `allowedRoutes` |
| `ASSERTION_FAILED` | Sim | Tentar `fallback_action` |
| `RECOVERY_EXHAUSTED` | Não | `FAILED` + evidência completa |

## Transições típicas

### Caso feliz

```txt
PENDING → OBSERVING → DECIDING → RUNNING → VALIDATING → PASSED
```

### Falha recuperada

```txt
PENDING → OBSERVING → DECIDING → RUNNING → VALIDATING
       → RECOVERY_ATTEMPTED → RUNNING → VALIDATING → PASSED
```

### Bloqueio

```txt
PENDING → ... → VALIDATING → RECOVERY_ATTEMPTED (x N)
       → RECOVERY_EXHAUSTED → BLOCKED + BUG_RECORDED
```

## Severidade do bug

| Severity | Critério |
|----------|----------|
| `CRITICAL` | App quebra. Crash JS. 5xx no endpoint próprio. Loop fatal |
| `HIGH` | Asserção principal falha. Fluxo principal bloqueado |
| `MEDIUM` | Asserção secundária falha. Fluxo alternativo afetado |
| `LOW` | Warning, layout pequeno, ruído com impacto reduzido |

## Filtro de ruído

```txt
Bug real:
- assertion principal falhou
- endpoint próprio retornou 500
- exceção JS não tratada da aplicação
- tela travou / loading infinito
- redirect para rota errada
- elemento crítico ausente

Ruído:
- analytics/pixel falhou
- warning de depreciação
- erro de extensão do navegador
- 404 de favicon
- erro de fonte externa
```

## Tipo de sinal

```ts
export type BugSignalType =
  | 'ASSERTION_FAILURE'
  | 'APP_CONSOLE_EXCEPTION'
  | 'APP_NETWORK_5XX'
  | 'APP_NETWORK_4XX_UNEXPECTED'
  | 'THIRD_PARTY_NETWORK_FAILURE'
  | 'DEPRECATION_WARNING'
  | 'TRACKING_ERROR'
  | 'TIMEOUT'
  | 'LOADING_STUCK'
  | 'VISUAL_BROKEN'
  | 'NAVIGATION_UNEXPECTED';
```
