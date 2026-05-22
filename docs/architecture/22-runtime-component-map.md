# 22 - Runtime Core e Componentes

## Objetivo

Este documento mapeia a arquitetura real da v0.2-stable do Agent QA e a fronteira com a evolucao v0.2.5 via `QaToolRegistry`.

O foco e registrar responsabilidades atuais por componente, com base na implementacao em `src/application` e `src/infra`, sem alterar comportamento de runtime. Este documento complementa [`tool-registry-v0.2.5.md`](./tool-registry-v0.2.5.md).

## 1. Visao Geral

Fluxo principal atual:

```txt
CLI
  -> AgentController / AgentService
  -> RunAgentUseCase
  -> ScenarioPlannerService
  -> ExecutionPlanPlannerService / ExecutionPlanFactoryService
  -> PlanExecutorService
  -> BrowserHarnessPort / PlaywrightHarness
  -> EvidenceService / FileRunRepository / ReportRenderer
```

O `RunAgentUseCase` e o core operacional da run. Ele carrega config, aplica overrides, valida preflight, cria o diretorio da run, gera cenarios, constroi o `ExecutionPlan` quando aplicavel, abre o browser, executa o plano ou o loop reativo legado, finaliza metricas e persiste artefatos.

Quando `runtime.mode` nao e `FULL_REACTIVE`, o caminho preferencial atual e orientado por `ExecutionPlan`: `ExecutionPlanPlannerService` tenta obter um plano do provider LLM, valida schema e regras semanticas, e cai para `ExecutionPlanFactoryService` quando o plano e invalido ou inseguro. A execucao funcional desse plano passa por `PlanExecutorService`.

## 2. Component Map

| Componente | Responsabilidade                                                                                                                                                      | Arquivos principais                                                                                                                                                                             | Entradas                                                               | Saidas                                                                                                                                   | Dependencias                                                                                                    |
| ---------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------- |
| Core       | Orquestra CLI/use cases, config, lifecycle do browser, status, metricas e finalizacao da run.                                                                         | `src/interfaces/cli/agent.controller.ts`, `src/application/services/agent.service.ts`, `src/application/use-cases/run-agent.usecase.ts`                                                         | `RunAgentDto`, `RunConfig`, flags CLI, demand opcional                 | `QaRunResult`, run directory, status, metricas, artefatos finais                                                                         | Config loader, planners, executor, harness, repository, sanitizer, evidence                                     |
| Harness    | Encapsula Playwright atras de `BrowserHarnessPort`; observa tela, executa actions atomicas, valida expectativas, captura estado/runtime e evidencias brutas.          | `src/application/ports/browser-harness.port.ts`, `src/infra/playwright/playwright-harness.ts`                                                                                                   | `RunConfig`, `QaAction`, `BoundExpectedAfterAction`, `PlanCondition[]` | `ScreenObservation`, `ActionExecutionResult`, `AssertionResult`, `RuntimeStateSnapshot`, screenshot, DOM, network, console, trace, video | Playwright, `ObservationService`, `PlaywrightQuiescenceGuard`, `SignalsCollector`, `FormLoginService`           |
| Planner    | Cria o plano funcional em dois niveis: cenarios/tasks e plano executavel.                                                                                             | `src/application/services/scenario-planner.service.ts`, `src/application/services/execution-plan-planner.service.ts`, `src/application/services/execution-plan-factory.service.ts`              | `RunConfig`, `QaScenario[]`, respostas do `DecisionProviderPort`       | `QaScenario[]`, `ExecutionPlan`, `planSource`, `fallbackReason`                                                                          | `DecisionProviderPort`, schemas Zod, factory fallback                                                           |
| Replanner  | Solicita e aplica patches de plano quando a execucao encontra falhas recuperaveis.                                                                                    | `src/application/services/plan-replanner.service.ts`, `src/application/services/plan-patch-applier.service.ts`                                                                                  | `ReplanInput`, `ExecutionPlan`, `PlanPatch`, `RunConfig`               | `AppliedPlanPatch`, novo `ExecutionPlan`, historico de patch                                                                             | `DecisionProviderPort`, `PlanPatchSchema`, `ExecutionPlanSchema`, policy de patch                               |
| Executor   | Autoridade final de execucao funcional do plano. Resolve dados, locators e policies; executa actions; valida pre/postconditions e assertions; aciona recovery/replan. | `src/application/services/plan-executor.service.ts`                                                                                                                                             | `ExecutionPlan`, `RunConfig`                                           | `PlanExecutionResult`, `QaStep[]`, attempts, warnings, `patchHistory`, evaluations                                                       | Harness, locator resolver, data harness, action policy, availability resolver, recovery, task memory, replanner |
| Evidence   | Registra bugs e evidencias sanitizadas quando ha falha real ou recovery esgotado.                                                                                     | `src/application/services/evidence.service.ts`                                                                                                                                                  | `QaStep`, `ScreenObservation`, classificacao, attempts, config, runDir | `QaBug`, `bugs/<BUG-ID>/bug.json`, `bug-report.md`, screenshot, DOM, console, network, trace, video                                      | Harness, repository, sanitizer, `ReportRenderer`                                                                |
| Reports    | Persiste e renderiza artefatos humanos e JSON da run.                                                                                                                 | `src/infra/persistence/file-run.repository.ts`, `src/infra/persistence/run-directory.manager.ts`, `src/infra/persistence/report-renderer.ts`, `src/application/use-cases/report-run.usecase.ts` | `QaRunResult`, `RunConfig`, runDir/runId, formato `md` ou `json`       | `execution-report.md`, `run.json`, `qa-summary.json`, resposta de `report`                                                               | File system, `ReportRenderer`, repository port                                                                  |

## 3. Camadas e elegibilidade para tools

### Core / Domain

Responsabilidade: definir contratos, tipos, schemas Zod e regras de dominio que todos os outros blocos respeitam.

Componentes atuais:

- `ExecutionPlanSchema`, `ExecutionStepSchema` e `PlanPatchSchema` em `src/domain/schemas/execution-plan.schema.ts`.
- `PlanConditionSchema` e `PlanCondition`, que representam as condicoes de runtime atuais.
- `LocatorDescriptorSchema` e `LocatorDescriptor` em `src/domain/schemas/action.schema.ts`.
- `RuntimeErrorCode` em `src/domain/models/run.model.ts`.
- Status de cenario em `QaScenario.status`, tambem em `src/domain/models/run.model.ts`.

Regra de dependencia:

- Core/domain nao deve depender diretamente de LangChain, Hermes, MCP ou Playwright.
- Schemas e modelos podem ser usados por planner, replanner, executor, harness e tools, mas nao devem importar adaptadores externos.

Elegibilidade para tools:

- Pode ser usado por tools publicas de validacao e leitura, como `qa.plan.validate`.
- Nao executa browser e nao deve carregar dependencias de infraestrutura.

### Planner

Responsabilidade: criar, normalizar e validar planos antes de qualquer execucao funcional.

Componentes atuais:

- `ExecutionPlanPlannerService` em `src/application/services/execution-plan-planner.service.ts`.
- Providers `FakeDecisionProvider`, `GroqDecisionProvider` e `OpenAiLangChainDecisionProvider` em `src/infra/llm`.
- `LlmPlanPatchNormalizer` em `src/infra/llm/llm-output-normalizer.ts`, que normaliza wrappers e valida `ExecutionPlan`/`PlanPatch`.
- Validacao por `ExecutionPlanSchema` e policy semantica dentro de `ExecutionPlanPlannerService`.
- Fallback `buildPlan -> ExecutionPlanFactoryService` quando o plano LLM falha schema ou policy.

Elegibilidade para tools:

- Pode ser chamado por uma tool publica segura como `qa.plan.build`, desde que a saida continue passando por Zod e policy.
- A tool publica nao deve executar browser; ela deve apenas retornar plano validado, source e fallback reason quando aplicavel.

### Replanner

Responsabilidade: tratar falha parcial de execucao propondo e aplicando um patch seguro sobre o plano corrente.

Componentes atuais:

- `PlanReplannerService` em `src/application/services/plan-replanner.service.ts`.
- `PlanPatchApplierService` em `src/application/services/plan-patch-applier.service.ts`.
- Validacao de `basePlanId` e `basePlanVersion` contra o plano corrente.
- Policy contra weakening de validacoes: patch nao pode transformar step funcional em `CONTINUE_WITH_WARNING` fora dos casos permitidos, remover postconditions primarias ou remover assertions criticas.

Elegibilidade para tools:

- Pode ser chamado por uma tool publica controlada como `qa.plan.replan`, desde que receba plano, step falho, observacao reduzida, motivo e historico.
- O patch resultante deve continuar passando por `PlanPatchSchema`, `PlanPatchApplierService` e policies.

### Executor

Responsabilidade: executar plano funcional de ponta a ponta, mantendo ordem, policies, dados, locators, recovery e replan sob controle do runtime.

Componente central:

- `PlanExecutorService` em `src/application/services/plan-executor.service.ts`.

Regra de autoridade:

- `PlanExecutorService` deve continuar sendo a autoridade final de execucao.
- Uma tool pode chamar o executor em alto nivel, por exemplo `qa.plan.execute`.
- Nenhuma tool publica deve permitir actions soltas como `click`, `fill`, `press` ou `navigate`.

### Harness / Playwright

Responsabilidade: infraestrutura de browser e captura de estado real.

Componentes atuais:

- `BrowserHarnessPort` em `src/application/ports/browser-harness.port.ts`.
- `PlaywrightHarness` em `src/infra/playwright/playwright-harness.ts`.
- Acoes reais de browser, observacao de tela, `runtimeState`, screenshots, DOM snapshots, console/network logs, traces e videos.

Elegibilidade para tools:

- Harness nao deve ser exposto diretamente para LLM.
- Capacidades seguras podem virar tools macro ou internas, sempre mediadas por executor/policy.
- Actions Playwright diretas permanecem internas.

### Evidence / Reports

Responsabilidade: registrar artefatos, bugs, summaries, reports humanos e exports auxiliares.

Componentes atuais:

- `EvidenceService` em `src/application/services/evidence.service.ts`.
- `ReportRenderer`, `FileRunRepository` e `RunDirectoryManager` em `src/infra/persistence`.
- `ReportRunUseCase` em `src/application/use-cases/report-run.usecase.ts`.
- `PlaywrightSpecExporter` em `src/application/services/playwright-spec-exporter.service.ts`.

Artefatos relacionados:

- `scenario-report.md`
- `status.json`
- `execution-log.json`
- `generated-test.spec.ts`

Elegibilidade para tools:

- `qa.evidence.record` pode ser publica macro quando delega para `EvidenceService`, exige `runDir`/contexto de runtime e nao executa browser diretamente.
- `qa.spec.export` pode ser publica ou controlada se operar sobre `QaRunResult`/run existente, sem executar browser.
- `qa.report.generate` pode ser publica segura se apenas renderizar ou recuperar artefatos existentes.

## 4. Runtime Modes

`FULL_REACTIVE`

- Desativa o caminho de `ExecutionPlan` em `RunAgentUseCase`.
- Usa o loop reativo legado por `runScenario`/`runTask`: observe, decide, bind/resolve, execute, quiescence, reobserve, validate, recover.
- Ainda preserva as regras centrais de observation atual, data harness, action policy, recovery e evidencia.

`HYBRID_GUARDED`

- E o modo preferencial quando nao se quer `FULL_REACTIVE`.
- Usa `ScenarioPlannerService` para gerar `QaScenario/QaTask`.
- Usa `ExecutionPlanPlannerService` para tentar construir `ExecutionPlan` via provider LLM.
- Se o plano LLM falhar schema ou policy semantica, usa `ExecutionPlanFactoryService`.
- Executa via `PlanExecutorService`, com recovery e replan quando permitido.

`PLAN_AND_EXECUTE`

- Tambem usa `ExecutionPlan` como contrato de execucao.
- No executor, nao aciona replan dinamico: `tryReplan` retorna sem patch quando o modo e `PLAN_AND_EXECUTE`.
- Falhas seguem para recovery, warning ou bloqueio conforme `onFailure`, attempts e policy do step.

## 5. Data and Artifacts

Contratos principais:

- `RunConfig`: schema de configuracao em `src/domain/schemas/config.schema.ts`.
- `QaScenario` e `QaTask`: modelo funcional planejado em `src/domain/models/run.model.ts`.
- `ExecutionPlan` e `ExecutionStep`: contrato executavel em `src/domain/schemas/execution-plan.schema.ts`.
- `PlanPatch`: contrato de replan incremental em `src/domain/schemas/execution-plan.schema.ts`.
- `QaBug`: bug classificado e persistido em `src/domain/models/run.model.ts`.

Artefatos persistidos pela run atual:

- `generated-execution-plan.json`: plano gerado antes da execucao, ou cenarios quando nao ha plano.
- `execution-plan.json`: plano final sanitizado; no caminho com executor, pode refletir patches aplicados.
- `patch-history.json`: historico de patches aplicados pelo replanner.
- `execution-log.json`: steps, attempts, bugs, estatisticas LLM e runtime compacto.
- `run.json`: resultado completo da run com `schemaVersion`.
- `status.json`: status por cenario em `scenarios/<scenarioId>/status.json`.
- `scenario-report.md`: resumo humano por cenario.
- `execution-report.md`: relatorio humano final da run.
- `qa-summary.json`: resumo JSON da run.
- `generated-test.spec.ts`: spec Playwright exportada a partir do resultado.

Evidencias de bug ficam em `bugs/<BUG-ID>/`, incluindo `bug.json`, `bug-report.md`, `screenshot.png`, `dom-snapshot.html`, `console.log`, `network.json`, `observation.json`, `trace.zip` e `video.webm` quando disponiveis.

## 6. Runtime Authority

`PlanExecutorService` e a autoridade final de execucao funcional no caminho baseado em `ExecutionPlan`.

Isso significa:

- tools publicas nao devem executar Playwright diretamente;
- tools publicas nao devem expor actions atomicas como `click`, `fill`, `press` ou `navigate`;
- qualquer execucao funcional deve passar por plano declarativo, schema Zod, policies, resolucao de dados/locators, quiescencia, preconditions, postconditions e assertions;
- `PlaywrightHarness` permanece encapsulado atras de `BrowserHarnessPort`;
- `QaToolRegistry` pode validar, montar, ler, gerar ou orquestrar, mas nao deve substituir o executor como autoridade.

Essa fronteira e coerente com `QaToolRegistry`, que bloqueia registro publico de actions Playwright diretas como `click`, `fill`, `press` e `navigate`.

## 7. Tool Registry Impact

A v0.2.5 deve evoluir a camada de tools sem reescrever o runtime. O fluxo permitido continua:

```txt
LLM / adapter externo
  -> QaToolRegistry
  -> tool publica segura
  -> contrato declarativo / leitura / relatorio
  -> PlanExecutorService quando houver execucao funcional
  -> BrowserHarnessPort / PlaywrightHarness
```

Tools publicas candidatas:

- `qa.plan.validate`: valida um `ExecutionPlan` contra contrato Zod/policy sem abrir browser.
- `qa.plan.build`: gera ou solicita um `ExecutionPlan` validado.
- `qa.plan.replan`: solicita/aplica um `PlanPatch` controlado, respeitando `basePlanId`, `basePlanVersion` e policy contra weakening.
- `qa.plan.execute`: orquestra execucao de plano, delegando para `PlanExecutorService`.
- `qa.evidence.record`: registra evidencias pelo `EvidenceService`, respeitando contexto de runtime.
- `qa.memory.search`: consulta memoria/artefatos de run sem executar browser.
- `qa.report.generate`: gera ou recupera relatorios a partir de run existente.
- `qa.spec.export`: exporta spec a partir de resultado/run existente, sem controlar Playwright diretamente.

Tools internas candidatas:

- `qa.condition.evaluate`: avalia `PlanCondition` contra observacao/snapshot.
- `qa.element.ensureAvailable`: encapsula `ElementAvailabilityResolver` com policy.
- `qa.locator.resolve`: resolve `LocatorDescriptor` contra a observacao atual.
- `qa.action.executeInternal`: executa action ja validada dentro das fronteiras do runtime.
- `qa.quiescence.wait`: aguarda estabilidade apos uma action.

Nao expor como tools publicas:

- `click`
- `fill`
- `press`
- `navigate`

Essas actions permanecem como detalhes internos do executor/harness, sempre mediadas por plano, policy e validacao.

## 8. Known Gaps / Notes

- `doc/21-v0.1-implementation-structure.md` descreve uma estrutura planejada por modulos como `orchestrator`, `harness`, `locator`, `data`, `recovery` e `evidence`.
- A implementacao atual esta consolidada em servicos de `src/application` e adaptadores de `src/infra`, com injecao NestJS em `ApplicationModule` e `InfraModule`.
- Algumas responsabilidades planejadas como modulos separados existem hoje como services ou ports, nao como pastas/modulos dedicados.
- O caminho reativo legado ainda existe em `RunAgentUseCase`, mas o caminho preferencial para modos nao reativos usa `ExecutionPlan` e `PlanExecutorService`.
- O documento usa apenas nomes existentes no codigo atual para componentes de implementacao. Se specs antigas usarem nomes diferentes para os mesmos conceitos, prefira os nomes reais citados aqui: `PlanCondition`, `RuntimeErrorCode`, `QaScenario.status` e `EvidenceService`.
- A documentacao antiga continua util para contexto e intencao, mas nao deve ser usada como inventario fiel da implementacao atual quando divergir do codigo.

## 9. Source of Truth

Quando houver divergencia entre specs antigas e implementacao atual, prevalece o codigo em:

- `src/application`
- `src/infra`
- `src/domain/schemas`
- `src/domain/models`

Specs em `doc/` e documentos historicos devem ser lidos como contexto arquitetural e historico de decisoes, nao como fonte unica da implementacao.
