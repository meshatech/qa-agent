# Single Orchestrator + Typed Tool Queue (v2)

## Objetivo

Criar uma arquitetura simples e robusta para orquestração de QA onde **um único prompt LLM** gera uma fila tipada de ferramentas, mas **não executa ações diretamente**.

A arquitetura final deve ser:

```
Single Orchestrator Prompt
→ ToolQueueSchema
→ ToolQueueToExecutionPlanMapper
→ ExecutionPlanSchema
→ PlanExecutorService
→ Evidence / Report / Learning
```

A regra central é:

```
LLM planeja.
Schema limita.
Mapper converte.
PlanExecutor executa.
Validators provam.
Evidence registra.
```

---

## Decisão arquitetural principal

### Não criar um runtime paralelo

A `ToolQueue` **não deve ser o runtime principal**.

Ela deve ser uma representação intermediária, ou IR:

```
ToolQueue = plano proposto pela LLM em formato simples
ExecutionPlan = contrato oficial executável pelo runtime
```

Portanto, o fluxo correto é:

```
LLM
→ ToolQueue JSON
→ validação por ToolQueueSchema
→ ToolQueueToExecutionPlanMapper
→ validação por ExecutionPlanSchema
→ PlanExecutorService
```

Isso evita duplicar o que o projeto já tem:

```
ExecutionPlan
PlanExecutorService
QaToolRegistry
ExpectedOutcome
PlanCondition
EvidenceService
PRReporterService
```

---

# 1. Core Idea

Enviar um prompt único ao LLM contendo:

1. Descrição da task.
2. Estado atual da página, quando disponível.
3. Lista de tools/macro-agents disponíveis.
4. Regras de orquestração.
5. Schema de saída obrigatório.
6. Contratos de validação.
7. Política de fallback honesto.

O LLM retorna apenas JSON válido:

```json
{
  "taskQueue": [
    {
      "step": 1,
      "tool": "navigator.open",
      "params": {
        "url": "https://codeshare.io"
      },
      "expectedOutcome": {
        "kind": "NAVIGATION",
        "target": "CodeShare"
      }
    },
    {
      "step": 2,
      "tool": "observer.capture",
      "params": {
        "includeAccessibilityTree": true,
        "includeScreenshot": true
      }
    },
    {
      "step": 3,
      "tool": "actor.fill",
      "params": {
        "target": {
          "strategy": "text_any",
          "texts": ["editor", "code area", "content"]
        },
        "value": "teste"
      }
    },
    {
      "step": 4,
      "tool": "validator.state",
      "params": {
        "condition": {
          "type": "ui_state",
          "expected": "contains_text",
          "text": "teste"
        }
      }
    }
  ],
  "reasoning": "Open the page, observe available elements, fill the editor, and validate the text state."
}
```

---

# 2. Nome recomendado

Use:

```
Single Orchestrator + Typed Tool Queue
```

Evitar chamar os componentes de "sub-agentes inteligentes" nesta versão.

Melhor interpretação:

```
Navigator = macro tool determinística
Observer = macro tool determinística
Actor = macro tool determinística
Validator = macro tool determinística
Explorer = macro tool determinística
Orchestrator = único componente LLM
```

---

# 3. Princípios

## 3.1 LLM não executa browser

O LLM nunca executa:

```
click
fill
type
navigate
assert
```

Ele apenas retorna uma queue tipada.

## 3.2 Tools não raciocinam com LLM

Cada tool deve ser uma função determinística ou adapter do harness.

```
navigator.open
observer.capture
actor.click
actor.fill
validator.state
explorer.scan
```

## 3.3 Runtime valida estado, não texto livre

A validação deve usar:

```
ExpectedOutcome
PlanCondition
StateValidator
```

Não usar regex para inferir intenção.

## 3.4 Fallback honesto

Se a task não puder ser traduzida com confiança:

```
NO_REGRESSION
```

Se nem isso for possível:

```
BLOCKED
```

Nunca voltar para regex.

---

# 4. Arquitetura final

```
User Request / RequiredScenario
        ↓
ExpectedOutcomeResolverService
        ↓
SingleOrchestratorPromptBuilder
        ↓
LLM returns ToolQueue JSON
        ↓
ToolQueueSchema validation
        ↓
ToolQueueToExecutionPlanMapper
        ↓
ExecutionPlanSchema validation
        ↓
PlanExecutorService
        ↓
EvidenceService
        ↓
PRReporterService
        ↓
Learning / Graph-lite
```

---

# 5. Tools disponíveis

## 5.1 `navigator.open`

Abre uma URL e valida carregamento inicial.

```ts
input: {
  url: string;
  expectedTitle?: string;
}

output: {
  ok: boolean;
  currentUrl: string;
  title?: string;
  status?: number;
}
```

Uso:

```
primeiro step
após redirects
quando task exige navegação
```

---

## 5.2 `observer.capture`

Captura o estado atual da página.

```ts
input: {
  includeScreenshot?: boolean;
  includeAccessibilityTree?: boolean;
  includeDomSummary?: boolean;
  fullPage?: boolean;
}

output: {
  url: string;
  title?: string;
  elements: ElementSummary[];
  screenshotPath?: string;
}
```

Regra:

```
nunca agir sem observar antes
```

---

## 5.3 `actor.click`

Executa click seguro.

```ts
input: {
  target: LocatorDescriptor;
  timeoutMs?: number;
}
```

Regras:

```
preferir role/text/label/semanticKey/testId
não usar coordenadas por padrão
coordenadas só como último recurso e com evidência
```

---

## 5.4 `actor.fill`

Preenche campo com valor sintético.

```ts
input: {
  target: LocatorDescriptor;
  value: string;
}
```

Regras:

```
não gerar CPF/RG/cartão/endereço real
não gerar dados pessoais reais
usar safe-test-value quando incerto
```

---

## 5.5 `actor.type`

Digita texto no foco atual.

```ts
input: {
  text: string;
  delayMs?: number;
}
```

Uso:

```
contenteditable
editor customizado
campo onde fill não funciona
```

---

## 5.6 `actor.press`

Pressiona uma tecla.

```ts
input: {
  key: string;
}
```

Uso:

```
Enter
Escape
Tab
atalhos simples
```

---

## 5.7 `validator.state`

Valida condição tipada.

```ts
input: {
  condition: PlanCondition;
}
```

Condições esperadas:

```
auth_state
route_state
ui_state
menu_state
attribute_state
storage_state
network_state
console_state
```

---

## 5.8 `explorer.scan`

Explora a página quando o fluxo normal falha.

```ts
input: {
  mode:
    | "scan_clickables"
    | "scan_inputs"
    | "scan_accessibility_tree"
    | "scan_semantic_candidates"
    | "full_observation";
}
```

Uso:

```
locator não encontrado
validação falhou
estado da página mudou
```

---

# 6. Prompt Orchestrator

## System prompt recomendado

```
You are the QA Orchestrator.

Your job is to convert a QA task into a typed tool queue.

You do not execute browser actions.
You do not invent unavailable tools.
You must return JSON only.
You must use only the provided tools.
You must validate after meaningful actions.
You must not use regex.
You must not rely on hardcoded app-specific words.
You must prefer ExpectedOutcome and PlanCondition.
If you are unsure, use NO_REGRESSION or request observation/exploration.
```

---

## Tools no prompt

Manter compacto:

```
Available tools:
- navigator.open({url})
- observer.capture({includeScreenshot, includeAccessibilityTree})
- actor.click({target})
- actor.fill({target, value})
- actor.type({text})
- actor.press({key})
- validator.state({condition})
- explorer.scan({mode})
```

---

## Regras no prompt

```
1. Start with navigator.open if no page is loaded.
2. Always observe before acting.
3. Validate after each meaningful action.
4. Use ExpectedOutcome when available.
5. Use state validators, not text guesses, to prove success.
6. If locator fails, observe again.
7. If locator fails repeatedly, use explorer.scan.
8. If classification is uncertain, use NO_REGRESSION.
9. Never output free-form browser commands.
10. Return JSON only.
11. Keep the queue short: 3 to 8 steps.
12. Prefer replanning over producing a giant fragile plan.
```

---

# 7. ToolQueue Schema

## ToolNameSchema

O fallback também deve usar tool tipada, não string livre.

```ts
export const ToolNameSchema = z.enum([
  'navigator.open',
  'observer.capture',
  'actor.click',
  'actor.fill',
  'actor.type',
  'actor.press',
  'validator.state',
  'explorer.scan',
]);
```

## FallbackToolCallSchema

Fallback é uma tool simples, sem step, expectedOutcome ou fallback aninhado. Isso evita recursão infinita no Zod.

```ts
export const FallbackToolCallSchema = z.discriminatedUnion('tool', [
  z.object({ tool: z.literal('navigator.open'), params: NavigatorOpenParamsSchema }),
  z.object({ tool: z.literal('observer.capture'), params: ObserverCaptureParamsSchema }),
  z.object({ tool: z.literal('actor.click'), params: ActorClickParamsSchema }),
  z.object({ tool: z.literal('actor.fill'), params: ActorFillParamsSchema }),
  z.object({ tool: z.literal('actor.type'), params: ActorTypeParamsSchema }),
  z.object({ tool: z.literal('actor.press'), params: ActorPressParamsSchema }),
  z.object({ tool: z.literal('validator.state'), params: ValidatorStateParamsSchema }),
  z.object({ tool: z.literal('explorer.scan'), params: ExplorerScanParamsSchema }),
]);
```

## ToolQueueItemSchema

Cada item da queue é validado por discriminated union na tool. Params são tipados por tool, não `z.record(z.unknown())`.

```ts
export const ToolQueueItemSchema = z.discriminatedUnion('tool', [
  z.object({ step: z.number().int().positive(), tool: z.literal('navigator.open'), params: NavigatorOpenParamsSchema, expectedOutcome: ExpectedOutcomeSchema.optional(), fallback: FallbackToolCallSchema.optional() }),
  z.object({ step: z.number().int().positive(), tool: z.literal('observer.capture'), params: ObserverCaptureParamsSchema, expectedOutcome: ExpectedOutcomeSchema.optional(), fallback: FallbackToolCallSchema.optional() }),
  z.object({ step: z.number().int().positive(), tool: z.literal('actor.click'), params: ActorClickParamsSchema, expectedOutcome: ExpectedOutcomeSchema.optional(), fallback: FallbackToolCallSchema.optional() }),
  z.object({ step: z.number().int().positive(), tool: z.literal('actor.fill'), params: ActorFillParamsSchema, expectedOutcome: ExpectedOutcomeSchema.optional(), fallback: FallbackToolCallSchema.optional() }),
  z.object({ step: z.number().int().positive(), tool: z.literal('actor.type'), params: ActorTypeParamsSchema, expectedOutcome: ExpectedOutcomeSchema.optional(), fallback: FallbackToolCallSchema.optional() }),
  z.object({ step: z.number().int().positive(), tool: z.literal('actor.press'), params: ActorPressParamsSchema, expectedOutcome: ExpectedOutcomeSchema.optional(), fallback: FallbackToolCallSchema.optional() }),
  z.object({ step: z.number().int().positive(), tool: z.literal('validator.state'), params: ValidatorStateParamsSchema, expectedOutcome: ExpectedOutcomeSchema.optional(), fallback: FallbackToolCallSchema.optional() }),
  z.object({ step: z.number().int().positive(), tool: z.literal('explorer.scan'), params: ExplorerScanParamsSchema, expectedOutcome: ExpectedOutcomeSchema.optional(), fallback: FallbackToolCallSchema.optional() }),
]);

export const ToolQueueSchema = z.object({
  taskQueue: z.array(ToolQueueItemSchema),
  reasoning: z.string().max(800),
});
```

Isso impede:

```json
{ "tool": "actor.fill", "params": { "banana": "x" } }
```

E permite fallback para tool diferente com params próprios:

```json
{
  "tool": "actor.fill",
  "params": { "target": { "strategy": "text_any", "texts": ["editor"] }, "value": "teste" },
  "fallback": {
    "tool": "explorer.scan",
    "params": { "mode": "scan_inputs" }
  }
}
```

## Validação única e forte

```
ToolQueueItemSchema = discriminated union por tool
→ params validados pela tool específica
→ fallback é FallbackToolCallSchema (não-recursivo, tool+params tipados)
→ sem z.record(z.unknown()) em nenhum ponto
→ sem recursão infinita no Zod
```

Regra:

```
Se tool não existir → BLOCKED com TOOL_NOT_ALLOWED
Se params não bater com a tool → BLOCKED com TOOL_PARAMS_INVALID
Se fallback inválido → BLOCKED com FALLBACK_INVALID
```

## Regras

```
JSON inválido → tentar repair uma vez
JSON ainda inválido → BLOCKED com SCHEMA_INVALID
tool inexistente → BLOCKED com TOOL_NOT_ALLOWED
params inválidos → BLOCKED com TOOL_PARAMS_INVALID
```

---

# 8. ToolQueueToExecutionPlanMapper

## Objetivo

Converter `ToolQueue` validada em `ExecutionPlan`.

Este é o ponto mais importante do desenho.

```
ToolQueue não executa.
ToolQueue vira ExecutionPlan.
ExecutionPlan é executado pelo PlanExecutorService.
```

## Arquivo sugerido

```
src/application/services/tool-queue-to-execution-plan.mapper.ts
```

## Responsabilidade

```
receber ToolQueue validada
converter cada tool em step de ExecutionPlan
preservar expectedOutcome
preservar fallback
preservar metadata para evidence/report
validar resultado com ExecutionPlanSchema
```

## Interface sugerida

```ts
class ToolQueueToExecutionPlanMapper {
  map(input: {
    queue: ToolQueue;
    config: RunConfig;
    scenarioId?: string;
  }): ExecutionPlan;
}
```

## Regras de mapeamento

### `navigator.open`

Vira step com ação de navegação.

### `observer.capture`

Vira step de observação (`observe_screen`) no ExecutionPlan.

Regra:

```
observer.capture sempre vira um ExecutionStep do tipo observação.
não é metadata opcional.
é step obrigatório antes de qualquer actor.*.
```

### `actor.click`

Vira step de action click.

### `actor.fill`

Vira step de action fill.

### `actor.type`

Vira step de action type.

### `actor.press`

Vira step de action press.

### `validator.state`

Vira postcondition ou assertion tipada.

### `explorer.scan`

Vira step exploratório controlado, nunca ação livre.

## Critérios de aceite

- ToolQueue válida vira ExecutionPlan válido.
- ExecutionPlanSchema valida o resultado.
- PlanExecutorService executa o plano.
- Não existe browser execution dentro do mapper.
- Não existe LLM call dentro do mapper.
- Não existe regex no mapper.
- Fallbacks são preservados com tools tipadas.

---

# 9. Replanning

## Quando replanejar

Replan deve ocorrer quando:

```
locator não encontrado
action falhou
validator falhou
schema da queue inicial não cobriu o estado atual
explorer encontrou novo contexto útil
```

## Replan prompt

Entrada:

```
task original
ExpectedOutcome
última observation
steps executados
step que falhou
erro sanitizado
evidências disponíveis
```

## ReplanQueueSchema

O replan também passa por schema. Não retorna tool livre.

```ts
export const ReplanActionSchema = z.enum([
  'replace_remaining_steps',
  'abort',
]);

export const ReplanQueueSchema = z.object({
  action: ReplanActionSchema,
  fromStep: z.number().int().positive().optional(),
  taskQueue: z.array(ToolQueueItemSchema).optional(),
  reasoning: z.string().max(500),
});
```

Regras:

```
action = replace_remaining_steps → fromStep obrigatório, taskQueue obrigatório
action = abort → fromStep omitido, taskQueue omitido
replan nunca altera steps já executados
replan nunca retorna tool fora de ToolNameSchema
```

## Exemplo de saída válida

```json
{
  "action": "replace_remaining_steps",
  "fromStep": 4,
  "taskQueue": [
    {
      "step": 4,
      "tool": "explorer.scan",
      "params": {
        "mode": "scan_inputs"
      }
    }
  ],
  "reasoning": "The previous textbox locator failed, so scan inputs before choosing a new target."
}
```

Ou abort:

```json
{
  "action": "abort",
  "reasoning": "No reliable locator found after exploration."
}
```

## Regras de execução

```
máximo de replans por scenario: 2
máximo de falhas por step: 3
sem loop infinito
falha repetida → BLOCKED
```

---

# 10. Plano inicial curto

Evitar queue gigante.

Regra:

```
3 a 8 steps por queue
```

Motivo:

```
browser muda estado após cada ação
plano longo fica frágil
replan incremental é mais confiável
```

---

# 11. Integração com arquitetura atual

## Reutilizar

```
QaToolRegistry
ExecutionPlan
PlanExecutorService
ExpectedOutcomeResolverService
StateContractTranslatorService
LocatorResolverService
EvidenceService
PRReporterService
Graph-lite futuramente
```

## Não criar

```
runtime paralelo
tool executor separado completo
multiagente com vários prompts
sub-agentes LLM independentes
```

---

# 12. Fallback honesto

Se não houver plano confiável:

```
NO_REGRESSION
```

Se nem `NO_REGRESSION` for possível:

```
BLOCKED
```

Regras:

```
nunca usar regex para inferir intenção
nunca fingir cobertura específica
nunca marcar PASS completo quando só rodou fallback
```

---

# 13. Graph-lite como enriquecimento futuro

O Orchestrator pode receber contexto do graph-lite:

```
Known aliases:
- DEAUTHENTICATION: Sair, Encerrar sessão, Logout

Known locators:
- account-menu-button worked 4 times
- logout-button worked 3 times
```

Mas graph-lite deve ser opcional.

Ordem de prioridade:

```
config.semanticAliases
→ graph-lite validated aliases
→ LLM target
→ NO_REGRESSION
```

---

# 14. Fases de implementação

## Fase 1 — Prompt Builder + Schema

Criar:

```
SingleOrchestratorPromptBuilder
ToolNameSchema
ToolParamsSchema (discriminated union por tool)
ToolQueueItemSchema
ToolQueueSchema
ToolQueueRepairService
```

Critérios:

```
prompt gera JSON válido
schema bloqueia tool inexistente
fallback.tool também é tipado
params validado por tool específica (ex: actor.fill requer target+value)
JSON inválido tenta repair uma vez
sem execução ainda
```

---

## Fase 2 — Tool Definitions

Mapear tools existentes ou criar adapters:

```
navigator.open
observer.capture
actor.click
actor.fill
actor.type
actor.press
validator.state
explorer.scan
```

Critérios:

```
todas as tools têm input schema
todas retornam resultado tipado
nenhuma tool chama LLM
nenhuma tool interpreta intenção por regex
```

---

## Fase 3 — ToolQueueToExecutionPlanMapper

Criar:

```
ToolQueueToExecutionPlanMapper
```

Critérios:

```
ToolQueue vira ExecutionPlan válido
ExecutionPlanSchema valida o resultado
PlanExecutorService continua único executor
não criar runtime paralelo
```

---

## Fase 4 — Replanning

Criar:

```
OrchestratorReplanService
ReplanQueueSchema
```

Critérios:

```
falha de locator aciona observe/explorer
falha repetida vira BLOCKED
replan preserva histórico
não entra em loop infinito
```

---

## Fase 5 — Reports e Evidence

Integrar com:

```
pr-report.md
execution-report.md
evidence
blocks
bugs
publication status
```

Critérios:

```
cada step executado aparece no report
falhas de tool aparecem como block ou bug
evidências são linkadas
fallback aparece como cobertura limitada
```

---

# 15. Testes

## Unit tests

```
ToolQueueSchema rejeita tool inválida
ToolQueueSchema rejeita fallback.tool inválido
PromptBuilder inclui tools e regras
Mapper converte navigator.open
Mapper converte actor.click
Mapper converte validator.state
Mapper não chama browser
Mapper não chama LLM
```

## Integration tests

```
fixture sintética fora do MeshaMail
task simples de navegação
task de preenchimento em contenteditable
falha de locator aciona explorer
replan gera nova queue
fallback NO_REGRESSION quando classificação falha
```

## Regression tests

```
não quebra ExecutionPlan atual
não quebra PlanExecutorService atual
não quebra PRReporter
não reintroduz regex de intenção
```

---

# 16. Critérios de aceite finais

A arquitetura estará pronta quando:

- Um único prompt orquestrador gerar `ToolQueue` válida.
- A queue for validada por schema em **duas camadas** (estrutura + params por tool).
- `fallback.tool` for tipado e `fallback.params` validado pela tool específica.
- `ToolQueue` for convertida para `ExecutionPlan`.
- `ExecutionPlanSchema` validar o plano convertido.
- `PlanExecutorService` continuar sendo o executor oficial.
- Nenhuma ação for executada sem observation anterior quando aplicável.
- Toda ação relevante tiver validator depois.
- Falha de locator gerar replan/explorer.
- Falha repetida gerar `BLOCKED`.
- Replan retornar `ReplanQueueSchema` tipado, nunca tool livre.
- Nenhum regex for usado para inferir intenção.
- O runtime continuar baseado em contrato tipado.
- Evidências forem registradas.
- O PR report mostrar steps, bugs, blocks, fallback e evidências.
- O fluxo funcionar em fixture sintética fora do MeshaMail.
