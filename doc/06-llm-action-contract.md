# 06 — Contrato final da ação da LLM

## Objetivo

LLM responde sempre JSON estruturado. Nunca código. Nunca seletor cru. Sempre referenciando observação atual.

## Schema do envelope

```json
{
  "schemaVersion": "action.v1",
  "observationId": "obs_20260519_173122_ab12",
  "thought_summary": "A tela mostra um formulário de produto. O próximo passo seguro é preencher o campo Nome.",
  "action": {
    "type": "fill",
    "targetElementId": "el_001",
    "value": "{{uniqueName:productName:Produto Teste}}"
  },
  "expected_after_action": {
    "type": "field_value_contains",
    "targetElementId": "el_001",
    "value": "{{ref:productName}}"
  },
  "fallback_action": {
    "type": "press",
    "key": "Escape",
    "reason": "Fechar possível modal ou dropdown inesperado"
  },
  "confidence": 0.91
}
```

## Campos obrigatórios

| Campo | Descrição |
|-------|-----------|
| `schemaVersion` | Versão do schema da ação. Default atual: `action.v1` |
| `observationId` | ID da observação atual. Validado pelo Harness |
| `thought_summary` | Justificativa curta auditável. **Não** chain-of-thought completo |
| `action` | Ação atômica do enum `QaAction` |
| `expected_after_action` | Asserção esperada após executar |
| `fallback_action` | Ação de recuperação se `expected_after_action` falhar |
| `confidence` | 0.0–1.0. Usado por `RecoveryPolicy` |

## Tipos de `expected_after_action`

```ts
type ExpectedAfterAction =
  | { type: 'field_value_contains'; targetElementId: string; value: string }
  | { type: 'element_visible'; targetElementId?: string; text?: string }
  | { type: 'text_visible'; text: string }
  | { type: 'url_contains'; value: string }
  | { type: 'no_console_errors' };
```

## Binding de validação

`targetElementId` em `expected_after_action` referencia a observação **atual no momento da decisão**. Como IDs `el_*` são efêmeros, o Harness deve resolver esse alvo antes da ação e criar um `BoundExpectedAfterAction` interno:

```ts
export type BoundExpectedAfterAction =
  | {
      type: 'field_value_contains';
      target: BoundValidationTarget;
      value: string;
    }
  | {
      type: 'element_visible';
      target?: BoundValidationTarget;
      text?: string;
    }
  | { type: 'text_visible'; text: string }
  | { type: 'url_contains'; value: string }
  | { type: 'no_console_errors' };

export interface BoundValidationTarget {
  originalElementId: string;
  observationId: string;
  locator: LocatorDescriptor;
  humanName?: string;
}
```

Após a ação, o runtime pode invalidar o `locatorMap`, reobservar a tela e validar usando o `locator` vinculado, nunca o `el_*` antigo. Se o locator vinculado não resolver mais, a falha vira `ASSERTION_FAILED` ou `LOCATOR_NOT_FOUND` conforme o caso e entra na `RecoveryPolicy`.

## Validação

Harness valida com Zod (ou similar) **antes** de executar:

```txt
1. schemaVersion suportada
2. action conforme schema QaAction
3. observationId === observação corrente
4. targetElementId de action/expected existe no locatorMap atual
5. expected_after_action com targetElementId vira BoundExpectedAfterAction interno
6. placeholders {{...}} resolvíveis no momento correto
7. expected_after_action não usa geradores {{uniqueName}}/{{uniqueEmail}}
8. confidence em [0, 1]
```

## Regras invioláveis

```txt
- LLM nunca gera código Playwright para execução em runtime
- LLM nunca inventa seletor CSS
- LLM nunca referencia elemento de observação anterior
- LLM nunca cria locator próprio — só escolhe targetElementId do snapshot
- LLM nunca executa ação fora do enum QaAction
```

## Erros associados

- `ACTION_SCHEMA_INVALID` → JSON fora do schema. Recuperável com retry.
- `STALE_OBSERVATION` → observationId obsoleto.
- `LOCATOR_NOT_FOUND` → targetElementId fora do locatorMap.

## Política sobre `thought_summary`

```txt
Máximo 1–2 frases.
Não pode conter código.
Não pode conter seletor CSS.
Serve apenas como evidência auditável.
Vai pro execution-log.json.
```
