# 18 — Security, Privacy + Schema Versioning

## Princípio

```txt
Credencial nunca aparece em log, evidência ou prompt LLM.
Dados sensíveis são mascarados antes de persistir.
```

## Superfícies de risco

| Superfície | Risco | Mitigação |
|-----------|-------|-----------|
| `execution-log.json` | senha digitada via fill | mascarar valores de campos password |
| `network.json` | JWT em header Authorization | mascarar tokens |
| `dom-snapshot.html` | valor de input password | strip de `input[type=password]` |
| `console.log` | dump de objeto com credencial | regex de mascaramento |
| Cookies | session token | mascarar `Set-Cookie` |
| Prompt LLM | password no fill | nunca enviar valor de campo password à LLM |
| `run-data.json` | nome/email reais | usar `{{uniqueEmail}}` em vez de email real |

## Sanitizer

```ts
export interface Sanitizer {
  sanitizeString(input: string): string;
  sanitizeObject<T>(input: T): T;
  sanitizeNetworkSignal(signal: NetworkSignal): NetworkSignal;
}
```

### Regras default

```ts
const DEFAULT_MASK_REGEXES = [
  // JWT
  /eyJ[a-zA-Z0-9_-]{10,}\.[a-zA-Z0-9_-]+\.[a-zA-Z0-9_-]+/g,
  // Bearer
  /Bearer\s+[a-zA-Z0-9._\-]+/gi,
  // API key padrão
  /(api[_-]?key|apikey)["':=\s]+["']?([a-zA-Z0-9_\-]{16,})/gi,
  // AWS access key
  /AKIA[0-9A-Z]{16}/g,
  // Cartão de crédito (placeholder)
  /\b(?:\d[ -]*?){13,19}\b/g,
];

const MASK = '***REDACTED***';
```

### Sanitização do `fill`

Quando elemento é password (`role=textbox` + `type=password` no DOM):

```txt
- Valor digitado NÃO é logado no resolvedAction
- resolvedAction.value vira "***REDACTED***" no execution-log.json
- Valor real só existe em memória, nunca persiste
- LLM recebe placeholder, nunca valor real (ver doc 17 form login)
```

```ts
function sanitizeAction(action: QaAction, element?: ObservableElement): QaAction {
  if (action.type === 'fill' && isPasswordField(element)) {
    return { ...action, value: '***REDACTED***' };
  }
  return action;
}
```

## Sanitização de network

```ts
export function sanitizeNetwork(signal: NetworkSignal, config: PrivacyConfig): NetworkSignal {
  const url = redactUrlQueryParams(signal.url, ['token', 'access_token', 'api_key']);
  const headers = redactHeaders(signal.headers, ['authorization', 'cookie', 'set-cookie', 'x-api-key']);
  return { ...signal, url, headers };
}
```

## Sanitização do DOM snapshot

```ts
function purifyDomForEvidence(html: string): string {
  return html
    .replace(/<input([^>]*type=["']password["'][^>]*)value=["'][^"']*["']/gi, '<input$1value="***"')
    .replace(/<meta([^>]*name=["']csrf-token["'][^>]*)content=["'][^"']*["']/gi, '<meta$1content="***"');
}
```

## Sanitização do RunDataStore

```txt
- chaves prefixadas com "secret:" nunca persistidas
- emails mascarados se config.privacy.maskEmails=true
- ordem: gerar dado → registrar → mascarar antes de escrever em disco
```

## Sanitização do config.json salvo

`config.json` na pasta da run **nunca** contém:

```txt
- valores resolvidos de env (apenas nome da env var)
- senhas
- API keys
- storageState path resolvido para conteúdo
```

## Logs do agente (`agent.log`)

```txt
- log structured (JSON-lines)
- aplicar Sanitizer.sanitizeString em toda mensagem
- nunca logar headers brutos sem sanitizar
- nunca logar request body de POST /login
```

## Auditoria

Toda redação aplicada vira contador no `metrics.json`:

```json
{
  "sanitization": {
    "redactedFills": 2,
    "redactedHeaders": 14,
    "redactedNetworkUrls": 3,
    "redactedDomNodes": 1
  }
}
```

---

## Schema Versioning

### Política

```txt
Todo schema persistido tem campo schemaVersion no formato "<scope>.v<N>".
Mudança incompatível = bump major.
Mudança aditiva opcional = bump minor (v1, v1.1).
```

### Escopos versionados

| Escopo | Versão atual | Campo |
|--------|--------------|-------|
| Observation | `obs.v1` | `ScreenObservation.meta.schemaVersion` |
| Action | `action.v1` | `QaActionEnvelope.schemaVersion` |
| Run dir | `run.v1` | `run.json.schemaVersion` |
| Execution log | `log.v1` | `execution-log.json.version` |
| Prompt | `v1` | `RunConfig.llm.promptVersion` |
| Bug report | `bug.v1` | `bug.json.schemaVersion` |

### `schemaVersion` no envelope

Contrato vigente do doc 14:

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
```

### Compatibilidade

```txt
- ler versões antigas com migração explícita
- gravar sempre versão atual
- versão desconhecida → erro fatal "unsupported schema version"
```

### Migrations

Pasta `src/infrastructure/migrations/` por escopo:

```txt
migrations/
  observation/
    v1-to-v2.ts
  action/
    v1-to-v2.ts
```

Função pura: `(oldDoc) => newDoc`.

### Quando bumpar

| Mudança | Bump |
|---------|------|
| Adicionar campo opcional | minor (v1.1) |
| Adicionar tipo novo no discriminated union | minor |
| Renomear campo | major (v2) |
| Remover campo | major |
| Mudar semântica de campo existente | major |

## Anti-padrões

```txt
- usar versão flutuante (sem schemaVersion)
- ignorar versão antiga em vez de migrar
- logar credencial mesmo sanitizada por padding
- salvar storageState dentro da pasta da run
- enviar password real à LLM em prompt
```
