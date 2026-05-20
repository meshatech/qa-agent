# 13 — Observation Model + Locators + DOM Purifier

## ScreenObservation (schema completo)

```ts
export interface ScreenObservation {
  observationId: string;
  createdAt: string;              // ISO
  url: string;
  title: string;
  routeName?: string;             // se conhecido via config
  visibleTexts: string[];
  elements: ObservableElement[];
  pageState: PageState;
  consoleSignals: ConsoleSignal[];
  networkSignals: NetworkSignal[];
  meta: {
    viewport: { width: number; height: number };
    schemaVersion: string;        // "obs.v1"
  };
}

export interface PageState {
  isLoading: boolean;
  hasModal: boolean;
  hasToast: boolean;
  hasValidationErrors: boolean;
  hasOverlay?: boolean;
  focusedElementId?: string;
}
```

## ObservableElement

```ts
export interface ObservableElement {
  id: string;                     // ephemeral, e.g. "el_001"
  role: string;                   // ARIA role
  name: string;                   // accessible name
  text?: string;
  placeholder?: string;
  value?: string;
  disabled?: boolean;
  checked?: boolean;
  selected?: boolean;
  required?: boolean;
  options?: string[];             // para combobox/select
  inViewport: boolean;
  locator: LocatorDescriptor;     // privado do Harness, NÃO vai pra LLM
}
```

Campo `locator` é **stripado** antes de enviar para LLM (ver doc 11).

## LocatorDescriptor

Estratégias permitidas. Ordem de prioridade: role > label > placeholder > text > testid.

```ts
export type LocatorDescriptor =
  | { strategy: 'role'; role: string; name?: string; exact?: boolean }
  | { strategy: 'label'; text: string; exact?: boolean }
  | { strategy: 'placeholder'; text: string; exact?: boolean }
  | { strategy: 'text'; text: string; exact?: boolean }
  | { strategy: 'testid'; value: string };
```

Schema Zod:

```ts
export const LocatorDescriptorSchema = z.discriminatedUnion('strategy', [
  z.object({ strategy: z.literal('role'), role: z.string(), name: z.string().optional(), exact: z.boolean().optional() }),
  z.object({ strategy: z.literal('label'), text: z.string(), exact: z.boolean().optional() }),
  z.object({ strategy: z.literal('placeholder'), text: z.string(), exact: z.boolean().optional() }),
  z.object({ strategy: z.literal('text'), text: z.string(), exact: z.boolean().optional() }),
  z.object({ strategy: z.literal('testid'), value: z.string() }),
]);
```

## Resolução para Playwright

```ts
export function resolveToLocator(page: Page, desc: LocatorDescriptor): Locator {
  switch (desc.strategy) {
    case 'role':
      return page.getByRole(desc.role as any, { name: desc.name, exact: desc.exact });
    case 'label':
      return page.getByLabel(desc.text, { exact: desc.exact });
    case 'placeholder':
      return page.getByPlaceholder(desc.text, { exact: desc.exact });
    case 'text':
      return page.getByText(desc.text, { exact: desc.exact });
    case 'testid':
      return page.getByTestId(desc.value);
  }
}
```

## ConsoleSignal / NetworkSignal

```ts
export interface ConsoleSignal {
  level: 'log' | 'info' | 'warn' | 'error' | 'debug';
  text: string;
  source?: string;                // url do script
  isAppOrigin: boolean;           // ver doc 15
  timestamp: string;
}

export interface NetworkSignal {
  method: string;
  url: string;
  headers?: Record<string, string>;
  status: number;
  durationMs: number;
  isAppOrigin: boolean;
  failure?: string;
  timestamp: string;
}
```

`isAppOrigin` calculado contra `RunConfig.appDomains` (doc 17).

## DOM Purifier

Antes de extrair `ObservableElement`, limpar DOM/accessibility tree.

### Remover

```txt
- <script>, <style>, <noscript>, <meta>, <link>
- <svg> inline gigante (manter só ícones com aria-label)
- <canvas>
- atributos: onclick/onmouseover/inline handlers
- classes utilitárias longas (Tailwind, atoms gerados)
- data-* exceto data-testid
- conteúdo de elementos display:none / visibility:hidden / aria-hidden=true
```

### Manter

```txt
- role explícito ou implícito
- aria-label, aria-labelledby (resolvido para texto)
- label associado a input
- placeholder
- texto visível
- estado: disabled, checked, selected, required, expanded
- data-testid
- href parcial (path, sem query)
- erros de validação visíveis
```

## Accessibility Tree Normalizer

Preferir snapshot do AX tree do Playwright (`page.accessibility.snapshot()`) sobre DOM bruto:

```ts
const ax = await page.accessibility.snapshot({ interestingOnly: true });
```

Vantagens:

```txt
- já filtra elementos sem semântica
- já resolve aria-labelledby
- já calcula accessible name
- já indica role efetivo
```

DOM bruto entra só como **fallback** quando AX tree não cobrir (ex: custom components sem ARIA).

## Pipeline da Observação

```txt
1. Page → page.accessibility.snapshot()
2. Page → DOM puro filtrado (fallback)
3. Page → console buffer (últimos N)
4. Page → network buffer (últimos N)
5. Normalize → ObservableElement[]
6. Generate observationId
7. Build LocatorDescriptor por elemento
8. Compute pageState (loading/modal/toast)
9. Return ScreenObservation
10. LocatorResolver.rebuildFromObservation(obs)
```

## Estratégia de geração de Locator

Para cada elemento normalizado:

```txt
Se tem data-testid → strategy=testid (mais estável)
Senão se input tem label associado → strategy=label
Senão se input tem placeholder → strategy=placeholder
Senão se elemento tem role + accessible name → strategy=role
Senão se texto visível único → strategy=text
Senão descartar (sem locator estável)
```

Elemento sem locator estável **não entra** no snapshot enviado à LLM.

## Prompt budget (resumo)

Ver doc 11 para limites. Aqui só a regra:

```txt
- Manter elementos in-viewport + interativos
- Máx 80 elementos
- Truncar visibleTexts para 60
- Truncar value/text para 120 chars
```

## Schema version

```txt
schemaVersion: "obs.v1"
```

Bump quando estrutura mudar. LLM prompt referencia versão.
