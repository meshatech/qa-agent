# De/Para — agent-qa (Estado Atual)

> Mapeamento completo da arquitetura, fluxos, componentes e status de implementação.
> **Nota (v2 simplificado):** Runtime enxugado nas Fases 1-5. Removidos: `ExecutionMonitorService`, `DeepThinkService`, `RedisPlanCacheAdapter`, `FilePlanCacheAdapter`, `redis.d.ts`. Arquivado: `ProjectGraphService` (experimental/). Isolado: rota reativa (`FULL_REACTIVE`) em `ReactiveRunnerService`. Veja `docs/V2-SIMPLIFICATION-PLAN.md`.

---

## 1. Arquitetura — Clean Architecture (4 camadas)

```
┌─────────────────────────────────────────────────────────────────┐
│  INTERFACES (CLI / Controllers)                                  │
│  AgentController → AgentService → Use Cases                     │
├─────────────────────────────────────────────────────────────────┤
│  APPLICATION (casos de uso + serviços + ports)                    │
│  UseCases → Services → Ports (interfaces abstratas)             │
├─────────────────────────────────────────────────────────────────┤
│  DOMAIN (modelos + schemas + regras de negócio)                   │
│  Zod schemas, tipos, erros de domínio                            │
├─────────────────────────────────────────────────────────────────┤
│  INFRAESTRUTURA (implementações concretas)                       │
│  PlaywrightHarness, GroqDecisionProvider, FileSystemRepo, etc   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 2. Ports (contratos) → Implementações

| Port | Arquivo | Implementação | Responsabilidade |
|---|---|---|---|
| `BrowserHarnessPort` | `src/application/ports/browser-harness.port.ts` | `PlaywrightHarness` | Abrir browser, observar tela, executar ações, validar, screenshot, traces |
| `DecisionProviderPort` | `src/application/ports/decision-provider.port.ts` | `GroqDecisionProvider`, `FakeDecisionProvider` | LLM: planejar, decidir, replanear, classificar outcomes |
| `RunRepositoryPort` | `src/application/ports/run-repository.port.ts` | `FileSystemRunRepository` | Persistir runs, screenshots, JSONs, relatórios |
| `ConfigLoaderPort` | `src/application/ports/config-loader.port.ts` | `JsonFileConfigLoader` | Carregar `agent-qa.config.json` |
| `PlanCachePort` | `src/application/ports/plan-cache.port.ts` | `InMemoryPlanCacheAdapter` | Cache efêmero de planos de execução |

---

## 3. Fluxo Principal de Execução

```
CLI (run)
   │
   ▼
AgentController.run()
   │
   ▼
RunAgentUseCase.execute()
   │
   ├──▶ ValidateConfigUseCase ──▶ RunConfig (Zod)
   │
   ├──▶ ScenarioPlannerService ──▶ QaScenario[]
   │      └── LLM "plan" (se não houver catálogo)
   │
   ├──▶ ExecutionPlanPlannerService ──▶ ExecutionPlan
   │      ├── LLM "buildPlan" (modo HYBRID_GUARDED)
   │      └── Fallback: ExecutionPlanFactoryService (factory_first)
   │
   ├──▶ PlanExecutorService ──▶ Executa step a step (modo HYBRID_GUARDED / PLAN_AND_EXECUTE)
   │      ├── BrowserHarnessPort.observe() ──▶ ScreenObservation
   │      ├── BrowserHarnessPort.execute(QaAction)
   │      ├── BrowserHarnessPort.validate(Postcondition)
   │      └── RecoveryPolicyService (se falhar)
   │           ├── Fallback action
   │           ├── Replan (LLM "replan")
   │           └── Emergency action
   │
   ├──▶ ReactiveRunnerService ──▶ Rota FULL_REACTIVE (opt-in/experimental)
   │      ├── decide() por ação com heurísticas semânticas
   │      ├── trySemanticTheme / trySemanticLogout (shortcuts para outcomes conhecidos)
   │      └── RecoveryPolicyService (se falhar)
   │
   └──▶ EvidenceService ──▶ Report, screenshots, traces, video
```

---

## 4. Ciclo de Vida de um Step (HYBRID_GUARDED)

```
1. CHECK preconditions  ──▶ skip se já satisfeitas
2. RESOLVE locator      ──▶ LocatorResolverService → el_xxx ou coordenadas
3. EXECUTE action       ──▶ PlaywrightHarness.execute()
4. WAIT quiescence      ──▶ waitForQuiescence()
5. OBSERVE              ──▶ new ScreenObservation
6. CHECK postconditions ──▶ BrowserHarnessPort.validate()
7. CHECK assertions     ──▶ BusinessAssertion
8. ON FAILURE:
   ├── retry (maxAttemptsPerStep)
   ├── fallback action
   ├── replan (LLM)
   └── emergency / abortScenario
```

---

## 5. Schema de Ações (`QaActionSchema`) — Status

| Ação | Status | Implementado em PlaywrightHarness | Uso típico |
|---|---|---|---|
| `click` | ✅ | ✅ | Clicar botão, link, menu |
| `fill` | ✅ | ✅ | Preencher input, textarea |
| `select` | ✅ | ✅ | Dropdown por label/value/index |
| `press` | ✅ | ✅ | Escape, Enter, Tab, setas |
| `clickOutside` | ✅ | ✅ | Fechar modal, dismiss overlay |
| `clickAtCoordinates` | ✅ | ✅ | Fallback para ícones sem texto |
| `waitForStable` | ✅ | ✅ | Esperar DOM + network idle |
| `navigate` | ✅ | ✅ | Ir para URL com retry automático |
| `assertVisible` | ✅ | ✅ | Verificar elemento/texto visível |
| `assertText` | ✅ | ✅ | Verificar conteúdo de texto |
| `abortScenario` | ✅ | ✅ | Abortar quando impossível |
| **`drag`** | ✅ **Phase 1.1** | ✅ | Drag-and-drop entre elementos |
| **`uploadFile`** | ✅ **Phase 1.2** | ✅ | Upload de arquivo por path |
| **`waitForCondition`** | ✅ **Phase 1.4** | ✅ | Esperar texto específico aparecer |
| **`compareScreenshot`** | ✅ **Phase 1.5** | ✅ (pixelmatch) | Comparar screenshot com baseline |
| **`auditAccessibility`** | ✅ **Phase 1.6** | ✅ (axe-core) | Rodar auditoria WCAG |
| **`acceptDialog`** | ✅ **Phase 2.1** | ✅ | Aceitar `alert`/`confirm` nativo |
| **`dismissDialog`** | ✅ **Phase 2.1** | ✅ | Dismiss `alert`/`confirm` nativo |
| **`richTextFill`** | ✅ **Phase 2.3** | ✅ | Preencher `contenteditable` (CKEditor, Quill) |
| **`extract`** | ✅ **Phase 2.4** | ✅ | Ler texto/value de elemento para memória |

**Ainda não implementado:**

| Ação/Mecanismo | Status | O que falta |
|---|---|---|
| `strategy: 'index'` no `LocatorDescriptorSchema` | ❌ **Phase 1.3** | Adicionar ao schema + resolver (`:nth-of-type`, Playwright `nth()`) |
| `repeatUntil` / `maxIterations` no step | ❌ **Phase 2.2** | Campo no `ExecutionStepSchema` + lógica no `PlanExecutorService` |

---

## 6. Locator Strategies (`LocatorDescriptorSchema`)

| Strategy | Descrição | Exemplo |
|---|---|---|
| `role` | ARIA role + nome opcional | `button "Enviar"` |
| `label` | Texto de label associado | `label "Email"` |
| `placeholder` | Atributo placeholder | `placeholder "Digite seu nome"` |
| `text` | Texto exato do elemento | `text "Salvar"` |
| `text_any` | Múltiplos textos alternativos (OR) | `["Sair", "Logout", "Sign out"]` |
| `testid` | `data-testid` | `testid "submit-btn"` |
| `document` | Documento inteiro | cliques fora, scroll |
| `semantic` | Chave semântica + intent + candidates | `menu_trigger` → candidates `[role button "Conta", text_any ["Menu", "Account"]]` |

**Faltante:**
| `index` | Posição/N-ésimo em uma lista | ❌ **Phase 1.3** |

---

## 7. Plan Conditions (Pré/Pós-condições)

| Tipo | Uso | Exemplo |
|---|---|---|
| `field_value_contains` | Validar input preenchido | campo email contém "test@" |
| `element_visible` | Elemento visível na tela | botão "Salvar" visível |
| `text_visible` | Texto presente | "Bem-vindo" |
| `text_any_visible` | Qualquer texto de uma lista | `["Sair", "Logout"]` |
| `url_contains` | URL contém padrão | `/dashboard` |
| `no_console_errors` | Sem erros no console | ─ |
| `ui_state` | Estado de UI (DOM, atributo, style) | `appearance_mode` changed |
| `auth_state` | Autenticado ou anônimo | `anonymous` após logout |
| `menu_state` | Menu aberto/fechado | `open` após clicar no trigger |
| `route_state` | Mudança de rota | `matches` `/login` |
| `attribute_state` | Atributo HTML específico | `aria-expanded` = `true` |
| `storage_state` | localStorage/sessionStorage | `theme` = `dark` |

---

## 8. ExpectedOutcome Kinds (tipos de tarefa)

| Kind | Gerado por | Factory gera... |
|---|---|---|
| `AUTHENTICATION` | LLM classifica | `waitForStable` + `auth_state: authenticated` |
| `DEAUTHENTICATION` | LLM classifica | `click` (menu trigger + logout) + `auth_state: anonymous` |
| `NAVIGATION` | LLM classifica | `navigate` + `route_state: matches` |
| `APPEARANCE_CHANGE` | LLM classifica | `click` (theme toggle) + `ui_state: exists` |
| `DISCLOSURE` | LLM classifica | `click` (menu trigger) + `menu_state: open` |
| `DATA_ENTRY` | LLM classifica | `fill` + `no_console_errors` |
| `CONTENT_PRESENCE` | LLM classifica | `assertVisible` |
| `NO_REGRESSION` | Fallback | `waitForStable` + `no_console_errors` |
| `CLASSIFICATION_FAILED` | Erro | fallback genérico |

**Universalidade:** o LLM recebe apenas o título da task (ex: "Sair da conta") e retorna o `kind` + `target`. **Nenhum texto de UI é hardcoded no código-fonte.**

---

## 9. Serviços Principais (Application)

| Serviço | O que faz |
|---|---|
| `PlanExecutorService` | Orquestra execução do plano: precondições → resolver locators → executar → validar pós-condições → recovery |
| `ReactiveRunnerService` | Rota `FULL_REACTIVE`: loop reativo com decide() por ação + heurísticas semânticas (theme/logout/menu) |
| `ScenarioPlannerService` | Gera cenários a partir da demanda (LLM ou catálogo) |
| `ExecutionPlanPlannerService` | Gera `ExecutionPlan`: tenta LLM → valida → fallback factory |
| `ExecutionPlanFactoryService` | Factory determinística: converte `ExpectedOutcome` em steps concretos (sem LLM) |
| `ExpectedOutcomeResolverService` | Resolve `ExpectedOutcome` para cada task (LLM classify ou fallback `NO_REGRESSION`) |
| `LocatorResolverService` | Resolve `LocatorDescriptor` → `el_xxx` ou coordenadas na tela atual |
| `RecoveryPolicyService` | Gerencia retries, fallbacks, replanning, emergency actions |
| `BugClassifierService` | Classifica severidade de bugs (CRITICAL, HIGH, MEDIUM, LOW) |
| `EvidenceService` | Coleta screenshots, traces, video, relatórios JSON |
| `TaskMemoryService` | Memória efêmera durante um run (geradores, refs) |
| `DataHarnessService` | Armazena dados gerados (`{{uniqueName}}`, `{{ref:key}}`) |
| `ElementAvailabilityResolver` | Abre menus/containers para acessar elementos ocultos |
| `MemorySearchService` | Busca em memória persistente (BM25) para reutilizar conhecimento |
| `SemanticLocatorMemoryResolver` | Resolve locators semânticos usando memória de runs anteriores |
| `PlaywrightQuiescenceGuard` | Detecta quando a página está estável (DOM + network idle) |

**Removidos (v2 simplificação):** `ExecutionMonitorService` (inerte), `DeepThinkService` (fallback caro, não justificava custo), `ProjectGraphService` (arquivado em `experimental/project-graph/`) |

---

## 10. Infraestrutura

| Componente | Tecnologia | Função |
|---|---|---|
| `PlaywrightHarness` | Playwright (chromium/firefox/webkit) | Browser automation |
| `GroqDecisionProvider` | Groq API (OpenAI-compatible) | LLM para plan, decide, replan, classify |
| `FakeDecisionProvider` | Stub determinístico | Testes sem LLM |
| `FileSystemRunRepository` | Node.js fs | Persistir runs localmente em `./qa-agent-runs/` |
| `JsonFileConfigLoader` | Node.js fs | Carregar config JSON |
| `ObservationService` | Playwright accessibility + DOM | Extrair elementos, textos, bounds, screenshot |
| `DomPurifier` | Custom | Limpar e enriquecer DOM (ariaLabel, title, alt, className) |
| `SignalsCollector` | Playwright events | Coletar console errors, network failures |
| `FormLoginService` | Playwright | Automatizar login por formulário |
| `LlmPlanPatchNormalizer` | Custom + Zod | Normalizar e validar saída do LLM |
| `AxeBuilder` | `@axe-core/playwright` | Auditoria WCAG |
| `pixelmatch` + `pngjs` | Node.js | Comparação pixel-a-pixel de screenshots |
| `InMemoryPlanCacheAdapter` | In-memory (Map) | Cache efêmero de planos de execução |

**Removidos (v2 simplificação):** `RedisPlanCacheAdapter`, `FilePlanCacheAdapter`, `src/types/redis.d.ts` |

---

## 11. Módulos NestJS

| Módulo | Arquivo | Contém |
|---|---|---|
| `AppModule` | `src/app.module.ts` | Root module, importa todos |
| `ApplicationModule` | `src/application/application.module.ts` | Todos os services e use cases |
| `DomainModule` | `src/domain/domain.module.ts` | Schemas e tipos (puro, sem providers) |
| `InfraModule` | `src/infra/infra.module.ts` | Implementações concretas (Playwright, Groq, FS) |
| `InterfacesModule` | `src/interfaces/interfaces.module.ts` | CLI controllers e comandos |

---

## 12. CLI — Comandos Disponíveis

| Comando | Use Case | Descrição |
|---|---|---|
| `qa-agent run` | `RunAgentUseCase` | Executa o agente QA completo |
| `qa-agent capture-auth` | `CaptureAuthUseCase` | Captura storageState (sessão logada) |
| `qa-agent validate-config` | `ValidateConfigUseCase` | Valida `agent-qa.config.json` |
| `qa-agent inspect` | `InspectUseCase` | Inspeciona artefatos de um run anterior |
| `qa-agent report` | `ReportUseCase` | Gera relatório de um run |
| `qa-agent onboard` | `OnboardUseCase` | Gera config inicial interativa |
| `qa-agent preflight` | `PreflightUseCase` | Valida contexto git/ClickUp antes de CI |
| `qa-agent read-pr-context` | `ReadPrContextUseCase` | Lê metadata e diff do PR para CI |

---

## 13. Configuração (`RunConfigSchema`)

| Seção | Controles |
|---|---|
| `baseUrl` + `appDomains` | URL base e domínios permitidos |
| `demand` | Título, descrição, acceptance criteria, escopo |
| `browser` | Engine (chromium/firefox/webkit), headless, viewport, locale |
| `auth` | `none`, `storageState`, `formLogin` |
| `llm` | Provider (fake/groq/openai), model, temperatura, tokens, retries |
| `timeouts` | Quiescence, ação, navegação, cenário, run |
| `runtime` | Modo (`FULL_REACTIVE`/`HYBRID_GUARDED`/`PLAN_AND_EXECUTE`), max actions, replans, destructive policy, semantic keys/aliases, element availability, tools, planning strategy |
| `recovery` | Max attempts, fallbacks, emergency actions |
| `classifier` | Regex de noise, domínios de terceiro, tracking |
| `privacy` | Mask emails, JWT, cookies |
| `allowedRoutes` | Restringe navegação |
| `clickup` | Integração com task ClickUp |
| `output` | Diretório de runs, keep video/screenshot/trace on pass |
| `scenarioSelection` | Max cenários a executar |
| `pr` | Metadata do PR para pipeline |

**Removidos (v2 simplificação):** `monitor` (Fase 2), `projectPath` (Fase 4) |

---

## 14. Estado do Roadmap vs Implementação

| # | Item | Status | Implementado |
|---|---|---|---|
| 1.1 | Drag-and-drop | ✅ **FEITO** | `PlanActionSchema` + `PlaywrightHarness.dragTo()` |
| 1.2 | Upload de arquivo | ✅ **FEITO** | `PlanActionSchema` + `PlaywrightHarness.setInputFiles()` |
| 1.3 | Índice/posição em listas | ✅ **FEITO** | `strategy: 'index'` no `LocatorDescriptorSchema` + `LocatorResolverService` |
| 1.4 | Espera condicional | ✅ **FEITO** | `PlanActionSchema` + `PlaywrightHarness.getByText().waitFor()` |
| 1.5 | Screenshot diff | ✅ **FEITO** | `PlaywrightHarness.compareScreenshot()` com `pixelmatch` |
| 1.6 | WCAG audit | ✅ **FEITO** | `PlaywrightHarness.auditAccessibility()` com `axe-core` + `@axe-core/playwright` |
| 2.1 | Diálogos nativos | ✅ **FEITO** | `acceptDialog` / `dismissDialog` + handler `page.on('dialog')` |
| 2.2 | Loop/repetição | ✅ **FEITO** | `repeatUntil` / `maxIterations` no `ExecutionStepSchema` + `PlanExecutorService` |
| 2.3 | Rich text editor | ✅ **FEITO** | `richTextFill` com `page.evaluate()` para `contenteditable` |
| 2.4 | Extração de dados | ✅ **FEITO** | `extract` com `innerText` / `inputValue` |
| 2.5 | Retry de navegação | ✅ **FEITO** | `navigateWithRetry()` já existe no harness |

---

## 15. Status da v1

✅ **v1 FECHADA** — todos os 11 itens do roadmap estão implementados.

## 16. Status da v2 (Simplificação)

✅ **v2 CONCLUÍDA** — 5 fases de enxugamento executadas. Ver `docs/V2-SIMPLIFICATION-PLAN.md`.

| Fase | O que foi feito | Risco |
|---|---|---|
| **0** | Baseline registrado (smoke codeshare Docker) | — |
| **1** | Removidos `RedisPlanCacheAdapter`, `FilePlanCacheAdapter`, `redis.d.ts` | ~zero |
| **2** | Removido `ExecutionMonitorService` (inerte) + chave `monitor` do config | ~zero |
| **3** | Removido `DeepThinkService` + `deepThink()` do plan executor + do `DecisionProviderPort` | médio (fallback encurtado) |
| **4** | Arquivado `ProjectGraphService` + adapters/schemas para `experimental/project-graph/` | médio (nenhuma config usava) |
| **5** | Isolada rota `FULL_REACTIVE` em `ReactiveRunnerService` | médio (rota permanece, mas isolada) |

### Build após v2

| Build | Status |
|---|---|
| TypeScript typecheck | ✅ Passa |
| ESLint | ✅ Sem erros |
| Testes unitários | ✅ ~1454/1465 passam (11 falhas pré-existentes: Playwright local não instalado) |
| Smoke codeshare (Docker) | ✅ Readiness: READY |
| Smoke i18n FULL_REACTIVE (Docker) | ✅ Executou sem crash |

### Correções de robustez aplicadas (bug MeshaMail)

| Problema | Causa | Correção |
|---|---|---|
| Login falso-positivo | `successWhen.urlContains` com próprio domínio não validava mudança de URL | `FormLoginService` agora captura URL antes do submit e valida que mudou; detecta se campo password ainda visível |
| Crash em erro não tratado | `runWithBrowser` e `runWithTools` só tinham `finally`, sem `catch` | Adicionado `catch` geral que grava `QaBug` válido, fecha browser, e retorna resultado `BLOCKED` sem matar o processo |

| Build | Status |
|---|---|
| TypeScript typecheck | ✅ Passa |
| Testes | ✅ 172/173 passam (1 falha não relacionada: path Windows vs Unix em `load-clickup-config-settings.spec.ts`) |
