# Contexto Ativo

> Arquivo volátil — atualizar ao iniciar/concluir tarefas relevantes.

## Foco atual

**PRJ-11315 auditada e concluída**: memória Markdown/BM25 implementada; gaps corrigidos; `npm run check` verde; subtasks ClickUp em **desenvolvido**; parent em **code review**.

## Decisões recentes

- Tool canônica permanece `qa.memory.search` (alias `search_project_memory` para ClickUp PRJ-11335)
- BM25 implementado internamente, sem dependência externa
- Fallback de memória vazia retorna `warnings[]` sem quebrar fluxo
- `qa.plan.build` e `qa.plan.replan` retornam `memoryContext` automaticamente
- `MemoryMarkdownLoader` + `RunHistoryService` adicionados no gap-fix da auditoria

## Bloqueios

Nenhum no momento.

## Próximo passo sugerido

Implementar PRJ-11316 (onboarding real e baseline smoke) quando priorizado.
