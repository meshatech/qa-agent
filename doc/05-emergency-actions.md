# 05 — Ações globais de emergência

## Objetivo

Saídas universais para estados flutuantes: modal preso, dropdown aberto, tooltip, overlay travado.

## Tipo `QaAction` atualizado

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

## Press (Escape, Enter, Tab, Backspace)

Primeira saída segura.

```ts
export interface PressAction {
  type: 'press';
  key:
    | 'Escape'
    | 'Enter'
    | 'Tab'
    | 'Backspace'
    | 'ArrowUp'
    | 'ArrowDown'
    | 'ArrowLeft'
    | 'ArrowRight';
  targetElementId?: string;
  reason: string;
}
```

Casos comuns:

```txt
- Escape  → fecha modal/dropdown/tooltip
- Enter   → confirma diálogo
- Tab     → avança foco
- Backspace → corrige campo
```

## Click outside

```ts
export interface ClickOutsideAction {
  type: 'clickOutside';
  reason: string;
}
```

Implementação:

```ts
async clickOutside(): Promise<void> {
  const viewport = this.page.viewportSize();

  if (!viewport) {
    await this.page.keyboard.press('Escape');
    return;
  }

  await this.page.mouse.click(10, 10);
}
```

Fallback para `Escape` se viewport indisponível.

## Click por coordenada (restrito)

Frágil. Última escolha.

```ts
export interface ClickAtCoordinatesAction {
  type: 'clickAtCoordinates';
  x: number;
  y: number;
  reason: string;
  risk: 'HIGH';
}
```

### Política de uso

`clickAtCoordinates` só permitido quando:

```txt
- 3 ações semânticas anteriores falharam na mesma task
- press Escape falhou
- clickOutside falhou
- agente em estado BLOCKED_CANDIDATE
```

Harness deve **bloquear** uso fora dessas condições.

## Hierarquia de tentativa em estado flutuante

```txt
1. press Escape
2. clickOutside
3. waitForStable + reobserve
4. clickAtCoordinates (último recurso, log obrigatório)
5. AbortScenario
```

## Logging obrigatório

Toda ação de emergência registra:

```txt
- motivo (reason)
- estado anterior
- estado posterior
- se conseguiu desbloquear
```

Vira evidência no `execution-log.json`.

## Bug class eliminada

- Agente preso em modal sem botão de fechar.
- Dropdown aberto bloqueando próxima interação.
- Tooltip travado sobre elemento alvo.
- Loop infinito tentando clicar em elemento atrás de overlay.
