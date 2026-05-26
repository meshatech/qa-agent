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

## Em andamento

- [ ] Nenhuma feature de código em progresso registrada neste memory bank

## Planejado (spec em tasks-clickup/, sem código)

- [ ] Pipeline preflight (ClickUp, GitHub tokens)
- [ ] Leitura de demanda ClickUp e diff de PR
- [ ] Correlação demanda/diff/memória
- [ ] Seleção de cenários e execution plan para PR
- [ ] PR reporter e learning extractor

## Limitações conhecidas

- Providers LLM externos nem sempre validados em todos os ambientes; fallback factory é mitigação
- `inspect` / `report` requerem `--runs-dir` e `--run-id`
- Projeto focado em CLI, não SDK pública estável
- `qa.memory.search` requer `context.metadata.memorySearch` no runtime (DI ainda não wired no RunAgentUseCase)
