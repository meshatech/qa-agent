# V2 Definitiva — Tasks Refinadas

> Cada task tem: **contexto**, **o que falta**, **critério de aceite**, **estimativa**.

---

## Fase A — Fundação e Higiene

### Task A1 — `.gitignore` de arquivos de autenticação

**Contexto:** `meshamail-auth.json` e similares estão versionados. Isso é risco de segurança.

**O que falta:** Adicionar ao `.gitignore`:
```
*-auth.json
meshamail-auth.json
storage-state.json
.agent-qa/pipeline/state/
```

**Critério de aceite:**
- `git status` não mostra mais `meshamail-auth.json` como untracked
- Arquivo `meshamail-auth.json` atual é removido do versionamento (`git rm --cached`)

**Estimativa:** 10 min

---

### Task A2 — Organizar configs experimentais

**Contexto:** 18 arquivos `agent-qa.*.config.json` poluem a raiz (`codeshare.v2` até `meshamail.70b.v6`).

**O que falta:**
- Criar diretório `configs/experimental/`
- Mover todos os configs não-canônicos (tudo exceto `agent-qa.config.json`)
- Atualizar referências nos testes que usam esses paths

**Critério de aceite:**
- Raiz do repo tem apenas `agent-qa.config.json` (canônico)
- `configs/experimental/` contém os demais
- `npm run check` passa (nenhum teste quebrado por path)

**Estimativa:** 30 min

---

### Task A3 — `QA_AGENT_BASE_URL` override no config loader

**Contexto:** Preview env tem URL dinâmica por PR (`pr-<N>.preview...`). O config `baseUrl` é estático.

**O que falta:**
- Em `ValidateConfigUseCase.execute()`, após parse Zod:
  ```typescript
  if (process.env.QA_AGENT_BASE_URL) {
    config.baseUrl = process.env.QA_AGENT_BASE_URL;
  }
  ```
- Adicionar wildcard do preview em `appDomains` automaticamente
  ```typescript
  // se QA_AGENT_PREVIEW_DOMAIN=*.preview.meshamail.dev
  config.appDomains.push(process.env.QA_AGENT_PREVIEW_DOMAIN ?? config.baseUrl);
  ```

**Critério de aceite:**
- Teste unitário: `config.baseUrl` é overrideado pelo env
- Teste unitário: `appDomains` inclui domínio do preview
- Pipeline `execute` usa a URL do preview, não a do config

**Estimativa:** 1h

---

### Task A4 — Decisão: branch `feature/sub-agent-orchestrator`

**Contexto:** Branch aberta com `ToolQueueSchema`, mapper e replan. Não está fechada.

**O que falta (decisão):**
- **Opção 1:** Merge na main com flag `runtime.tools.enabled: false` (default)
- **Opção 2:** Arquivar branch, manter como experimento separado

**Recomendação:** Opção 1 — merge com flag. O código existe, não quebra nada se desabilitado.

**Critério de aceite:**
- Branch mergeada ou decisão documentada
- `HYBRID_GUARDED` continua como caminho canônico
- `tools.enabled: true` ativa Tool Queue (opt-in)

**Estimativa:** 2h (merge + ajustes de conflito)

---

## Fase B — Empacotamento

### Task B1 — Comando `pipeline all`

**Contexto:** Hoje cada etapa é comando separado. Workflow precisa de 7 steps. Deve ser 1.

**O que falta:**
- Novo comando `qa-agent pipeline all --config <path>`
- Executa em sequência: `prepare` → `correlate` → `generate-plan` → `execute` → `report` → `learning` → `promote-learning --auto-approve`
- Gates fail-fast: se `prepare` BLOCKED, para. Se `correlate` BLOCKED, para.
- Propaga exit code: `OK`, `BUGS_FOUND`, `CONFIG_ERROR`, `BLOCKED`

**Critério de aceite:**
- `qa-agent pipeline all` roda todas as etapas em sequência
- Se `prepare` retorna BLOCKED, nenhuma etapa subsequente roda
- Exit code final é o mais severo encontrado
- Teste de integração cobre caminho feliz + bloqueio no preflight

**Estimativa:** 3h

---

### Task B2 — `scripts/wait-for-ready.sh`

**Contexto:** O workflow precisa esperar o preview responder antes de executar.

**O que falta:**
- Shell script `scripts/wait-for-ready.sh`:
  ```bash
  #!/bin/bash
  URL=$1
  for i in $(seq 1 60); do
    code=$(curl -s -o /dev/null -w '%{http_code}' "$URL" || true)
    [ "$code" = "200" ] && exit 0
    sleep 2
  done
  echo "Preview not ready after 120s" && exit 1
  ```
- Script incluído na imagem Docker em `/opt/qa-agent/`

**Critério de aceite:**
- Script funciona contra qualquer URL
- Timeout configurável via env `QA_AGENT_PREVIEW_TIMEOUT` (default 120s)
- Retorna exit 0 se 200, exit 1 se timeout

**Estimativa:** 30 min

---

### Task B3 — Dockerfile de release

**Contexto:** `Dockerfile.playwright` existe mas é para desenvolvimento. Precisa de release multi-stage.

**O que falta:**
```dockerfile
# Dockerfile (release)
FROM mcr.microsoft.com/playwright:v1.60.0-noble
WORKDIR /opt/qa-agent
COPY package*.json ./
RUN npm ci --omit=dev --no-audit --no-fund
COPY dist/ ./dist/
COPY scripts/wait-for-ready.sh ./
RUN ln -s /opt/qa-agent/dist/main.js /usr/local/bin/qa-agent \
 && chmod +x dist/main.js
ENTRYPOINT []
```

**Critério de aceite:**
- Build: `docker build -t qa-agent:local .` funciona
- Container: `docker run qa-agent:local qa-agent --version` responde
- Container: `docker run qa-agent:local qa-agent pipeline all --help` funciona
- Tamanho < 2GB (base Playwright é ~1.5GB)

**Estimativa:** 2h

---

### Task B4 — CI do próprio repo (`.github/workflows/ci.yml`)

**Contexto:** Nenhum CI existe no repo qa-agent. Sem proteção de regressão.

**O que falta:**
```yaml
name: CI
on: [push, pull_request]
jobs:
  check:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
      - run: npm ci
      - run: npm run check  # tsc + eslint + testes unitários
  smoke:
    runs-on: ubuntu-latest
    container:
      image: mcr.microsoft.com/playwright:v1.60.0-noble
    steps:
      - uses: actions/checkout@v4
      - run: npm ci
      - run: npm run test:smoke  # smoke com fake LLM
```

**Critério de aceite:**
- Push em qualquer branch dispara CI
- `npm run check` passa (sem regressão)
- Smoke executa com sucesso (sem browser real, fake LLM)

**Estimativa:** 1h

---

### Task B5 — Release workflow (`.github/workflows/release.yml`)

**Contexto:** Sem workflow de release, a imagem Docker não é publicada automaticamente.

**O que falta:**
```yaml
name: Release
on:
  push:
    tags: ['v*']
jobs:
  release:
    runs-on: ubuntu-latest
    permissions:
      packages: write
    steps:
      - uses: actions/checkout@v4
      - uses: docker/login-action@v3
        with:
          registry: ghcr.io
          username: ${{ github.actor }}
          password: ${{ secrets.GITHUB_TOKEN }}
      - run: npm ci && npm run build
      - uses: docker/build-push-action@v5
        with:
          push: true
          tags: |
            ghcr.io/mesha/qa-agent:${{ github.ref_name }}
            ghcr.io/mesha/qa-agent:latest
```

**Critério de aceite:**
- Tag `v2.0.0` dispara build e push
- Imagem disponível em `ghcr.io/mesha/qa-agent:v2.0.0`
- Imagem roda `qa-agent --version` corretamente

**Estimativa:** 1h

---

## Fase C — Integração

### Task C1 — Template workflow para repo alvo

**Contexto:** Cada repo alvo precisa copiar um workflow. Deve ser um template claro.

**O que falta:**
- Criar `docs/templates/qa-agent.yml`:
  ```yaml
  name: QA Agent
  on:
    pull_request:
      types: [opened, synchronize, reopened]
  concurrency:
    group: qa-agent-pr-${{ github.event.number }}
    cancel-in-progress: true
  jobs:
    build-preview:
      runs-on: [self-hosted, vps]
      outputs:
        preview_url: ${{ steps.deploy.outputs.url }}
      steps:
        - id: deploy
          run: echo "url=https://pr-${{ github.event.number }}.preview.example.com" >> "$GITHUB_OUTPUT"
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
        - uses: actions/checkout@v4
          with: { fetch-depth: 0 }
        - run: /opt/qa-agent/wait-for-ready.sh "$QA_AGENT_BASE_URL"
        - run: qa-agent pipeline all --config ./agent-qa.config.json
        - uses: actions/upload-artifact@v4
          if: always()
          with:
            name: qa-agent-evidence-pr-${{ github.event.number }}
            path: .agent-qa/pipeline/
  ```

**Critério de aceite:**
- Template copiável para qualquer repo alvo
- Instruções claras em `docs/templates/README.md`
- Onboarding ≤ 30 minutos para novo repo

**Estimativa:** 1h

---

### Task C2 — Documentar caminhos de auth para CI

**Contexto:** `capture-auth` é interativo. Em CI precisa de alternativa.

**O que falta:**
- Documentação em `docs/auth-in-ci.md`:
  - **Caminho 1 (canônico):** `formLogin` — config + secrets `QA_AGENT_USER`/`QA_AGENT_PASS`
  - **Caminho 2 (seed):** `storageState` — gerar localmente uma vez, salvar como secret/artifact
  - **Caminho 3:** `none` — páginas públicas

**Critério de aceite:**
- Documento explica cada caminho com exemplo de config
- Inclui como criar usuário de teste no preview
- Inclui como gerar e criptografar storageState

**Estimativa:** 1h

---

### Task C3 — Smoke real ponta a ponta

**Contexto:** Nunca foi testado o ciclo completo em um PR real.

**O que falta:**
- Escolher 1 repo alvo piloto (Meshamail)
- Criar PR de teste
- Verificar:
  1. Preview sobe
  2. Agente roda no container
  3. Comentário aparece no PR
  4. Artifacts são salvos
  5. Memória é atualizada (se write-back ativado)

**Critério de aceite:**
- 1 PR de teste com comentário do agente visível
- Artifacts baixáveis no GitHub Actions
- Sem erros no log do job

**Estimativa:** 4h (inclui debugging)

---

## Fase D — Profissionalização

### Task D1 — Gherkin sintático real + `.feature` artifact

**Contexto:** `GherkinRendererService` emite Markdown com blocos de código, não Gherkin sintático.

**O que falta:**
- Modificar `GherkinRendererService` para emitir:
  ```gherkin
  # language: pt
  Funcionalidade: Alternância de tema (CU-868)

    Cenário: Usuário alterna para tema escuro
      Dado que o menu de conta está visível
      Quando clico no botão "Tema"
      E seleciono "Escuro"
      Então o atributo "data-theme" do documento é "dark"
  ```
- Adicionar `PersistGherkinScenariosUseCase` que gera `.feature` por cenário em `evidence/features/`
- Mapeamento determinístico: `precondition` → `Dado`, `action` → `Quando`, `postcondition` → `Então`

**Critério de aceite:**
- `.feature` gerado é Gherkin sintático válido (pode ser parseado por qualquer parser)
- Inclui `# language: pt`
- Status por cenário: `@passed`, `@failed`, `@blocked`

**Estimativa:** 4h

---

### Task D2 — Seção Gherkin colapsável no comentário do PR

**Contexto:** Comentário do PR é Markdown puro. Gherkin deve ser visual e colapsável.

**O que falta:**
- Modificar `PRReportRenderer` para incluir seção:
  ```markdown
  <details>
  <summary>📋 Cenários executados (Gherkin)</summary>

  ```gherkin
  # ... blocos com status ...
  ```
  </details>
  ```
- Cada cenário com emoji de status (✅/⚠️/❌)

**Critério de aceite:**
- Comentário no PR tem seção colapsável
- Gherkin é legível sem expandir (título + status)
- Links para `.feature` artifact

**Estimativa:** 2h

---

### Task D3 — Contrato `memory.md` v1

**Contexto:** Formato dos chunks vive implícito no `MemoryChunker`.

**O que falta:**
- Modificar `MemoryMarkdownLoader` para validar header:
  ```markdown
  <!-- agent-qa-memory v1 -->
  ```
- Se ausente, emitir warning (back-compat) e assumir v1
- Rejeitar chunks sem `## [tipo] slug` válido
- Documentar contrato em `docs/memory-contract-v1.md`

**Critério de aceite:**
- `memory.md` gerado por `generate-memory` inclui header v1
- Loader valida e reporta chunks malformados
- Testes cobrem parsing válido e inválido

**Estimativa:** 2h

---

### Task D4 — Write-back da memória (commit na branch)

**Contexto:** `promote-learning` atualiza `memory.md` local, mas nada commita.

**O que falta:**
- Step no workflow template:
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
- Flag `memoryWriteBack: "commit" | "off"` no config (default: `"commit"`)

**Critério de aceite:**
- Se `memory.md` mudou, commit automático na branch do PR
- `[skip ci]` evita loop de workflow
- Se push falha (conflito), não quebra a run (warning)

**Estimativa:** 1h

---

## Fase E — Fechamento

### Task E1 — README operacional

**Contexto:** README atual é técnico. Precisa de guia de operação.

**O que falta:**
- Seção "Arquitetura operacional" com diagrama
- Seção "Onboarding de repo alvo" (30 min)
- Seção "CI/CD do agente"
- Link para templates

**Estimativa:** 2h

---

### Task E2 — Tag v2.0.0 + Imagem publicada

**O que falta:**
- `git tag v2.0.0`
- Push da tag dispara release workflow
- Verificar imagem em `ghcr.io/mesha/qa-agent:v2.0.0`

**Estimativa:** 10 min

---

## Melhorias Adicionais (pós-v2)

### Task M1 — Multi-provider LLM robusto

**Contexto:** Hoje só Groq/OpenAI. Falta fallback entre providers.

**O que falta:**
- `LLMProviderPort` com adapters:
  - `GroqLLMAdapter`
  - `OpenAiLLMAdapter`
  - `FakeLLMAdapter` (para testes)
- Config: `llm.provider: "groq" | "openai" | "fake"`
- Retry com fallback: se Groq falha (rate limit), tenta OpenAI
- Rate limit handling unificado

**Critério de aceite:**
- Troca de provider é só mudar config
- Testes rodam com `fake` (sem API key)
- Fallback automático em rate limit

**Estimativa:** 4h

---

### Task M2 — Integração ClickUp melhorada

**Contexto:** ClickUp task ID é extraído do PR, mas sem validação robusta.

**O que falta:**
- Validar se task existe antes de gerar plano
- Cache de task details (evita reconsulta)
- Link direto ClickUp no comentário do PR

**Estimativa:** 2h

---

### Task M3 — Health check do preview no preflight

**Contexto:** `wait-for-ready.sh` roda no workflow. Deveria ser parte do preflight.

**O que falta:**
- Adicionar `check: preview_reachable` no `PipelinePreflightService`
- Usar `QA_AGENT_BASE_URL` para ping
- Incluir status no `preflight-report.json`

**Estimativa:** 1h

---

## Resumo por Fase

| Fase | Tasks | Estimativa total |
|------|-------|------------------|
| A — Higiene | A1, A2, A3, A4 | ~6h |
| B — Empacotamento | B1, B2, B3, B4, B5 | ~8h |
| C — Integração | C1, C2, C3 | ~6h |
| D — Profissionalização | D1, D2, D3, D4 | ~9h |
| E — Fechamento | E1, E2 | ~2h |
| **Total v2** | | **~31h (~1 semana)** |
| Melhorias (M1–M3) | | +7h |

---

## Ordem de prioridade

1. **A1, A2** — Higiene (rápido, sem risco)
2. **A3** — QA_AGENT_BASE_URL (bloqueante para CI)
3. **B1, B2, B3** — pipeline all + Dockerfile + wait-for-ready
4. **B4, B5** — CI e release do repo
5. **C1, C2, C3** — Template + smoke real
6. **D1–D4** — Profissionalização
7. **E1, E2** — Fechamento
8. **M1–M3** — Melhorias (pós-v2)
