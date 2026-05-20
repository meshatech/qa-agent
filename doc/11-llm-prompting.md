# 11 — LLM Prompting

## Objetivo

Definir como a LLM é instruída para produzir `QaActionEnvelope` válido. Sem prompt sólido, o contrato de `06` é teoria.

## Princípios

```txt
1. LLM nunca escreve código Playwright
2. LLM nunca inventa seletor CSS
3. LLM só escolhe targetElementId dentro da observação atual
4. LLM responde sempre JSON conforme schema
5. LLM justifica em thought_summary curto (1-2 frases)
6. LLM usa placeholders {{...}} para dados dinâmicos
```

## System Prompt (template)

```txt
Você é o Agent QA Universal, um agente de teste reativo.

Você recebe a cada ciclo:
- a demanda da run (objetivo do teste)
- o cenário atual em execução
- a task atual
- a observação atual da tela (ScreenObservation reduzida)
- os dados dinâmicos já gerados (RunDataStore)
- as últimas tentativas (memória curta)

Você deve responder APENAS JSON conforme o schema QaActionEnvelope.

Regras invioláveis:
- targetElementId deve existir em observation.elements
- observationId deve ser exatamente o da observação recebida
- nunca gere código Playwright
- nunca invente seletor CSS
- use placeholders {{uniqueName:key:prefix}}, {{uniqueEmail:key}}, {{ref:key}}
- em expected_after_action, use {{ref:key}} para dados gerados; nunca use {{uniqueName}} ou {{uniqueEmail}}
- prefira locators semânticos (já fornecidos pelo Harness)
- se tela inesperada, use fallback_action = press Escape ou clickOutside
- se task impossível, retorne action.type = "abortScenario" com reason

Ações permitidas (enum QaAction):
- click, fill, select, press, clickOutside, clickAtCoordinates (restrito)
- waitForStable, assertVisible, assertText, navigate, abortScenario

Tipos de expected_after_action:
- field_value_contains, element_visible, text_visible, url_contains, no_console_errors

Saída obrigatória:
{
  "schemaVersion": "action.v1",
  "observationId": "<copiar do input>",
  "thought_summary": "<1-2 frases>",
  "action": { ... },
  "expected_after_action": { ... },
  "fallback_action": { ... },
  "confidence": <0..1>
}
```

## User message (template por ciclo)

```txt
DEMANDA:
{{demand.description}}

CENÁRIO:
{{scenario.title}}

TASK:
{{task.title}}
Resultado esperado: {{task.expected}}

OBSERVAÇÃO ATUAL (observationId={{observation.observationId}}):
{{observation_json_reduced}}

DADOS DA RUN:
{{run_data_json}}

ÚLTIMAS TENTATIVAS:
{{attempts_json}}

Responda apenas com o JSON do QaActionEnvelope.
```

## Reduced Observation (formato enviado à LLM)

Para economizar token, enviar versão enxuta:

```json
{
  "observationId": "obs_20260519_173122_ab12",
  "url": "/produtos/novo",
  "title": "Cadastro de Produto",
  "pageState": {
    "isLoading": false,
    "hasModal": false,
    "hasToast": false,
    "hasValidationErrors": false
  },
  "visibleTexts": ["Novo Produto", "Nome", "Preço", "Categoria", "Salvar"],
  "elements": [
    { "id": "el_001", "role": "textbox", "name": "Nome", "required": true, "value": "" },
    { "id": "el_002", "role": "textbox", "name": "Preço", "required": true, "value": "" },
    { "id": "el_003", "role": "combobox", "name": "Categoria", "options": ["Geral", "Bebidas"] },
    { "id": "el_004", "role": "button", "name": "Salvar", "disabled": false }
  ],
  "recentConsoleErrors": [],
  "recentNetworkFailures": []
}
```

`locator` interno **não** vai para a LLM. Só fica no `LocatorResolver` do Harness.

## Prompt budget

| Limite | Default | Ação se excedido |
|--------|---------|------------------|
| Tokens da observation | 4000 | Truncar `visibleTexts`, agrupar elementos por role |
| Elementos enviados | 80 | Manter apenas visíveis na viewport + interativos |
| `visibleTexts` items | 60 | Manter apenas textos com role-relevância |
| Tamanho `recentConsoleErrors` | 10 | LIFO, manter últimos |

## Retry de schema

Quando resposta da LLM não passa Zod:

```ts
async function decideWithRetry(input: DecideInput, maxRetries = 2): Promise<QaActionEnvelope> {
  let lastError: string | null = null;

  for (let i = 0; i <= maxRetries; i++) {
    const raw = await llm.complete({
      system: SYSTEM_PROMPT,
      user: buildUserMessage(input),
      validationFeedback: lastError ?? undefined,
    });

    const parsed = QaActionEnvelopeSchema.safeParse(JSON.parse(raw));
    if (parsed.success) return parsed.data;

    lastError = formatZodError(parsed.error);
  }

  throw new ActionSchemaInvalidError(lastError ?? 'unknown');
}
```

Erro mapeado: `ACTION_SCHEMA_INVALID`.

## Determinismo

```txt
- temperature: 0 ou ≤ 0.2 (decisão é executiva, não criativa)
- top_p: 1.0
- response_format: json
- seed: opcional para reprodutibilidade
```

## Anti-padrões proibidos

| Anti-padrão | Por quê proibido |
|-------------|------------------|
| LLM gera `await page.click('...')` | Quebra contrato. Risco de injection |
| LLM inventa `targetElementId` fora do snapshot | Crasha em `LOCATOR_NOT_FOUND` |
| LLM omite `observationId` | Aceita ação obsoleta |
| LLM omite `schemaVersion` | Harness assume `action.v1`, mas registra warning de compatibilidade |
| LLM responde texto livre | Quebra parse Zod |
| LLM usa `{{ref:X}}` sem `set` prévio | `DYNAMIC_DATA_KEY_NOT_FOUND` |

## Auditoria

`thought_summary` + `confidence` + `action` salvos no `execution-log.json` por step. Permite revisar decisão a posteriori.

## Versionamento do prompt

Prompt versionado: `PROMPT_VERSION = "v1"`. Mudança de prompt = mudança de versão. Log da run grava versão.
