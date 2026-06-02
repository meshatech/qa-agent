# Roadmap — agent-qa v1

> Fechamento das fases para tornar o runtime robusto em fluxos web reais.
> Libs escolhidas: **Playwright `toHaveScreenshot()`** para screenshot diff e **`axe-core` + `@axe-core/playwright`** para WCAG audit.

---

## Phase 1 — Fundação Sólida (v1)

Objetivo: não se perder nos fluxos críticos e ter evidências claras quando quebrar. Cobre ~90% dos cenários de regressão web.

| # | Item | Prioridade | Descrição técnica |
|---|---|---|---|
| 1.0 | **Superfícies editáveis genéricas** | `HIGH` | Observar `textarea`, inputs textuais e `[contenteditable="true"]` mesmo sem label, placeholder ou nome acessível. Representar como `textbox` declarativo e permitir fallback semântico de `DATA_ENTRY` para `role=textbox`. Usar literal explícito da demanda quando informado entre aspas. |
| 1.1 | **Drag-and-drop** | `HIGH` | Nova ação `drag` no `QaActionSchema` (origem → destino via `targetElementId`). Implementar no `PlaywrightHarness` com `page.dragAndDrop()`. |
| 1.2 | **Upload de arquivo** | `HIGH` | Nova ação `uploadFile` com campo `filePath: string`. Implementar no `PlaywrightHarness` com `page.setInputFiles()`. |
| 1.3 | **Índice/posição em listas** | `HIGH` | Adicionar `strategy: 'index'` ao `LocatorDescriptorSchema` + resolver no `LocatorResolverService` (`:nth-of-type`, `nth-match`, ou Playwright `nth()`). |
| 1.4 | **Espera condicional** | `HIGH` | Nova ação `waitForCondition` no `QaActionSchema` aceitando um `PlanCondition` (ex: `text_visible`, `element_visible`). Implementar no `PlaywrightHarness` com `expect(page).toPass()` ou polling. |
| 1.5 | **Screenshot diff (baseline)** | `HIGH` | Usar **Playwright `expect(page).toHaveScreenshot()`**. Adicionar `compareScreenshot(baselinePath, threshold)` ao `BrowserHarnessPort`. Integrar ao `PlanExecutorService` em steps críticos (tema, modal, navegação) e ao `EvidenceService` para baseline de bugs. |
| 1.6 | **WCAG audit com axe-core** | `MEDIUM` | Usar **`axe-core` + `@axe-core/playwright`**. Criar port `AccessibilityAuditPort` com método `audit(): Promise<AccessibilityViolation[]>`. Implementar no `PlaywrightHarness`. Executar automaticamente em steps `APPEARANCE_CHANGE` e `NAVIGATION`. Classificar violações críticas no `BugClassifierService`. |

### Critérios de aceite Phase 1

- [x] Smoke externo CodeShare acessa `https://codeshare.io/5ee6dl` e digita `teste` sem locator específico do site
- [x] `textarea` anônimo e `[contenteditable="true"]` aparecem na observação como `textbox`
- [x] Ruído conhecido de console pode ser filtrado por `classifier.knownNoiseRegexes` sem mascarar erros globalmente
- [x] Smoke local composto cobre login, navegação, formulário, upload, drag e logout por actions declarativas, sem chamadas LLM
- [x] Screenshot diff detecta regressão de tema/layout com baseline armazenável em `output.runsDir/baselines/`
- [x] WCAG audit reporta `button-name` e o executor registra violações críticas antes da recuperação por locator
- [x] Índice em lista permite "clicar no 2º botão Excluir" sem ambiguidade
- [x] Espera condicional aguarda status "Concluído" antes de prosseguir
- [x] Todos os testes passam (`npm test`) e lint/typecheck limpos

---

## Phase 2 — Resiliência em fluxos dinâmicos (v2)

Objetivo: cobrir fluxos complexos com loops, decisões dinâmicas e interações avançadas.

| # | Item | Prioridade | Descrição técnica |
|---|---|---|---|
| 2.1 | **Diálogos nativos do browser** | `HIGH` | Handler `page.on('dialog')` no `PlaywrightHarness`. Novas ações `acceptDialog`, `dismissDialog` com texto opcional. Integrar ao `QaActionSchema`. |
| 2.2 | **Loop/repetição em steps** | `MEDIUM` | Campo `repeatUntil` ou `maxIterations` no `ExecutionStepSchema`. O `PlanExecutorService` repete o step até a postcondition passar ou atingir o limite. |
| 2.3 | **Rich text editor complexo** | `MEDIUM` | Evoluir `fill` interno ou criar capability interna controlada para editores que não aceitam preenchimento Playwright declarativo (CKEditor, Quill, Monaco etc.). Não expor `executeScript` como tool pública e não permitir DOM/script arbitrário vindo da LLM. |
| 2.4 | **Extração de dados da tela** | `MEDIUM` | Nova ação `extract` que lê texto/valor de um elemento e armazena no `DataHarnessService` para uso em steps subsequentes. Permite decisão baseada em conteúdo dinâmico (ex: "escolher voo mais barato"). |
| 2.5 | **Retry automático de navegação** | `LOW` | No `PlaywrightHarness`, retry de `page.goto()` em erros de rede (`net::ERR_*`) com backoff exponencial. Configurável via `config.timeouts.navigationRetry`. |

### Critérios de aceite Phase 2

- [x] Fluxo repetível funciona com `repeatUntil` e limite obrigatório `maxIterations`
- [x] Upload em fluxo com `alert` de confirmação funciona sem travar
- [x] Preenchimento controlado de `[contenteditable="true"]` funciona sem script arbitrário vindo da LLM
- [x] Extração de dado da tela permite reutilização posterior por `{{ref:key}}`
- [x] Navegação resiste a falha de rede transitória com retry e backoff configuráveis

---

## Libs escolhidas

| Capacidade | Lib | Motivo |
|---|---|---|
| Screenshot diff | **Playwright `expect(page).toHaveScreenshot()`** | Já está no projeto, baseline automático, threshold configurável, diff visual embutido |
| WCAG audit | **`axe-core` + `@axe-core/playwright`** | Padrão de mercado, integração direta com Playwright, regras WCAG 2.1 A/AA/AAA, saída estruturada com impacto e solução |

---

## Progresso

- [x] Phase 1.0 — Observação de `textarea` anônimo e `[contenteditable="true"]` como `textbox`
- [x] Phase 1.0 — Fallback semântico de `DATA_ENTRY` para `role=textbox`
- [x] Phase 1.0 — Literal explícito entre aspas usado pelo gerador de valor
- [x] Phase 1.0 — `classifier.knownNoiseRegexes` aplicado à validação `no_console_errors`
- [x] Phase 1.0 — Validar smoke externo CodeShare após implementação
- [x] Phase 1.5 — Screenshot na observação (base64) *(já entregue na sessão anterior)*
- [x] Phase 1.6 — Atributos de acessibilidade (`ariaLabel`, `title`, `alt`, `className`) *(já entregue)*
- [x] Phase 1.1 — Drag-and-drop
- [x] Phase 1.2 — Upload de arquivo
- [x] Phase 1.3 — Índice/posição
- [x] Phase 1.4 — Espera condicional
- [x] Phase 1.5 — Screenshot diff com baseline
- [x] Phase 1.6 — WCAG audit
- [x] Phase 2.1 — Diálogos nativos
- [x] Phase 2.2 — Loop/repetição
- [x] Phase 2.3 — Rich text editor
- [x] Phase 2.4 — Extração de dados
- [x] Phase 2.5 — Retry de navegação

---

## Registro de tentativas

| Tentativa | Resultado | Ajuste |
|---|---|---|
| CodeShare 1 | `BLOCKED` | Editor anônimo não aparecia na observação. |
| CodeShare 2 | Falso positivo | `DATA_ENTRY` precisava validar `field_value_contains`. |
| CodeShare 3 | `BLOCKED` | Pós-condição precisava usar locator concreto observado. |
| CodeShare 4 | `PASSED_WITH_WARNINGS`, 3 chamadas LLM | Editor recebeu `teste`; validação passou. |
| CodeShare 5 | `PASSED_WITH_WARNINGS`, 4 chamadas LLM | Regressão externa final passou com WCAG automático reportando `button-name` e `label`. |
| Roadmap fixture 1 | Timeout | Timeout do teste ampliado para comportar quiescência e Axe. |
| Roadmap fixture 2 | Upload falhou | `input[type=file]` passou a preferir locator por label/`aria-label`. |
| Roadmap fixture 3 | Diálogo travou clique | Harness passou a devolver controle quando captura diálogo pendente. |
| Roadmap fixture 4 | `PASSED` | Capacidades Phase 1 e Phase 2 validadas em testes focados. |

## Evidências automatizadas

- `test/playwright-harness.spec.ts`: drag, upload, espera condicional, screenshot diff, WCAG `button-name`, diálogo, rich text, extração e retry de navegação.
- `test/locator-resolver.spec.ts`: resolução declarativa por índice.
- `test/plan-executor.spec.ts`: `repeatUntil` com limite e reutilização de dado extraído via `{{ref:key}}`.
- `test/form-login.spec.ts`: login real em fixture local com locators declarativos.
- `agent-qa.codeshare.config.json`: smoke externo sem locator específico do CodeShare.
