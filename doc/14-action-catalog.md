# 14 — Action Catalog (schemas Zod completos)

## Discriminated union `QaAction`

```ts
export type QaAction =
  | ClickAction
  | FillAction
  | SelectAction
  | PressAction
  | ClickOutsideAction
  | ClickAtCoordinatesAction
  | WaitForStableAction
  | NavigateAction
  | AssertVisibleAction
  | AssertTextAction
  | AbortScenarioAction;
```

Discriminator: `type`.

## ClickAction

```ts
export const ClickActionSchema = z.object({
  type: z.literal('click'),
  targetElementId: z.string().regex(/^el_\d+$/),
  reason: z.string().min(1),
});
```

## FillAction

```ts
export const FillActionSchema = z.object({
  type: z.literal('fill'),
  targetElementId: z.string().regex(/^el_\d+$/),
  value: z.string(),                            // pode conter {{...}}
  reason: z.string().min(1),
});
```

## SelectAction

```ts
export const SelectActionSchema = z.object({
  type: z.literal('select'),
  targetElementId: z.string().regex(/^el_\d+$/),
  option: z.union([
    z.object({ label: z.string() }),
    z.object({ value: z.string() }),
    z.object({ index: z.number().int().nonnegative() }),
  ]),
  reason: z.string().min(1),
});
```

## PressAction

```ts
export const PressActionSchema = z.object({
  type: z.literal('press'),
  key: z.enum(['Escape', 'Enter', 'Tab', 'Backspace', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight']),
  targetElementId: z.string().regex(/^el_\d+$/).optional(),
  reason: z.string().min(1),
});
```

Sem `targetElementId` → key vai pro foco atual.

## ClickOutsideAction

```ts
export const ClickOutsideActionSchema = z.object({
  type: z.literal('clickOutside'),
  reason: z.string().min(1),
});
```

## ClickAtCoordinatesAction (restrito)

```ts
export const ClickAtCoordinatesActionSchema = z.object({
  type: z.literal('clickAtCoordinates'),
  x: z.number().int().nonnegative(),
  y: z.number().int().nonnegative(),
  reason: z.string().min(10),                   // exige justificativa longa
  risk: z.literal('HIGH'),
});
```

Política: só permitido após 3 ações semânticas falharem. Harness bloqueia caso contrário.

## WaitForStableAction

```ts
export const WaitForStableActionSchema = z.object({
  type: z.literal('waitForStable'),
  timeoutMs: z.number().int().positive().max(10000).optional(),
  reason: z.string().min(1),
});
```

Equivale a forçar `QuiescenceGuard.waitForQuiescence()`.

## NavigateAction

```ts
export const NavigateActionSchema = z.object({
  type: z.literal('navigate'),
  to: z.string(),                               // path relativo (ex: "/produtos/novo")
  reason: z.string().min(1),
});
```

Restrição: `to` deve estar dentro de `RunConfig.allowedRoutes` se configurado.

## AssertVisibleAction

```ts
export const AssertVisibleActionSchema = z.object({
  type: z.literal('assertVisible'),
  targetElementId: z.string().regex(/^el_\d+$/).optional(),
  text: z.string().optional(),
  reason: z.string().min(1),
}).refine(
  (a) => a.targetElementId !== undefined || a.text !== undefined,
  { message: 'assertVisible requires targetElementId or text' },
);
```

## AssertTextAction

```ts
export const AssertTextActionSchema = z.object({
  type: z.literal('assertText'),
  targetElementId: z.string().regex(/^el_\d+$/),
  expected: z.string(),                         // pode conter {{ref:...}}
  match: z.enum(['equals', 'contains', 'regex']).default('contains'),
  reason: z.string().min(1),
});
```

## AbortScenarioAction

```ts
export const AbortScenarioActionSchema = z.object({
  type: z.literal('abortScenario'),
  reason: z.string().min(10),
});
```

Marca cenário como `BLOCKED`. LLM usa quando task se torna impossível.

## QaAction (union schema)

```ts
export const QaActionSchema = z.discriminatedUnion('type', [
  ClickActionSchema,
  FillActionSchema,
  SelectActionSchema,
  PressActionSchema,
  ClickOutsideActionSchema,
  ClickAtCoordinatesActionSchema,
  WaitForStableActionSchema,
  NavigateActionSchema,
  AssertVisibleActionSchema,
  AssertTextActionSchema,
  AbortScenarioActionSchema,
]);

export type QaAction = z.infer<typeof QaActionSchema>;
```

## ExpectedAfterAction

```ts
export const ExpectedAfterActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('field_value_contains'),
    targetElementId: z.string().regex(/^el_\d+$/),
    value: z.string(),
  }),
  z.object({
    type: z.literal('element_visible'),
    targetElementId: z.string().regex(/^el_\d+$/).optional(),
    text: z.string().optional(),
  }).refine(
    (a) => a.targetElementId !== undefined || a.text !== undefined,
    { message: 'element_visible requires targetElementId or text' },
  ),
  z.object({
    type: z.literal('text_visible'),
    text: z.string(),
  }),
  z.object({
    type: z.literal('url_contains'),
    value: z.string(),
  }),
  z.object({
    type: z.literal('no_console_errors'),
  }),
]);

export type ExpectedAfterAction = z.infer<typeof ExpectedAfterActionSchema>;
```

## BoundExpectedAfterAction (interno)

`ExpectedAfterAction` é o contrato da LLM. Antes da ação executar, o Harness converte qualquer `targetElementId` em um alvo vinculado por locator semântico:

```ts
export const BoundValidationTargetSchema = z.object({
  originalElementId: z.string().regex(/^el_\d+$/),
  observationId: z.string(),
  locator: LocatorDescriptorSchema,
  humanName: z.string().optional(),
});

export const BoundExpectedAfterActionSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('field_value_contains'),
    target: BoundValidationTargetSchema,
    value: z.string(),
  }),
  z.object({
    type: z.literal('element_visible'),
    target: BoundValidationTargetSchema.optional(),
    text: z.string().optional(),
  }).refine(
    (a) => a.target !== undefined || a.text !== undefined,
    { message: 'element_visible requires target or text' },
  ),
  z.object({
    type: z.literal('text_visible'),
    text: z.string(),
  }),
  z.object({
    type: z.literal('url_contains'),
    value: z.string(),
  }),
  z.object({
    type: z.literal('no_console_errors'),
  }),
]);

export type BoundExpectedAfterAction = z.infer<typeof BoundExpectedAfterActionSchema>;
```

Regra: `el_*` nunca é reutilizado após reobservação. Validação pós-ação usa `BoundExpectedAfterAction.target.locator`.

## QaActionEnvelope

```ts
export const QaActionEnvelopeSchema = z.object({
  schemaVersion: z.string().default('action.v1'),
  observationId: z.string(),
  thought_summary: z.string().min(1).max(500),
  action: QaActionSchema,
  expected_after_action: ExpectedAfterActionSchema,
  fallback_action: QaActionSchema,
  confidence: z.number().min(0).max(1),
});

export type QaActionEnvelope = z.infer<typeof QaActionEnvelopeSchema>;
```

## ActionExecutionResult

```ts
export interface ActionExecutionResult {
  ok: boolean;
  actionType: string;
  durationMs: number;
  quiescence?: QuiescenceResult;
  error?: QaRuntimeError;
}
```

## AssertionResult

```ts
export interface AssertionResult {
  ok: boolean;
  type: string;                                 // tipo do expected
  expected: string;
  actual?: string;
  durationMs: number;
}
```

## Erros adicionais do catálogo

```ts
export type ActionCatalogErrorCode =
  | 'CONCURRENT_ACTION_DENIED'
  | 'NAVIGATION_BLOCKED'
  | 'UNSUPPORTED_ACTION_SCHEMA_VERSION';
```

## Idempotência / single-flight

```txt
- Apenas uma ação executa por vez no Harness
- Action chamadas em paralelo são rejeitadas com CONCURRENT_ACTION_DENIED
- Após executeAction, próxima ação só após quiescência completar
```

```ts
class ActionHarness {
  private inFlight = false;

  async execute(action: QaAction): Promise<ActionExecutionResult> {
    if (this.inFlight) {
      throw new ConcurrentActionDeniedError();
    }
    this.inFlight = true;
    try {
      return await this.executeInternal(action);
    } finally {
      this.inFlight = false;
    }
  }
}
```

## Resolução de placeholders

Antes de qualquer execução, `ActionHarness` chama `dataHarness.resolveObject(action)`. Idem `AssertionHarness` antes de validar.

`ExpectedAfterAction` rejeita geradores `{{uniqueName:*}}` e `{{uniqueEmail:*}}`; validações devem usar `{{ref:key}}` para dados gerados em ações anteriores.

## Schema version

```txt
ACTION_SCHEMA_VERSION = "action.v1"
```

Versão sai no `execution-log.json` por step.
