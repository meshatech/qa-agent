# v0.2.5 - Tool Registry & Harness Tools

## Objetivo

Criar uma base incremental para `QaToolRegistry` sem mudar o runtime. A camada de tools deve preparar integração futura com LangChain Structured Tools, MCP, mas o `PlanExecutorService` continua sendo a autoridade final de execução.

## Descrição do Pedido

Esta entrega revisa a arquitetura atual do `agent-qa` e cria a base produtiva mínima do `QaToolRegistry` para a fase `Tool Registry & Harness Tools`.

O escopo pedido foi:

- mapear a fronteira entre core, harness, planner/replanner, executor, evidence/reports e tools;
- documentar quais tools podem ser públicas e quais devem permanecer internas;
- impedir exposição pública de actions Playwright diretas como `click`, `fill`, `press` e `navigate`;
- manter o `PlanExecutorService` como autoridade final de execução;
- manter `PlaywrightHarness` encapsulado atrás do runtime;
- não remover fallback factory, validações Zod ou policies existentes;
- não acoplar o core diretamente a LangChain, Hermes ou MCP;
- criar contratos base em `src/application/tools/`;
- cobrir a base com testes.

Fora de escopo nesta entrega:

- reescrever o runtime;
- transformar actions Playwright em tools públicas;
- criar adapter LangChain/MCP;
- trocar o fluxo de execução do `PlanExecutorService`;
- alterar comportamento funcional.

## Mapa Atual

- Core/domain:
  - `src/domain/schemas/execution-plan.schema.ts`
  - `src/domain/schemas/action.schema.ts`
  - Define `ExecutionPlan`, `PlanPatch`, `PlanCondition`, actions declarativas e validações Zod.
- Planner:
  - `src/application/services/execution-plan-planner.service.ts`
  - Converte saída LLM em `ExecutionPlan`, valida schema/policy e mantém fallback para factory.
- Replanner:
  - `src/application/services/plan-replanner.service.ts`
  - Solicita `PlanPatch`, valida e limita replans.
- Executor:
  - `src/application/services/plan-executor.service.ts`
  - Executa plano determinístico, resolve locators, valida pre/postconditions e business assertions.
- Harness:
  - `src/infra/playwright/playwright-harness.ts`
  - Encapsula Playwright atrás das portas/runtime. Não deve ser exposto como tool pública.
- Element availability:
  - `src/application/services/element-availability-resolver.service.ts`
  - Tenta tornar elementos disponíveis de forma controlada antes de declarar locator indisponível.
- LLM normalization:
  - `src/infra/llm/llm-output-normalizer.ts`
  - Normaliza wrappers `{ plan }`, `{ executionPlan }`, `{ patch }`, `{ patches: [] }` e reparos seguros.
- Evidence/reports:
  - `src/application/services/evidence.service.ts`
  - `src/infra/persistence/report-renderer.ts`
  - Persistem logs, reports, screenshots/traces/videos conforme configuração.

## Fronteira Entre Core, Harness e Tools

O core define contratos declarativos e políticas. O harness executa interações reais no browser, mas fica encapsulado atrás do runtime. Tools são uma camada de orquestração segura sobre capacidades já existentes; elas não substituem o executor.

Fluxo permitido:

```txt
LLM / adapter externo
-> QaToolRegistry
-> tool pública segura
-> contrato declarativo / leitura / relatório
-> PlanExecutorService quando houver execução funcional
-> BrowserHarnessPort / PlaywrightHarness
```

Fluxo proibido:

```txt
LLM / adapter externo
-> click/fill/press/navigate tool pública
-> Playwright direto
```

## Regras de Segurança

- A LLM não pode executar Playwright diretamente.
- `click`, `fill`, `press`, `navigate` e equivalentes Playwright não serão expostos como tools públicas.
- O `PlanExecutorService` permanece a autoridade final para execução funcional.
- O `PlaywrightHarness` permanece encapsulado atrás do runtime e das portas de aplicação.
- Fallback factory, validações Zod e policies existentes não devem ser removidos.
- O core não deve depender diretamente de LangChain, Hermes ou MCP.
- Adapters para LangChain/Structured Tools/Hermes/MCP devem ficar em `src/infra/adapters/` ou camada equivalente de infraestrutura.

## Contrato base `QaTool`

A interface `QaTool` em `src/application/tools/qa-tool.ts` é o contrato base para qualquer capacidade registrada no `QaToolRegistry`.

Ela é genérica o suficiente para tools de planejamento, execução, observação, memória, evidência e reporting, mas mantém validação Zod de entrada/saída e separação segura entre tools públicas e capabilities internas.

```ts
export interface QaTool<I = unknown, O = unknown> {
  name: string;
  description: string;
  inputSchema: z.ZodType<I>;
  outputSchema?: z.ZodType<O>;
  internalOnly?: boolean;
  execute(input: I, context: QaToolContext): Promise<O>;
}
```

Campos do contrato:

- `name`: identificador único da tool, por exemplo `qa.plan.validate`;
- `description`: explicação clara para orquestradores/humanos;
- `inputSchema`: schema Zod obrigatório para validar entrada;
- `outputSchema`: schema Zod opcional para validar retorno;
- `internalOnly`: indica que a tool não pode ser exposta publicamente por padrão;
- `execute`: função assíncrona que recebe input validado e `QaToolContext`.

Esse contrato fica em `src/application/tools`, não importa Playwright diretamente e não depende diretamente de LangChain, Hermes ou MCP.

## Contexto controlado `QaToolContext`

A interface `QaToolContext` em `src/application/tools/qa-tool-context.ts` fornece informações úteis e controladas para execução de uma tool registrada no `QaToolRegistry`, sem entregar acesso irrestrito ao runtime ou ao Playwright.

Estrutura atual:

```ts
export interface QaToolContext {
  runId?: string;
  runDir?: string;
  scenarioId?: string;
  taskId?: string;
  config?: RunConfig;
  metadata?: Record<string, unknown>;
}
```

Campos atuais:

- `runId`: identificador da run atual;
- `runDir`: diretório da run atual, usado por artifacts/evidências/reports;
- `scenarioId`: identificador do cenário em execução;
- `taskId`: identificador da task em execução;
- `config`: `RunConfig` validado, quando disponível;
- `metadata`: canal controlado para dependências/capabilities injetadas pelo runtime nativo.

O contexto pode ser expandido futuramente com campos como `projectId`, `workspaceRoot`, `artifactDir`, `memoryContext`, `providerContext` e `logger`.

O contexto não deve incluir diretamente:

- `page` do Playwright;
- `browser context` do Playwright;
- funções soltas de `click`, `fill`, `press` ou `navigate`;
- API direta de `PlaywrightHarness`;
- qualquer execução livre de DOM/script arbitrário.

Quando uma tool precisar acessar capacidades do runtime, isso deve acontecer por meio de `metadata` com dependências controladas e tipadas no ponto de uso, preservando a separação entre orchestration e runtime.

## Ações Playwright não expostas

Ações diretas de browser/Playwright nunca devem ser tools públicas do `QaToolRegistry`.

Essa regra preserva a segurança da v0.2-stable/v0.2.5, evitando que a LLM volte a operar como gerador/executor direto de ações no browser.

As ações abaixo são proibidas como tools públicas:

- `click`
- `fill`
- `press`
- `navigate`
- `selectOption`
- `uploadFile`
- `dragAndDrop`
- `evaluate`
- qualquer ação de DOM/script arbitrário

No projeto atual, o `QaToolRegistry` já bloqueia explicitamente tools públicas com os nomes:

- `click`
- `fill`
- `press`
- `navigate`

As demais ações diretas de browser listadas acima devem seguir a mesma regra arquitetural: não podem ser expostas como tools públicas.

Essas ações só podem existir dentro do runtime guardado:

```txt
ExecutionPlan
-> Zod/schema
-> semantic policy
-> PlanExecutorService
-> BrowserHarnessPort / PlaywrightHarness
-> Evidence/Reports
```

A LLM só pode sugerir `ExecutionPlan` ou `PlanPatch`. O plano/patch passa por validação, a execução real é do `PlanExecutorService`, e o `PlaywrightHarness` é infraestrutura, não ferramenta pública.

## Tools Públicas Iniciais

As primeiras tools públicas são macro tools. Elas podem ser chamadas por orquestrador, LangChain, Hermes, MCP ou fluxo nativo, mas nunca representam ações atômicas de browser.

- `qa.plan.validate`
  - Status: implementada.
  - Valida um `ExecutionPlan` contra `ExecutionPlanSchema`.
  - Uso: validar plano antes de executar, validar output de LLM, depurar erros de schema e retornar `{ ok, issues }`.
  - Não abre browser, não resolve locator, não executa Playwright e não altera estado da aplicação.
- `qa.screen.observe`
  - Status: implementada como macro tool dependente de browser no contexto.
  - Retorna uma `ScreenObservation` controlada da tela atual.
  - Opções: `includeDom`, `includeScreenshot`, `includeAccessibilityTree`.
  - Não executa ação.
- `qa.plan.build`
  - Status: implementada como macro tool dependente de `ExecutionPlanPlannerService` no contexto.
  - Gera ou solicita um `ExecutionPlan` a partir de config, demanda e cenários.
  - Usa provider LLM/factory, normalização, Zod e policy.
  - Não executa o plano.
- `qa.plan.replan`
  - Status: implementada como macro tool dependente de `PlanReplannerService` no contexto.
  - Solicita um `PlanPatch` quando uma etapa falhar.
  - Respeita `basePlanId`, `basePlanVersion`, `PlanPatchSchema` e policy contra weakening via `PlanPatchApplierService`.
  - Não aplica patch sem validação.
- `qa.plan.execute`
  - Status: implementada como macro tool dependente de `PlanExecutorService` no contexto.
  - Executa um `ExecutionPlan` validado.
  - Respeita preconditions, actions declarativas, quiescence, postconditions e assertions.
  - Não aceita action solta como input.
- `qa.evidence.record`
  - Status: implementada como macro tool dependente de `EvidenceService` no contexto.
  - Registra evidências da execução, respeitando `runDir` e config de output do runtime.
  - Retorna paths/artifacts gerados pelo serviço de evidência.
- `qa.report.generate`
  - Status: implementada como macro tool dependente de `ReportRunUseCase` no contexto.
  - Gera ou recupera relatório de uma run existente em `md` ou `json`.
  - Não executa browser.
- `qa.spec.export`
  - Status: implementada como macro tool dependente de `PlaywrightSpecExporter` no contexto.
  - Exporta `.spec.ts` pós-execução a partir de `QaRunResult`/execution log.
  - Não participa do runtime e não executa browser.
- `qa.memory.search`
  - Status: implementada como busca textual simples.
  - Busca memória/contexto do projeto em arquivo versionado, por padrão `.agent-qa/memory.md`.
  - Pode evoluir para chunks BM25 sem mudar a fronteira de segurança.

Essas tools podem ser expostas para LLMs/adapters porque operam em nível macro ou leitura controlada. Nenhuma delas expõe `click`, `fill`, `press` ou `navigate`.

## Tools Internas Iniciais

Tools internas encapsulam capacidades do runtime, ficam marcadas com `internalOnly` e não devem ser exportadas para LangChain, Hermes, MCP ou orquestradores externos por padrão.

- `qa.condition.evaluate`
  - Status: implementada como internalOnly.
  - Avalia `PlanCondition` e gera resultado equivalente a `ConditionEvaluationResult`.
  - Uso: preconditions, postconditions e business assertions.
  - Não é pública porque expõe detalhes internos do executor.
- `qa.element.ensureAvailable`
  - Status: implementada como internalOnly.
  - Usa `ElementAvailabilityResolver` para tentar tornar um elemento disponível sob policy.
  - Não é pública porque poderia induzir exploração indevida da UI.
- `qa.locator.resolve`
  - Status: implementada como internalOnly.
  - Resolve `LocatorDescriptor` contra a `ScreenObservation` atual.
  - Trabalha com `el_*` efêmero e nunca deve persistir esses IDs.
  - Não é pública porque locator resolution é detalhe do runtime.
- `qa.action.executeInternal`
  - Status: implementada como internalOnly.
  - Executa uma action já validada dentro das fronteiras do runtime.
  - Chamada apenas pelo runtime; nunca por LLM diretamente.
  - Respeita action schema e `ActionPolicyService` quando fornecido.
- `qa.quiescence.wait`
  - Status: implementada como internalOnly.
  - Aguarda estabilidade de DOM/rede/UI após uma action.
  - Registra resultado de quiescence; timeout não deve virar bug isoladamente.

Mesmo internas, essas tools devem respeitar schemas e policies existentes. Elas não expõem execução livre de Playwright.

## Base Implementada

A base mínima fica em:

- `src/application/tools/qa-tool.ts`
- `src/application/tools/qa-tool-context.ts`
- `src/application/tools/qa-tool-registry.ts`
- `src/application/tools/built-in/plan-validation.tool.ts`
- `src/application/tools/built-in/contracts.ts`
- `src/application/tools/built-in/public-tools.ts`
- `src/application/tools/built-in/internal-tools.ts`
- `src/application/tools/built-in/condition-evaluator.ts`
- `src/application/tools/built-in/support.ts`

O `QaToolRegistry` registra tools, lista apenas públicas por padrão, valida input/output com Zod e bloqueia registro público de actions Playwright diretas.

Tools implementadas:

- `qa.plan.validate`
- `qa.screen.observe`
- `qa.plan.build`
- `qa.plan.replan`
- `qa.plan.execute`
- `qa.evidence.record`
- `qa.report.generate`
- `qa.spec.export`
- `qa.memory.search`
- `qa.condition.evaluate` (`internalOnly`)
- `qa.element.ensureAvailable` (`internalOnly`)
- `qa.locator.resolve` (`internalOnly`)
- `qa.action.executeInternal` (`internalOnly`)
- `qa.quiescence.wait` (`internalOnly`)

## Critério de Evolução

Deve evoluir adicionando adapters e tools concretas sem alterar o contrato central:

```txt
Tools sugerem, leem, validam ou orquestram.
PlanExecutorService executa.
PlaywrightHarness permanece encapsulado.
```
