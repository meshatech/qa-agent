# Convenções — agent-qa

## TypeScript e módulos

- Strict mode, ESM (`"type": "module"`)
- Imports relativos com sufixo `.js` (NodeNext)
- Proibido `any` (ESLint); preferir `unknown` + narrowing

## Nomenclatura de arquivos

kebab-case + sufixo por tipo:

- `.service.ts`, `.usecase.ts`, `.provider.ts`, `.port.ts`, `.schema.ts`

## Nomenclatura de tipos

| Papel | Sufixo/prefixo | Exemplo |
|-------|----------------|---------|
| Port | `Port` | `DecisionProviderPort` |
| Service | `Service` | `ScenarioPlannerService` |
| Use case | `UseCase` | `RunAgentUseCase` |
| Provider | `Provider` | `GroqDecisionProvider` |
| Schema Zod | `Schema` + type export | `RunConfigSchema` / `RunConfig` |

## NestJS DI

- Services → `APPLICATION_PROVIDERS` em `application.module.ts`
- Adapters infra → `INFRA_PROVIDERS` em `infra.module.ts`
- Injeção via `@Inject('TokenName')`

## Zod-first

Schemas em `domain/schemas/` são fonte de verdade. Toda saída LLM passa por validação Zod antes de execução.

## Testes

Vitest em `test/`, espelhando `src/`. Rodar `npm test`, `npm run typecheck`, `npm run lint` antes de commit.

## Documentação

Specs numeradas em `doc/`; não duplicar contratos inteiros em memory files — referenciar paths.
