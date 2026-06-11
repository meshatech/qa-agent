# V2 Definitiva — Plano de Fechamento e Integração Operacional

**Versão:** 1.0
**Status:** Plano de fechamento — consolida o que existe, fecha pontas soltas e define a integração real via GitHub Actions + preview environment
**Data:** 2026-06-10

---

## 1. Objetivo da V2 Definitiva

O `qa-agent` é um agente de QA autônomo que opera dentro do ciclo de Pull Request:

1. **Lê a demanda** na task do ClickUp vinculada ao PR.
2. **Correlaciona** a demanda com o diff do PR e com a memória do projeto (BM25).
3. **Gera um plano de execução** (cenários → ExecutionPlan tipado).
4. **Executa** o plano contra um **ambiente de preview** do PR via Playwright.
5. **Reporta** o resultado como comentário no PR (bugs, evidências, cobertura de critérios).
6. **Aprende** com a execução e promove aprendizados de volta para a memória do projeto.

A v2 definitiva fecha o ciclo: tudo isso rodando **sem intervenção humana**, disparado pelo
GitHub Actions, **depois** que o ambiente de preview (Traefik + VPS + build self-hosted) sobe.

> **Princípio da v2:** *Um repositório alvo integra o agente com 3 arquivos: um workflow,
> um config e (opcionalmente) um memory.md. Nada mais.*

---

## 2. Estado Atual — O Que Já Existe e Funciona

### 2.1 Pipeline CLI (núcleo do CI) — ✅ completo

| Etapa | Comando | Artefato gerado | Status |
|---|---|---|---|
| 1. Preparação | `qa-agent pipeline prepare` | `preflight-report.json` + `pr-diff-context.json` | ✅ |
| 2. Correlação | `qa-agent pipeline correlate` | `correlation-report.md`, `required-scenarios.json`, `selected-scenarios.json`, `demand-context.json`, `memory-consultation-log.json` | ✅ |
| 3. Risco | `qa-agent pipeline risk` | risk score do diff | ✅ |
| 4. Plano | `qa-agent pipeline generate-plan` | `execution-plan.json` | ✅ |
| 5. Execução | `qa-agent pipeline execute` | `run.json`, screenshots, vídeo, traces | ✅ |
| 6. Relatório | `qa-agent pipeline report` | `pr-report.md` + **comentário no PR** | ✅ |
| 7. Aprendizado | `qa-agent pipeline learning` | `learning-candidates.json` | ✅ |
| 8. Promoção | `qa-agent pipeline promote-learning --auto-approve` | atualiza `memory.md` | ✅ |
| Bootstrap | `qa-agent pipeline generate-memory` | `.agent-qa/memory.md` inicial | ✅ |

Exit codes já são semânticos (`OK`, `BUGS_FOUND`, `CONFIG_ERROR`, preflight `BLOCKED`),
o que permite gates no Actions sem parsing de output.

### 2.2 Correlacionador (task × diff × memória) — ✅ existe, com lacunas menores

`RunPipelineCorrelateUseCase` já faz o circuito completo:

- Lê `pr-diff-context.json` (gerado do evento do GitHub Actions via `GITHUB_EVENT_PATH`).
- Resolve o `clickUpTaskId` do PR (branch name / título / descrição — `clickup-task-id-from-pr.resolver`).
- Busca a demanda no ClickUp (`CLICKUP_TOKEN`), persiste `demand-context.json`.
- Monta query BM25 a partir de demanda + diff e consulta a memória (`types: route, flow, scenario, semantic_locator`).
- `DemandDiffMemoryCorrelatorService` produz `CorrelationResult` com score por critério de aceite.
- Registra `memory-consultation-log.json` com gaps explícitos (critério sem cobertura, rota sem chunk, memória vazia).
- Bloqueia com motivo sanitizado quando faltam insumos (`CorrelationBlockedError`).

### 2.3 Feedback no PR (GitHub provider) — ✅ existe

`PRReporterService` + `FetchGitHubCommentAdapter`:

- Posta comentário via API do GitHub com **upsert** (acha comentário existente pelo
  `AGENT_QA_COMMENT_MARKER` e atualiza, evitando spam de comentários por push).
- Renderiza cobertura de critérios de aceite, bugs com links de evidência, métricas de valor de QA.
- Grava `pr-publication-status.json` (auditável) e `pr-report.md` (fallback quando sem token).
- Sanitização de secrets em todas as mensagens.

### 2.4 Memória BM25 — ✅ funciona, ⚠️ contrato não formalizado

- `MemorySearchService` → `MemoryMarkdownLoader` → `MemoryChunker` → `BM25MemoryIndex`.
- Fonte: `.agent-qa/memory.md` no repositório alvo.
- Tipos de chunk: `route`, `flow`, `scenario`, `semantic_locator`.
- Write-back: `learning` → `promote-learning` (com `--auto-approve` para candidatos confirmados de alta confiança).
- Bootstrap: `generate-memory` analisa o código do projeto e gera o `memory.md` inicial.

### 2.5 Execução Playwright — ✅ harness maduro

- 21 ações implementadas (click, fill, drag, upload, dialogs, richText, extract, WCAG, screenshot-diff...).
- 3 rotas de runtime: `PLAN_AND_EXECUTE`, `HYBRID_GUARDED` (canônica), `FULL_REACTIVE` (isolada em `ReactiveRunnerService`).
- Escada de fallback de 4 degraus (locator determinístico → availability → decide LLM → replan).
- Evidências: screenshots, vídeo, trace, axe-core.
- `Dockerfile.playwright` já existe (base `mcr.microsoft.com/playwright:v1.60.0-noble`).

### 2.6 Gherkin — ⚠️ parcial

`GherkinRendererService` + `PersistGherkinScenariosUseCase` existem, mas o output é
**Markdown ad-hoc** ("Cenários Selecionados" com seções), **não Gherkin sintático**
(`Feature / Scenario / Given / When / Then`). Não gera `.feature`.

### 2.7 Specs em andamento (não implementadas)

- `docs/scenario-workspace-memory-spec.md` — workspace por run com vídeo por cenário
  (multi-BrowserContext), `runtime-memory.md`, classificação de falha BUG/BLOCKED/DRIFT/INCONCLUSIVE.
- `docs/SUB-AGENT-ORCHESTRATOR.md` — Single Orchestrator + Typed Tool Queue (branch atual
  `feature/sub-agent-orchestrator`, com `ToolQueueSchema`, mapper e replan já criados mas não fechados).

---

## 3. Pontas Soltas — Gap Analysis para Fechar a V2

| # | Gap | Evidência | Severidade | Resolução (seção) |
|---|---|---|---|---|
| G1 | **Não existe workflow do GitHub Actions** — nem CI próprio, nem template/reusable workflow para repos alvo | `.github/workflows/` ausente | 🔴 Bloqueante | §5, §6 |
| G2 | **`baseUrl` estático no config** — preview env tem URL dinâmica por PR (`pr-<N>.preview...`) | `RunConfigSchema.baseUrl` sem interpolação | 🔴 Bloqueante | §5.4 |
| G3 | **Distribuição inexistente** — sem imagem Docker publicada, sem action, sem pacote npm | nenhum registry configurado | 🔴 Bloqueante | §6.1 |
| G4 | **Gherkin não é Gherkin** — renderer emite Markdown próprio | `gherkin-renderer.service.ts` | 🟡 Profissionalização | §7 |
| G5 | **Contrato do `memory.md` não formalizado** — formato dos chunks vive implícito no chunker | `memory-chunker.service.ts` | 🟡 Padronização | §8 |
| G6 | **Auth em CI não resolvida** — `capture-auth` é interativo; `meshamail-auth.json` legado na raiz | spec §8 do scenario-workspace | 🟡 Operacional | §5.5 |
| G7 | **Write-back da memória** — `promote-learning` atualiza `memory.md` local, mas nada commita de volta no repo alvo | nenhum passo de commit/PR | 🟡 Operacional | §8.3 |
| G8 | **Vídeo por cenário** — spec escrita, não implementada | `scenario-workspace-memory-spec.md` | 🟢 Pode ser v2.1 | §9 |
| G9 | **Branch orchestrator aberta** — decidir se Tool Queue entra na v2 ou fica atrás de flag | `feature/sub-agent-orchestrator` | 🟡 Decisão | §9 |
| G10 | **Higiene do repo** — 11 configs experimentais na raiz (`agent-qa.codeshare.v2-5`, `meshamail.70b.v2-6`), `meshamail-auth.json` versionado | `git status` | 🟢 Limpeza | §10 |

---

## 4. Arquitetura Operacional da V2 — Visão Completa

### 4.1 O agente é um robô da pipeline, não uma dependência do projeto

O repositório alvo **não instala** o qa-agent como dependência. O agente roda como um
**job do GitHub Actions** usando uma **imagem Docker publicada** (`ghcr.io/mesha/qa-agent:v2`),
no **runner self-hosted da VPS** — o mesmo host onde o Traefik publica os previews.

```
┌──────────────────────────── PULL REQUEST aberto/atualizado ───────────────────────────┐
│                                                                                        │
│  JOB 1: build-preview (self-hosted, VPS)                                               │
│  ├── docker build da branch do PR                                                      │
│  ├── docker compose up com labels Traefik                                              │
│  └── Traefik publica: https://pr-<N>.preview.<dominio>                                 │
│         │                                                                              │
│         ▼  needs: build-preview  (output: preview_url)                                 │
│                                                                                        │
│  JOB 2: qa-agent (self-hosted, VPS, container ghcr.io/mesha/qa-agent:v2)               │
│  ├── 0. wait-for-ready ── curl no preview_url até HTTP 200 (timeout 120s)              │
│  ├── 1. pipeline prepare    ── preflight + pr-diff-context (lê GITHUB_EVENT_PATH)      │
│  ├── 2. pipeline correlate  ── ClickUp task + diff + memory.md (BM25)                  │
│  ├── 3. pipeline generate-plan ── ExecutionPlan a partir dos cenários selecionados     │
│  ├── 4. pipeline execute    ── Playwright headless contra QA_AGENT_BASE_URL            │
│  ├── 5. pipeline report     ── comenta no PR (upsert) + pr-report.md                   │
│  ├── 6. pipeline learning + promote-learning --auto-approve                            │
│  ├── 7. upload-artifact     ── vídeos, screenshots, traces, run.json                   │
│  └── 8. (opcional) commit do memory.md atualizado                                      │
│                                                                                        │
│  JOB 3: teardown-preview (sempre, ou no fechamento do PR)                              │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

### 4.2 Por que o Playwright roda bem nesse desenho

- O job roda **dentro do container Playwright** (browsers já instalados na imagem) no
  runner self-hosted — zero instalação de browser por run.
- O runner está **na mesma VPS** do Traefik: o agente acessa o preview pela **URL pública**
  (`https://pr-N.preview.<dominio>`), exercitando TLS, cookies e redirects como um usuário
  real — mais fiel do que rede interna Docker. Fallback: rede interna
  (`http://preview-pr-N:porta`) se DNS público não estiver disponível para o runner.
- Headless por padrão (`browser.headless: true`), com vídeo/trace gravados como evidência.

### 4.3 Sequência de gates (fail-fast barato → caro)

| Ordem | Gate | Custo | Falha → |
|---|---|---|---|
| 1 | `prepare` (preflight) | grátis | PR sem task ClickUp → comenta "QA bloqueado: vincule a task" e sai com exit 6 (não falha o check, `continue-on-error` configurável) |
| 2 | `correlate` | 1 chamada ClickUp + BM25 local | BLOCKED → comenta motivo |
| 3 | `risk` (opcional) | grátis | risco baixo → pode pular execução (política do repo) |
| 4 | `generate-plan` | 0–1 chamada LLM | falha → fallback factory determinística |
| 5 | `execute` | browser + 0–N chamadas LLM (escada) | bugs → exit BUGS_FOUND |
| 6 | `report` | 1 chamada GitHub API | sem token → grava `pr-report.md` como artifact |

---

## 5. Integração com o Preview Environment (Traefik + VPS + self-hosted)

### 5.1 Contrato entre o job de preview e o agente

O job de preview **deve expor a URL como output**. Convenção:

```yaml
jobs:
  build-preview:
    runs-on: [self-hosted, vps]
    outputs:
      preview_url: ${{ steps.deploy.outputs.url }}
    steps:
      - id: deploy
        run: |
          # ... build + compose up com labels traefik ...
          echo "url=https://pr-${{ github.event.number }}.preview.example.com" >> "$GITHUB_OUTPUT"
```

Se o sistema de preview já existir e não expuser output, o agente aceita a **convenção
determinística** `https://pr-<PR_NUMBER>.preview.<dominio>` via env, sem acoplamento.

### 5.2 Readiness check (novo, pequeno e obrigatório)

Antes de executar, o agente espera o preview ficar pronto. Implementação mínima — um step
shell no workflow (não precisa de código novo no agente):

```yaml
- name: Wait for preview
  run: |
    for i in $(seq 1 60); do
      code=$(curl -s -o /dev/null -w '%{http_code}' "$QA_AGENT_BASE_URL" || true)
      [ "$code" = "200" ] && exit 0
      sleep 2
    done
    echo "Preview not ready after 120s" && exit 1
```

Evolução opcional na v2: mover para o `preflight` (`check: preview_reachable`) para o
motivo aparecer no `preflight-report.json`.

### 5.3 Workflow de referência no repositório alvo (arquivo único)

```yaml
# .github/workflows/qa-agent.yml  (repo alvo — ÚNICO arquivo necessário)
name: QA Agent
on:
  pull_request:
    types: [opened, synchronize, reopened]

concurrency:
  group: qa-agent-pr-${{ github.event.number }}
  cancel-in-progress: true

permissions:
  contents: read
  pull-requests: write   # comentário do relatório

jobs:
  build-preview:
    # ... job de preview já existente (Traefik/VPS) ...

  qa-agent:
    needs: build-preview
    runs-on: [self-hosted, vps]
    container:
      image: ghcr.io/mesha/qa-agent:v2
    env:
      QA_AGENT_BASE_URL: ${{ needs.build-preview.outputs.preview_url }}
      CLICKUP_TOKEN: ${{ secrets.CLICKUP_TOKEN }}
      GROQ_API_KEY: ${{ secrets.GROQ_API_KEY }}
      GITHUB_TOKEN: ${{ secrets.GITHUB_TOKEN }}
    steps:
      - uses: actions/checkout@v4          # diff + memory.md + config do repo alvo
        with: { fetch-depth: 0 }           # diff base...head completo
      - name: Wait for preview
        run: /opt/qa-agent/wait-for-ready.sh "$QA_AGENT_BASE_URL"
      - name: Run QA pipeline
        run: qa-agent pipeline all --config ./agent-qa.config.json
      - uses: actions/upload-artifact@v4
        if: always()
        with:
          name: qa-agent-evidence-pr-${{ github.event.number }}
          path: .agent-qa/pipeline/
```

> **Novo comando `pipeline all`:** wrapper que roda prepare → correlate → generate-plan →
> execute → report → learning em sequência com a política de gates da §4.3. Hoje cada etapa
> é um comando separado (bom para debug, ruim para adoção). O comando agregado é a peça de
> simplicidade que faltava — 1 step no workflow em vez de 7.

### 5.4 `baseUrl` dinâmico (G2 — mudança de código necessária)

A URL do preview muda a cada PR; o config é estático. Resolução em duas camadas:

1. **Override por env (obrigatório na v2):** `QA_AGENT_BASE_URL` tem precedência sobre
   `config.baseUrl`. Implementação: no `ValidateConfigUseCase`/loader, após o parse Zod:
   `baseUrl = env.QA_AGENT_BASE_URL ?? config.baseUrl`. O domínio do preview também entra
   automaticamente em `appDomains` (wildcard `*.preview.<dominio>` configurável).
2. **Interpolação no config (nice-to-have):** suportar `"baseUrl": "${QA_AGENT_BASE_URL}"`
   para tornar a intenção explícita no arquivo.

### 5.5 Autenticação no preview (G6)

`capture-auth` é interativo — inviável em CI. Estratégia v2 por ordem de preferência:

| Estratégia | Quando usar | Como |
|---|---|---|
| `formLogin` | App com login por formulário | Config `auth.formLogin` + secrets `QA_AGENT_USER`/`QA_AGENT_PASS`; preview é semeado com usuário de teste no build |
| `storageState` seed | SSO/OAuth onde formLogin não alcança | Storage state gerado uma vez (local, `capture-auth`), salvo como **secret/artifact criptografado**, restaurado no job. Validade limitada — preferir formLogin |
| `none` | Páginas públicas | — |

Regra v2: `meshamail-auth.json` sai da raiz e do versionamento (entra no `.gitignore`);
storage state em CI vive em `.agent-qa/pipeline/state/` (alinhado com a spec do
scenario-workspace, §8 daquele doc).

### 5.6 Secrets e variáveis — contrato completo

| Variável | Obrigatória | Usada em | Origem |
|---|---|---|---|
| `CLICKUP_TOKEN` | ✅ | preflight, correlate | Secret do repo/org |
| `GROQ_API_KEY` (ou `OPENAI_API_KEY`) | ✅ | generate-plan, execute (escada), learning | Secret |
| `GITHUB_TOKEN` | ✅ | preflight, report (comentário) | Automático do Actions |
| `QA_AGENT_BASE_URL` | ✅ | execute | Output do job de preview |
| `QA_AGENT_USER` / `QA_AGENT_PASS` | se formLogin | execute | Secret |
| `GITHUB_EVENT_PATH` / `GITHUB_REPOSITORY` etc. | ✅ | prepare (contexto do PR) | Automático do Actions |

---

## 6. Modelo de Distribuição (G3)

### 6.1 Imagem Docker publicada — a unidade de entrega da v2

```dockerfile
# Dockerfile (release) — evolução do Dockerfile.playwright existente
FROM mcr.microsoft.com/playwright:v1.60.0-noble
WORKDIR /opt/qa-agent
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY dist/ ./dist/
COPY scripts/wait-for-ready.sh ./
RUN ln -s /opt/qa-agent/dist/main.js /usr/local/bin/qa-agent && chmod +x dist/main.js
ENTRYPOINT []
```

- Publicada em `ghcr.io/mesha/qa-agent` com tags `v2`, `v2.x.y`, `latest`.
- Build + push automatizado por workflow de release **neste** repositório
  (`.github/workflows/release.yml`, disparado por tag).
- Runner self-hosted faz cache da imagem — pull só em release nova.

### 6.2 CI do próprio qa-agent (hoje inexistente)

`.github/workflows/ci.yml` mínimo: `npm run check` (tsc + eslint + testes unitários) +
smoke codeshare em container Playwright. Sem isso, a v2 não tem proteção de regressão.

### 6.3 Onboarding de um repositório alvo — checklist de 4 passos

1. Copiar `qa-agent.yml` de referência para `.github/workflows/` (§5.3).
2. Criar `agent-qa.config.json` mínimo na raiz (ou rodar `qa-agent onboard`):
   ```json
   {
     "baseUrl": "${QA_AGENT_BASE_URL}",
     "demand": { "source": "clickup" },
     "auth": { "mode": "formLogin", "formLogin": { "...": "..." } },
     "llm": { "provider": "groq", "model": "llama-3.3-70b-versatile" },
     "runtime": { "mode": "HYBRID_GUARDED" }
   }
   ```
3. Configurar secrets: `CLICKUP_TOKEN`, `GROQ_API_KEY` (+ credenciais de teste se formLogin).
4. (Opcional, recomendado) Bootstrap da memória: `qa-agent pipeline generate-memory` local,
   commitar `.agent-qa/memory.md`.

Convenção de vínculo PR ↔ ClickUp já suportada: ID da task no nome da branch, título ou
descrição do PR (`clickup-task-id-from-pr.resolver`).

---

## 7. Gherkin Profissional (G4)

### 7.1 O que muda

`GherkinRendererService` passa a emitir **Gherkin sintático real**, mantendo o invólucro
Markdown para o comentário do PR:

```gherkin
# language: pt
Funcionalidade: Alternância de tema (CU-868: Dark mode no painel)

  Contexto:
    Dado que estou autenticado em "https://pr-42.preview.example.com"

  Cenário: Usuário alterna para tema escuro
    Dado que o menu de conta está visível
    Quando clico no botão "Tema"
    E seleciono "Escuro"
    Então o atributo "data-theme" do documento é "dark"
    E nenhum erro aparece no console
```

### 7.2 Mapeamento determinístico (sem LLM)

| Fonte (já existe) | Gherkin |
|---|---|
| `QaScenario.title` + task ClickUp | `Funcionalidade:` / `Cenário:` |
| `preconditions` (PlanCondition) | `Dado que ...` |
| `steps[].action` (QaAction) | `Quando ...` / `E ...` |
| `postconditions` + `BusinessAssertion` | `Então ...` / `E ...` |
| Resultado da execução | tag `@passed` / `@failed` / `@blocked` por cenário |

### 7.3 Entregáveis

- `evidence/features/<scenario-id>.feature` por run (artifact).
- Seção colapsável no comentário do PR: "📋 Cenários executados (Gherkin)" com os blocos
  e o status de cada um — é a linguagem que o PO/QA humano lê.
- O `.feature` é **derivado, não fonte**: o contrato executável continua sendo o
  `ExecutionPlan`. (Aceitar `.feature` como entrada é explicitamente **fora da v2**.)

---

## 8. Padronização da Memória BM25 (G5, G7)

### 8.1 Contrato formal do `memory.md` (novo schema de documentação)

Formalizar o que o `MemoryChunker` já espera, como contrato versionado:

```markdown
<!-- agent-qa-memory v1 -->
# Project Memory — <nome do projeto>

## [route] /login
URL de autenticação. Form com campos email/password, submit "Entrar".
Redireciona para /inbox após sucesso.

## [flow] login-padrao
1. navigate /login → 2. fill email → 3. fill password → 4. click "Entrar"
→ 5. auth_state: authenticated.

## [scenario] alternar-tema
Dado autenticado, abrir menu de conta, clicar "Tema", validar storage_state theme=dark.
Cobre critérios de aparência. Última execução: PASSED.

## [semantic_locator] menu_trigger
candidates: role=button name="Conta"; text_any ["Menu", "Account", "Perfil"].
Confirmado em 12 runs.
```

Regras do contrato:

1. **Header obrigatório** `<!-- agent-qa-memory v1 -->` — o loader valida e emite warning
   de migração quando ausente (back-compat com arquivos atuais).
2. **Um chunk = um heading `## [tipo] slug`** com tipo ∈ `route | flow | scenario | semantic_locator`.
3. Corpo do chunk em texto corrido/lista — é o que o BM25 indexa; sem limite rígido,
   recomendação ≤ 15 linhas por chunk.
4. **Append e atualização só via `promote-learning`** em CI; edição manual permitida
   localmente (é Markdown de propósito).
5. Localização canônica: `.agent-qa/memory.md` **no repositório alvo**, versionado em git —
   a memória pertence ao projeto testado, não ao agente.

### 8.2 Ciclo de vida

```
generate-memory (bootstrap, 1x) ──▶ memory.md
        │
        ▼ (cada PR)
correlate (BM25 read) ──▶ cenários/locators reutilizados
        │
        ▼ (pós-execução)
learning ──▶ learning-candidates.json
        │
        ▼
promote-learning --auto-approve ──▶ memory.md atualizado
        │
        ▼
write-back (G7, novo) ──▶ commit no repo alvo
```

### 8.3 Write-back do aprendizado (G7 — fechar na v2)

Decisão: **commit direto na branch do PR** pelo job (simples, auditável no próprio PR):

```yaml
- name: Persist learned memory
  if: success()
  run: |
    if ! git diff --quiet .agent-qa/memory.md; then
      git config user.name "qa-agent[bot]"
      git config user.email "qa-agent@users.noreply.github.com"
      git add .agent-qa/memory.md
      git commit -m "chore(qa-agent): promote learned memory [skip ci]"
      git push
    fi
```

- `[skip ci]` evita loop de workflow.
- Alternativa conservadora (flag de config `memoryWriteBack: "pr" | "commit" | "off"`):
  abrir PR separado de memória. Default v2: `commit`.

### 8.4 Integração com `runtime-memory.md` (spec scenario-workspace)

Quando a Fase 2 da spec entrar, `MemorySearchService` indexa `memory.md` (baseline do
projeto) **+** `qa-agent-runs/<runId>/state/runtime-memory.md` (estado da run), com
prioridade para o runtime em caso de overlap — já especificado na spec §5.6. O contrato
v1 do §8.1 vale para os dois arquivos.

---

## 9. Escopo: o que entra na V2 e o que fica para a V2.1

### Entra na v2 (fechamento)

| Item | Gap | Esforço |
|---|---|---|
| Workflow CI do próprio repo + release da imagem Docker | G1, G3 | M |
| Reusable workflow / template `qa-agent.yml` para repos alvo | G1 | S |
| `QA_AGENT_BASE_URL` override + appDomains do preview | G2 | S |
| Comando `pipeline all` | simplicidade | S |
| Gherkin real no renderer + `.feature` como artifact + seção no comentário | G4 | M |
| Contrato `memory.md` v1 (header, validação, doc) | G5 | S |
| Write-back de memória (commit na branch do PR) | G7 | S |
| Auth CI: formLogin como caminho canônico + storageState seed documentado | G6 | S |
| Higiene: gitignore de auth.json, remover configs experimentais da raiz | G10 | S |
| **Decisão sobre a branch orchestrator** (recomendação abaixo) | G9 | — |

**Recomendação G9 (orchestrator/Tool Queue):** fechar a branch como **rota opt-in**
(`runtime.planningStrategy: "tool_queue"`), atrás de flag, sem virar caminho canônico da
v2. O caminho canônico permanece `HYBRID_GUARDED` + factory fallback, que é o que está
validado em smoke. A Tool Queue amadurece em paralelo sem bloquear o fechamento.

### Fica para a v2.1 (já especificado, não bloqueia operação)

| Item | Justificativa |
|---|---|
| Scenario Workspace Memory completo (vídeo por cenário, multi-context) — `scenario-workspace-memory-spec.md` | Evidência atual (1 vídeo por run) já cumpre o relatório de PR; micro-vídeos são refinamento de evidência, não pré-requisito de operação |
| Classificação fina BUG/BLOCKED/DRIFT/INCONCLUSIVE (Fase 5 da spec) | MVP Bug Flow (Fase 2.5) é suficiente para o comentário de PR |
| Aceitar `.feature` como entrada (BDD-first) | Inverteria a direção do fluxo; sem demanda real |
| Paralelização de cenários | Sequencial é mais simples e o gargalo é o LLM, não o browser |

---

## 10. Fases de Fechamento (uma preocupação por PR, suite verde entre fases)

> Protocolo idêntico ao da simplificação: `npm run check` verde ao fim de cada fase.

### Fase A — Higiene e fundação (G10, G2)
- [ ] `.gitignore`: `meshamail-auth.json`, `*-auth.json`, `qa-agent-runs/`.
- [ ] Mover configs experimentais da raiz para `configs/experimental/` (ou deletar os obsoletos).
- [ ] `QA_AGENT_BASE_URL` override no config loader + teste unitário.
- [ ] Merge ou flag da branch `feature/sub-agent-orchestrator` (decisão G9).

### Fase B — Empacotamento (G1, G3)
- [ ] `Dockerfile` de release (multi-stage, dist + browsers) + `wait-for-ready.sh`.
- [ ] `.github/workflows/ci.yml` (check + smoke) no próprio repo.
- [ ] `.github/workflows/release.yml` (build + push `ghcr.io/mesha/qa-agent` por tag).
- [ ] Comando `pipeline all` com gates da §4.3.

### Fase C — Integração de PR (G1, G6)
- [ ] Template `qa-agent.yml` de referência (docs/templates/) + doc de onboarding (§6.3).
- [ ] Smoke real: 1 PR de teste num repo alvo com preview Traefik, ponta a ponta
      (preview sobe → agente roda → comentário aparece → artifacts salvos).
- [ ] Documentar os dois caminhos de auth (formLogin canônico, storageState seed).

### Fase D — Profissionalização do output (G4, G5, G7)
- [ ] Gherkin sintático no `GherkinRendererService` + `.feature` por cenário como artifact.
- [ ] Seção Gherkin colapsável no comentário do PR (status por cenário).
- [ ] Header de versão + validação do contrato `memory.md` v1 no loader.
- [ ] Step de write-back da memória no workflow template (commit `[skip ci]`).

### Fase E — Fechamento
- [ ] Atualizar `README.md` + `PROJECT-MAP.md` com a arquitetura operacional (§4).
- [ ] Arquivar specs concluídas em `docs/historico/`.
- [ ] Tag `v2.0.0` + imagem publicada.

---

## 11. Critérios de Aceite da V2 Definitiva

1. **Onboarding em ≤ 30 minutos:** um repo alvo novo integra o agente com 1 workflow +
   1 config + secrets, sem tocar no código do agente.
2. **Ciclo completo num PR real:** preview Traefik sobe → agente espera readiness →
   correlaciona task ClickUp + diff → executa no preview → comenta no PR com cobertura,
   Gherkin e evidências → promove aprendizado com commit de memória.
3. **Comentário único por PR** (upsert), com: status geral, cobertura de critérios de
   aceite, cenários em Gherkin com status, bugs com links de evidência, métricas.
4. **Zero estado fora do repo alvo:** memória versionada em `.agent-qa/memory.md`;
   artefatos de run como GitHub artifacts; nenhum arquivo de auth versionado.
5. **Falha honesta:** PR sem task ClickUp, preview fora do ar ou token ausente produzem
   bloqueio com motivo legível (preflight/correlate BLOCKED), nunca falso-verde.
6. **Custo previsível:** caminho feliz ≤ 3 chamadas LLM por PR (classify + plan + eventuais
   degraus da escada); telemetria da escada visível no relatório.
7. **CI do agente verde:** `npm run check` + smoke em container como gate de release.

---

## 12. Decisões Registradas

| Decisão | Escolha | Alternativa rejeitada | Motivo |
|---|---|---|---|
| Forma de distribuição | Imagem Docker (ghcr.io) usada como `container:` no job | Action JS/composite; pacote npm | Browsers Playwright pesados; imagem é cacheada no runner self-hosted; versão pinada |
| Onde a memória mora | `.agent-qa/memory.md` no repo alvo, versionada | Storage central no agente | Memória é conhecimento do produto testado; revisável em PR |
| Acesso ao preview | URL pública via Traefik | Rede interna Docker | Fidelidade (TLS/cookies/redirects); runner está na mesma VPS, latência irrelevante |
| Write-back de memória | Commit direto na branch do PR (`[skip ci]`) | PR separado de memória | Simplicidade; o aprendizado fica auditável no próprio PR que o gerou |
| Gherkin | Derivado do ExecutionPlan (saída) | BDD-first (.feature como entrada) | Não inverter o fluxo; Gherkin é linguagem de relatório na v2 |
| Tool Queue (branch atual) | Opt-in atrás de flag | Caminho canônico da v2 | HYBRID_GUARDED é o que está validado; não acoplar fechamento a experimento |
| Vídeo por cenário | v2.1 (spec pronta) | Dentro da v2 | Não bloqueia operação real; evidência atual já atende o comentário de PR |

---

## 13. Referências

- `docs/V2-SIMPLIFICATION-PLAN.md` — enxugamento concluído (pré-requisito desta v2).
- `docs/scenario-workspace-memory-spec.md` — spec v2.1 (vídeo por cenário + runtime memory).
- `docs/SUB-AGENT-ORCHESTRATOR.md` — Tool Queue (opt-in).
- `src/main.ts` — comandos `pipeline *` existentes.
- `src/application/use-cases/run-pipeline-correlate.usecase.ts` — correlacionador.
- `src/application/services/pr-reporter.service.ts` + `src/infra/github/fetch-github-comment.adapter.ts` — feedback no PR.
- `src/application/services/memory-search.service.ts` + `bm25-memory-index.service.ts` — memória BM25.
- `Dockerfile.playwright` — base da imagem de release.
