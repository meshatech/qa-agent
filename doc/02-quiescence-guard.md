# 02 — Quiescence Guard

## Objetivo

Impedir observação prematura da tela. Espera React/Vue/Next terminarem update de estado, DOM, toast, botão, loading e chamadas async antes do próximo Observe.

## Componente

```txt
QuiescenceGuard
```

## Responsabilidades

```txt
- esperar network estabilizar
- esperar DOM parar de sofrer mutações
- esperar botão/loading mudar de estado
- evitar observação prematura
- retornar motivo da estabilidade
```

## Interface

```ts
export interface QuiescenceGuard {
  waitForQuiescence(input?: WaitForQuiescenceInput): Promise<QuiescenceResult>;
}

export interface WaitForQuiescenceInput {
  timeoutMs?: number;
  domQuietMs?: number;
  networkQuietMs?: number;
  allowNetworkIdleFailure?: boolean;
}

export interface QuiescenceResult {
  stable: boolean;
  reason:
    | 'NETWORK_AND_DOM_IDLE'
    | 'DOM_IDLE_ONLY'
    | 'TIMEOUT_BUT_CONTINUABLE'
    | 'LOAD_STATE_REACHED';
  elapsedMs: number;
}
```

## Implementação conceitual (Playwright)

```ts
export class PlaywrightQuiescenceGuard implements QuiescenceGuard {
  constructor(private readonly page: Page) {}

  async waitForQuiescence(
    input: WaitForQuiescenceInput = {},
  ): Promise<QuiescenceResult> {
    const timeoutMs = input.timeoutMs ?? 3000;
    const domQuietMs = input.domQuietMs ?? 250;
    const allowNetworkIdleFailure = input.allowNetworkIdleFailure ?? true;

    const startedAt = Date.now();
    let networkIdle = false;

    try {
      try {
        await this.page.waitForLoadState('networkidle', { timeout: timeoutMs });
        networkIdle = true;
      } catch {
        if (!allowNetworkIdleFailure) throw new Error('Network idle timeout');
      }

      await this.waitForDomQuiet(domQuietMs, timeoutMs);

      return {
        stable: true,
        reason: networkIdle ? 'NETWORK_AND_DOM_IDLE' : 'DOM_IDLE_ONLY',
        elapsedMs: Date.now() - startedAt,
      };
    } catch {
      return {
        stable: false,
        reason: 'TIMEOUT_BUT_CONTINUABLE',
        elapsedMs: Date.now() - startedAt,
      };
    }
  }

  private async waitForDomQuiet(
    quietMs: number,
    timeoutMs: number,
  ): Promise<void> {
    await this.page.evaluate(
      ({ quietMs, timeoutMs }) => {
        return new Promise<void>((resolve, reject) => {
          let timer: number | undefined;
          const timeout = window.setTimeout(() => {
            observer.disconnect();
            reject(new Error('DOM quiet timeout'));
          }, timeoutMs);

          const done = () => {
            window.clearTimeout(timeout);
            observer.disconnect();
            resolve();
          };

          const observer = new MutationObserver(() => {
            if (timer) window.clearTimeout(timer);
            timer = window.setTimeout(done, quietMs);
          });

          observer.observe(document.body, {
            childList: true,
            subtree: true,
            attributes: true,
            characterData: true,
          });

          timer = window.setTimeout(done, quietMs);
        });
      },
      { quietMs, timeoutMs },
    );
  }
}
```

## Integração no fluxo

```ts
async executeAction(action: QaAction): Promise<ActionExecutionResult> {
  const result = await this.actionHarness.execute(action);

  const quiescence = await this.quiescenceGuard.waitForQuiescence({
    timeoutMs: 3000,
    domQuietMs: 250,
  });

  return {
    ...result,
    quiescence,
  };
}
```

## Defaults sugeridos

| Param | Default |
|-------|---------|
| `timeoutMs` | 3000 |
| `domQuietMs` | 250 |
| `networkQuietMs` | reservado para implementação com contador próprio de requests |
| `allowNetworkIdleFailure` | true |

## Erro associado

`QUIESCENCE_TIMEOUT` → warning quando `stable=false` mas continuável. Não aborta cenário sozinho.
