# Memória do projeto — agent-qa (dogfooding)

Memória persistente para execuções de QA neste repositório. Alinhada a `.agent-qa/structure.md`.

---

## Agent QA — runtime CLI

<!-- type: project | id: PROJ-AGENT-QA-001 -->

Runtime de QA guiado por LLM (TypeScript, NestJS, Playwright, Zod). CLI principal: `qa-agent`. Documentação canônica em `doc/README.md`. Release estável documentada: v0.2-stable com Hybrid Guarded Execution e QaToolRegistry.

Princípio: LLM decide, harness executa, orchestrator governa, schemas validam, evidence registra.

---

## Fixture smoke — cadastro

<!-- type: route | id: ROUTE-FIXTURE-SMOKE-001 -->

- **URL**: `http://127.0.0.1:4173/` (servidor local `node ./test/fixtures/server.mjs`)
- **Página**: `test/fixtures/smoke.html` — formulário "Cadastro" com campo Nome e botão Salvar
- **Domínio config**: `127.0.0.1` em `appDomains`
- **Config de exemplo**: `agent-qa.fixture.config.json`

---

## Fixture login

<!-- type: route | id: ROUTE-FIXTURE-LOGIN-001 -->

- **URL**: `http://127.0.0.1:4173/login` (mesmo servidor fixture)
- **Página**: `test/fixtures/login.html`
- **Credenciais**: definir via env vars do config de auth (`formLogin` — `usernameEnv`, `passwordEnv`); ver `test/fixtures/login.html` para comportamento esperado

---

## Smoke local — validate e run

<!-- type: flow | id: FLOW-FIXTURE-SMOKE-001 -->

1. Subir fixture: `node ./test/fixtures/server.mjs`
2. Validar config: `npm run qa-agent -- validate-config --config ./agent-qa.fixture.config.json`
3. Executar: `npm run qa-agent -- run --config ./agent-qa.fixture.config.json`
4. Provider recomendado para teste local: `llm.provider: fake`
5. Demanda exemplo: preencher campo Nome e salvar (status "Salvo" na página)

---

## Locators — smoke.html

<!-- type: semantic_locator | id: LOC-SMOKE-NAME-001 -->

- Campo **Nome**: `input[name="name"]` ou label "Nome"
- Botão **Salvar**: `button` com texto "Salvar"
- Confirmação: `#status` com texto "Salvo" após clique

---

## Locators — login.html

<!-- type: semantic_locator | id: LOC-LOGIN-FORM-001 -->

- Título página: "Acessar conta"
- Email: `#email` ou `input[name="email"]`
- Senha: `#password` ou `input[name="password"]`
- Submit: `#submit` texto "Entrar"
- Erro: `#error` role alert "Credenciais inválidas"
- Sucesso: `#dashboard` "Bem-vindo ao Dashboard" (URL `/dashboard`)

---

## Cenário fixture smoke

<!-- type: scenario | id: SCN-FIXTURE-SMOKE-001 -->

**Objetivo**: Preencher Nome e salvar no fixture de cadastro.

**Critérios observáveis**:
- Campo nome preenchido
- Após Salvar, `#status` exibe "Salvo"

**Config**: `demand.id: DEM-001`, `agent-qa.fixture.config.json`

---

## Limitações conhecidas do runtime

<!-- type: known_issue | id: ISSUE-RUNTIME-LIMITS-001 -->

- Providers LLM externos (Groq, OpenAI) podem falhar em alguns ambientes; fallback para factory plan é esperado
- `inspect` e `report` requerem `--runs-dir` e `--run-id`
- Escopo atual é CLI; SDK pública estável não é garantida
- Serviços BM25 (`MemorySearchService`, `MemoryChunker`, `BM25MemoryIndex`) implementados — consulta via tool `qa.memory.search`

---

## Aprendizados de runtime

<!-- type: runtime_learning | id: LEARN-CLICKUP-DEMAND-RUN-001 -->

`RunAgentUseCase` persiste `demand-context.json` quando `CLICKUP_TOKEN` está no env e há `config.clickup.taskId` (fallback deprecado: `CLICKUP_TASK_ID` env com warning). Preflight extrai task ID do PR; fora do GHA o check é skipped (`WARN`).

<!-- type: runtime_learning | id: LEARN-GITHUB-PR-CONTEXT-001 -->

`GitHubActionsPrContextReaderPort.read()` monta `PullRequestContext` a partir de `GITHUB_*` + `GITHUB_EVENT_PATH` (eventos `pull_request` / `pull_request_target`) e retorna também `rawDiff` via `git diff origin/${GITHUB_BASE_REF}...HEAD` (`buildPullRequestDiffArgs`), `changedFiles` classificados (`parseGitDiffChangedFiles` + `classifyChangedFiles`, PRJ-11388), `affectedRoutes` (`detectAffectedRoutes`, PRJ-11389) e `affectedSchemas` (`detectAffectedSchemas`, PRJ-11390). `headBranch` é metadado; tip do diff é `HEAD` (merge ref em GHA). Diff vazio → `rawDiff === ''`, `changedFiles === []`, `affectedRoutes === []`, `affectedSchemas === []`. Persistência em `pr-diff-context.json` via `qa-agent read-pr-context` (PRJ-11391). Testes E2E: reader + `ExecGitRepositoryAdapter` real. Erros estruturados: `PrContextReaderError`. Preflight (`validateCheckoutHistory`) já garante shallow checkout e `origin/${base}` antes do pipeline.

<!-- type: runtime_learning | id: LEARN-GITHUB-DIFF-PARSER-001 -->

`parseGitDiffAddedLines(rawDiff)` em `git-diff-added-lines.parser.ts` extrai `DiffLine[]` com `type: 'added'`. Metadados compartilhados em `git-diff.parser.shared.ts`. Linhas `+` (não `+++`) viram `content` sem prefixo; `lineNumber` segue contador do lado novo do hunk (`@@ ... +newStart ... @@`), incrementando também em linhas de contexto (` `). Removidas (`-`) e marcadores `\ No newline` não incrementam o contador novo. Saída validada por `DiffLineSchema`. Wiring no reader/`ChangedFile.positiveLines` adiado para PRJ-11388.

<!-- type: runtime_learning | id: LEARN-GITHUB-DIFF-PARSER-002 -->

`parseGitDiffRemovedLines(rawDiff)` em `git-diff-removed-lines.parser.ts` extrai `DiffLine[]` com `type: 'removed'`. Mesmos metadados ignorados que PRJ-11385. Linhas `-` (não `---`) viram `content` sem prefixo; `lineNumber` segue contador do lado antigo do hunk (`@@ -oldStart ... @@`), incrementando também em linhas de contexto (` `). Adicionadas (`+`) e marcadores `\ No newline` não incrementam o contador antigo. Saída validada por `DiffLineSchema`. Wiring no reader/`ChangedFile.negativeLines` adiado para PRJ-11388.

<!-- type: runtime_learning | id: LEARN-GITHUB-DIFF-PARSER-003 -->

`parseGitDiffContextLines(rawDiff)` em `git-diff-context-lines.parser.ts` extrai `DiffLine[]` com `type: 'context'`. Metadados compartilhados em `git-diff.parser.shared.ts` (`HUNK_HEADER_PATTERN`, `isFileMetadataLine`). Linhas com prefixo espaço (` `) viram `content` sem prefixo; `lineNumber` segue contador do lado novo do hunk (`@@ ... +newStart ... @@`). Adicionadas (`+`) incrementam contador sem emitir; removidas (`-`) não incrementam. Limite de contexto fica para consumidor (PRJ-11388+).

<!-- type: runtime_learning | id: LEARN-GITHUB-CHANGED-FILES-001 -->

`parseGitDiffChangedFiles(rawDiff)` monta `ChangedFile[]` por seção `diff --git` (`path`, `status`, `positiveLines`, `negativeLines`, `contextLines`). Status: `--- /dev/null` → `added`; `+++ /dev/null` → `removed`; senão `modified`. `classifyChangedFileKind(path)` atribui `kind` determinístico (`test` > `schema` > `route` > `infra` > `docs` > `other`) por path/extensão. `GitHubActionsPrContextReaderAdapter.read()` retorna `changedFiles` em `PrContextReadResult`. PRJ-11389/11390 filtram por `kind`; PRJ-11391 persiste JSON.

<!-- type: runtime_learning | id: LEARN-GITHUB-AFFECTED-ROUTES-001 -->

`detectAffectedRoutes(changedFiles)` filtra `kind === 'route'` e deriva rotas via `extractRouteFromChangedFilePath` (segmento `routes/` ou `pages/`, strip extensão, colapsa `index`). Saída deduplicada e ordenada (`/home`, `/admin/users`, …). Exposta em `PrContextReadResult.affectedRoutes` e serializada em `pr-diff-context.json` (PRJ-11391).

<!-- type: runtime_learning | id: LEARN-GITHUB-AFFECTED-SCHEMAS-001 -->

`detectAffectedSchemas(changedFiles)` filtra `kind === 'schema'` e deriva identificadores via `extractSchemaIdentifierFromChangedFilePath` (`.schema.ts` → basename sem sufixo; senão path sem extensão final). Saída deduplicada e ordenada (`changed-file`, `pull-request-context`, …). Exposta em `PrContextReadResult.affectedSchemas` e serializada em `pr-diff-context.json` (PRJ-11391).

<!-- type: runtime_learning | id: LEARN-GITHUB-PR-DIFF-CONTEXT-001 -->

`PrDiffContextPersistenceService.persistFromGitHubActions(outputDir)` chama `GitHubActionsPrContextReaderPort.read()`, mapeia via `buildPrDiffContextFromReadResult` em `application/mappers/pr-diff-context.mapper.ts` (sem `rawDiff`), valida `PrDiffContextSchema` (`schemaVersion: pr-diff-context.v1`), sanitiza com `SanitizerService` + `collectKnownSecretsFromEnv` (CLICKUP/GITHUB tokens do env) e grava `{outputDir}/pr-diff-context.json` via writer atômico (tmp + rename). CLI: `qa-agent read-pr-context --output-dir ./.agent-qa/pipeline`. Falha propaga `PrContextReaderError`. Consumo pelo correlator fica para PRJ-11392+.

<!-- type: runtime_learning | id: LEARN-GITHUB-PR-REFS-001 -->

Refs do PR vêm de `github-actions-pr-refs.resolver.ts`: `prNumber` via `GITHUB_REF` (`refs/pull/N/merge`) → `GITHUB_PR_NUMBER` → `pull_request.number` em `GITHUB_EVENT_PATH`; `baseBranch`/`headBranch` de `GITHUB_BASE_REF`/`GITHUB_HEAD_REF`. `FileGitHubEventContextAdapter` reutiliza o mesmo resolver de `prNumber`. Ausência de qualquer ref retorna `undefined` em `resolveGitHubActionsPrRefs` (mapper lança `PrContextReaderError` `MISSING_CONTEXT`). Preflight `readBranchHead()` usa o mesmo `resolveHeadBranchFromEnv` e reporta ausência em `preflight-report.checks.branchHead`.

<!-- type: runtime_learning | id: LEARN-GITHUB-BASE-BRANCH-001 -->

Antes do `git diff`, `GitHubActionsPrContextReaderAdapter` chama `GitRepositoryPort.ensureBaseBranchAvailable(baseBranch, cwd)`: verifica `origin/${baseBranch}`; se ausente e checkout não-shallow, executa `git fetch origin ${base}:refs/remotes/origin/${base}` via `execFile`. Falha com `PrContextReaderError` code `BASE_BRANCH_UNAVAILABLE`. Preflight continua gate CI sem fetch. Testes de integração cobrem fetch que restaura `origin/main` ausente e bloqueio em checkout shallow.

<!-- type: runtime_learning | id: LEARN-PR-CLICKUP-TASK-ID-001 -->

`extractClickUpTaskIdFromPullRequestText(title, body?, pattern?)` extrai custom ID do PR (default `PRJ-\d+`; override env/config). Preflight: skipped (`WARN`) sem contexto PR ou sem `GITHUB_EVENT_PATH`; BLOCKED se PR OK mas ID ausente. Erros I/O/parse de `GITHUB_EVENT_PATH` propagam (`PrContextReaderError`) → preflight `FAIL` com `error`. Regex custom: max 100 chars, whitelist, `safe-regex`; inválido → fallback + `warning` centralizado (`INVALID_CUSTOM_ID_PATTERN_WARNING`). Body sanitizado (control chars, max 10k) com `Logger.warn` se truncado. `CLICKUP_TASK_ID` no `collectKnownSecretsFromEnv` (fallback deprecado). Erros preflight sanitizados (paths multi-segmento + tokens). Mapper GHA omite `clickUpTaskId` se ausente. Schema: `clickUpTaskId` opcional.

<!-- type: runtime_learning | id: LEARN-PLACEHOLDER-001 -->

_Placeholder_: learnings de locators, cenários pass/fail e recovery serão appendados aqui ou via pipeline de learning (PRJ-11323) após runs reais documentadas.

Regra: preferir registrar locators estáveis como `semantic_locator` e outcomes como novos ids `runtime_learning`.
