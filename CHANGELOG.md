# Changelog

## v2.0.0 — 2026-06-16

### O que entra nesta versão

- **LangGraph engine** — executor baseado em máquina de estados com 13 nós e checkpointing (`runtime.engine: graph`)
- **Human-in-the-Loop (HITL)** — pausa em ações destrutivas com `ASK_APPROVAL` policy
- **PostgreSQL memory persistence** — memória entre runs via `DATABASE_URL` com BM25 + PostgreSQL
- **Audit logging estruturado** — NestJS Logger em todo o fluxo LLM (method, provider, model, tokens)
- **Docker multi-stage build** — imagem `qa-agent:local` com Playwright + `tini`
- **Docker Compose** — orquestração de `postgres` + `qa-agent`
- **CI/CD completo** — GitHub Actions com typecheck, lint, test, validate-config, docker-smoke
- **Zero skips nos testes** — 218 test files, 1741 tests, 0 skipped
- **Fallback LLM automático** — troca de provider em rate limit (429)
- **MemoryStorePort + PostgresMemoryStoreAdapter** — busca BM25, upsert de chunks, fingerprints de falha
- **ClickUpHttpReaderAdapter** — leitura de tasks ClickUp como `DemandContext`
- **Preflight pipeline** — validação de contexto git/ClickUp/GitHub antes de CI
- **PR diff context** — leitura de metadata e diff do PR para pipeline

### Breaking changes

- `runtime.engine` agora aceita `legacy` (default) ou `graph` — anteriormente só existia `legacy`
- `DATABASE_URL` requerida para `memory.source: postgres` ou `hybrid` — sem URL, fallback para arquivo (`memory.md`)
- `docker run qa-agent:ci <cmd>` — não precisa mais digitar `qa-agent` duas vezes (ENTRYPOINT corrige isso)
- `RedisPlanCacheAdapter`, `FilePlanCacheAdapter` removidos — uso de `InMemoryPlanCacheAdapter`
- `ExecutionMonitorService`, `DeepThinkService` removidos — simplificação do runtime

### O que fica para v2.1

- **pgvector** — embeddings vetoriais para busca semântica (espec arquivada em `docs/historico/V2-MEMORY-PGVECTOR-SPEC.md`)
- **Scenario Workspace Memory** — vídeo separado por cenário, continuidade entre BrowserContexts (espec arquivada em `docs/historico/scenario-workspace-memory-spec.md`)
- **Playwright Agent CLI integration** — fallback motor alternativo para skills complexas

### Arquivado

- `docs/V2-MEMORY-PGVECTOR-SPEC.md` → `docs/historico/V2-MEMORY-PGVECTOR-SPEC.md`
- `docs/scenario-workspace-memory-spec.md` → `docs/historico/scenario-workspace-memory-spec.md`
- `ProjectGraphService` → `experimental/project-graph/`

### Docker

```bash
docker pull ghcr.io/mesha/qa-agent:v2.0.0
docker run --rm ghcr.io/mesha/qa-agent:v2.0.0 --version
```
