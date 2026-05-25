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

## Registry central `QaToolRegistry`

O `QaToolRegistry` em `src/application/tools/qa-tool-registry.ts` é o registry central das tools do Agent QA.

Ele registra, busca, lista e executa tools de forma controlada, servindo como fundação para integrações futuras com LangChain, Hermes, MCP, orquestrador nativo e pipeline de PR.

Funcionalidades atuais:

- registra uma tool com `register`;
- registra várias tools com `registerMany`;
- busca tool por nome com `get`;
- verifica a existência acessível de uma tool com `has`;
- busca tool por nome com erro explícito usando `getOrThrow`;
- exige tool por nome com `require`, retornando erro explícito quando ausente ou inacessível;
- lista tools públicas por padrão com `list`;
- lista tools públicas explicitamente com `listPublic`;
- lista todas as tools, incluindo internas, com `listAll`;
- lista tools internas apenas quando `includeInternal: true`;
- executa tools com validação de input via `inputSchema`;
- valida output quando `outputSchema` existe;
- impede exposição pública de tools internas marcadas com `internalOnly`;
- bloqueia nomes perigosos já implementados para tools públicas.

O método `register` valida o contrato mínimo antes de inserir a tool no registry:

- `name` obrigatório e não vazio;
- `description` obrigatória e não vazia;
- `inputSchema` obrigatório;
- `execute` obrigatório;
- nome único no registry;
- suporte a `internalOnly`;
- bloqueio de nomes perigosos para tools públicas.

Busca por nome:

- `get(name)` retorna a tool quando ela existe e é pública;
- `get(name)` retorna `undefined` quando a tool não existe;
- `get(name)` retorna `undefined` para tool interna quando `includeInternal` não for informado;
- `get(name, { includeInternal: true })` permite buscar tool interna;
- `has(name)` retorna `true` quando a tool existe e é acessível;
- `has(name)` retorna `false` quando a tool não existe ou é interna sem `includeInternal`;
- `has(name, { includeInternal: true })` permite verificar tool interna;
- `getOrThrow(name)` retorna a tool quando ela existe e é acessível;
- `getOrThrow(name)` lança erro claro quando a tool não existe ou não está acessível;
- `require(name)` permanece como alias compatível de `getOrThrow(name)`.

Listagem e execução de internas:

- `list()` e `listPublic()` omitem tools internas por padrão;
- `list({ includeInternal: true })` e `listAll()` incluem tools internas;
- adapters externos devem usar a listagem pública por padrão;
- `execute(name, input, context)` bloqueia tool interna por padrão;
- `execute(name, input, context, { includeInternal: true })` permite execução interna controlada.

## Adapter estrutural para tools

O adapter inicial fica em `src/infra/adapters/structured-tool.adapter.ts`.

Ele converte uma `QaTool` pública para um formato estrutural compatível com orquestradores externos sem acoplar o core diretamente a LangChain, Hermes ou MCP:

```ts
export interface StructuredToolLike {
  name: string;
  description: string;
  schema: unknown;
  invoke(input: unknown): Promise<unknown>;
}
```

Regras do adapter:

- recebe uma `QaTool`;
- retorna `undefined` para tools `internalOnly` por padrão;
- expõe `name`, `description` e `inputSchema` como `schema`;
- encapsula `execute` por meio de `invoke`;
- valida input com `inputSchema` antes de executar;
- valida output com `outputSchema` quando existir;
- retorna resposta serializável;
- não importa Playwright;
- não importa LangChain;
- fica em `src/infra/adapters`, preservando o core desacoplado.

## Adapter LangChain

O adapter LangChain real fica em `src/infra/adapters/langchain-tool.adapter.ts`.

Ele usa `DynamicStructuredTool` de `@langchain/core/tools` para converter uma `QaTool` pública em uma structured tool real do LangChain, mantendo a dependência restrita à camada de infraestrutura.

Regras do adapter LangChain:

- recebe uma `QaTool`;
- retorna `undefined` para tools `internalOnly` por padrão;
- expõe `name` e `description`;
- usa `inputSchema` como `schema` da `DynamicStructuredTool`;
- encapsula `execute` por meio de `invoke`;
- valida input com `inputSchema` antes de executar;
- valida output com `outputSchema` quando existir;
- recebe `QaToolContext` de forma controlada por opção;
- retorna resposta serializável;
- não importa Playwright;
- não altera `QaTool`, `QaToolContext` ou `QaToolRegistry`;
- mantém o core desacoplado de LangChain.

Nomes perigosos bloqueados hoje para registro público:

- `click`
- `fill`
- `press`
- `navigate`
- `selectOption`
- `uploadFile`
- `dragAndDrop`
- `evaluate`
- `playwright.click`
- `playwright.fill`
- `playwright.press`
- `playwright.navigate`
- `playwright.selectOption`
- `playwright.uploadFile`
- `playwright.dragAndDrop`
- `playwright.evaluate`

Regra arquitetural para demais ações diretas de browser:

- qualquer ação de DOM/script arbitrário

Ações de DOM/script arbitrário também não devem ser expostas como tools públicas. Se forem adicionadas ao runtime no futuro, devem seguir a mesma regra de bloqueio público ou permanecer internas.

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
- `selectOption`
- `uploadFile`
- `dragAndDrop`
- `evaluate`

Além disso, variantes com prefixo `playwright.` desses mesmos nomes também são bloqueadas para registro público.

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
  - Arquivo: `src/application/tools/built-in/observe_screen.tool.ts`.
  - Retorna uma `ScreenObservation` controlada da tela atual.
  - Opções: `includeDom`, `includeScreenshot`, `includeAccessibilityTree`, `includeUrl`, `includeConsoleSummary`.
  - Não executa ação, não navega, não executa script no DOM e não expõe `page` do Playwright.
- `qa.plan.build`
  - Status: implementada como macro tool dependente de `ExecutionPlanPlannerService` no contexto.
  - Arquivo: `src/application/tools/built-in/build_execution_plan.tool.ts`.
  - Gera ou solicita um `ExecutionPlan` a partir de config, demanda e cenários.
  - Aceita `scenarios`, `config`, `memoryContext`, `demandContext`, `screenObservation` e `runtimeMode`.
  - Delega para `ExecutionPlanPlannerService`, preservando provider LLM/factory, normalização por provider, validação Zod, policy semântica e fallback para factory.
  - Retorna `plan`, `planSource`, `fallbackReason` e `fallbackWarning` quando aplicável.
  - Não executa o plano, não aplica patch, não executa Playwright e não aceita `el_*`/`targetElementId` fora do contrato validado.
- `qa.plan.replan`
  - Status: implementada como macro tool dependente de `PlanReplannerService` no contexto.
  - Arquivo: `src/application/tools/built-in/request_replan.tool.ts`.
  - Solicita um `PlanPatch` quando uma etapa falhar.
  - Aceita `replanReason`, `currentPlan`, `failedStep`, `failedCondition`, `currentObservation`, `executionContext` e `patchHistory`, além dos aliases internos `plan`, `observation`, `reason` e `history`.
  - Delega para `PlanReplannerService`, preservando `PlanPatchSchema`, `basePlanId`, `basePlanVersion` e policy contra weakening via `PlanPatchApplierService`.
  - Retorna patch validado/status de aplicação ou falha controlada quando o replan é inválido/bloqueado.
  - Não aplica patch fora do fluxo do runtime, não executa action solta e não executa Playwright.
- `qa.plan.execute`
  - Status: implementada como macro tool dependente de `PlanExecutorService` no contexto.
  - Arquivo: `src/application/tools/built-in/execute_execution_plan.tool.ts`.
  - Executa um `ExecutionPlan` validado.
  - Aceita `plan`, `runConfig`/`config`, `scenarioId`, `outputConfig` e `planRef` seguro.
  - Delega para `PlanExecutorService`, preservando o fluxo `ExecutionPlan -> Preconditions -> LocatorResolver -> ActionHarness interno -> Quiescence -> Postconditions -> BusinessAssertions -> Evidence/Reports`.
  - Retorna `executionResult`, `scenarioFinalStatus`, `warnings`, `bugs`, `artifacts` e `executionLogPath` quando disponível.
  - Não aceita action solta como input; payloads top-level como `{ "action": "click", "target": "button Salvar" }`, `{ "type": "fill", "selector": "#email", "value": "teste" }`, `{ "press": "Enter" }` e `{ "navigate": "https://..." }` devem ser rejeitados.
  - Actions diretas de browser só podem existir dentro de `ExecutionStep -> QaActionSchema -> ExecutionPlanSchema -> PlanExecutorService`; a tool pública não expõe `PlaywrightHarness`, não expõe `page`, não ignora policies e não faz bypass de pre/postconditions.
- `qa.evidence.record`
  - Status: implementada como macro tool dependente de `EvidenceService` no contexto.
  - Arquivo: `src/application/tools/built-in/record_evidence.tool.ts`.
  - Registra evidências da execução, respeitando `runDir` e config de output do runtime.
  - Aceita `runId`, `scenarioId`, `reason`, `status`, `includeScreenshot`, `includeVideo`, `includeTrace`, `includeDomSnapshot`, `includeConsoleLog`, `includeNetworkLog`, `outputConfig` e payload `evidence` do runtime.
  - Delega para `EvidenceService.record`, que encapsula captura/sanitização de screenshot, DOM, console, network, trace, video e reports.
  - Retorna `evidenceBundle`, `artifactPaths` e `relativePaths`.
  - Mascara textos sensíveis no motivo recebido e não executa ações diretas de browser, não navega e não expõe `PlaywrightHarness`/`page`.
- `qa.report.generate`
  - Status: implementada como macro tool dependente de `ReportRunUseCase` no contexto.
  - Gera ou recupera relatório de uma run existente em `md` ou `json`.
  - Não executa browser.
- `qa.spec.export`
  - Status: implementada como macro tool dependente de `PlaywrightSpecExporter` no contexto.
  - Arquivo: `src/application/tools/built-in/export_playwright_spec.tool.ts`.
  - Exporta `.spec.ts` pós-execução a partir de `executionLogPath` ou `QaRunResult`.
  - Aceita `executionLogPath`, `runId`, `scenarioId`, `sanitizeSensitiveData` e `outputPath`.
  - Retorna `generatedSpecPath` e `warnings`.
  - Marca o export como experimental, sanitiza dados sensíveis quando configurado e não participa do runtime.
  - Não executa browser, não reexecuta o spec gerado e não expõe `PlaywrightHarness`/`page`.
- `qa.memory.search`
  - Status: implementada com chunks Markdown tipados e ranking BM25.
  - Busca memória/contexto do projeto em `.agent-qa/memory.md` (ou `memoryPath` explícito).
  - Aceita `projectPath`, `query`, `limit`, `types` e retorna `chunks[]` com `relevanceScore` e `warnings[]`.

Essas tools podem ser expostas para LLMs/adapters porque operam em nível macro ou leitura controlada. Nenhuma delas expõe `click`, `fill`, `press` ou `navigate`.

## Tools Internas Iniciais

Tools internas encapsulam capacidades do runtime, ficam marcadas com `internalOnly` e não devem ser exportadas para LangChain, Hermes, MCP ou orquestradores externos por padrão.

- `qa.condition.evaluate`
  - Status: implementada como internalOnly.
  - Arquivo: `src/application/tools/built-in/evaluate_condition.tool.ts`.
  - Avalia `PlanCondition` e gera resultado equivalente a `ConditionEvaluationResult`.
  - Aceita `condition`, `currentObservation`, `beforeState`, `afterState` e `runContext`, mantendo compatibilidade com os aliases internos `observation`, `before` e `after`.
  - Suporta preconditions, postconditions, business assertions e condições de runtime como `ui_state`, `auth_state`, `menu_state`, `route_state`, `attribute_state` e `storage_state`.
  - Retorna `conditionId`, `type`, `passed`, `expected`, `actual`, `before`, `after`, `severity` e `reason`.
  - Não é pública porque expõe detalhes internos do executor e não deve ser exportada para adapters externos por padrão.
- `qa.element.ensureAvailable`
  - Status: implementada como internalOnly.
  - Arquivo: `src/application/tools/built-in/ensure_element_available.tool.ts`.
  - Usa `ElementAvailabilityResolver` para tentar tornar um elemento disponível sob policy.
  - Aceita `target`, `currentObservation`, `availabilityPolicy` e `runContext`, mantendo compatibilidade com os aliases internos `observation` e `policy`.
  - Preserva o fluxo: resolver locator direto, verificar policy, abrir somente container permitido, aguardar quiescence no resolver, reobservar e tentar resolver novamente.
  - Retorna o resultado estruturado do resolver com motivos como `FOUND_DIRECTLY`, `FOUND_AFTER_OPEN_CONTAINER`, `NOT_FOUND`, `POLICY_DISABLED` e `MAX_ATTEMPTS_EXCEEDED`.
  - Bloqueia policies com ações genéricas/arbitrárias de abertura como `clickOutside`, `clickAtCoordinates`, `navigate` e `fill`.
  - Não é pública porque poderia induzir exploração indevida da UI e não deve ser exportada para adapters externos por padrão.
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

## Status da Entrega

Checklist consolidado da entrega no estado atual do projeto:

- tools macro seguras registradas no `QaToolRegistry`;
- tools internas registradas com `internalOnly`;
- `list()` e `listPublic()` ocultam tools internas por padrão;
- adapters externos também ocultam tools `internalOnly` por padrão;
- actions Playwright diretas como `click`, `fill`, `press`, `navigate` e equivalentes não aparecem no catálogo público;
- `qa.plan.build`, `qa.plan.replan` e `qa.plan.execute` reutilizam `ExecutionPlanPlannerService`, `PlanReplannerService` e `PlanExecutorService`;
- `qa.plan.execute` não aceita action solta e só executa `ExecutionPlan` validado;
- o runtime `v0.2-stable` permanece funcional com `typecheck`, `test`, `lint` e `build` passando no estado atual validado.

## Critério de Evolução

Deve evoluir adicionando adapters e tools concretas sem alterar o contrato central:

```txt
Tools sugerem, leem, validam ou orquestram.
PlanExecutorService executa.
PlaywrightHarness permanece encapsulado.
```
