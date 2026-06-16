# Memória V2 — Aprendizado Estruturado por Projeto com PostgreSQL + pgvector

**Versão:** 1.0
**Status:** Especificação para operação — complementa `docs/V2-DEFINITIVE-PLAN.md` (§8)
**Data:** 2026-06-10
**Escopo:** substitui o armazenamento estático (`.agent-qa/memory.md`) por um memory store
em PostgreSQL com `pgvector`, mantendo a busca lexical como primeira classe (híbrido).

---

## 1. Objetivo e Princípios

O agente deve **aprender por projeto, de forma curada** — não acumular contexto de cada run.
A memória armazena somente conhecimento durável extraído dos PRs e das execuções:
features do produto, fluxos validados, locators confirmados, cenários que provaram valor.

No início de cada run, o agente consulta essa memória e injeta no contexto **apenas os
chunks relevantes para o PR atual**, tornando o plano mais preciso e o consumo de tokens
menor (menos exploração, menos degraus da escada de fallback, menos replans).

> **Princípios de design:**
> 1. **Curadoria, não acumulação** — grava-se aprendizado consolidado, nunca transcript de run.
> 2. **Escreve uma vez, lê sempre** — embedding é calculado na escrita; a leitura é só SQL.
> 3. **Híbrido por padrão** — lexical (full-text) + semântico (vector), fundidos por RRF.
> 4. **Memória viva** — chunks têm confiança, reforço por uso e decaimento por obsolescência.
> 5. **O arquivo não morre** — `memory.md` vira formato de import/export e fallback offline.

---

## 2. Por Que Sair do Arquivo Estático (e o que preservar)

### 2.1 Limites do modelo atual (`.agent-qa/memory.md` + BM25 in-memory)

| Limitação | Impacto em operação |
|---|---|
| Busca puramente lexical | "alternar tema" não encontra chunk escrito como "dark mode toggle" — recall baixo entre PT/EN e sinônimos |
| Sem identidade de chunk | `promote-learning` faz append; duplicatas e contradições se acumulam sem merge |
| Sem ciclo de vida | Chunk obsoleto (UI mudou) continua sendo recuperado com o mesmo peso para sempre |
| Write-back via commit no repo alvo | Concorrência entre PRs simultâneos gera conflito de merge no `memory.md` |
| Um arquivo por repo | Sem visão multi-projeto, sem métricas de uso da memória, sem governança |
| Índice reconstruído a cada consulta | `BM25MemoryIndex.build()` roda em toda chamada — ok para 1 arquivo, não escala |

### 2.2 O que o modelo atual faz bem (e a v2 preserva)

- **Precisão lexical**: rotas (`/login`), seletores (`data-testid=submit-btn`), nomes exatos
  de botões são termos onde BM25/full-text ganha de embedding. **A busca lexical permanece.**
- **Legibilidade humana**: a memória continua exportável/importável como Markdown.
- **Tipos de chunk validados**: `route`, `flow`, `scenario`, `semantic_locator` continuam.

### 2.3 Decisão

PostgreSQL + `pgvector` como **fonte de verdade da memória por projeto**, com busca
**híbrida** (FTS nativo do Postgres + cosine no pgvector, fusão por Reciprocal Rank Fusion).
O banco roda na **mesma VPS** do runner self-hosted e do Traefik — latência de consulta
desprezível e nenhum dado de produto sai da infraestrutura.

---

## 3. Modelo de Dados

### 3.1 Schema SQL (migração inicial)

```sql
CREATE EXTENSION IF NOT EXISTS vector;

-- Um registro por projeto/repositório testado
CREATE TABLE projects (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_key TEXT NOT NULL UNIQUE,         -- ex: "mesha/meshamail" (owner/repo)
  display_name TEXT,
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TYPE memory_chunk_type AS ENUM (
  'feature',           -- NOVO: conhecimento de feature extraído de PRs
  'route',
  'flow',
  'scenario',
  'semantic_locator'
);

CREATE TYPE memory_chunk_status AS ENUM (
  'active',            -- recuperável
  'archived',          -- decaído/obsoleto; mantido para auditoria, fora da busca
  'superseded'         -- substituído por merge; aponta para o sucessor
);

CREATE TABLE memory_chunks (
  id            BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id    BIGINT NOT NULL REFERENCES projects(id),
  chunk_type    memory_chunk_type NOT NULL,
  slug          TEXT NOT NULL,               -- identidade estável: "feature/dark-mode"
  title         TEXT NOT NULL,
  content       TEXT NOT NULL,               -- corpo legível (mesmo texto do memory.md)
  metadata      JSONB NOT NULL DEFAULT '{}', -- rotas, criterios, taskIds, prNumbers...
  content_hash  TEXT NOT NULL,               -- sha256(content) p/ cache de embedding
  embedding     vector(1536),                -- NULL permitido (modo degradado lexical)

  -- Memória viva
  status        memory_chunk_status NOT NULL DEFAULT 'active',
  superseded_by BIGINT REFERENCES memory_chunks(id),
  confidence    REAL NOT NULL DEFAULT 0.5,   -- 0..1
  use_count     INT  NOT NULL DEFAULT 0,     -- vezes recuperado e usado em correlação
  success_count INT  NOT NULL DEFAULT 0,     -- vezes que a run que o usou passou
  failure_count INT  NOT NULL DEFAULT 0,     -- vezes que contradisse a realidade (drift)
  last_used_at  TIMESTAMPTZ,
  source_pr     INT,                         -- PR que originou o aprendizado
  source_run_id TEXT,

  -- Busca lexical nativa
  tsv tsvector GENERATED ALWAYS AS (
    setweight(to_tsvector('simple', coalesce(title, '')), 'A') ||
    setweight(to_tsvector('simple', coalesce(content, '')), 'B')
  ) STORED,

  created_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at    TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (project_id, chunk_type, slug)
);

CREATE INDEX idx_chunks_tsv     ON memory_chunks USING gin (tsv);
CREATE INDEX idx_chunks_hnsw    ON memory_chunks
  USING hnsw (embedding vector_cosine_ops) WITH (m = 16, ef_construction = 64);
CREATE INDEX idx_chunks_project ON memory_chunks (project_id, chunk_type, status);

-- Auditoria de consulta (substitui memory-consultation-log.json como fonte; o JSON
-- continua sendo emitido como artifact do pipeline)
CREATE TABLE memory_consultations (
  id          BIGINT GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  project_id  BIGINT NOT NULL REFERENCES projects(id),
  pr_number   INT,
  run_id      TEXT,
  query       TEXT NOT NULL,
  chunk_ids   BIGINT[] NOT NULL DEFAULT '{}',
  gaps        JSONB NOT NULL DEFAULT '[]',
  created_at  TIMESTAMPTZ NOT NULL DEFAULT now()
);
```

Notas de dimensionamento:

- `vector(1536)` assume `text-embedding-3-small` (OpenAI). Se optar por modelo local
  (ex: `bge-m3`, 1024 dims), ajustar a dimensão **na migração inicial** — trocar depois
  exige re-embed de tudo (barato, mas evitável).
- HNSW em vez de IVFFlat: o volume por projeto é pequeno (centenas a poucos milhares de
  chunks); HNSW dá recall alto sem tuning de listas e não exige `ANALYZE` pós-carga.
- Dialeto `simple` no tsvector: o conteúdo mistura PT/EN/código; stemming agressivo
  (`portuguese`) machucaria termos técnicos. Reavaliar com telemetria.

### 3.2 O novo tipo `feature` — o coração do pedido

O aprendizado por PR que você descreveu vira um chunk `feature` estruturado:

```json
{
  "chunk_type": "feature",
  "slug": "feature/dark-mode",
  "title": "Dark mode no painel de configurações",
  "content": "Alternância de tema via menu de conta > Tema. Persiste em localStorage (key 'theme'). Afeta rotas /settings e /inbox. Validação canônica: storage_state theme=dark + atributo data-theme no <html>.",
  "metadata": {
    "routes": ["/settings", "/inbox"],
    "acceptanceCriteria": ["tema persiste após reload", "toggle acessível por teclado"],
    "relatedScenarios": ["scenario/alternar-tema"],
    "relatedLocators": ["semantic_locator/menu_trigger", "semantic_locator/theme_toggle"],
    "clickUpTasks": ["CU-868"],
    "prNumbers": [42, 57]
  }
}
```

Regras:

1. `feature` é criado/atualizado pelo `promote-learning` quando a run de um PR **passa**
   e o `LearningExtractor` consolida o que a feature é, onde mora e como se valida.
2. `metadata.relatedScenarios/relatedLocators` formam um **grafo leve por referência de
   slug** — na recuperação, um hit em `feature` puxa seus cenários e locators relacionados
   em uma segunda query barata (sem precisar de score), entregando contexto completo e
   compacto.
3. Um PR novo que toca `/settings` recupera a feature por rota (lexical) **ou** por
   semântica da demanda ("permitir tema escuro" ≈ "dark mode"), mesmo sem overlap de termos.

---

## 4. Recuperação — Busca Híbrida Eficiente

### 4.1 Pipeline de consulta (1 chamada de embedding, 1 round-trip SQL)

```
correlate (início da run)
  │
  ├─ 1. buildMemorySearchQuery(demand, prDiff)        ← já existe
  ├─ 2. embed(query)                                  ← ÚNICA chamada de embedding da leitura
  ├─ 3. SQL única: CTE lexical + CTE vector + fusão RRF
  └─ 4. expansão de grafo (slugs relacionados)        ← SELECT por slug, sem score
```

```sql
WITH lexical AS (
  SELECT id, row_number() OVER (ORDER BY ts_rank(tsv, q) DESC) AS r
  FROM memory_chunks, websearch_to_tsquery('simple', $query) q
  WHERE project_id = $project AND status = 'active'
    AND chunk_type = ANY($types) AND tsv @@ q
  LIMIT 20
),
semantic AS (
  SELECT id, row_number() OVER (ORDER BY embedding <=> $query_embedding) AS r
  FROM memory_chunks
  WHERE project_id = $project AND status = 'active'
    AND chunk_type = ANY($types) AND embedding IS NOT NULL
  ORDER BY embedding <=> $query_embedding
  LIMIT 20
),
fused AS (
  SELECT id, SUM(1.0 / (60 + r)) AS rrf_score        -- RRF, k=60
  FROM (SELECT * FROM lexical UNION ALL SELECT * FROM semantic) u
  GROUP BY id
)
SELECT c.*, f.rrf_score,
       f.rrf_score * (0.5 + 0.5 * c.confidence) AS final_score
FROM fused f JOIN memory_chunks c ON c.id = f.id
ORDER BY final_score DESC
LIMIT $limit;   -- default 10, igual ao correlate atual
```

Decisões embutidas:

- **RRF em vez de soma ponderada de scores**: scores de FTS e cosine vivem em escalas
  diferentes; fusão por rank é robusta e sem tuning.
- **Confiança como multiplicador suave** (`0.5 + 0.5 * confidence`): chunk novo (0.5) não
  é punido demais; chunk reforçado (→1.0) sobe; chunk decaído (→0) afunda sem sumir.
- **Modo degradado**: se o serviço de embedding falhar, a CTE `semantic` é omitida e a
  busca segue 100% lexical — **a run nunca bloqueia por causa da memória** (mesma filosofia
  do `MemorySearchService` atual, que retorna vazio com warning).

### 4.2 Economia de contexto (o ganho real de tokens)

| Mecanismo | Efeito |
|---|---|
| `LIMIT 10` + corte por `final_score` mínimo (default 0.02) | Só entra no prompt o que tem sinal; sem "encher" contexto |
| Renderização compacta (título + corpo, sem metadata bruta) | `MemoryChunkRenderer` atual já faz; mantém-se |
| Expansão de grafo limitada (≤ 3 relacionados por hit de `feature`) | Contexto completo sem busca adicional cara |
| Orçamento de tokens da memória no prompt (`memoryTokenBudget`, default 1.500) | Trunca por score decrescente; nunca estoura o prompt do plan |
| Recall semântico melhor → menos exploração na execução | Menos chamadas `decide()`/`replan()` — a economia composta mais relevante |

### 4.3 Cache local da run

A consulta acontece **uma vez por run** (no `correlate`); o resultado vai para
`memory-consultation-log.json` e os chunks selecionados seguem nos artefatos do pipeline
(`selected-scenarios.json` etc.). `generate-plan` e `execute` **não reconsultam o banco** —
leem os artefatos. Zero round-trip adicional, comportamento idêntico ao atual.

---

## 5. Escrita — Aprendizado Curado com Deduplicação

### 5.1 Fluxo de escrita (somente via `promote-learning`)

```
run termina
  │
  ├─ pipeline learning ──▶ learning-candidates.json      (já existe)
  │
  └─ pipeline promote-learning --auto-approve
       │  para cada candidato aprovado:
       ├─ 1. normaliza → { chunk_type, slug, title, content, metadata }
       ├─ 2. content_hash = sha256(content)
       │      hash já existe no projeto? → no-op (idempotência entre re-runs)
       ├─ 3. embed(content)                               ← única chamada de embedding da escrita
       ├─ 4. dedup semântico:
       │      vizinho mais próximo do mesmo tipo com cosine ≥ 0.92?
       │      ├─ slug igual            → UPDATE (conteúdo evolui, embedding novo,
       │      │                          confidence preservada, updated_at)
       │      └─ slug diferente        → MERGE: novo chunk criado, antigo marcado
       │                                 superseded_by, metadata.prNumbers unidos
       └─ 5. INSERT com confidence inicial 0.5, source_pr, source_run_id
```

Custo: **1 embedding por candidato promovido** (tipicamente 0–5 por PR). Com
`text-embedding-3-small` isso é fração de centavo — irrelevante perto de 1 chamada de plan.

### 5.2 Reforço e decaimento (memória viva)

Atualizações disparadas pelo `report`/`learning` ao fim da run, em uma única transação:

| Evento | Efeito no chunk |
|---|---|
| Chunk recuperado e correlacionado a cenário executado | `use_count++`, `last_used_at = now()` |
| Run do cenário que o usou **passou** | `success_count++`, `confidence = min(1, confidence + 0.05)` |
| Chunk contradito pela realidade (locator não existe, rota mudou → DRIFT) | `failure_count++`, `confidence = max(0, confidence - 0.2)` |
| `confidence < 0.15` **e** `failure_count ≥ 3` | `status = 'archived'` (sai da busca, fica auditável) |
| Job mensal (cron na VPS) | chunks `active` sem uso há 180 dias → `confidence - 0.1` |

Isso fecha o ciclo que o arquivo estático nunca teve: **a memória converge para o que é
verdade no produto hoje**, e o que envelhece sai do caminho sem ser apagado.

### 5.3 O que é proibido gravar

- Transcript/log de run, observações de tela, DOM — isso é artefato de run (GitHub
  artifacts), não memória.
- Dados sensíveis: o conteúdo passa pelo `SanitizerService` (mask de emails/JWT/cookies)
  **antes** do INSERT. O banco nunca recebe credencial ou PII.
- Chunks por falha não confirmada: candidato de run com status BLOCKED/INCONCLUSIVE não é
  promovível (apenas BUG confirmado pode gerar atualização de `feature` com a correção).

---

## 6. Arquitetura no Código (Ports & Adapters)

A mudança respeita a Clean Architecture existente — **nenhum use case muda de contrato**:

```
MemorySearchService (application)        ← interface pública preservada
   │
   ▼
MemoryStorePort (novo port)
   ├── PgVectorMemoryStoreAdapter (novo, canônico)
   │     ├── pg (pool, SQL acima)
   │     └── EmbeddingProviderPort ──▶ OpenAiEmbeddingAdapter | NoopEmbeddingAdapter
   └── FileMemoryStoreAdapter (wrapper do BM25 atual — fallback/offline)
```

| Componente | Status | Responsabilidade |
|---|---|---|
| `MemoryStorePort` | novo | `search(query, opts)`, `upsert(chunk)`, `reinforce(events)`, `export()`, `import(markdown)` |
| `PgVectorMemoryStoreAdapter` | novo | SQL híbrido §4.1, dedup §5.1, lifecycle §5.2 |
| `FileMemoryStoreAdapter` | novo (wrapper) | Encapsula `MemoryMarkdownLoader + MemoryChunker + BM25MemoryIndex` atuais |
| `EmbeddingProviderPort` | novo | `embed(texts: string[]): number[][]` — batch, com retry |
| `MemorySearchService` | modificado | Passa a delegar ao port; assinatura de `search()` inalterada |
| `RunPipelineCorrelateUseCase` | **inalterado** | Continua chamando `memorySearch.search()` |
| `RunPipelinePromoteLearningUseCase` | modificado | Grava via port em vez de reescrever `memory.md` |

Seleção por config:

```json
{
  "memory": {
    "store": "pgvector",                  // "pgvector" | "file" (default: "file" até GA)
    "databaseUrlEnv": "QA_AGENT_MEMORY_DB_URL",
    "embedding": { "provider": "openai", "model": "text-embedding-3-small" },
    "search": { "limit": 10, "minScore": 0.02, "tokenBudget": 1500 },
    "writeback": { "autoApprove": true, "dedupThreshold": 0.92 }
  }
}
```

---

## 7. Operação na Infraestrutura Existente (VPS + self-hosted)

### 7.1 Provisionamento (docker-compose na VPS, junto do Traefik)

```yaml
# /opt/qa-agent/docker-compose.memory.yml
services:
  qa-memory-db:
    image: pgvector/pgvector:pg17
    restart: unless-stopped
    environment:
      POSTGRES_DB: qa_agent_memory
      POSTGRES_USER: qa_agent
      POSTGRES_PASSWORD_FILE: /run/secrets/qa_memory_pass
    volumes:
      - qa-memory-data:/var/lib/postgresql/data
    networks: [qa-internal]        # SEM porta pública; só a rede interna do runner
    secrets: [qa_memory_pass]

volumes:
  qa-memory-data:
networks:
  qa-internal: { external: true }  # mesma rede dos jobs self-hosted
```

- **Sem exposição pública**: o banco só é alcançável pela rede interna Docker da VPS;
  o job do agente (container no runner) conecta via `qa-memory-db:5432`.
- Secret no GitHub: `QA_AGENT_MEMORY_DB_URL=postgres://qa_agent:***@qa-memory-db:5432/qa_agent_memory`.
- **Backup**: `pg_dump` diário via cron da VPS para o storage de backup existente +
  `qa-agent memory export` semanal commitando snapshot `memory.md` por projeto (ver §7.3).

### 7.2 Multi-projeto

Um único banco serve todos os repositórios: `project_key = owner/repo` (derivado de
`GITHUB_REPOSITORY`, zero config no repo alvo). Isolamento lógico por `project_id` em
todas as queries; sem dado cruzado entre projetos no contexto do agente.

### 7.3 Export/Import — o arquivo como formato, não como store

```bash
qa-agent memory import --project mesha/meshamail --file .agent-qa/memory.md   # migração inicial
qa-agent memory export --project mesha/meshamail --out .agent-qa/memory.md    # snapshot legível
qa-agent memory stats  --project mesha/meshamail                              # chunks por tipo, confiança média, top usados
```

- `import` reaproveita o `MemoryChunker` atual (o contrato `## [tipo] slug` do
  `V2-DEFINITIVE-PLAN.md` §8.1 é exatamente o formato de import).
- `export` mantém a memória **revisável por humanos** e versionável como snapshot — o
  benefício de governança do arquivo permanece, sem os custos de concorrência.
- O write-back por commit (`V2-DEFINITIVE-PLAN.md` §8.3) é **substituído** pelo INSERT no
  banco: PRs simultâneos deixam de conflitar; o snapshot exportado vira artefato semanal,
  não passo do pipeline de PR.

### 7.4 Disponibilidade e modo degradado

| Falha | Comportamento |
|---|---|
| Banco indisponível no `correlate` | Warning + fallback para `FileMemoryStoreAdapter` (snapshot exportado no repo); se ausente, segue sem memória — **nunca bloqueia o PR** |
| Embedding API indisponível na leitura | Busca 100% lexical (CTE semântica omitida) |
| Embedding API indisponível na escrita | Chunk gravado com `embedding NULL` + job de backfill (`qa-agent memory backfill-embeddings`) |
| Migração de modelo de embedding | `backfill-embeddings --model <novo>` re-embeda por `content_hash`; coluna redimensionada em migração planejada |

---

## 8. Fases de Implementação

> Mesmo protocolo das demais frentes: suite verde entre fases, 1 preocupação por PR.

### Fase M1 — Port e fallback (sem banco ainda)
- [ ] `MemoryStorePort` + `FileMemoryStoreAdapter` envolvendo BM25 atual.
- [ ] `MemorySearchService` delega ao port; `correlate`/`promote-learning` inalterados.
- [ ] Config `memory.store` com default `file`. Zero mudança de comportamento.

### Fase M2 — Store pgvector (leitura)
- [ ] Migrações SQL (§3.1) + `PgVectorMemoryStoreAdapter.search()` com RRF (§4.1).
- [ ] `EmbeddingProviderPort` + adapter OpenAI (batch + retry) + `Noop` para testes.
- [ ] `qa-agent memory import` (migra `memory.md` existente, com backfill de embeddings).
- [ ] Testes de integração com Postgres efêmero (testcontainers).

### Fase M3 — Escrita curada
- [ ] `promote-learning` grava via port: hash idempotente, dedup semântico ≥ 0.92, merge
      com `superseded_by` (§5.1).
- [ ] Tipo `feature` no `LearningExtractor`: consolidação de feature a partir de demanda
      ClickUp + diff + resultado da run, com `metadata` relacional (§3.2).
- [ ] Sanitização obrigatória pré-INSERT.

### Fase M4 — Memória viva
- [ ] Eventos de reforço/decaimento no fim da run (§5.2), em transação única.
- [ ] `memory_consultations` persistido + `qa-agent memory stats`.
- [ ] Cron mensal de decaimento por inatividade (script na VPS).

### Fase M5 — Operação e GA
- [ ] `docker-compose.memory.yml` provisionado na VPS + secret `QA_AGENT_MEMORY_DB_URL`.
- [ ] Backup diário (`pg_dump`) + export semanal de snapshot.
- [ ] Piloto em 1 projeto real por 2 semanas com `store: pgvector`; comparar telemetria
      (tokens por run, degraus da escada, replans) contra baseline `file`.
- [ ] Flip do default para `pgvector`; `file` permanece como fallback documentado.

---

## 9. Critérios de Aceite

1. **Contrato preservado**: `correlate` funciona sem mudança de assinatura; trocar
   `memory.store` entre `file` e `pgvector` não altera nenhum schema de artefato.
2. **Nunca bloqueia**: banco ou embedding indisponíveis degradam (lexical/arquivo/vazio
   com warning), jamais derrubam a run de PR.
3. **Leitura barata**: 1 chamada de embedding + 1 round-trip SQL por run; p95 da consulta
   < 100 ms na VPS.
4. **Escrita curada**: re-rodar `promote-learning` do mesmo run é no-op (idempotência por
   hash); candidatos semanticamente duplicados resultam em merge, não em chunk novo.
5. **Memória viva mensurável**: `memory stats` mostra confiança média, uso e arquivados;
   chunk contradito 3× sai da busca sem intervenção manual.
6. **Economia comprovada no piloto**: redução mensurável de tokens por run e/ou de
   degraus da escada versus baseline — telemetria no `pr-report.md` (seção "Memória").
7. **Governança**: export legível por humanos a qualquer momento; nenhum dado sensível no
   banco (auditoria por amostragem no piloto).

---

## 10. Decisões Registradas

| Decisão | Escolha | Alternativa rejeitada | Motivo |
|---|---|---|---|
| Mecanismo de busca | Híbrido FTS + pgvector com RRF | Só vetorial | Termos exatos (rotas, testids, nomes de botão) são o forte do caso de uso; embedding sozinho perde precisão lexical |
| Banco | Postgres + pgvector na VPS | Serviço gerenciado de vetores (Pinecone etc.) | Infra já existe, dado não sai da VPS, volume é pequeno, SQL dá governança de graça |
| Índice vetorial | HNSW | IVFFlat | Volume pequeno por projeto; HNSW tem recall alto sem tuning |
| Modelo de embedding | `text-embedding-3-small` (1536d) | Modelo local | Custo desprezível na escala (embeds só na escrita); trocar por local é suportado via port |
| Quando embeddar | Na escrita (1×/chunk) + 1×/query na leitura | Re-embed na leitura | Leitura é o caminho quente; escrita é rara e curada |
| Granularidade do aprendizado | Chunk curado por feature/fluxo/cenário/locator | Contexto por run | Requisito explícito: aprendizado estruturado, não acumulação — contexto de run é artefato, não memória |
| Relações entre chunks | Grafo leve por slug em `metadata` | Tabela de edges / graph DB | Suficiente para expansão de contexto; evita repetir o erro do `ProjectGraphService` arquivado na simplificação |
| Write-back no repo alvo | Substituído por INSERT no banco + snapshot exportado | Commit do `memory.md` por PR | Elimina conflito entre PRs concorrentes; humano revisa via export/stats |
| Identidade do projeto | `GITHUB_REPOSITORY` como `project_key` | Config manual | Zero configuração no onboarding |

---

## 11. Relação com os Demais Documentos

- **Substitui** o §8.3 (write-back por commit) do `V2-DEFINITIVE-PLAN.md` quando
  `memory.store = pgvector`; o contrato Markdown do §8.1 daquele doc permanece como
  **formato de import/export** desta spec.
- **Compatível** com `scenario-workspace-memory-spec.md`: o `runtime-memory.md` daquela
  spec é estado **efêmero da run** (filesystem) e não entra no banco — exatamente a
  fronteira curadoria × contexto definida no §5.3.
- Fases M1–M5 podem rodar em paralelo às Fases A–E do plano definitivo; única dependência
  dura é a Fase M5 (piloto) precisar do ciclo de PR operante (Fase C do plano definitivo).

---

## 12. Referências

- `src/application/services/memory-search.service.ts`, `bm25-memory-index.service.ts`,
  `memory-chunker.service.ts` — implementação atual (vira `FileMemoryStoreAdapter`).
- `src/application/use-cases/run-pipeline-promote-learning.usecase.ts` — ponto de escrita.
- `src/application/use-cases/run-pipeline-correlate.usecase.ts` — ponto de leitura.
- `docs/V2-DEFINITIVE-PLAN.md` §8 — contrato Markdown (formato import/export).
- pgvector: https://github.com/pgvector/pgvector (HNSW, `vector_cosine_ops`).
- Reciprocal Rank Fusion: Cormack et al., 2009 — fusão robusta de rankings heterogêneos.
