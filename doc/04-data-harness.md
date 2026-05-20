# 04 — Data Harness + RunDataStore

## Problema

Variável dinâmica não pode ser apenas string substituída no momento. Precisa virar **dado rastreável** da execução, reutilizável depois em asserções.

## Componentes

```txt
RunDataStore   — armazena dados gerados durante a run
DataHarness    — resolve placeholders e popula store
```

## RunDataStore

```ts
export interface RunDataStore {
  set(key: string, value: string): void;
  get(key: string): string | undefined;
  all(): Record<string, string>;
}
```

## Sintaxe de placeholders

Formato:

```txt
{{tipo:chave:argumento}}
```

Exemplos:

```txt
{{uniqueName:productName:Produto Teste}}
{{uniqueEmail:userEmail}}
{{ref:productName}}
```

## Tipos suportados (MVP)

| Tipo | Sintaxe | Comportamento |
|------|---------|---------------|
| `uniqueName` | `{{uniqueName:key:prefix}}` | Gera `prefix <timestamp>-<short>`, salva em `key` |
| `uniqueEmail` | `{{uniqueEmail:key}}` | Gera `key.<ts>.<short>@qa.local`, salva em `key` |
| `ref` | `{{ref:key}}` | Lê valor previamente salvo. Erro se ausente |

## DataHarness

```ts
export interface DataHarness {
  resolve(input: string): string;
  resolveObject<T>(input: T): T;
  getRunData(): Record<string, string>;
}
```

## Implementação

```ts
export class DefaultDataHarness implements DataHarness {
  constructor(private readonly store: RunDataStore) {}

  resolve(input: string): string {
    return input.replace(/\{\{([^}]+)\}\}/g, (_, expression: string) => {
      const [type, key, ...rest] = expression.split(':');
      const arg = rest.join(':');

      if (type === 'ref') {
        const value = this.store.get(key);
        if (!value) {
          throw new Error(`Run data key not found: ${key}`);
        }
        return value;
      }

      if (type === 'uniqueName') {
        const value = `${arg} ${this.timestamp()}-${this.shortId()}`;
        this.store.set(key, value);
        return value;
      }

      if (type === 'uniqueEmail') {
        const value = `${key}.${this.timestamp()}.${this.shortId()}@qa.local`;
        this.store.set(key, value);
        return value;
      }

      throw new Error(`Unknown data expression: ${expression}`);
    });
  }

  resolveObject<T>(input: T): T {
    if (typeof input === 'string') {
      return this.resolve(input) as T;
    }

    if (Array.isArray(input)) {
      return input.map((item) => this.resolveObject(item)) as T;
    }

    if (input && typeof input === 'object') {
      const output: Record<string, unknown> = {};

      for (const [key, value] of Object.entries(input)) {
        output[key] = this.resolveObject(value);
      }

      return output as T;
    }

    return input;
  }

  private timestamp(): string {
    return new Date()
      .toISOString()
      .replace(/[-:.TZ]/g, '')
      .slice(0, 14);
  }

  private shortId(): string {
    return Math.random().toString(16).slice(2, 6);
  }
}
```

## Fluxo correto

```txt
LLM decide:
  fill Nome com {{uniqueName:productName:Produto Teste}}

ActionHarness:
  resolveObject(action) → "Produto Teste 20260519173122-a82f"
  store.set("productName", ...)
  executa fill

AssertionHarness:
  recebe assert com {{ref:productName}}
  resolve para o valor real salvo
  executa expect
```

## Regra obrigatória

```txt
ActionHarness deve resolver dados dinâmicos antes da ação.
AssertionHarness deve resolver dados dinâmicos antes da validação.
expected_after_action deve usar {{ref:key}} ou valor estático; {{uniqueName}}/{{uniqueEmail}} em validação é rejeitado.
```

Motivo: geradores `unique*` produzem valores novos a cada resolução. Em validações, isso criaria falso negativo comparando contra dado diferente do que foi digitado.

## Persistência

Salvar `run-data.json` no diretório da execução ao final da run. Permite auditoria e rerun manual.

```json
{
  "productName": "Produto Teste 20260519173122-a82f",
  "userEmail": "userEmail.20260519173122.b91c@qa.local"
}
```

## Erro associado

`DYNAMIC_DATA_KEY_NOT_FOUND` → `{{ref:X}}` sem set prévio.

## Bug class eliminada

- Asserção valida com texto diferente do que foi digitado.
- Falso bug por duplicidade de nome em rerun.
- Inconsistência entre ação e validação.
