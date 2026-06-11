# V2 Definitiva — Tasks Concisas (máx. 10)

> Cada task conecta implementação técnica ao **human loop**: o que o dev/PO vê, o que acontece se não fizer, e como isso aterra no dia a dia.
>
> Fonte canônica: [`docs/V2-DEFINITIVE-PLAN.md`](V2-DEFINITIVE-PLAN.md). Os códigos `G1–G10` referenciam o Gap Analysis (§3) daquele plano. As 10 tasks abaixo são fixas — esta versão apenas refina as descrições.

---

## Task 1 — Fundação: Repo Limpo e URL Dinâmica

> Cobre **G10** (higiene), **G2** (baseUrl estático) e **G9** (decisão orchestrator). Plano §5.4, §10, §9.

### O que o humano vê hoje
Dev clona o repo e encontra 11+ arquivos `agent-qa.*.config.json` experimentais na raiz (`codeshare.v2–v5`, `meshamail.70b.v2–v6`), misturados com o único canônico `agent-qa.config.json`. Pior: `meshamail-auth.json` está **versionado** — credencial real exposta no histórico do git. Quando abre um PR, o preview sobe em `https://pr-<N>.preview.<dominio>` (URL nova por PR), mas o `config.baseUrl` é estático: o agente aponta para o ambiente errado.

### O que falta fazer
1. **`.gitignore`** — adicionar `*-auth.json`, `meshamail-auth.json`, `storage-state.json`, `.agent-qa/pipeline/state/`, `qa-agent-runs/`
2. **Remover do versionamento** — `git rm --cached meshamail-auth.json` (mantém o arquivo local, tira do git)
3. **Organizar configs** — mover todos os não-canônicos para `configs/experimental/`; raiz fica só com `agent-qa.config.json`; atualizar paths referenciados em testes
4. **`QA_AGENT_BASE_URL` override** — em `ValidateConfigUseCase`, após o parse Zod: `baseUrl = env.QA_AGENT_BASE_URL ?? config.baseUrl`; injetar o wildcard do preview (`QA_AGENT_PREVIEW_DOMAIN`, ex.: `*.preview.meshamail.dev`) em `appDomains` automaticamente
5. **Decisão branch orchestrator (G9)** — merge de `feature/sub-agent-orchestrator` na main atrás de flag opt-in (`runtime.tools.enabled: false` por default); `HYBRID_GUARDED` + factory fallback continua o caminho canônico

### Se não fizer
- Credencial vaza no git → rotação de senha, incidente de segurança, exposição no histórico permanente
- Dev gasta minutos procurando qual config usar → fricção de onboarding
- Preview muda de URL por PR e o agente aponta para produção/URL estática → testa o ambiente errado, falso-positivo/falso-negativo silencioso

### Critérios de aceite
- `git status` não mostra mais arquivos de auth (untracked ou tracked)
- Raiz contém apenas `agent-qa.config.json`; demais em `configs/experimental/`; `npm run check` passa sem teste quebrado por path
- Teste unitário: `config.baseUrl` assume o valor de `QA_AGENT_BASE_URL` quando setado; `appDomains` inclui o domínio do preview
- `HYBRID_GUARDED` permanece o caminho canônico; Tool Queue só ativa com `tools.enabled: true` (opt-in)

**Estimativa:** 5h

---

## Task 2 — Empacotamento: Docker, Scripts e CI do Repo

> Cobre **G3** (distribuição inexistente) e **G1** (CI próprio ausente). Plano §6.1, §6.2.

### O que o humano vê hoje
Não existe imagem Docker de release — só `Dockerfile.playwright` (base `mcr.microsoft.com/playwright:v1.60.0-noble`), voltado a desenvolvimento. Para rodar em CI, alguém clona o repo, instala dependências e browsers Playwright (10+ min por run). Não há CI do próprio repo: um push pode quebrar a `main` sem ninguém saber até o release.

### O que falta fazer
1. **`scripts/wait-for-ready.sh`** — loop `curl` ao `QA_AGENT_BASE_URL` até HTTP 200, timeout configurável via `QA_AGENT_PREVIEW_TIMEOUT` (default 120s); exit 0 em 200, exit 1 no timeout; copiado para `/opt/qa-agent/` na imagem
2. **`Dockerfile` de release** — multi-stage sobre a base Playwright: `npm ci --omit=dev` + `COPY dist/` + `wait-for-ready.sh` + symlink `qa-agent` em `/usr/local/bin`; `ENTRYPOINT []`
3. **`.github/workflows/ci.yml`** — `npm run check` (tsc + eslint + testes unitários) + smoke em container Playwright (fake LLM, sem browser real nem API key)
4. **`.github/workflows/release.yml`** — disparado por tag `v*`: build e push para `ghcr.io/mesha/qa-agent` com tags `v2`, `v2.x.y`, `latest`; runner self-hosted faz cache da imagem (pull só em release nova)

### Se não fizer
- Cada run em CI demora 10+ min só para setup → devs desistem de usar
- Sem CI do repo, regressão entra na `main` → agente quebra no momento mais importante (release)
- Sem imagem publicada não há unidade de entrega → a v2 nunca sai do papel

### Critérios de aceite
- `docker build -t qa-agent:local .` funciona, imagem < 2GB (base Playwright ~1.5GB)
- `docker run qa-agent:local qa-agent --version` e `... pipeline all --help` respondem
- Tag `v*` dispara build + push em `ghcr.io/mesha/qa-agent`
- CI passa em todo push/PR; smoke executa com fake LLM

**Estimativa:** 6h

---

## Task 3 — Pipeline Unificado (`pipeline all`)

> Cobre a lacuna de simplicidade. Plano §5.3 (nota do comando), §4.3 (sequência de gates).

### O que o humano vê hoje
O ciclo são 8 comandos separados (`prepare` → `correlate` → `risk` → `generate-plan` → `execute` → `report` → `learning` → `promote-learning`). Ótimos para debug, ruins para adoção: o workflow alvo precisa de 7 steps encadeados, e se um falha os seguintes rodam mesmo assim (a menos que o YAML trate manualmente) — gastando chamadas LLM à toa. O log fica fragmentado.

### O que falta fazer
1. **Comando `pipeline all`** — wrapper que roda a sequência `prepare → correlate → generate-plan → execute → report → learning → promote-learning --auto-approve`
2. **Gates fail-fast (§4.3)** — `prepare` BLOCKED (sem task ClickUp) → comenta "QA bloqueado: vincule a task", exit 6, para; `correlate` BLOCKED → comenta motivo sanitizado e para. Nada de custo LLM desperdiçado a jusante.
3. **Propagação de exit codes semânticos** — `OK`, `BUGS_FOUND`, `CONFIG_ERROR`, `BLOCKED`; o final é o mais severo encontrado (permite gates no Actions sem parsing de output)
4. **Teste de integração** — caminho feliz completo + bloqueio no preflight

### Se não fizer
- Workflow do repo alvo carrega 7 steps → complexo, propenso a erro de copy-paste
- `prepare` falha (sem `CLICKUP_TOKEN`) mas `generate-plan`/`execute` rodam mesmo assim → chamadas LLM desperdiçadas ($$$)
- Dev não sabe em qual etapa falhou sem abrir cada log → debugging lento

### Critérios de aceite
- `qa-agent pipeline all --config ./agent-qa.config.json` executa tudo em 1 step
- Se `prepare`/`correlate` bloqueia, nenhuma etapa subsequente roda
- Exit code final é o mais severo encontrado
- Log indica claramente qual etapa falhou

**Estimativa:** 3h

---

## Task 4 — Integração no Repo Alvo: Template e Auth

> Cobre **G1** (template para repos alvo) e **G6** (auth em CI). Plano §5.3, §5.5, §6.3.

### O que o humano vê hoje
Não existe template. Para integrar o agente num novo repo, alguém adivinha o workflow YAML, entende como o preview Traefik sobe e descobre como autenticar em CI — sendo que `capture-auth` é **interativo**, inviável em pipeline. O `meshamail-auth.json` legado na raiz era a única "referência".

### O que falta fazer
1. **Template `docs/templates/qa-agent.yml`** — workflow único: `build-preview` (output `preview_url`) → job `qa-agent` (container `ghcr.io/mesha/qa-agent:v2`, self-hosted) com `checkout fetch-depth: 0` → `wait-for-ready` → `pipeline all` → `upload-artifact` (`.agent-qa/pipeline/`)
2. **Onboarding doc** — `docs/templates/README.md`: copiar workflow, criar `agent-qa.config.json` mínimo, configurar secrets (`CLICKUP_TOKEN`, `GROQ_API_KEY`/`OPENAI_API_KEY`, `GITHUB_TOKEN` automático, `QA_AGENT_BASE_URL` do output de preview)
3. **Documentar auth em CI** — `docs/auth-in-ci.md` com os 3 caminhos:
   - **formLogin (canônico)** — config `auth.formLogin` + secrets `QA_AGENT_USER`/`QA_AGENT_PASS`; preview semeado com usuário de teste no build
   - **storageState seed** — para SSO/OAuth; gerar uma vez localmente via `capture-auth`, salvar como secret/artifact criptografado, restaurar em `.agent-qa/pipeline/state/` (validade limitada — preferir formLogin)
   - **none** — páginas públicas
4. **Smoke real** — 1 PR de teste no Meshamail: preview sobe → agente roda → comentário → artifacts

### Se não fizer
- Novo repo alvo leva dias para integrar → ninguém adota
- Auth em CI não funciona → toda run falha no login → agente inútil
- Smoke nunca validado → a primeira execução real é no PR de um cliente

### Critérios de aceite
- Novo repo alvo integra em ≤ 30 min (3 arquivos: workflow + config + memory.md opcional)
- PR de teste tem comentário do agente visível no GitHub (upsert, sem spam)
- Artifacts (vídeo, screenshots, `run.json`) baixáveis
- `docs/auth-in-ci.md` tem exemplo de config para cada caminho, incluindo criação de usuário de teste e geração de storageState

**Estimativa:** 8h (inclui smoke e debugging)

---

## Task 5 — Evidências no PR: Vídeo, Screenshots e Trace

> Profissionalização do output. Plano §2.5 (evidências do harness), §2.3 (PRReporterService).

### O que o humano vê hoje
O comentário do PR (`PRReporterService` + `FetchGitHubCommentAdapter`) traz cobertura de critérios e bugs, mas as evidências ficam num único vídeo por run. Quando um cenário falha, o dev baixa o artifact do GitHub Actions, extrai o zip e procura o screenshot — 5 min de fricção. O PO/QA nunca chega a ver o que aconteceu.

### O que falta fazer
1. **Links de evidência no comentário** — vídeo `.webm`, screenshots `.png` e trace `.zip` com URLs diretos para os artifacts
2. **Seção "Evidências" no `pr-report.md`** — organizada por cenário: antes/depois e o momento da falha
3. **Screenshots por cenário** — start e end de cada cenário (não só da run inteira)
4. **Sanitização** — garantir que vídeo/screenshots não capturam dados sensíveis (alinhado à sanitização de secrets já aplicada nas mensagens)

### Se não fizer
- Dev gasta 5 min baixando artifact para ver o que quebrou → não olha, ignora o bot
- PO/QA não vê evidência → não confia no resultado
- Vídeo da run inteira (5 min) sem contexto → dev procura o timestamp manualmente

### Critérios de aceite
- Comentário do PR tem links diretos para vídeo, screenshots e trace
- Screenshots nomeados por cenário: `scenario-01-login-start.png`, `scenario-01-login-end.png`
- Cenário que falha tem o screenshot do momento da falha destacado
- Nenhum dado sensível visível nas evidências

**Estimativa:** 4h

---

## Task 6 — Gherkin Profissional e `.feature`

> Cobre **G4** (Gherkin não é Gherkin). Plano §7.

### O que o humano vê hoje
O `GherkinRendererService` emite **Markdown ad-hoc** ("Cenários Selecionados" com seções), não Gherkin sintático. O PO/QA não lê — parece log de máquina. Não há `.feature` para importar em ferramentas de BDD.

### O que falta fazer
1. **GherkinRendererService sintático** — `# language: pt`, `Funcionalidade:`, `Contexto:`, `Cenário:`, `Dado/Quando/E/Então`
2. **Mapeamento determinístico (sem LLM)** — `QaScenario.title` + task ClickUp → `Funcionalidade:`/`Cenário:`; `preconditions` → `Dado`; `steps[].action` → `Quando`/`E`; `postconditions` + `BusinessAssertion` → `Então`; resultado da execução → tag `@passed`/`@failed`/`@blocked`
3. **`.feature` artifact** — `PersistGherkinScenariosUseCase` grava `evidence/features/<scenario-id>.feature` por cenário (derivado do `ExecutionPlan`, não fonte)
4. **Seção colapsável no PR** — `<details>` "📋 Cenários executados (Gherkin)" com blocos + emoji de status (✅/⚠️/❌)

### Se não fizer
- PO/QA ignora o comentário → não sente valor no agente
- Sem `.feature`, não há integração com ferramentas de gestão de testes
- Cenários em Markdown não transmitem intenção de negócio → QA humano duplica trabalho

### Critérios de aceite
- `.feature` é parseável por cucumber-js / qualquer parser Gherkin; inclui `# language: pt`
- Comentário tem seção "📋 Cenários executados (Gherkin)" colapsável; status visível sem expandir (título + emoji)
- Tags de status por cenário (`@passed`/`@failed`/`@blocked`) e links para download do `.feature`

**Estimativa:** 5h

---

## Task 7 — Memória que Aprende e Persiste

> Cobre **G5** (contrato `memory.md` não formalizado) e **G7** (write-back). Plano §8.

### O que o humano vê hoje
O agente "aprende" (`learning` → `promote-learning` atualiza `.agent-qa/memory.md`), mas o arquivo **nunca volta para o repo alvo**. O próximo PR não encontra o locator atualizado → a mesma falha se repete. E o formato dos chunks (`route`, `flow`, `scenario`, `semantic_locator`) vive implícito no `MemoryChunker`: uma mudança no chunker quebra o parsing de arquivos antigos silenciosamente.

### O que falta fazer
1. **Contrato `memory.md` v1** — header obrigatório `<!-- agent-qa-memory v1 -->`; `MemoryMarkdownLoader` valida e emite warning de migração quando ausente (back-compat)
2. **Validação de chunks** — um chunk = um heading `## [tipo] slug` com tipo ∈ `route | flow | scenario | semantic_locator`; rejeitar/avisar malformados; documentar em `docs/memory-contract-v1.md`
3. **`generate-memory` com header** — bootstrap gera `memory.md` já com o header v1
4. **Write-back no workflow** — step pós-`promote-learning`: se `.agent-qa/memory.md` mudou, commit automático na branch do PR com `[skip ci]` (autor `qa-agent[bot]`)
5. **Flag `memoryWriteBack`** — config `"commit" | "off"` (default `"commit"`; alternativa conservadora "pr" documentada)

### Se não fizer
- Memória atualizada fica só no runner → perdida no próximo PR
- O mesmo locator quebrado é reusado N vezes → N runs falham pelo mesmo motivo → desperdício de LLM
- Formato muda silenciosamente → parsing quebra, memória ignorada sem warning

### Critérios de aceite
- `memory.md` gerado inclui header v1; loader reporta warning para arquivos legados e chunks malformados
- PR com mudança de memória tem commit automático; `[skip ci]` evita loop de workflow
- Conflito de push não quebra a run (apenas warning)

**Estimativa:** 4h

---

## Task 8 — Resiliência: Multi-Provider LLM e Health Check

> Endurecimento operacional. Plano §4.3 (gate de preview), §5.2 (readiness), Refinadas M1/M3.

### O que o humano vê hoje
Se o Groq cai ou rate-limita (429), a run inteira falha — o dev vê "Erro 429" e não sabe se é código ou API. Se o preview demora a subir, o agente gera plano, executa contra URL inacessível e morre num timeout genérico, **depois** de gastar chamadas LLM.

### O que falta fazer
1. **`LLMProviderPort`** — interface unificada de provider
2. **Adapters** — `GroqLLMAdapter`, `OpenAiLLMAdapter`, `FakeLLMAdapter` (testes, sem API key); seleção via `llm.provider: "groq" | "openai" | "fake"`
3. **Fallback** — Groq 429 → tenta OpenAI automaticamente; rate-limit handling unificado
4. **Health check no preflight** — `PipelinePreflightService` pinga `QA_AGENT_BASE_URL` (`check: preview_reachable`); se != 200, BLOCKED com motivo "Preview não responde" registrado em `preflight-report.json` (evolução do `wait-for-ready.sh` para dentro do agente)

### Se não fizer
- Rate limit da Groq bloqueia todo PR → devs esperam sem saber por quê
- Preview fora do ar → agente gera plano, executa, falha no meio → chamadas LLM desperdiçadas
- Sem health check, sem diagnóstico → dev abre log de 500 linhas para descobrir que o preview estava down

### Critérios de aceite
- Troca de provider é só mudar config; testes rodam com `fake` (sem API key)
- Groq 429 → fallback automático para OpenAI
- `preflight-report.json` inclui `preview_reachable`; preview != 200 → BLOCKED com mensagem legível

**Estimativa:** 5h

---

## Task 9 — Documentação e Tag de Release

> Fechamento. Plano §10 (Fase E), §11 (critérios de aceite da v2).

### O que o humano vê hoje
O README é técnico demais; um novo contribuidor não sabe por onde começar nem como o ciclo PR → preview → agente → comentário funciona. Não existe tag de release — não há "versão estável" de referência, cada deploy usa um commit aleatório. Specs de v2.1 estão misturadas com as de v2.

### O que falta fazer
1. **README operacional** — diagrama do fluxo PR → preview → agente → comentário (§4 do plano); onboarding de 30 min; link para `docs/templates/`
2. **PROJECT-MAP atualizado** — refletir CI/CD e os ports novos (`LLMProviderPort`, etc.)
3. **Arquivar specs de v2.1** — `scenario-workspace-memory-spec.md`, `V2-MEMORY-PGVECTOR-SPEC.md` → `docs/historico/`
4. **Tag `v2.0.0`** — `git tag v2.0.0` + push (dispara o release workflow da Task 2); verificar imagem publicada
5. **CHANGELOG v2.0.0** — o que entra, o que fica para v2.1, breaking changes

### Se não fizer
- Novo contribuidor perde 1 dia entendendo o projeto → abandona
- Sem tag, não há referência estável → cada deploy usa commit aleatório
- Specs de v2.1 misturadas com v2 → confusão de escopo

### Critérios de aceite
- README tem diagrama e onboarding de 30 min
- Tag `v2.0.0` existe e a imagem Docker está publicada
- `ghcr.io/mesha/qa-agent:v2.0.0` roda `qa-agent --version`
- Specs de v2.1 estão em `docs/historico/`

**Estimativa:** 4h

---

## Task 10 — Smoke Ponta a Ponta: Validação Real

> Validação dos critérios de aceite da v2. Plano §11, Fase C (§10).

### O que o humano vê hoje
Nunca foi validado que o ciclo completo funciona ponta a ponta. A primeira vez que rodar será no PR real de um cliente — se falhar, perde-se credibilidade e os bugs de integração (container, rede, auth) aparecem sob pressão.

### O que falta fazer
1. **PR de teste** — branch simples no Meshamail, abrir PR vinculado a uma task ClickUp
2. **Verificar preview** — Traefik publica a URL e responde 200 (readiness ok)
3. **Executar workflow** — job `qa-agent` roda no container e passa por todas as etapas do `pipeline all`
4. **Validar comentário** — status geral, cobertura de critérios, Gherkin com status por cenário, métricas, links de evidência (upsert único)
5. **Validar artifacts** — vídeo, screenshots, `run.json`, `pr-report.md` baixáveis
6. **Validar memória** — commit de memória aparece na branch (se write-back ativado)
7. **Corrigir regressões** — bugs encontrados no smoke são corrigidos antes da tag

### Se não fizer
- A primeira experiência do cliente é uma falha → abandona o agente
- Bugs de integração (container, rede, auth) só aparecem em produção → debugging sob pressão
- Sem smoke validado, não há confiança para a tag de release

### Critérios de aceite
- 1 PR de teste demonstra o ciclo completo, sem erros no log do GitHub Actions
- Comentário é legível e útil para humano (status, Gherkin, evidências)
- Falha honesta validada: PR sem task / preview down / token ausente → BLOCKED com motivo, nunca falso-verde
- Onboarding de novo repo alvo testado com checklist de 30 min

**Estimativa:** 6h (inclui debugging)

---

## Resumo

| # | Task | Estimativa | Fase | Gaps |
|---|------|------------|------|------|
| 1 | Fundação: Repo Limpo e URL Dinâmica | 5h | A | G10, G2, G9 |
| 2 | Empacotamento: Docker, Scripts e CI | 6h | B | G3, G1 |
| 3 | Pipeline Unificado (`pipeline all`) | 3h | B | simplicidade |
| 4 | Integração no Repo Alvo: Template e Auth | 8h | C | G1, G6 |
| 5 | Evidências no PR: Vídeo, Screenshots, Trace | 4h | D | — |
| 6 | Gherkin Profissional e `.feature` | 5h | D | G4 |
| 7 | Memória que Aprende e Persiste | 4h | D | G5, G7 |
| 8 | Resiliência: Multi-Provider LLM e Health Check | 5h | D | M1, M3 |
| 9 | Documentação e Tag de Release | 4h | E | — |
| 10 | Smoke Ponta a Ponta: Validação Real | 6h | Validação | — |
| | **Total** | **~48h (~1.5 semanas)** | | |

## Ordem de execução recomendada

```
Fase 1 (fundar):     1 → 2 → 3
Fase 2 (integrar):   4
Fase 3 (polir):      5 → 6 → 7 → 8
Fase 4 (fechar):     10 → 9
```

> **Regra:** `npm run check` verde ao fim de cada task. Smoke (task 10) só roda quando 1–8 estão prontas.
