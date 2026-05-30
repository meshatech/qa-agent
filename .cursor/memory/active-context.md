# Contexto Ativo

> Arquivo volátil — atualizar ao iniciar/concluir tarefas relevantes.

## Foco atual

**Branch** `PRJ-11323-create-learning-candidates-and-risk-scoring-initial` — ajustes Gherkin em stash (`WIP: Gherkin bug feedback...`). Specs em `specs/001-gherkin-bug-feedback/` (gitignored, no disco).

Correção de 8 bugs no pipeline de execução concluída (factory/planner/resolver/learning-extractor). Todos os testes passam (`npm run check`: typecheck + lint + 1340 testes OK). `validate:agent-config` falha por motivo pré-existente (13 .mdc vs 12 esperados — `specify-rules.mdc` do speckit, não relacionado).

## Decisões recentes

- semanticTarget não-fatal — em vez de `throw`, candidatos inseguros/curtos/que estouram a policy são ignorados com warning; retorna subconjunto seguro ou `null` (caller emite safe check step)
- semanticTarget guarda candidatos vazios/<3 chars retornando `null`
- NAVIGATION path traversal — `hasPathTraversal` decodifica + `posix.normalize` + checa segmento `..` (sem falsos positivos de `includes('..')`); containment de base path quando baseUrl tem subpath
- DATA_ENTRY — valida `testValue` com `validateDestructiveText`; substitui por `safe-test-value` + warn se bloqueado
- resolve() valida saída do LLM com `ExpectedOutcomeSchema.parse`; falha → `CLASSIFICATION_FAILED`
- planner factory_first — sem plano da factory, faz fallback para LLM buildPlan; sem fallback usável lança `ExecutionPlanBuildError`
- isLogoutProofCondition route_state — só aceita `expectedUrlPattern` contendo `/login`, `/signin`, `/auth`
- learning-extractor persist — ordem write temp → rename → appendRunHistory (rename falha: deleta temp + rethrow; sem referência pendente no history)

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
