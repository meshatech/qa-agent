# 03 — IDs efêmeros por observação

## Regra

```txt
Element IDs como el_001, el_002, el_003 só existem dentro de uma única observação.
Depois de qualquer ação executada, todos os IDs anteriores são inválidos.
```

LLM nunca decide com elemento de observação antiga.

## Contrato `ScreenObservation`

```ts
export interface ScreenObservation {
  observationId: string;
  createdAt: string;
  url: string;
  title: string;
  elements: ObservableElement[];
}
```

## Envelope da ação

Toda ação carrega `observationId` atual:

```ts
export interface QaActionEnvelope {
  observationId: string;
  action: QaAction;
}
```

## Validação no Harness

```ts
if (actionEnvelope.observationId !== currentObservation.observationId) {
  throw new StaleObservationError(
    'Action references an expired observation snapshot.',
  );
}
```

## LocatorResolver revisado

```ts
export class LocatorResolver {
  private currentObservationId: string | null = null;
  private locatorMap = new Map<string, LocatorDescriptor>();

  rebuildFromObservation(observation: ScreenObservation): void {
    this.currentObservationId = observation.observationId;
    this.locatorMap.clear();

    for (const element of observation.elements) {
      this.locatorMap.set(element.id, element.locator);
    }
  }

  resolve(observationId: string, elementId: string): LocatorDescriptor {
    if (observationId !== this.currentObservationId) {
      throw new StaleObservationError(
        `Observation ${observationId} is no longer valid.`,
      );
    }

    const locator = this.locatorMap.get(elementId);

    if (!locator) {
      throw new ElementNotFoundError(
        `Element ${elementId} not found in current observation.`,
      );
    }

    return locator;
  }
}
```

## Ciclo obrigatório

```txt
Observe → gera observationId novo
       → reseta locatorMap
       → preenche locatorMap com elementos da observação

Action → valida observationId no envelope
       → resolve locator pelo mapa atual
       → executa

Após ação → quiescence → próxima Observe → invalida tudo
```

## Validação pós-ação

`expected_after_action.targetElementId` também pertence à observação atual. Antes de executar a ação, o Harness deve resolver esse alvo para `BoundExpectedAfterAction` com `LocatorDescriptor`. Depois da ação e da nova observação, a validação usa o locator vinculado, não o `el_*` antigo.

```txt
Decisão LLM → expected_after_action.targetElementId = el_001
Harness     → resolve el_001 para LocatorDescriptor e cria BoundExpectedAfterAction
Após ação   → invalida locatorMap e reobserva
Validação   → usa BoundExpectedAfterAction.target.locator
```

## Convenções

- `observationId` formato sugerido: `obs_YYYYMMDD_HHmmss_<short>` ex: `obs_20260519_173122_ab12`.
- IDs de elemento: `el_NNN` (3 dígitos, sequencial dentro da observação).
- Nunca persistir mapa de elementos entre observações.

## Erros associados

- `STALE_OBSERVATION` → recuperável. Forçar nova Observe.
- `LOCATOR_NOT_FOUND` → elemento sumiu da tela atual.

## Bug class eliminada

Mata classe inteira: ação em elemento que já não existe mais ou mudou de posição/role após re-render.
