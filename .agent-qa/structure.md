# Estrutura da memória — `.agent-qa/`

Contrato de organização da memória persistente do Agent QA para execuções de QA. Consumida futuramente por `MemoryChunker`, `BM25MemoryIndex` e `MemorySearchService` (PRJ-11315).

## Arquivos desta pasta

| Arquivo | Função |
|---------|--------|
| `memory.md` | Conhecimento indexável do projeto (chunks tipados) |
| `structure.md` | Este guia de convenções |
| `run-history.jsonl` | Histórico de runs (1 evento JSON por linha) |

## Tipos de chunk (`MemoryChunkType`)

Contrato planejado em `src/domain/` (PRJ-11328/11329):

| Tipo | Uso |
|------|-----|
| `project` | Visão, arquitetura, convenções globais do app sob teste |
| `route` | URL, propósito, pré-condições de navegação |
| `flow` | Sequência de passos ou jornada de usuário |
| `semantic_locator` | Como encontrar elementos (texto, role, candidatos semânticos) |
| `scenario` | Cenário de teste ou critério de aceite mapeado |
| `known_issue` | Bug conhecido, limitação, workaround |
| `runtime_learning` | Aprendizado de runs anteriores (locators que funcionaram/falharam) |

## Formato de seção em `memory.md`

Cada seção deve ser autocontida e buscável:

```markdown
## Login da aplicação
<!-- type: route | id: ROUTE-LOGIN-001 -->

URL /login. Credenciais via usernameEnv/passwordEnv no config — nunca literais aqui.
```

- **`type`**: um dos tipos acima (obrigatório)
- **`id`**: identificador estável único no projeto (obrigatório)
- Conteúdo: factual, atualizado, sem tokens ou credenciais

## Equivalência com Memory Bank Cursor (`.cursor/memory/`)

Memória para **desenvolver** o repo vs memória para **executar QA**:

| Cursor (dev) | Agent QA (runtime) |
|--------------|----------------------|
| `project-brief.md`, `architecture.md` | chunks `type: project` |
| rotas/fixtures documentados | chunks `type: route`, `flow` |
| locators estáveis | chunks `type: semantic_locator` |
| `progress.md` learnings | chunks `type: runtime_learning` |
| limitações documentadas | chunks `type: known_issue` |

Ao descobrir conhecimento estável em `.cursor/memory/`, espelhar na seção correspondente de `memory.md`.

## Adicionar chunks manualmente

1. Escolher `type` e gerar `id` único (ex.: `FLOW-SMOKE-001`)
2. Adicionar seção em `memory.md` com metadado HTML
3. Manter texto conciso — BM25 funciona melhor com parágrafos focados
4. Nunca commitar dados sensíveis

## `run-history.jsonl`

Formato JSONL: uma linha = um objeto JSON (sem vírgulas entre linhas).

Campos esperados (evolução futura PRJ-11327):

```json
{"runId":"...","ts":"ISO-8601","status":"passed|failed","demandId":"...","summary":"..."}
```

Linhas que começam com `#` são comentários e devem ser ignoradas por parsers.

## Proibido

- Tokens ClickUp, GitHub, API keys, senhas, valores de env
- Estado efêmero de uma run (`TaskMemoryService`) — usar `run-history.jsonl` para resumos, não scratch pad
