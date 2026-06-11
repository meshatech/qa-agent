# Contexto Ativo

> Arquivo volátil — atualizar ao iniciar/concluir tarefas relevantes.

## Foco atual

**MESHAP-3975 (Task 1 v2)** — Fundação: repo limpo + URL dinâmica **gaps fechados** (2026-06-11): `configs/agent-qa.meshamail.config.json` versionado; `QA_AGENT_BASE_URL` / `QA_AGENT_PREVIEW_DOMAIN` documentados em `.env.example` + README; known security gap registrado (credencial em HEAD/histórico — purge pendente). `.gitignore` de auth; experimentais apagados; helper `applyBaseUrlOverride` wired nos 6 pontos.

Branch de trabalho: `feature/sub-agent-orchestrator` (Tool Queue já na árvore; merge para main pendente — ver G9).

## Decisões recentes

- semanticTarget não-fatal — em vez de `throw`, candidatos inseguros/curtos/que estouram a policy são ignorados com warning; retorna subconjunto seguro ou `null` (caller emite safe check step)
- semanticTarget guarda candidatos vazios/<3 chars retornando `null`
- NAVIGATION path traversal — `hasPathTraversal` decodifica + `posix.normalize` + checa segmento `..` (sem falsos positivos de `includes('..')`); containment de base path quando baseUrl tem subpath
- DATA_ENTRY — valida `testValue` com `validateDestructiveText`; substitui por `safe-test-value` + warn se bloqueado
- resolve() valida saída do LLM com `ExpectedOutcomeSchema.parse`; falha → `CLASSIFICATION_FAILED`
- planner factory_first — sem plano da factory, faz fallback para LLM buildPlan; sem fallback usável lança `ExecutionPlanBuildError`
- isLogoutProofCondition route_state — só aceita `expectedUrlPattern` contendo `/login`, `/signin`, `/auth`
- learning-extractor persist — ordem write temp → rename → appendRunHistory (rename falha: deleta temp + rethrow; sem referência pendente no history)
- **G9 (orchestrator)** — Tool Queue permanece opt-in (`runtime.tools.enabled: false` default); HYBRID_GUARDED + factory fallback é o caminho canônico; merge para main documentado, não executado nesta task
- **Meshamail smoke** — T002 falhava: click em "Configurações" (sidebar) + `menu_state` falso-negativo; corrigido: `semanticAliases.DISCLOSURE` → "Conta e opções", postcondition `text_any_visible`, `tools.enabled: false`; run ~23s, 4/4 tasks PASSED_WITH_WARNINGS
- **Bug aba abrindo/fechando** — causa: recriação de contexto pós-SSO + `recoverPage` agressivo; corrigido em 2026-06-11
- **Bug aba pós-T003 (tema)** — log TabTrace #21: `about:blank` abre **após** T003 (assíncrono); T002/T003 clicavam mesmo `el_001` (locator "Tema" resolvia para trigger do menu). Fixes: semantic locator switch/menuitem; exclude account trigger em text_any; proactive ensureAvailability antes de clicks; `runtime.enforceSingleTab: true` no meshamail + ghostTabKiller
- **Sessão efêmera por run** — `{runDir}/.auth/storage-state.json`; SSO autônomo; **sem recarregar contexto** após login — aguarda redirect na mesma aba, salva sessão em paralelo, executa testes

- Token redaction — `redactSecretsInMessage` substitui literal + `encodeURIComponent` + Base64 (variantes longas primeiro)
- BLOCKED sanitization — `CorrelationBlockedError` sanitiza `blockReason`/`warnings` do correlator; `blockAndThrow` recebe `sanitize` e aplica em ambos
- sanitizePath — padrões estáticos `/home/`, `/Users/`, `C:/Users/` + prefixo `homedir()` do processo; teste com `vi.mock('node:os')`
- Test coverage — duplicate acceptanceCriteria dedup; buildMemorySearchQuery edge cases; correlation-lexical borda; describePipelineArtifactError
- blockAndThrow warnings — `createBlockedCorrelationResult(blockReason, warnings)`; propagado no catch do correlator com `memoryResponse.warnings`
- Scenario ranking — `rankedMatches` ordena por `correlation.score` desc antes do loop; `correlations` mantém ordem ClickUp
- BLOCKED artifacts — `blockAndThrow` e fluxo `execute` não chamam `persistArtifacts`; payload só em `CorrelationBlockedError` + stdout CLI

## Bloqueios

Nenhum no momento.

## Próximo passo sugerido

Epic PRJ-11320 concluída (11392–11405). Próximo: `ScenarioSelector` / `execution-plan.json` (PRJ-11321+).

Roadmap V1 local: `docs/architecture/23-pipeline-v1-roadmap.md`.
