# Single Orchestrator Prompt + Typed Macro Tools

## Objetivo

Criar uma arquitetura simples em que **um único prompt orquestrador** decide quais ferramentas/macro-agentes usar para transformar uma tarefa de QA em uma sequência executável, sem hardcoded flow e sem múltiplos prompts especializados.

A ideia central é:

```
LLM = orquestrador/planejador
Sub-agents = tools determinísticas
Runtime = executor seguro
Validação = contrato de estado
```

O LLM não executa ações diretamente. Ele apenas retorna um plano tipado. O runtime valida o plano e executa usando tools registradas.

---

## Decisão arquitetural

### Nome

```
Single Orchestrator Prompt Architecture
```

ou, mais precisamente:

```
Single Orchestrator + Typed Tool Queue
```

### Por que ajustar o nome

"Sub-agent" pode dar a entender que cada agente tem seu próprio prompt/LLM. Para esta versão, isso aumenta complexidade.

Nesta arquitetura:

```
NavigatorAgent = tool/macro determinística
ObserverAgent = tool/macro determinística
ActorAgent = tool/macro determinística
ValidatorAgent = tool/macro determinística
ExplorerAgent = tool/macro determinística
```

O único componente com raciocínio LLM é o **Orchestrator**.

---

## 1. Core Idea

Em vez de múltiplos prompts especializados, enviar ao LLM um prompt único contendo:

1. Descrição da tarefa.
2. Estado atual da página, quando disponível.
3. Definição dos tools/macro-agents disponíveis.
4. Regras de orquestração.
5. Schema de saída obrigatório.
6. Limites de segurança.
7. Contratos de sucesso esperados.

O LLM retorna uma **task queue tipada**.

Exemplo:

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
        "includeAccessibilityTree": true
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
  "reasoning": "The flow opens the page, observes the editor, fills it, and validates visible state."
}
```

---

## 2. Princípio mais importante

O LLM pode decidir a sequência, mas não pode executar ação sem contrato.

Regra:

```
LLM propõe.
Schema valida.
Runtime executa.
Validator prova.
Evidence registra.
```

O Orchestrator nunca deve retornar comandos livres como:

```
click on the logout button
```

Ele deve retornar uma ação tipada:

```json
{
  "tool": "actor.click",
  "params": {
    "target": {
      "strategy": "text_any",
      "texts": ["Sair", "Logout", "Sign out"]
    }
  }
}
```

---

## 3. Por que isso funciona

### 3.1 Menos chamadas LLM

A arquitetura reduz o número de chamadas porque usa um prompt orquestrador para montar o plano inicial.

Mas é importante não prometer "uma única chamada para tudo", porque páginas mudam após cada ação.

Melhor regra:

```
1 chamada LLM para plano inicial.
Nova chamada LLM apenas em replan/falha/contexto novo.
```

### 3.2 Fluxo dinâmico

O LLM pode escolher granularidade:

```
tarefa simples → poucos steps
tarefa complexa → mais observe/validate/replan
```

### 3.3 Sem grafo fixo de agentes

O código não precisa ter fluxo rígido:

```
login sempre faz A → B → C
logout sempre faz X → Y → Z
```

O LLM escolhe tools disponíveis, mas dentro de um schema fechado.

### 3.4 Fallback natural

Se uma ação falha:

```
failure context
→ replan prompt
→ Explorer/Observer
→ nova task queue
```

---

## 4. Arquitetura ajustada

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
ToolQueueExecutor
        ↓
QaToolRegistry
        ↓
Navigator / Observer / Actor / Validator / Explorer
        ↓
Evidence + Report + Learning
```

---

## 5. Tools disponíveis

### 5.1 `navigator.open`

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

### 5.2 `observer.capture`

Captura estado da página.

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
Nunca agir sem observar antes.
```

---

### 5.3 `actor.click`

Executa click seguro.

```ts
input: {
  target: LocatorDescriptor;
  timeoutMs?: number;
}
```

Regras:

```
não usar coordenadas por padrão
preferir role/text/label/semanticKey
usar coordenadas só como último recurso e com evidência
```

---

### 5.4 `actor.fill`

Preenche campo.

```ts
input: {
  target: LocatorDescriptor;
  value: string;
}
```

Regras:

```
usar valores sintéticos
não gerar dados pessoais reais
não gerar CPF/RG/cartão/endereço real
```

---

### 5.5 `actor.type`

Digita texto em foco atual.

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

### 5.6 `actor.press`

Pressiona tecla.

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

### 5.7 `validator.state`

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

### 5.8 `explorer.scan`

Explora página quando a ação planejada falha.

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
quando locator não é encontrado
quando validação falha
quando a página mudou de forma inesperada
```

---

## 6. Prompt Orchestrator

### Estrutura

```
# SYSTEM: QA Orchestrator

You are the QA Orchestrator.

Your job is to convert a QA task into a typed tool queue.

You do not execute browser actions.
You do not invent unavailable tools.
You must return JSON only.
You must use the provided tools.
You must validate after meaningful actions.
You must not use regex.
You must not rely on hardcoded app-specific words.
You must prefer ExpectedOutcome and PlanCondition.

If you are unsure, choose NO_REGRESSION or request observation/exploration.
```

### Available Tools

O prompt deve listar tools em formato compacto, não muito longo.

Exemplo:

```
Tools:
- navigator.open({url})
- observer.capture({includeScreenshot, includeAccessibilityTree})
- actor.click({target})
- actor.fill({target, value})
- actor.type({text})
- actor.press({key})
- validator.state({condition})
- explorer.scan({mode})
```

### Rules

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
```

---

## 7. Schema de saída

```ts
export const ToolQueueSchema = z.object({
  taskQueue: z.array(z.object({
    step: z.number().int().positive(),
    tool: z.enum([
      'navigator.open',
      'observer.capture',
      'actor.click',
      'actor.fill',
      'actor.type',
      'actor.press',
      'validator.state',
      'explorer.scan'
    ]),
    params: z.record(z.unknown()),
    expectedOutcome: ExpectedOutcomeSchema.optional(),
    fallback: z.object({
      tool: z.string(),
      params: z.record(z.unknown())
    }).optional()
  })),
  reasoning: z.string().max(800)
});
```

Regra:

```
Se JSON inválido → reparse/repair uma vez.
Se continuar inválido → BLOCKED com erro SCHEMA_INVALID.
```

---

## 8. Executor

### `ToolQueueExecutor`

Responsabilidade:

```
receber taskQueue validada
executar step a step
registrar resultado
acionar replan quando necessário
coletar evidências
```

Fluxo:

```
for step in taskQueue:
  validate tool exists
  validate params
  execute tool
  record result
  if step failed:
     call replan
```

---

## 9. Replanning

Quando falhar:

```
failure context
+ last observation
+ executed steps
+ failed step
+ error
→ LLM replan prompt
```

O replan não deve retornar o plano inteiro sempre. Melhor retornar:

```json
{
  "action": "replace_remaining_steps",
  "fromStep": 4,
  "taskQueue": [...]
}
```

Ou:

```json
{
  "action": "abort",
  "reason": "No reliable locator found after exploration."
}
```

---

## 10. Plano inteiro vs plano incremental

O plano inicial: LLM monta uma queue curta.
Durante execução: replan apenas quando houver falha ou estado novo importante.

Tamanho recomendado:

```
3 a 8 steps por queue
```

Evitar plano gigante com 30 steps, porque fica frágil.

---

## 11. Integração com arquitetura atual

### Reutilizar o que já existe

Este plano deve reutilizar:

```
QaToolRegistry
ExecutionPlan
PlanExecutorService
ExpectedOutcomeResolverService
StateContractTranslatorService
LocatorResolverService
EvidenceService
PRReporterService
```

Não criar um runtime paralelo se o atual já executa `ExecutionPlan`.

### Caminho recomendado

Converter `ToolQueue` em `ExecutionPlan`.

```
LLM ToolQueue
→ ToolQueueToExecutionPlanMapper
→ PlanExecutorService
```

Assim evita dois executores diferentes.

---

## 12. Fallback honesto

Se o Orchestrator não conseguir montar plano confiável:

```
NO_REGRESSION
```

Se nem `NO_REGRESSION` puder rodar:

```
BLOCKED
```

Nunca usar regex para tentar adivinhar intenção.

---

## 13. Graph-lite como enriquecimento futuro

O prompt pode receber contexto do graph-lite:

```
Known aliases:
- DEAUTHENTICATION: Sair, Encerrar sessão, Logout

Known locators:
- account-menu-button worked 4 times
- logout-button worked 3 times
```

Mas o graph-lite não deve ser obrigatório.

Ordem:

```
config.semanticAliases
→ graph-lite validated aliases
→ LLM target
→ NO_REGRESSION
```

---

## 14. Fases de implementação

### Fase 1 — Schema + Prompt Builder

Criar:

```
SingleOrchestratorPromptBuilder
ToolQueueSchema
ToolQueueRepairService
```

Critérios:

```
prompt gera JSON válido
JSON inválido vira BLOCKED/repair
sem execução ainda
```

---

### Fase 2 — Tool Registry

Criar ou mapear tools:

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
todas as tools têm schema
todas retornam SubAgentResult/ToolResult
nenhuma tool chama LLM
```

---

### Fase 3 — Queue Executor

Criar:

```
ToolQueueExecutor
```

ou mapear para:

```
ExecutionPlan
```

Critérios:

```
executa queue validada
observa antes de agir
valida após ação
registra evidências
```

---

### Fase 4 — Replanning

Criar:

```
OrchestratorReplanService
```

Critérios:

```
falha de locator aciona observe/explorer
falha repetida vira BLOCKED
replan não perde histórico
```

---

### Fase 5 — Relatório

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
```

---

## 15. Critérios de aceite finais

A arquitetura estará pronta quando:

* Um único prompt orquestrador conseguir gerar `ToolQueue` válida.
* A queue for validada por schema.
* Nenhuma ação for executada sem observation anterior.
* Toda ação relevante tiver validator depois.
* Falha de locator gerar replan/explorer.
* Falha repetida gerar `BLOCKED`, não loop infinito.
* Nenhum regex for usado para inferir intenção.
* O runtime continuar baseado em contrato tipado.
* Evidências forem registradas.
* O PR report mostrar steps, bugs, blocks e evidências.
* O fluxo funcionar em fixture sintética fora do MeshaMail.

