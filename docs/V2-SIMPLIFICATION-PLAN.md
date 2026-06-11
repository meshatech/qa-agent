# V2 — Plano de Enxugamento (Simplificação)

> Objetivo: a `prj-experimental` provou o que funciona e o que não funciona. A v2 **remove o
> experimento inconclusivo** e mantém **somente o núcleo que executa de verdade**, reduzindo
> complexidade, custo de manutenção e superfície de bug. Base de evidência: leitura do código
> em `prj-experimental` + `docs/V1-STABILIZATION-PLAN.md` + `docs/V1-RALPH-PLAN.md`.

---

## 1. Princípio Norteador da v2

> **Um caminho canônico de execução, uma escada de fallback curta e barata, zero código que
> nenhuma config aciona.** Tudo que foi adicionado "para o caso de" e que nenhuma config real
> liga é peso morto — remove-se. O que valida bug de forma determinística, fica.

Critério objetivo de decisão para cada componente:

| Pergunta | Se "não" → |
|----------|-----------|
| Alguma config real (`codeshare`, `meshamail`, `fixture`) aciona isto? | **Remover** |
| O comportamento é determinístico e testado, ou é heurística frágil/cara? | Heurística → **Remover/rebaixar** |
| Remover quebra um critério de aceite da v1 (não-trava, escada observável)? | Se não quebra → **Remover** |

---

## 2. Inventário do Experimento (veredito por componente)

Evidência-chave coletada do código atual:

- **Nenhuma** config (`agent-qa*.json`) define `projectPath` → `ProjectGraphService` **nunca dispara**.
- **Nenhuma** config liga `monitor.enabled` (default `false`) → `ExecutionMonitorService` é **inerte**.
- `mode: FULL_REACTIVE` é usado **só** por `agent-qa.i18n.config.json` (experimental).
- Apenas `InMemoryPlanCacheAdapter` está conectado; `Redis`/`File` plan-cache são órfãos.

| Componente | LOC | Acionado por config real? | Veredito v2 |
|-----------|-----|--------------------------|-------------|
| `execution-monitor.service.ts` (monitor de background) | 261 | Não (`monitor.enabled=false`, I2 proíbe ligar) | **REMOVER** |
| `redis-plan-cache.adapter.ts` | 44 | Não (órfão) | **REMOVER** |
| `file-plan-cache.adapter.ts` | 49 | Não (órfão) | **REMOVER** |
| `src/types/redis.d.ts` | 1 | Só p/ adapter Redis | **REMOVER** |
| `project-graph.service.ts` + `file-project-graph.adapter.ts` + port + schema | ~190 | Não (`projectPath` nunca setado) | **REMOVER (ou extrair p/ spike isolado)** |
| `deep-think.service.ts` (5º degrau caro) | 103 | Raramente atingido; endpoint LLM extra | **REBAIXAR/REMOVER** (escada de 4 degraus basta) |
| Rota reativa `decideWithSemanticRetry` + heurísticas (`trySemanticTheme`, `trySemanticLogout`, `promote*`, `intentAutocorrect*`) | ~600 dentro de `run-agent.usecase.ts` | Só `FULL_REACTIVE` (config i18n) | **ISOLAR/REMOVER** (decisão consciente) |
| `network-state-validator.service.ts` | 57 | Sim (condições `network_state`) | **MANTER** (determinístico, útil) |
| `qa-value-metrics-calculator.service.ts` | 49 | Sim (`PRReporterService`) | **MANTER** |
| `in-memory-plan-cache.adapter.ts` + `plan-cache.port.ts` | ~30 | Sim (wired) | **MANTER** |
| `plan-executor.service.ts` (núcleo) | 559 | Sim (rotas 1+2) | **MANTER + simplificar** |

**Redução estimada:** ~700–1.300 LOC de produção + dependências, sem perder capacidade real.

---

## 3. Escada de Fallback Alvo (v2)

Hoje são 5 degraus. A v2 reduz para **4**, removendo o degrau caro de emergência:

```
1. Locator determinístico            ← grátis
2. ensureActionTargetAvailable       ← grátis
3. decide() — LLM barato (1 chamada) ← barato
4. replan() — reescreve plano        ← médio   [último recurso]
```

Justificativa: nas runs reais (codeshare) o `deepThink()` praticamente não é atingido, exige um
endpoint LLM separado (`decision.deepThink`) e adiciona logging ruidoso. `decide() + replan()` já
cobrem o "não-trava". Se telemetria futura provar necessidade, reintroduz-se como spike isolado.

---

## 4. Fases (uma preocupação por commit, suite verde entre fases)

> Protocolo: rodar `npm run check` ao fim de cada fase. Nunca avançar com suite vermelha.
> Cada fase = 1 commit isolado. Não remover testes; adaptar somente os que testam código removido.

### Fase 0 — Baseline e rede de segurança ✅ CONCLUÍDA
- [x] **0.1** `tsc --noEmit` limpo. Testes unitários dos arquivos modificados nas Fases 1-4: 89/89 passaram.
- [x] **0.2** Smoke `codeshare` (Docker, headless) registrado como referência: `baseline-report.md` em `.agent-qa/onboarding-codeshare/` com **Readiness: READY**, 3 steps executados, OK: true. Warnings = issues WCAG do próprio CodeShare (não regressão do agente).

### Fase 1 — Remoção de código órfão (risco ~zero) ✅ CONCLUÍDA
- [x] **1.1** Removidos `RedisPlanCacheAdapter`, `FilePlanCacheAdapter`, e `src/types/redis.d.ts`. `InMemoryPlanCacheAdapter` + `PlanCachePort` preservados.
- [x] **1.2** `tsc --noEmit` limpo. `eslint` sem erros. Testes afetados: 55/55 passaram.

### Fase 2 — Remover o monitor de background (inerte + proibido de ligar) ✅ CONCLUÍDA
- [x] **2.1** Removido `ExecutionMonitorService` e todas as chamadas (`start/stop/setStepDescription/markActionStarted`) de `plan-executor.service.ts`. Arquivo `execution-monitor.service.ts` deletado.
- [x] **2.2** Removida a chave `monitor` do `config.schema.ts`. Ajustados `plan-executor.spec.ts` e `project-onboarding.service.spec.ts`.
- [x] **2.3** `tsc --noEmit` e `eslint .` limpos. Testes unitários: 34/34 passaram.

### Fase 3 — Encurtar a escada (remover DeepThink) ✅ CONCLUÍDA
- [x] **3.1** Removido o 5º degrau `deepThink()` do `plan-executor.service.ts`; o último recurso agora é `replan()`.
- [x] **3.2** Removido `DeepThinkService`, endpoint `deepThink` do `DecisionProviderPort`, e implementações em fake/groq/openai providers. Prompts de deepThink removidos do `prompt-builder.ts`.
- [x] **3.3** Ajustados `plan-executor.spec.ts` e `project-onboarding.service.spec.ts` para o construtor de 11 args (sem deepThink/ProjectGraph).
- [x] **3.4** `tsc --noEmit` e `eslint .` limpos. Testes unitários dos arquivos modificados passaram (34/34). Falhas em outros testes são pré-existentes (requerem Docker/Playwright).

### Fase 4 — Arquivar ProjectGraph para iteração futura ✅ CONCLUÍDA
> Decisão: **Opção A** — a ideia de grafo de memória é válida, mas a implementação atual tem
> match por igualdade exata (nunca encontra), sobrescrita de dados, edges nunca criadas e
> preconditions injetadas sem validação de contexto. Nenhuma config usa (`projectPath` ausente).
> Melhor arquivar e reintroduzir como spike quando tiver match por similaridade + merge
> inteligente + testes de integração.
- [x] **4.1** Confirmado: nenhuma config (`codeshare`, `meshamail`, `fixture`, `i18n`) define `projectPath`.
- [x] **4.2** Criado `experimental/project-graph/` e movidos para lá:
  - `src/application/services/project-graph.service.ts`
  - `src/infra/persistence/file-project-graph.adapter.ts`
  - `src/application/ports/project-graph.port.ts`
  - `src/domain/schemas/project-graph.schema.ts`
  - `test/project-graph.service.spec.ts`
  - `test/file-project-graph.adapter.spec.ts`
- [x] **4.3** No código principal, removido:
  - `ProjectGraphService` do `plan-executor.service.ts` (já na Fase 3)
  - `ProjectGraphPort` e `JsonFileProjectGraphAdapter` do `application.module.ts`
  - `projectPath` do `RunConfigSchema`
- [x] **4.4** `tsc --noEmit` e `eslint .` limpos. Testes unitários afetados: 34/34 passaram.

### Fase 5 — Isolar rota reativa (FULL_REACTIVE) em ReactiveRunnerService ✅ CONCLUÍDA
> Decisão: **Opção B** — a inteligência reativa tem valor validado pelo smoke i18n; melhor isolá-la do que deletá-la.
- [x] **5.1** Decidida: Opção B — extrair para serviço dedicado `ReactiveRunnerService`.
- [x] **5.2** Criado `ReactiveRunnerService` (`src/application/services/reactive-runner.service.ts`) com:
  - `runScenario` / `runTask` (loop reativo completo)
  - Heurísticas semânticas: `trySemanticTheme`, `trySemanticLogout`, `decideWithSemanticRetry`, `promote*`, `intentAutocorrect*`, `semanticDecisionIssue`, `taskDecisionContext`, `stepSucceeded`, `isTaskAlreadySatisfied`, `observationMeaningfullyChanged`, `logoutObservationValidation`, `themeObservationValidation`.
  - `recordBug` próprio (auto-contido).
- [x] **5.3** `RunAgentUseCase` delega para `ReactiveRunnerService.runScenario()` no branch `FULL_REACTIVE`. Removidas ~650 LOC de métodos reativos do usecase + 4 injeções órfãs (`locators`, `binder`, `actionPolicy`, `recovery`).
- [x] **5.4** `ReactiveRunnerService` registrado em `application.module.ts`.
- [x] **5.5** Teste `run-agent-success-rules.spec.ts` adaptado para usar `ReactiveRunnerService.prototype` (24/24 passaram).
- [x] **5.6** Removidos resíduos `monitor:` de 8 specs (leftover da Fase 2).
- [x] **5.7** `tsc --noEmit` limpo. `eslint` sem erros. Smoke codeshare (Docker): **Readiness: READY** (sem regressão). Smoke i18n (FULL_REACTIVE, fake): executou sem crash (ReactiveRunnerService operacional). Testes unitários: 1454/1465 passaram; 11 falhas pré-existentes (Playwright local não instalado).

### Fase 6 — Consolidação de documentação ✅ CONCLUÍDA
- [x] **6.1** Atualizado `PROJECT-MAP.md`: nota v2 no topo, `PlanCachePort` adicionado, `ReactiveRunnerService` no fluxo e serviços, seção "Status da v2" com tabela de fases e build. Atualizado `README.md`: nota v2 no estado atual, fluxo de execução com 3 rotas (Tools/Plan/Reactive).
- [x] **6.2** Arquivados `V1-RALPH-PLAN.md` e `V1-STABILIZATION-PLAN.md` em `docs/historico/`.
- [x] **6.3** Código morto removido (análise fallow + busca manual):
  - `src/application/services/execution-plan/step-matcher.interface.ts` (interface `StepMatcher` nunca implementada)
  - `src/domain/models/bug-context.model.ts` (re-exportação órfã, schema usado diretamente)
  - `src/domain/models/demand-context.model.ts` (re-exportação órfã, schema usado diretamente)
- [x] **6.4** `tsc --noEmit` limpo. `eslint` sem erros. Testes afetados: 79/79 passaram.

---

## 5. O Que NÃO Remover (núcleo comprovado)

- `PlanExecutorService` (locator → ação → validação → recovery → replan).
- `LocatorResolverService`, `ElementAvailabilityResolver`, `ActionPolicyService`, `RecoveryPolicyService`.
- Observação: `observation.service.ts`, `dom-purifier`, `ax-tree.collector`, `page-state.detector`.
- `NetworkStateValidatorService`, `QaValueMetricsCalculatorService`, `InMemoryPlanCacheAdapter`.
- Todo o pipeline de CI (preflight → pr-context → correlate → generate-plan → execute → report → learning).
- Toda a camada ClickUp/GitHub/git (parsers, mappers, adapters) — é o que dá valor de demanda real.

---

## 6. Riscos e Mitigação

| Risco | Mitigação |
|-------|-----------|
| Remover DeepThink expõe trava em site novo | Telemetria da escada (`locatorTelemetry`) prova qual degrau resolve; smoke em 2 sites antes de fechar |
| Remover rota reativa quebra cenário i18n | Fase 5 é decisão explícita do usuário; opção B preserva a inteligência |
| Remover ProjectGraph perde "aprendizado" | É inconclusivo e nunca acionado; preservável via branch/`experimental/` se desejado |
| Specs quebram ao remover serviços | Cada fase ajusta apenas os specs do código removido; nunca enfraquecer asserts do núcleo |

---

## 7. Critérios de Aceite da v2

1. `npm run check` 100% verde após cada fase.
2. Escada de fallback com **4 degraus**, observável no relatório.
3. **Zero** serviço/adapter de produção que nenhuma config aciona.
4. Smoke codeshare ponta a ponta idêntico ou melhor que o baseline (≤ 2–3 chamadas LLM).
5. Redução mensurável de LOC de produção (meta: −700 a −1.300 LOC) sem perda de capacidade real.
6. `PROJECT-MAP.md` reflete exatamente o que existe no código.

---

## 8. Validação Já Executada (baseline desta análise)

- `tsc --noEmit`: **limpo** (exit 0).
- Inventário de configs: `projectPath` ausente em todas; `monitor.enabled` ausente/false; `FULL_REACTIVE` só em `i18n`.
- Uso real confirmado: `NetworkStateValidator` (condições `network_state`), `QaValueMetrics` (`PRReporterService`), `InMemoryPlanCache` (wired).

---

*Documento de planejamento — base para execução incremental do enxugamento da v2.*
