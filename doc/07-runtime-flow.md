# 07 — Fluxo runtime definitivo

## Diagrama

```txt
START RUN
  ↓
Open URL
  ↓
Observe current screen
  ↓
Build observationId + ephemeral locator map
  ↓
Send reduced observation to LLM
  ↓
LLM returns action envelope
  ↓
Validate observationId
  ↓
Resolve dynamic data placeholders
  ↓
Bind validation targets from current locator map
  ↓
Execute atomic action
  ↓
Wait for quiescence
  ↓
Invalidate old locator map
  ↓
Observe new screen
  ↓
Validate bound expected_after_action with resolved data
  ↓
If passed:
    continue
  Else:
    try fallback/recovery
  ↓
If failed permanently:
    record evidence
    mark FAILED/BLOCKED
```

## Pseudocódigo do orquestrador

```ts
async function runCycle(task: QaTask): Promise<QaTaskResult> {
  let observation = await harness.observe();
  locatorResolver.rebuildFromObservation(observation);

  while (!task.isComplete()) {
    const envelope = await llm.decideNextAction({
      task,
      observation,
      runData: dataHarness.getRunData(),
    });

    // 1. Valida observationId
    if (envelope.observationId !== observation.observationId) {
      throw new StaleObservationError(...);
    }

    // 2. Resolve placeholders da ação e faz bind dos alvos de validação
    const resolvedAction = dataHarness.resolveObject(envelope.action);
    const boundExpected = validationBinder.bind(
      envelope.expected_after_action,
      observation,
      locatorResolver,
    );

    // 3. Executa
    const exec = await harness.executeAction(resolvedAction);

    // 4. Quiescência
    await quiescenceGuard.waitForQuiescence();

    // 5. Invalida + reobserva
    observation = await harness.observe();
    locatorResolver.rebuildFromObservation(observation);

    // 6. Valida resultado.
    // Placeholders de assert são resolvidos aqui, depois da ação ter populado o RunDataStore.
    const resolvedExpected = dataHarness.resolveObject(boundExpected);
    const validated = await harness.validate(resolvedExpected);

    if (!validated.ok) {
      const recovered = await recoveryPolicy.tryFallback(
        {
          task,
          step: currentStep.withBoundExpectedAfterAction(boundExpected),
          observation,
          fallbackAction: envelope.fallback_action,
          budget: config.recovery,
        },
      );

      if (!recovered.ok) {
        await evidenceHarness.record({ task, observation, exec, validated });
        return { status: 'FAILED' };
      }
    }
  }

  return { status: 'PASSED' };
}
```

## Pontos não negociáveis

```txt
1. Quiescência sempre entre Action e Observe
2. Invalidação do locatorMap sempre antes de nova Observe
3. DataHarness.resolveObject sempre antes de executar e imediatamente antes de validar
4. observationId validado antes de qualquer ação
5. expected_after_action com targetElementId sempre vira BoundExpectedAfterAction antes da ação
6. Evidência salva apenas em falha real (após exaustão de fallback)
```

## Estado do orquestrador entre ciclos

```ts
interface OrchestratorState {
  runId: string;
  scenarioId: string;
  taskId: string;
  observationId: string;          // atual
  attempts: AttemptRecord[];      // memória curta
  recoveryBudget: number;         // limite de fallbacks
}
```

## Memória curta de tentativas

```json
{
  "scenarioId": "cadastro-produto-valido",
  "currentTaskId": "T003",
  "attempts": [
    {
      "action": "click",
      "target": "Salvar",
      "result": "timeout",
      "url": "/produtos/novo"
    },
    {
      "action": "click",
      "target": "Salvar",
      "result": "same_timeout",
      "url": "/produtos/novo"
    }
  ]
}
```

Regra:

```txt
Mesma task falha 2–3 vezes com mesmo erro:
  não insiste
  marca task BLOCKED ou FAILED
  registra evidência
  segue próximo cenário se possível
```

## Limite de orçamento (recovery budget)

| Item | Default |
|------|---------|
| Máx. tentativas por task | 3 |
| Máx. fallbacks por step | 1 |
| Máx. ações de emergência por cenário | 5 |
| Timeout total por cenário | configurável |
