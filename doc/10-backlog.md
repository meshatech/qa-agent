# 10 — Backlog: Épico 10 (Robustez operacional do loop reativo)

Tasks obrigatórias do MVP v0.1 derivadas do patch final. Sem essas tasks, o loop reativo não é seguro.

## Quiescência

```md
- [ ] Criar QuiescenceGuard
- [ ] Esperar networkidle quando aplicável
- [ ] Implementar detecção de DOM quiet por MutationObserver
- [ ] Adicionar timeout configurável de quiescência
- [ ] Registrar QUIESCENCE_TIMEOUT como warning quando continuável
```

## IDs efêmeros

```md
- [ ] Adicionar observationId em toda ScreenObservation
- [ ] Fazer QaActionEnvelope exigir observationId
- [ ] Rejeitar ação com observationId obsoleto
- [ ] Tornar IDs de elementos efêmeros por observação
- [ ] Limpar LocatorResolver a cada nova observação
- [ ] Recriar mapa id -> locator após cada Observe
- [ ] Registrar STALE_OBSERVATION como erro recuperável
```

## Dados dinâmicos

```md
- [ ] Criar RunDataStore
- [ ] Implementar placeholder {{uniqueName:key:prefix}}
- [ ] Implementar placeholder {{uniqueEmail:key}}
- [ ] Implementar placeholder {{ref:key}}
- [ ] Fazer ActionHarness resolver dados dinâmicos antes da ação
- [ ] Fazer AssertionHarness resolver dados dinâmicos antes da validação
- [ ] Persistir run-data.json no diretório da execução
```

## Ações de emergência

```md
- [ ] Adicionar ação global press Escape
- [ ] Adicionar ação global clickOutside
- [ ] Adicionar ação restrita clickAtCoordinates
- [ ] Criar política para limitar uso de coordenadas
- [ ] Logar toda ação de emergência no execution-log.json
```

## Critérios de aceite (DoD do Épico 10)

```txt
1. Após qualquer click/fill/select, executa-se quiescência antes da próxima Observe
2. Action com observationId antigo é rejeitada com STALE_OBSERVATION
3. LocatorResolver não retém estado entre observações
4. Asserções com {{ref:key}} usam o mesmo valor digitado pelo Action
5. {{ref:key}} sem set prévio falha com DYNAMIC_DATA_KEY_NOT_FOUND
6. press Escape e clickOutside disponíveis em qualquer step
7. clickAtCoordinates só executa se 3 ações semânticas anteriores falharam
8. run-data.json é persistido ao final da run
9. Recovery exausta marca task BLOCKED + evidência completa
```

## Estrutura v0.1

O Épico 10 entra dentro da implementação TypeScript/NestJS descrita no [doc 21](./21-v0.1-implementation-structure.md). A decisão de usar LangChain fica restrita ao adapter LLM no [doc 20](./20-adr-typescript-nest-langchain.md).

```md
- [ ] Criar app NestJS/TypeScript
- [ ] Criar módulos de Orchestrator, Harness, LLM, Locator, Data, Recovery e Evidence
- [ ] Implementar DecisionProvider desacoplado de LangChain
- [ ] Implementar LangChainDecisionProvider para OpenAI
- [ ] Garantir que nenhum módulo fora de LlmModule importe LangChain
- [ ] Validar toda resposta LLM com QaActionEnvelopeSchema
```

## Estimativa de risco se não implementado

| Item ausente | Risco |
|--------------|-------|
| Quiescence Guard | Race condition em SPAs. Falsos bugs |
| Ephemeral IDs | Ação em elemento inexistente. Crash ou click errado |
| RunDataStore | Asserção compara texto errado. Falso bug |
| Emergency actions | Loop infinito em modal. Run trava |

## Próximos épicos (fora do patch final)

```md
Épico 1 — Harness vivo (Playwright base)
Épico 2 — Observação enxuta (accessibility tree)
Épico 3 — Locator Resolver (estratégias role/label/placeholder/text/testid)
Épico 4 — Ações atômicas com Zod
Épico 5 — Ciclo reativo Observe→Decide→Act→Validate
Épico 6 — Data Harness (placeholders avançados)
Épico 7 — Bug Detector com filtros
Épico 8 — Evidence Recorder
Épico 9 — Relatórios
Épico 10 — Robustez operacional ← ESTE DOC
```
