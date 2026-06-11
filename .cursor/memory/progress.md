# Progresso — agent-qa

> Arquivo volátil — manter status honesto do repositório.

## Concluído (runtime MVP + v0.2-stable)

- [x] CLI `qa-agent` com validate-config, run, inspect, report, capture-auth
- [x] Loop reativo com quiescence, IDs efêmeros, data harness
- [x] Recovery policy e bug classifier
- [x] QaToolRegistry e modos Hybrid Guarded / PLAN_AND_EXECUTE
- [x] Providers LLM: fake, groq, openai
- [x] Evidências e diretório de run
- [x] Specs `doc/01`–`21` e release notes v0.2-stable

## Concluído (MESHAP-3975 — Fundação v2)

- [x] `.gitignore`: `*-auth.json`, `meshamail-auth.json`, `storage-state.json`, `.agent-qa/pipeline/state/`
- [x] `git rm --cached meshamail-auth.json` (credencial fora do versionamento)
- [x] Configs experimentais **apagados de vez** (16 arquivos: codeshare, meshamail.70b, fail, groq, i18n, etc.); pasta `configs/experimental/` removida
- [x] Mantidos: `agent-qa.config.json` (raiz) + `configs/agent-qa.fixture.config.json` (smoke)
- [x] Referências ativas atualizadas (`package.json` preflight:docker, `README.md` smoke)
- [x] `applyBaseUrlOverride` helper + wired em 6 pontos de carga de config
- [x] Testes `test/apply-base-url-override.spec.ts`
- [x] G9 documentado: Tool Queue opt-in, HYBRID_GUARDED canônico

## Concluído (MESHAP-3975 — gaps config limpo + URL dinâmica, 2026-06-11)

- [x] `configs/agent-qa.meshamail.config.json` versionado (staged)
- [x] `QA_AGENT_BASE_URL` / `QA_AGENT_PREVIEW_DOMAIN` em `.env.example` e README
- [x] Known security gap documentado (`decisions.md`, `.agent-qa/memory.md`) — purge/rotação fora de escopo
- [x] `npm run check` verde

## Concluído (Meshamail smoke + regressão aba)

- [x] T002 DISCLOSURE: postcondition `text_any_visible`, alias primário "Conta e opções"
- [x] Bug aba abrindo/fechando: removida recriação de contexto pós-SSO; popup OAuth adoptado; `recoverPage` menos agressivo; locator `text_any` preferência por match específico

## Concluído (correção de bugs no pipeline de execução)

- [x] Bug 1 — `semanticTarget` retorna `null` para candidatos vazios/curtos (<3 chars)
- [x] Bug 2 — NAVIGATION endurecida contra path traversal via `posix.normalize` + checagem de segmento `..` + containment de base path
- [x] Bug 3 — `resolve()` valida saída do LLM com `ExpectedOutcomeSchema.parse`; falha → `CLASSIFICATION_FAILED`
- [x] Bug 4 — planner `factory_first` faz fallback para LLM/`ExecutionPlanBuildError` em vez de plano `undefined`
- [x] Bug 5 — DATA_ENTRY valida `testValue` e substitui por `safe-test-value` se destrutivo
- [x] Bug 6 — `learning-extractor.persist` ordena write→rename→appendRunHistory (sem referência pendente)
- [x] Bug 7 — `semanticTarget` não lança exceção; ignora candidatos inseguros e retorna subconjunto seguro ou `null`
- [x] Bug 8 — `isLogoutProofCondition` restringe `route_state` a paths de login (`/login`, `/signin`, `/auth`)
- [x] Testes atualizados (factory throw→safe-check, persist ordering) + mocks de repo com `deleteFile`/`renameFile`; `npm run check` verde (validate:agent-config falha por motivo pré-existente de contagem de .mdc)

## Concluído (tooling agêntico nota 10)

- [x] `.cursor/rules/` — 12 rules modulares (EN)
- [x] `.cursor/memory/` — Memory Bank (PT) + `decisions.md`
- [x] `.agent-qa/` — memória runtime dogfooding alinhada
- [x] `AGENTS.md` — entrada única na raiz
- [x] `scripts/validate-agent-config.mjs` + npm script
- [x] Banner legado em `.windsurf/agents.md`
- [x] Segurança: sem credenciais literais em memory files

## Concluído (PRJ-11315 — BM25 Memory)

- [x] Contratos `MemoryChunk`, `MemoryChunkType`, `MemorySearchResult` em `src/domain/schemas/memory.schema.ts`
- [x] `.agent-qa/` — `memory.md`, `structure.md`, `run-history.jsonl`
- [x] `MemoryMarkdownLoader` — leitura read-only do Markdown
- [x] `MemoryChunker` — parser read-only de `.agent-qa/memory.md`
- [x] `BM25MemoryIndex` — ranking BM25 in-memory
- [x] `MemorySearchService` — orquestração + fallback com warnings
- [x] `RunHistoryService` — append sanitizado em `run-history.jsonl`
- [x] Tool `qa.memory.search` + alias `search_project_memory`
- [x] Planner/replanner consultam memória via `memoryContext` em `qa.plan.build` / `qa.plan.replan`
- [x] Testes Vitest: schema, chunker, BM25, service, tool, busca real (`test/memory-search-real-memory.spec.ts`)
- [x] `npm run check` passando
- [x] ClickUp PRJ-11315 subtasks auditadas — todas **desenvolvido**

## Concluído (PRJ-11317 — Pipeline Preflight)

- [x] PRJ-11348 — `PipelinePreflightService` base + `preflight-report.json`
- [x] PRJ-11349 — check dedicado `CLICKUP_TOKEN` (`validateClickUpToken`, `checks.clickupToken`)
- [x] PRJ-11351 — check permissão leitura ClickUp (`validateClickUpReadAccess`, `ClickUpApiPort`, 401/403 → `BLOCKED`)
- [x] PRJ-11350 — check dedicado `clickupTaskId` extraído do PR (`validateClickUpTaskId`, `checks.clickupTaskId`)
- [x] PRJ-11352 — check dedicado `GITHUB_TOKEN` (`validateGitHubToken`, `checks.githubToken`, warning não fatal)
- [x] PRJ-11357 — check permissão comentário PR (`validatePrCommentPermission`, `GitHubApiPort`, warning não fatal)
- [x] PRJ-11353 — check contexto PR GitHub Actions (`validatePrContext`, `checks.prContext`, evento + refs → `BLOCKED`)
- [x] PRJ-11354 — check config do projeto (`validateConfig`, reutiliza `ValidateConfigUseCase` com `skipHealthCheck`)
- [x] PRJ-11355 — check branch head (`readBranchHead`, `checks.branchHead`, `GITHUB_HEAD_REF` → `BLOCKED` se ausente)
- [x] PRJ-11356 — check checkout history (`validateCheckoutHistory`, `GitRepositoryPort`, shallow + base → `BLOCKED`)
- [x] PRJ-11358 — mascaramento tokens em logs/relatórios (`sanitizeForOutput`, secrets do env)
- [x] PRJ-11359 — contrato `preflight-report.v1` (`checkItems`, `tokensMasked`, schema Zod, `buildPreflightReport`)
- [x] PRJ-11360 — interrupção BLOCKED (`runOrThrow`, `PreflightBlockedError`, CLI `preflight`, exit code 6)
- [x] Hardening — `PreflightReportWriterPort`, use case enriquecido, testes adapter/integration, docs README/AGENTS
- [x] Review fixes — `tokensMasked` honesto, fallbacks token GitHub, `GitHubEventContextPort`, write atômico, config path absoluto, `pull_request_target`
- [x] Gate pipeline — CLI `pipeline prepare` (preflight → read-pr-context); PRJ-11550

## Concluído (PRJ-11318 — Leitor ClickUp)

- [x] PRJ-11361 — `DemandContext` + `DemandAttachmentSchema` em domínio (`demand-context.schema.ts`, testes)
- [x] PRJ-11362 — `BugContext` em domínio (`bug-context.schema.ts`, testes)
- [x] PRJ-11363 — `DemandAttachment` em `demand-attachment.schema.ts` + `test/demand-attachment.schema.spec.ts` (sem model redundante)
- [x] PRJ-11364 — `ClickUpReaderPort` + `FakeClickUpReaderAdapter` + `test/clickup-reader.port.spec.ts`
- [x] PRJ-11365 — `ClickUpHttpReaderAdapter`, testes HTTP/DI, wiring `ClickUpReaderPort` (ClickUp: desenvolvido)
- [x] PRJ-11366 — `resolveClickUpTaskId`, `RunConfig.clickup.taskId`, `readConfiguredTask` (ClickUp: critérios [x], status mantido em fazendo)
- [x] PRJ-11367 — `clickup-task-content.mapper.ts` + sanitização HTML em `ClickUpHttpReaderAdapter` (ClickUp: critérios atualizados, status mantido em fazendo)
- [x] Custom ID HTTP — `clickup-task-url.builder.ts`, `clickup-team-id.resolver.ts`, `RunConfig.clickup.teamId`, `CLICKUP_TEAM_ID`
- [x] PRJ-11368 — `clickup-acceptance-criteria.parser.ts` + testes unitários título/critérios (ClickUp: critérios [x], status mantido em fazendo)
- [x] PRJ-11369 — `clickup-reproduction-steps.parser.ts` + `BugContext` opcional no adapter (ClickUp: critérios [x], status mantido em fazendo)
- [x] PRJ-11370 — `clickup-bug-results.parser.ts` + `expectedResult`/`actualResult` no `BugContext` (ClickUp: critérios [x], status mantido em fazendo)
- [x] PRJ-11371 — `clickup-task-attachments.mapper.ts` + `DemandAttachment[]` no adapter (ClickUp: critérios [x], status mantido em fazendo)
- [x] PRJ-11372 — `clickup-http-error.handler.ts` + códigos HTTP + retry 429 (ClickUp: critérios [x], status mantido em fazendo)
- [x] PRJ-11373 — `demand-context.json` via `DemandContextPersistenceService` + writer atômico (ClickUp: critérios [x], status mantido em fazendo)
- [x] Review clean code — `clickup-description-sections.ts`, `clickup-task-response.mapper.ts`, retorno sanitizado em `persistDemandContext`/`persistFromClickUpTask`; 99 testes ClickUp/demand OK
- [x] Auditoria bugs — MAJOR/MINOR sanados; R1 `BugContextSchema.safeParse` + warning; integração `RunAgentUseCase.persistClickUpDemandContext`; Docker test scripts (`test:docker`, `check:docker`)

## Concluído (duplicatas temáticas PRJ-11318)

- [x] PRJ-11374 — duplicata de PRJ-11372 (erros HTTP) — coberta em código; spec `tasks-clickup/` atualizada
- [x] PRJ-11375 — duplicata de PRJ-11373 (`demand-context.json`) — coberta em código; spec + ClickUp atualizados

## Concluído (PRJ-11319 — Leitor PR/diff GitHub Actions)

- [x] PRJ-11376 — `PullRequestContext` em domínio (`pull-request-context.schema.ts`, `test/pull-request-context.schema.spec.ts`)
- [x] PRJ-11377 — `ChangedFile` em domínio (`changed-file.schema.ts`, `test/changed-file.schema.spec.ts`)
- [x] PRJ-11378 — `DiffLine` em domínio (`diff-line.schema.ts`, `test/diff-line.schema.spec.ts`); entregue junto com PRJ-11377
- [x] PRJ-11379 — `GitHubActionsPrContextReaderAdapter` + mapper env/event → `PullRequestContext` + `git diff origin/${base}...HEAD` (`PrContextReaderError`, 11 testes)
- [x] PRJ-11380 — resolvers `github-actions-pr-refs.resolver.ts` (`prNumber`, `baseBranch`, `headBranch`); DRY com `FileGitHubEventContextAdapter`; 9 testes dedicados
- [x] PRJ-11381 — `ensureBaseBranchAvailable` (verify + fetch `origin/${base}`); reader wired; `BASE_BRANCH_UNAVAILABLE`; PRJ-11383 duplicata
- [x] Validação `assertValidBaseBranchRef` — `VALIDATION_FAILED` antes de git em `ensureBaseBranchAvailable`; 3 casos em `exec-git-repository.adapter.spec.ts`
- [x] PRJ-11382 — `resolveHeadBranchFromEnv` DRY no preflight + mapper; `checks.branchHead` no report (PRJ-11355)
- [x] PRJ-11383 — auditoria fetch da base (duplicata PRJ-11381); testes fetch-restore + shallow
- [x] PRJ-11384 — `buildPullRequestDiffArgs`; diff vazio + E2E reader (`rawDiff` via git real); spec + 12 testes git/reader
- [x] PRJ-11385 — `parseGitDiffAddedLines`; metadados ignorados; 7 testes parser (+ integração git fixture)
- [x] PRJ-11386 — `parseGitDiffRemovedLines`; line numbers lado antigo; 7 testes parser (+ integração git fixture)
- [x] PRJ-11387 — `parseGitDiffContextLines` + `git-diff.parser.shared.ts`; 7 testes parser (+ regressão 3 parsers)
- [x] PRJ-11388 — `parseGitDiffChangedFiles` + `classifyChangedFiles`; `ChangedFile.kind`; reader `changedFiles`; 50 testes diff/reader
- [x] PRJ-11389 — `detectAffectedRoutes`; `affectedRoutes` no reader; 15 testes detector/reader
- [x] PRJ-11390 — `detectAffectedSchemas`; `affectedSchemas` no reader; testes detector/reader
- [x] PRJ-11391 — `PrDiffContextSchema`; `pr-diff-context.json`; CLI `read-pr-context`; testes schema/writer/persistência
- [x] Fix `tokensMasked` pr-diff — dual check: warn pré-sanitize + `tokensMasked` pós-sanitize
- [x] Fix git diff maxBuffer — 50MB + mensagem `ERR_CHILD_PROCESS_STDIO_MAXBUFFER` em `formatGitDiffFailedMessage`
- [x] Auditoria PRJ-11319 — DIP mapper, sanitização env, docs CLI, integração Nest, fix preflight spec flaky
- [x] PRJ-11550 — `RunPipelinePrepareUseCase` + CLI `pipeline prepare` (preflight gate + read-pr-context)
- [x] PRJ-11552 hardening — regex configurável; preflight skip WARN; schema opcional; env deprecada com fallback
- [x] PRJ-11552 follow-up — mapper omite ID sem throw; preflight try/catch + error/warning; regex inválido → WARN
- [x] PRJ-11552 security — safe-regex ReDoS; body sanitizado; sanitizePrContextErrorMessage no preflight
- [x] ClickUp secrets/warnings — CLICKUP_TASK_ID collector; pattern warning centralizado; log truncamento body

Epic PRJ-11319 entregue (11376–11391 + PRJ-11550 + PRJ-11552).

## Concluído (PRJ-11320 — Correlator demanda/diff/memória)

- [x] PRJ-11392 — `DemandDiffMemoryCorrelatorService` + CLI `pipeline correlate` + `RunPipelineCorrelateUseCase`
- [x] PRJ-11393 — `CorrelationItem` dedicado (`correlation-item.schema.ts`, `createCorrelationItem`, testes schema)
- [x] PRJ-11394 — `RiskItem` dedicado (`risk-item.schema.ts`, `createRiskItem`, testes schema)
- [x] PRJ-11395 — `RequiredScenario` dedicado (`required-scenario.schema.ts`, `createRequiredScenario`, testes schema)
- [x] PRJ-11396 — consumo `DemandContext` (`demand-context-consumer.ts`, `consumeDemandContext`, testes)
- [x] PRJ-11397 — consumo `PrDiffContext` (`pr-diff-context-consumer.ts`, `consumePrDiffContext`, testes)
- [x] PRJ-11398 — consumo `MemorySearchResult[]` (`memory-search-consumer.ts`, `consumeMemorySearchResults`, testes)
- [x] PRJ-11399 — correlação critério↔arquivos (`criterion-diff-correlator.ts`, `correlateCriterionWithDiff`, testes)
- [x] PRJ-11400 — regressão diff negativo (`negative-diff-regression-correlator.ts`, `correlateNegativeDiffRegressions`, testes)
- [x] PRJ-11401 — mismatch demanda↔diff (`demand-diff-mismatch-detector.ts`, `detectDemandDiffMismatch`, `demand_diff_mismatch`, testes)
- [x] PRJ-11402 — critérios sem evidência (`uncovered-criterion-detector.ts`, `detectUncoveredCriteria`, testes)
- [x] PRJ-11403 — score por correlação (`scenario-risk-scorer.ts`, `computeScenarioRiskScore`, testes)
- [x] PRJ-11404 — artefato `required-scenarios.json` (`required-scenarios-artifact.ts`, `prepareRequiredScenariosArtifact`, testes adapter + helper)
- [x] PRJ-11405 — artefato `correlation-report.md` (`correlation-report-artifact.ts`, renderer em domain, testes)
- [x] Schemas `CorrelationItem`, `RiskItem`, `RequiredScenario`, `correlation-result.v1`
- [x] Artefatos `required-scenarios.json`, `correlation-report.md`, `demand-context.json` no output dir
- [x] Gate BLOCKED (exit 6) quando entrada incompleta; memória vazia OK com warning
- [x] `CorrelationArtifactsWriterPort` — adapter prepara JSON + markdown (SRP)
- [x] Testes unitários correlator + integração use case; `npm run check`
- [x] Cobertura direta helpers — `correlation-lexical.spec.ts`, `build-memory-search-query.spec.ts` (777 testes)
- [x] Correlate error handling — BLOCKED vs HARNESS_FATAL; `prNumber` opcional em `blockAndThrow`; 780 testes
- [x] relatedFiles fallback — rota/schema preservam path de `changedFiles` para risk scorer e relatório; 782 testes
- [x] readPipelineArtifact spec — 4 casos (sucesso + 3 ConfigError); 786 testes
- [x] ZodError/BM25 handling — correlator + use case BLOCKED; 790 testes
- [x] Artifact error detail — `describePipelineArtifactError`; JSON/schema inválido → BLOCKED com cause; 794 testes
- [x] relatedFiles multi — `collectRelatedFiles` (overlap > 0, dedupe, cap 5); `correlation.file` inalterado
- [x] Hardening correlate — token redaction MAJOR, staging writer, correlator try/catch, mismatch por critério, route fallback guard/warning; 805 testes
- [x] Match consistency — applyBestMatch/scoreSchemaMatch; file/rationale alinhados; 808 testes
- [x] BLOCKED no persist — correlate não escreve `required-scenarios.json`/`correlation-report.md` em BLOCKED; testes use case
- [x] Fallback criteria warning — critérios ignorados listados no warning de rota fallback
- [x] Mismatch coverage ratio — proporcional 50%; descrição com `coveredCount/total`
- [x] Memory boost AND — `criterionHit` obrigatório; boost tiered; teste route-only sem boost; 812 testes
- [x] Correlate security — token redaction artifact errors; sanitizePath rationales; MAX_SCENARIOS cap test; 822 testes
- [x] Correlator heuristics — below-threshold warning pós-loop; camelCase tokenize; best memory boost; 828 testes
- [x] Scenario score ordering — rankedMatches por score desc + dedup; teste cap prioriza critérios fortes; 829 testes
- [x] blockAndThrow warnings — warnings BM25 preservados quando correlator lança; 830 testes
- [x] Correlate security tests — redaction URL/base64; BLOCKED blockReason/warnings sanitizados; sanitizePath Windows/homedir; duplicate criteria; lexical/buildMemory/describePipelineArtifactError; 851 testes

## Concluído (Speckit governance)

- [x] `.specify/memory/constitution.md` v1.0.0 — 5 princípios (runtime law, clean arch, Zod, CLI/evidence, scope/quality)
- [x] Templates `plan-template.md`, `spec-template.md`, `tasks-template.md` — Constitution Check e referências

## Concluído (Speckit 001 — Gherkin bug feedback, planeamento)

- [x] `specs/001-gherkin-bug-feedback/spec.md` + checklist requirements
- [x] `plan.md`, `research.md`, `data-model.md`, `quickstart.md`, `contracts/`
- [x] `tasks.md` (30 tasks, MVP US1 = T001–T016)
- [x] Feature 001 Gherkin bug feedback completa (T001–T030): service, finalize, report, docs, testes

## Concluído (Task 2 — Docker, Scripts e CI, 2026-06-11)

- [x] `qa-agent --version` lendo `package.json` em `src/main.ts`
- [x] `scripts/wait-for-ready.sh` — curl até HTTP 200, `QA_AGENT_PREVIEW_TIMEOUT` (default 120s)
- [x] `Dockerfile` release (base Playwright v1.60.0-noble, `npm ci --omit=dev`, symlink `/usr/local/bin/qa-agent`)
- [x] `npm run docker:build:release` no `package.json`
- [x] `tsconfig.build.json` — `rootDir: src` para emitir `dist/main.js` (alinha bin/Dockerfile)
- [x] `.dockerignore` — `dist/` incluído no contexto de build release
- [x] `.github/workflows/ci.yml` — job `check` em container Playwright + `docker-smoke`
- [x] `.github/workflows/release.yml` — tag `v*` → push `ghcr.io/${{ github.repository }}`
- [x] Validação local: `npm run check`, `docker build`, smoke `--version` / `pipeline --help` / `validate-config`

## Em progresso / backlog pipeline V1

- [ ] `pipeline all` (Task 3)
- [ ] Template `qa-agent.yml` para repos alvo (Task 4)
- [ ] Seleção de cenários e execution plan para PR (PRJ-11321+)
- [ ] PR reporter e learning extractor

## Limitações conhecidas

- Providers LLM externos nem sempre validados em todos os ambientes; fallback factory é mitigação
- `inspect` / `report` requerem `--runs-dir` e `--run-id`
- Projeto focado em CLI, não SDK pública estável
- Pipeline correlate implementado (PRJ-11392); run end-to-end e PR reporter ainda pendentes — PRJ-11321+ / PRJ-11324
