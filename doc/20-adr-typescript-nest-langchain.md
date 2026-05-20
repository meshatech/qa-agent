# 20 — ADR: TypeScript + NestJS com LangChain como adaptador LLM

## Status

Aceita para MVP v0.1.

## Contexto

O Agent QA precisa executar um loop reativo confiável sobre browser real. A LLM escolhe a próxima ação, mas não pode controlar Playwright diretamente, manter estado de runtime, resolver locators, decidir quiescência ou persistir evidência.

O projeto será implementado em TypeScript para manter os contratos Zod, tipos de domínio, Playwright e integração LLM no mesmo ecossistema.

## Decisão

Usar:

```txt
TypeScript        → linguagem base
NestJS            → composição por módulos, DI, config e entrypoints
Playwright        → browser harness
Zod               → schemas runtime e tipos derivados
LangChain JS      → adaptador opcional para providers LLM e structured output
```

LangChain **não** será o runtime do agente. Ele entra apenas na camada de decisão LLM.

## Regra de fronteira

```txt
LLM decide.
Harness executa.
Orchestrator governa.
Schemas validam.
Evidence registra.
```

## Papel de cada camada

| Camada | Responsabilidade |
|--------|------------------|
| `OrchestratorModule` | Coordena Observe → Decide → Act → Validate |
| `HarnessModule` | Encapsula Playwright, actions, assertions e page lifecycle |
| `ObservationModule` | Gera `ScreenObservation`, purifier, AX tree e page state |
| `LocatorModule` | Mantém `LocatorResolver` por observação |
| `DataModule` | Implementa `RunDataStore` e `DataHarness` |
| `LlmModule` | Expõe `DecisionProvider` e adapters de provider |
| `RecoveryModule` | Executa `RecoveryPolicy` e budgets |
| `EvidenceModule` | Cria run directory, logs, screenshots, traces e reports |
| `ConfigModule` | Carrega `RunConfig`, env vars e defaults |
| `SecurityModule` | Sanitização antes de prompt, log e evidência |

## Interface da decisão

O Orchestrator depende de uma interface própria, não de LangChain diretamente:

```ts
export interface DecisionProvider {
  decide(input: DecideInput): Promise<QaActionEnvelope>;
}

export interface DecideInput {
  task: QaTask;
  scenario: QaScenario;
  observation: ReducedScreenObservation;
  runData: Record<string, string>;
  attempts: AttemptRecord[];
}
```

## Adapter LangChain

```ts
@Injectable()
export class LangChainDecisionProvider implements DecisionProvider {
  constructor(
    private readonly modelFactory: LlmModelFactory,
    private readonly promptBuilder: PromptBuilder,
  ) {}

  async decide(input: DecideInput): Promise<QaActionEnvelope> {
    const model = this.modelFactory.create();
    const prompt = this.promptBuilder.build(input);

    const raw = await model.invoke(prompt);
    const parsed = QaActionEnvelopeSchema.safeParse(raw);

    if (!parsed.success) {
      throw new ActionSchemaInvalidError(parsed.error);
    }

    return parsed.data;
  }
}
```

Implementação real pode usar structured output do LangChain, mas o resultado **sempre** passa novamente pelo `QaActionEnvelopeSchema` do Agent QA.

## Providers suportados no MVP

MVP v0.1 começa com:

```txt
openai via LangChain
```

Extensão prevista sem mudar Orchestrator:

```txt
anthropic via LangChain
azure via LangChain
local via adapter próprio ou LangChain
```

## Proibições

```txt
- LangChain não chama Playwright tools diretamente
- LangChain não recebe LocatorDescriptor privado
- LangChain não persiste memória de runtime
- LangChain não decide recovery budget
- LangChain não escreve evidência
- LLM não recebe credenciais reais
```

## Structured output

Mesmo quando provider suporta JSON schema ou tool calling, o fluxo é:

```txt
Prompt + ReducedObservation
  → LLM response
  → parse/structured output
  → QaActionEnvelopeSchema.safeParse
  → valida observationId atual
  → bind expected_after_action
  → execução pelo Harness
```

## Retry de schema

Retry pertence ao `DecisionProvider`, mas o limite vem de config:

```ts
llm: {
  maxSchemaRetries: 2;
}
```

Regra:

```txt
1ª falha de schema → reenviar feedback resumido à LLM
2ª falha → repetir com feedback final
3ª falha → ACTION_SCHEMA_INVALID
```

## Consequências positivas

```txt
- Provider LLM fica substituível
- Orchestrator não acopla em SDK externo
- Testes unitários não precisam chamar LLM real
- Contratos Zod seguem como fonte da verdade
- NestJS facilita DI, módulos e configuração
```

## Consequências negativas

```txt
- Mais uma dependência de runtime
- LangChain pode mudar APIs entre versões
- Structured output varia entre providers
- Debug exige logar raw response sanitizada
```

## Mitigação

```txt
- Fixar versões npm no package-lock
- Encapsular LangChain atrás de DecisionProvider
- Ter FakeDecisionProvider para testes
- Validar sempre com Zod próprio
- Registrar provider/model/promptVersion/schemaVersion no execution-log.json
```

## DoD técnico

```txt
1. Orchestrator usa apenas DecisionProvider
2. Testes unitários rodam com FakeDecisionProvider
3. LangChainDecisionProvider valida saída com QaActionEnvelopeSchema
4. Falha de schema gera ACTION_SCHEMA_INVALID após retries
5. Nenhum serviço fora de LlmModule importa LangChain
```
