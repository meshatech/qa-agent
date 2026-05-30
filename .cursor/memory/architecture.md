# Arquitetura — agent-qa

## Camadas (Clean Architecture)

```
src/domain/       → modelos, schemas Zod, erros (sem deps de infra)
src/application/  → services, use cases, ports, QA tools
src/infra/        → Playwright, LLM, observação, persistência, config
src/interfaces/   → CLI (agent.controller.ts)
```

**DI NestJS**: `AppModule` → `InterfacesModule` → `ApplicationModule` → `InfraModule`

Mapa detalhado v0.2: `docs/architecture/`

## Loop runtime (reactive)

```
observe → LLM decide → act → quiescence → invalidate IDs → reobserve → validate → [recovery]
```

Lei completa: `doc/README.md`, fluxo: `doc/07-runtime-flow.md`

## Componentes principais

| Área | Responsabilidade |
|------|------------------|
| `ObservationService` + infra/observation | Snapshot da tela, AX tree, DOM purifier |
| `DecisionProviderPort` + infra/llm | Plano e próxima ação da LLM |
| `PlaywrightHarness` + QuiescenceGuard | Execução browser e espera de estabilidade |
| `RecoveryPolicyService` | Fallback e ações de emergência |
| `EvidenceService` + persistence | Runs, bugs, relatórios |
| `QaToolRegistry` | Tools built-in (observe, build plan, execute, replan, export spec) |
| `TaskMemoryService` | Memória **efêmera** por task durante a run |

## Mapa de services (`src/application/services/`)

Hub de orquestração: `RunAgentUseCase` (use case, não service — injeta todos abaixo).

| Service | Papel |
|---------|-------|
| `AgentService` | Fachada CLI → `RunAgentUseCase` |
| `ScenarioPlannerService` | Cenários a partir da demand |
| `ExecutionPlanPlannerService` | Plano Hybrid Guarded |
| `ExecutionPlanFactoryService` | Fallback factory |
| `PlanExecutorService` | Executa steps do plano |
| `PlanReplannerService` | Replan |
| `PlanPatchApplierService` | Patch de plano |
| `ActionPolicyService` | Política de ações |
| `DataHarnessService` | Placeholders dinâmicos |
| `LocatorResolverService` | Resolução de locators |
| `ElementAvailabilityResolverService` | Disponibilidade de elementos |
| `ValidationBinderService` | Validações com dados resolvidos |
| `RecoveryPolicyService` | Recovery e emergência |
| `BugClassifierService` | Severidade de bugs |
| `EvidenceService` | Artefatos de run/bug |
| `SanitizerService` | Sanitização de dados sensíveis |
| `TaskMemoryService` | Memória efêmera por task |
| `PlaywrightSpecExporterService` | Export spec experimental |
| `DemandDiffMemoryCorrelatorService` | Correlaciona demanda, diff PR e memória BM25 → cenários/riscos |
| `DemandContextPersistenceService` | Persiste `demand-context.json` via ClickUp |
| `PrDiffContextPersistenceService` | Persiste `pr-diff-context.json` via git diff |
| `PipelinePreflightService` | Preflight gate do pipeline PR |
| `MemorySearchService` | Busca BM25 em `.agent-qa/memory.md` |

Use cases: `RunAgentUseCase`, `ValidateConfigUseCase`, `InspectRunUseCase`, `ReportRunUseCase`, `CaptureAuthUseCase`, `RunPipelinePreflightUseCase`, `RunPrDiffContextUseCase`, `RunPipelinePrepareUseCase`, `RunPipelineCorrelateUseCase`.

## Saídas de uma run

Diretório em `output.runsDir`: `run.json`, `execution-log.json`, `metrics.json`, `execution-report.md`, etc. Bugs em `bugs/<BUG-ID>/` com screenshot, DOM, trace, video.

## Princípio

```
LLM decide. Harness executa. Orchestrator governa. Schemas validam. Evidence registra.
```
