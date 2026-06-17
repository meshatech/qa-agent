# QA Agent por PR — Modelo A (job de CI)

> Status: **desenho aprovado, em implementação**
> Decisão: **Modelo A** (agente como job do GitHub Actions) — mais viável, escalável e de menor manutenção pro nosso tamanho (3-4 repos, 1 VPS).
> O Modelo B (serviço/webhook) fica pra quando a escala justificar.

---

## Visão geral

Ao abrir/atualizar um PR, o GitHub Actions roda **3 jobs** num workflow **reusável** que vive aqui no `mesha-previews`. Cada repo-alvo só tem um **caller** de ~15 linhas + um manifesto. Tudo roda no **runner self-hosted da VPS de HML**.

```
PR (kriya-web → release)
  └─ Job 1  build-preview   → sobe o ambiente do PR, expõe preview_url
       └─ Job 2  qa-agent   → roda os testes contra a preview_url, comenta no PR   (needs)
  └─ Job 3  teardown        → derruba a stack + DROP do banco                       (on: PR closed)
```

Por que Modelo A: **o GitHub Actions já é o orquestrador** (fila, concorrência, secrets, logs, retry, resultado nativo no PR). Cada PR é um **job isolado** — sem serviço de pé pra manter, sem colisão entre PRs, sem fila pra construir. O agente já roda assim hoje com a imagem `v2.0.0`.

---

## Job 1 — `build-preview`

Roda em `runs-on: [self-hosted, vps]`. Reaproveita o que já existe no `kriya-web/.github/workflows/preview.yml`.

| Passo | O que faz |
|---|---|
| 1 | Checkout do web (branch do PR) + resolve a branch da api (**branch-match** → senão `main`) |
| 2 | **Clona o HML** num banco descartável `qa_pr_<n>` (a partir de um snapshot noturno; ver `Pré-requisitos`) |
| 3 | Builda imagens web+api (web com `NEXT_PUBLIC_API_URL` do preview) |
| 4 | `docker compose up` com labels do **Traefik** → URL pública por PR |
| 5 | Espera HTTP 200 e **expõe `preview_url` como output** do job |
| 6 | Comenta a URL no PR (sticky) |

**Contrato de saída (obrigatório):**
```yaml
outputs:
  preview_url: ${{ steps.deploy.outputs.url }}
  # ex.: https://kriya-pr-94.preview.kriya-hml.mesha.com.br
```

---

## Job 2 — `qa-agent`

`needs: build-preview`. Roda como **container** da imagem oficial.

```yaml
qa-agent:
  needs: build-preview
  runs-on: [self-hosted, vps]
  container: { image: ghcr.io/mesha/qa-agent:v2.0.0 }
  env:
    QA_AGENT_BASE_URL: ${{ needs.build-preview.outputs.preview_url }}  # URL por job
    CLICKUP_TOKEN: ${{ secrets.CLICKUP_TOKEN }}
    GROQ_API_KEY:  ${{ secrets.GROQ_API_KEY }}
    GITHUB_TOKEN:  ${{ secrets.GITHUB_TOKEN }}
```

| Passo | O que faz |
|---|---|
| 1 | `checkout` (fetch-depth: 0) — diff base…head + config + memória do repo |
| 2 | **Auth:** `curl` no `/auth/sso/test-login` do preview → captura cookies → escreve `storageState.json` |
| 3 | `qa-agent pipeline all` (prepare → correlate → generate-plan → execute → report → learning) |
| 4 | Comenta o resultado no PR (upsert) + `upload-artifact` (vídeo, screenshots, traces) |

**Auth (decisão Kriya):** o app é SSO-exclusivo (WSO2). Em vez de formLogin, usamos a porta **`GET /auth/sso/test-login`** (gated por `PREVIEW_TEST_AUTH`, só no preview) que emite sessão sem WSO2. O workflow faz `curl`, pega os cookies e monta um `storageState.json` → o agente roda com `auth.kind: storageState`. **Zero mudança no agente.**

**URL dinâmica:** vem por `QA_AGENT_BASE_URL` (override que já existe no agente). Como cada PR é um **job isolado**, cada um tem a sua env — sem colisão (essa é a razão de o Modelo A funcionar onde o B ainda não).

---

## Job 3 — `teardown`

`if: github.event.action == 'closed'`.

| Passo | O que faz |
|---|---|
| 1 | `docker compose down` (containers/rede do PR) |
| 2 | **`DROP DATABASE qa_pr_<n>`** — não acumula na VPS |
| 3 | Limpa imagens órfãs do PR |

---

## Insumos do agente

| Insumo | De onde | Pra quê |
|---|---|---|
| **Task ClickUp** | id no nome da branch/título/descrição do PR | a demanda (o que testar) |
| **Diff do PR** | `actions/checkout` (fetch-depth 0) | foca os cenários no que mudou |
| **Memória** | Postgres (memory store do agente) | reusa cenários/locators aprendidos |

---

## Contrato de segredos (no repo-alvo)

| Secret/var | Pra quê |
|---|---|
| `CLICKUP_TOKEN` | ler a demanda (preflight bloqueia PR sem task) |
| `GROQ_API_KEY` | LLM do agente |
| `GITHUB_TOKEN` | comentar o relatório no PR (automático no Actions) |
| `PREVIEW_TEST_AUTH_TOKEN` | 2º fator do test-login (no compose do preview) |
| `KRIYA_API_DEPLOY_KEY` | clonar a api (já existe) |

---

## Onboarding de um repo novo (≤ 15 linhas)

```yaml
# .github/workflows/qa.yml  (no repo-alvo)
on: { pull_request: { branches: [release], types: [opened, synchronize, reopened, closed] } }
concurrency: { group: qa-pr-${{ github.event.number }}, cancel-in-progress: true }
jobs:
  qa:
    uses: meshatech/mesha-previews/.github/workflows/preview-qa.yml@v1
    secrets: inherit
```
+ `.qa-preview.yml` (manifesto, já existe) + `agent-qa.config.json` + `.agent-qa/memory.md`.

---

## Pré-requisitos (estado)

| Item | Status |
|---|---|
| Imagem `ghcr.io/mesha/qa-agent:v2.0.0` | ✅ publicada |
| Override `QA_AGENT_BASE_URL` | ✅ existe no agente |
| `/auth/sso/test-login` (porta de auth do preview) | ✅ implementado (branch `feat/preview-test-login`, em stash — retomar) |
| Snapshot+clone do HML por PR + DROP no teardown | ⏳ a fazer (cron de snapshot na VPS) |
| Workflow reusável `preview-qa.yml` aqui no `mesha-previews` | ⏳ a fazer (esta entrega) |
| `agent-qa.config.json` no kriya-web (auth storageState) | ⏳ a fazer |

---

## Ordem de execução

1. Extrair o `preview.yml` do kriya-web pro **reusável** aqui (jobs 1-3).
2. Wire do job `qa-agent` (container v2.0.0 + test-login → storageState + `pipeline all`).
3. Snapshot/clone do banco + DROP no teardown.
4. `agent-qa.config.json` + caller no kriya-web (piloto).
5. Smoke: 1 PR ponta-a-ponta → replicar nos outros 3 repos.

> Evolução futura → **Modelo B** (serviço/webhook): só quando muitos repos + volume alto, ou control-plane central, ou trigger fora do GitHub. Exige fechar 4 lacunas no agente (async/fila, isolamento por request, diff via GitHub API, entrega de resultado).

---

## Detalhes Técnicos de Implementação

As seções abaixo descrevem os componentes internos do agente necessários para o auto-config (Modelo A) e para a evolução futura (Modelo B).

---

## 4. Skill de Auto-Config

### 4.1 Contexto que a Skill recebe

| Input | Fonte |
|-------|-------|
| `previewUrl` | Env var / CLI arg (`--preview-url`) |
| `baseUrl` | Extraído da `previewUrl` |
| `appDomains` | Domínio extraído da `previewUrl` |
| `demand` | ClickUp (já lido no `correlate`) |
| `prDiffContext` | `pr-diff-context.json` (já gerado pelo pipeline) |
| `projectMemory` | Postgres (se existir) |
| `llmConfig` | Variáveis de ambiente (`OPENROUTER_API_KEY`, etc.) |

### 4.2 Schema que a Skill deve conhecer

A skill recebe o schema completo do `RunConfig` como contexto no prompt (versão resumida), para que o LLM seja **conciso e não alucine campos**.

```
Você recebe:
- URL de preview
- Demanda ClickUp
- Diff do PR
- Conhecimento prévio do projeto (se houver em memória)

Monte um JSON que segue estritamente este schema: [schema resumido aqui].
```

### 4.3 Campos inferidos pela Skill

| Campo | Como é inferido |
|-------|-----------------|
| `baseUrl` | Direto da `previewUrl` |
| `appDomains` | Domínio da `previewUrl` |
| `demand.id/title/description` | ClickUp task |
| `auth.kind` | Ver seção 5 (detecção de auth) |
| `llm.*` | Variáveis de ambiente |
| `browser/timeouts/runtime/...` | Defaults do schema |
| `pr.*` | Metadata do PR (já no `pr-diff-context.json`) |

---

## 5. Detecção de Auth — 2 Camadas

### 5.1 Arquitetura de Detecção

```
┌─────────────────────────────────────────────────────────────┐
│                    Detecção de Auth                         │
├─────────────────────────────────────────────────────────────┤
│  1. Recebe preview URL + demanda + diff + projeto (repo)    │
│                                                             │
│  2. CHECK: Existe memória de longo prazo para este repo?    │
│     ├── SIM → Puxa knowledge base do Postgres               │
│     │         (ex: "Repo kriya-hml tem auth via Keycloak")    │
│     │         └── Usa como base, mas valida com diff          │
│     └── NÃO → Dispara Skill de Análise de Projeto            │
│                 └── Navega na branch base (main/develop/hml) │
│                     └── Mapeia: existe módulo de login?       │
│                                                             │
│  3. Correlação: O diff do PR toca módulos que exigem auth?  │
│     ├── SIM → auth.kind = formLogin/ssoRedirect (inferido)  │
│     └── NÃO → auth.kind = none                                │
│                                                             │
│  4. Persistência: Armazena/Atualiza na memória Postgres       │
│     └── Markdown estruturado por projeto                       │
│                                                             │
│  5. Próximo PR no mesmo repo → step 2 já tem dados           │
└─────────────────────────────────────────────────────────────┘
```

### 5.2 Regra Principal: Branch de Análise

- Se o PR target é `main` → analisa `main`
- Se target é `develop` → analisa `develop`
- Se target é `hml` → analisa `hml`
- (ou sempre analisa a **branch base** do PR)

### 5.3 Lógica de Decisão do Auth

```
if (memory existe para este repo) {
  // Usa conhecimento prévio
  authInfo = memory.auth;
  
  // Mas valida: o diff toca módulo protegido?
  if (diffTocaModuloProtegido(diff, memory.protectedModules)) {
    auth.kind = inferirTipoAuth(memory.authDetails);
  } else {
    auth.kind = 'none';
  }
} else {
  // Não conhece o projeto → analisa do zero
  projectAnalysis = skillAnalisarProjeto(previewUrl, branchBase);
  
  if (projectAnalysis.temModuloDeLogin) {
    auth.kind = inferirTipoAuth(projectAnalysis);
  } else {
    auth.kind = 'none';
  }
  
  // Persiste para próximas vezes
  memory.save(projectAnalysis);
}
```

---

## 6. Memória de Longo Prazo (Postgres)

### 6.1 O que deve ser armazenado

A memória deve conhecer o projeto **de forma profunda**, não apenas superficial:

| Categoria | O que salvar | Exemplo |
|-----------|-------------|---------|
| **Auth** | Tipo, URL, seletores, módulo | `kind: formLogin`, `loginUrl: /login`, `module: src/modules/auth/` |
| **Módulos protegidos** | Rotas/features que exigem auth | `/dashboard`, `/admin`, `/settings` |
| **Todos os módulos** | Mapa completo da aplicação | `src/modules/auth/`, `src/modules/dashboard/`, `src/modules/billing/` |
| **Regras principais** | Regras de negócio críticas | "Usuário precisa ter role ADMIN para acessar /admin" |
| **Como funciona** | Fluxos principais da aplicação | "Login → Dashboard → Billing → Pagamento" |
| **Dependências** | Serviços externos usados | "Keycloak para auth", "Stripe para pagamentos" |
| **Padrões de UI** | Padrões visuais recorrentes | "Todas as modais têm botão de fechar no canto superior direito" |
| **Dados de teste** | Dados conhecidos para testes | "CPF de teste: 000.000.000-00", "Email: teste@example.com" |
| **Erros de console** | Erros conhecidos (não bugs) | `"omnitagjs.com" — tracker, ignorar` |
| **Performance baselines** | Tempos de referência | "Página /dashboard carrega em ~2s" |
| **Última análise** | Quando foi analisado pela última vez | `lastAnalyzedAt: 2026-06-17T14:00:00Z` |
| **Branch analisada** | Qual branch foi usada como base | `analyzedBranch: develop` |
| **Commit** | Commit SHA da análise | `commitSha: abc123` |
| **Confiança** | Nível de confiança da análise | `confidence: high` |

### 6.2 Estrutura do ProjectKnowledge (JSONB/JSON com schema Zod)

> **Nota:** o formato de persistência é **JSONB no Postgres** (ou JSON em arquivo local no file adapter), validado pelo `ProjectKnowledgeSchema` (Zod). O markdown abaixo ilustra os campos conceituais que o schema cobre — é o formato que a LLM analysis skill retorna antes do parsing estruturado.

```markdown
# Project Knowledge: meshatech/kriya-hml

## Metadata
- repo: meshatech/kriya-hml
- analyzedAt: 2026-06-17T14:00:00Z
- analyzedBranch: develop
- commitSha: abc123def456
- confidence: high

## Auth
- kind: formLogin
- loginUrl: /login
- loginModule: src/modules/auth/
- detectedAt: 2026-06-17
- selectors:
  - username: input[name="email"]
  - password: input[name="password"]
  - submit: button[type="submit"]
- successWhen:
  - urlContains: /dashboard

## Modules Requiring Auth
| Module | Route | Description |
|--------|-------|-------------|
| Dashboard | /dashboard | Main user dashboard |
| Admin | /admin | Admin panel (role ADMIN) |
| Settings | /settings | User settings |
| Billing | /billing | Payment management |

## All Modules
| Module | Route | Requires Auth | Description |
|--------|-------|---------------|-------------|
| Auth | /login, /register | No | Authentication flows |
| Dashboard | /dashboard | Yes | Main dashboard |
| Landing | / | No | Public landing page |
| Admin | /admin | Yes (ADMIN role) | Admin panel |
| Billing | /billing | Yes | Payment & invoices |
| Settings | /settings | Yes | User preferences |

## Business Rules
- BR-001: Usuário precisa estar autenticado para acessar /dashboard
- BR-002: Apenas usuários com role ADMIN podem acessar /admin
- BR-003: Pagamentos usam Stripe (checkout redirect)
- BR-004: Sessão expira em 30 minutos de inatividade

## Main Flows
1. **Onboarding**: Landing → Register → Verify Email → Dashboard
2. **Login**: /login → Dashboard → (Settings | Billing | Admin)
3. **Payment**: Dashboard → Billing → New Payment → Stripe Checkout → Success

## External Dependencies
- Auth: Keycloak (SSO)
- Payments: Stripe
- Emails: SendGrid
- CDN: CloudFront

## UI Patterns
- Modais: botão de fechar no canto superior direito (`[aria-label="Fechar"]`)
- Toast notifications: aparecem no topo-direito, auto-dismiss em 5s
- Formulários: usam `data-testid="form-*"` como fallback
- Tabelas: paginação via botões `«` `»` no rodapé

## Test Data
| Campo | Valor de Teste | Observação |
|-------|----------------|------------|
| CPF | 000.000.000-00 | Usado em sandbox |
| Email | teste@example.com | Não envia email real |
| Senha | Teste123! | Sempre funciona em HML |
| Cartão | 4242 4242 4242 4242 | Stripe test card |

## Console Noise Patterns (conhecidos)
- `omnitagjs.com` — tracker, ignorar
- `doubleclick.net` — ads, ignorar
- `FB.init` — Facebook SDK, ignorar em HML
- `axe-core` — warnings de acessibilidade em teardown, ignorar

## Performance Baselines
| Página | Métrica | Valor | Observação |
|--------|---------|-------|------------|
| /landing | LCP | ~1.2s | Imagem hero otimizada |
| /dashboard | TTI | ~2.0s | SPA hydration |
| /billing | FCP | ~0.8s | Conteúdo estático |

## Notes
- Aplicação é SPA (React + Vite)
- Build gerado via Vite, served via Nginx
- Preview URLs geradas pelo Kriya
```

### 6.3 Estratégia de Atualização Incremental

- **Primeira análise**: Projeto desconhecido → análise completa → salva tudo.
- **PRs subsequentes**: Puxa memória existente → valida se algo mudou (novo módulo, novo auth) → **atualiza apenas o que mudou**.
- **Stale detection**: Se `analyzedAt` > 30 dias, pode forçar re-análise completa.

---

## 7. Componentes a Implementar

### 7.1 Nova Camada de Memória de Projeto

```
src/application/
  ports/
    project-memory-store.port.ts      # Interface: load/save project knowledge
  services/
    project-memory-manager.service.ts  # Orquestra leitura/escrita

domain/schemas/
  project-knowledge.schema.ts         # Zod schema do conhecimento

infra/memory/
  postgres-project-memory.adapter.ts  # Implementação Postgres
```

### 7.2 Skill de Análise do Projeto

```
src/infra/llm/
  project-analysis-skill.prompt.ts    # Prompt que ensina o LLM a analisar
  auto-config-skill.prompt.ts         # Prompt que monta o RunConfig JSON
```

### 7.3 Auto-Config Builder

```
src/application/
  services/
    auto-config-builder.service.ts    # Orquestra: URL + memória + skill → config
  use-cases/
    run-auto-config.usecase.ts        # Use case exposto no CLI
```

### 7.4 CLI

```
src/cli/cli.command.ts          # Novo: --preview-url, --auto-config
src/cli/cli.service.ts          # runAutoConfig()
```

---

## 8. Novo Fluxo `pipeline all` com Auto-Config

```
1. pipeline prepare          # preflight + read-pr-context (já existe)
2. pipeline correlate        # demanda ClickUp + diff (já existe)
3. auto-config               # NOVO: monta o config JSON
4. generate-plan             # já existe, mas usa config gerado
5. execute                   # já existe
6. report                    # já existe
7. learning                  # já existe
8. promote-learning          # já existe
```

Ou no job de CI:

```yaml
- name: Run QA Agent Auto-Config
  run: |
    qa-agent pipeline all \
      --auto-config \
      --preview-url "${{ needs.build-preview.outputs.preview_url }}" \
      --output-dir ./.agent-qa/pipeline
```

---

## 9. Decisões Tomadas

| # | Decisão | Status | Nota |
|---|---------|--------|------|
| 1 | **Probe rápido** antes de decidir auth? | **Adiada** | Auth 100% determinístico (memory + diff). Probe adicionaria latência sem ganho claro no Modelo A. |
| 2 | Memória por **repo + branch** | **Decidido** | Chave primária Postgres é `(repo, branch)`. Permite diferenças entre `main`/`develop`/`hml`. |
| 3 | **Multi-tenant** | **Adiado** | Fora do escopo Modelo A. Quando surgir, usar prefixo de projeto na chave de memória. |
| 4 | Skill de análise **síncrona** vs assíncrona | **Decidido** | Síncrona — roda na esteira do CI. Modelo B (assíncrono) só quando escala justificar. |
| 5 | `ssoRedirect` como tipo de auth | **Parcial** | Schema suporta `kind: 'ssoRedirect'`, mas o `AutoConfigBuilderService` não enriquece campos específicos (redirectUrl, etc.). Não necessário no Kriya (usa `storageState` via test-login). Implementar se um repo futuro usar SSO nativo. |

---

## 10. Checklist de Implementação

1. **[x]** `ProjectMemoryStorePort` + schema Zod (`project-knowledge.schema.ts`)
2. **[x]** `PostgresProjectMemoryAdapter` + file fallback + router (`project-memory-store-router.adapter.ts`)
3. **[x]** `ProjectAnalysisSkill` (prompt LLM) (`project-analysis-skill.prompt.ts`)
4. **[x]** `AutoConfigBuilderService` (`auto-config-builder.service.ts`)
5. **[x]** `RunAutoConfigUseCase` (`run-auto-config.usecase.ts`)
6. **[x]** Wire no CLI (`--preview-url`, `--auto-config`, `pipeline auto-config` subcommand)
7. **[x]** Integrar no `pipeline all` como step opcional (entre correlate e risk)
8. **[x]** Testes unitários (30 novos, 1782/1782 passando no Docker)

### Próximos passos (fora do repo qa-agent)

9. **[ ]** Workflow reusável `preview-qa.yml` no `meshatech/mesha-previews`
10. **[ ]** Snapshot noturno do banco HML na VPS (cron)
11. **[ ]** `agent-qa.config.json` no `kriya-web` com `auth.kind: storageState`
12. **[ ]** Smoke test ponta-a-ponta com 1 PR real

---

## 11. Glossário

| Termo | Significado |
|-------|-------------|
| **Skill** | Um prompt especializado + lógica de parsing que ensina o LLM a realizar uma tarefa específica |
| **Auto-Config** | O processo de gerar `agent-qa.config.json` sem input manual |
| **Project Memory** | Conhecimento persistente sobre um projeto/repositório, armazenado em Postgres |
| **Branch Base** | A branch para qual o PR está sendo mergeado (ex: `main`, `develop`, `hml`) |
| **Probe** | Navegação rápida na aplicação para coletar informações (sem executar cenários completos) |
