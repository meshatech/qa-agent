# 01 — Overview do patch MVP v0.1

## Problema

Loop reativo do MVP tem 4 pontas soltas. Sem fix por design, agente entra em loop, valida com dado errado, usa locator obsoleto, ou trava em modal.

## Decisão

As 4 correções entram como **regras obrigatórias do Harness**, não como comportamento opcional da LLM. Runtime impede o erro por design. LLM não precisa "lembrar".

## Os 4 ajustes

| # | Componente | Fix por design |
|---|-----------|----------------|
| 1 | `QuiescenceGuard` | Espera DOM/network estabilizar antes de reobservar |
| 2 | `observationId` + IDs efêmeros | Invalida IDs após cada ação. Rejeita ação obsoleta |
| 3 | `RunDataStore` + `DataHarness` | Dado dinâmico vira chave rastreável da run |
| 4 | Ações globais (`Escape`, `clickOutside`, `clickAtCoordinates`) | Saída universal para estado flutuante |

## Regra central runtime

```txt
Depois de toda ação:
  1. executar ação
  2. aguardar quiescência
  3. invalidar IDs antigos
  4. reobservar tela
  5. validar usando dados reais resolvidos
  6. só então pedir próxima decisão à LLM
```

## Veredito

Com esses 4 ajustes, MVP deixa de ser "bem arquitetado" e passa a ter **maturidade operacional**. Reduz drasticamente:

```txt
loops infinitos
race conditions
locators obsoletos
asserções com dado errado
agente preso em modal/dropdown
cliques duplicados
```

## Lei do runtime

```txt
Nenhuma ação executa sem observationId atual.
Nenhuma observação reaproveita IDs antigos.
Nenhuma validação usa dado dinâmico não resolvido.
Nenhuma decisão nova ocorre antes da quiescência.
Nenhum estado flutuante fica sem rota de escape.
```

## Pontas soltas resolvidas em docs adicionais

| Ponta solta | Doc |
|-------------|-----|
| Como a LLM é instruída (system prompt) | [11](./11-llm-prompting.md) |
| Modelo de domínio (Demand/Scenario/Task/Step) | [12](./12-domain-model.md) |
| `ObservableElement` + `LocatorDescriptor` + DOM purifier | [13](./13-observation-and-locators.md) |
| Schemas Zod completos de todas as `QaAction` | [14](./14-action-catalog.md) |
| `BugClassifier` (algoritmo) + `RecoveryPolicy` (decision tree) | [15](./15-bug-classifier-and-recovery.md) |
| Estrutura de diretórios, `bug-report.md`, `execution-log.json` | [16](./16-evidence-and-run-directory.md) |
| `RunConfig`, autenticação, CLI, env vars | [17](./17-configuration-and-cli.md) |
| Sanitização de credenciais + versionamento de schema | [18](./18-security-and-versioning.md) |
| Glossário de termos | [19](./19-glossary.md) |
| Arquitetura TypeScript/NestJS + LangChain adapter | [20](./20-adr-typescript-nest-langchain.md) |
| Estrutura de implementação v0.1 | [21](./21-v0.1-implementation-structure.md) |
