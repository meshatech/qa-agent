# Plano de Estabilização da v1 — Diagnóstico e Refinamento

> Análise técnica do estado atual do `qa-agent`, com foco em por que o agente
> "fica parado sem saber o que fazer" em sites diferentes do meshamail (ex.: codeshare),
> e o roteiro mínimo para tornar a v1 estável e universal.

---

## 1. Sumário Executivo

O agente recebeu **mais de 50 modificações** (29 arquivos alterados + 24 novos, todos não commitados) com o objetivo de torná-lo "semi-autônomo e universal". A intenção é correta, mas a expansão introduziu **três problemas estruturais**:

1. **Regressão central**: o fallback simples e barato de resolução de ação via LLM (`decide()`) foi **desconectado** e substituído por um caminho mais caro e frágil (`deepThink()`). Isso é a causa direta do agente "travar sem saber o que fazer" quando um locator não resolve.
2. **Proliferação de caminhos de execução**: existem **3 fluxos paralelos** que se comportam de forma diferente conforme a config. Sites diferentes caem em caminhos diferentes, gerando inconsistência.
3. **Crescimento não consolidado**: 6 serviços novos adicionados de uma vez (DeepThink, ExecutionMonitor, NetworkStateValidator, ProjectGraph, QaValueMetrics, PlanCache) sem commit, alguns sem conexão real ao núcleo.

**2 testes estão quebrados**, sendo 1 deles a prova direta da regressão.

---

## 2. Diagnóstico Detalhado

### 2.1. CAUSA RAIZ — Fallback de decisão desconectado (CRÍTICO)

O método `resolveViaLlm()` em `@/c:/dev/apps/mesha/qa-agent/src/application/services/plan-executor.service.ts:377` chama `this.decision.decide()` — o caminho **simples, barato e testado** para o agente decidir uma ação quando o locator determinístico falha.

**Este método é código morto: está definido mas nunca é chamado.**

No lugar dele, o fluxo de "locator não encontrado" foi reconectado ao `DeepThink`:

```@/c:/dev/apps/mesha/qa-agent/src/application/services/plan-executor.service.ts:152-166
            // DeepThink: emergency reasoning with compressed context
            try {
              const thinkResult = await this.deepThink.think({
                config,
                step,
                observation: before,
                error: error instanceof Error ? error.message : String(error),
                previousActions: result.attempts.slice(-5).map((a) => ({ action: a.actionType as unknown as QaAction, result: a.result, reason: a.reason })),
                attempts: result.attempts,
              });
              action = thinkResult.action;
              result.locatorTelemetry.push({ stepId: step.id, type: 'llm_decide', timestamp: new Date().toISOString() });
            } catch {
              throw error;
            }
```

Consequências:

- **Custo**: `DeepThink` usa o endpoint `decision.deepThink()` — uma chamada LLM **separada e adicional**, contribuindo para as "7 chamadas caras".
- **Fragilidade universal**: no modo `PLAN_AND_EXECUTE`, `tryReplan()` retorna `undefined` imediatamente (`@/c:/dev/apps/mesha/qa-agent/src/application/services/plan-executor.service.ts:290`). Logo o **único** fallback é o DeepThink. Se ele lançar erro ou devolver ação inútil, o passo falha e **o agente "trava"**.
- **Contrato quebrado**: o teste unitário que garante esse comportamento espera `decide()`, não `deepThink()`.

### 2.2. Teste quebrado #1 — prova da regressão

`@/c:/dev/apps/mesha/qa-agent/test/plan-executor.spec.ts:336` — *"uses decision provider fallback when a locator cannot be resolved"*:

```
AssertionError: expected "vi.fn()" to be called once, but got 0 times
```

O teste injeta um mock de `decide` e espera que ele seja chamado quando o locator `{ strategy: 'role', role: 'button', name: 'Missing' }` não resolve. Como o código chama `deepThink.think()`, o `decide` nunca é invocado. **Este teste documenta exatamente o comportamento universal que o usuário quer e que foi desfeito.**

### 2.3. Teste quebrado #2 — normalização de path no Windows

`@/c:/dev/apps/mesha/qa-agent/test/load-clickup-config-settings.spec.ts` — *"resolves config path from env variables"*:

```
expected 'C:\workspace\custom.json' to be '\workspace\custom.json'
```

Defeito de portabilidade cross-platform (resolução de caminho absoluto no Windows). Baixa severidade, mas é um defeito real que polui o sinal de CI.

### 2.4. Proliferação de caminhos de execução (ALTO)

Em `@/c:/dev/apps/mesha/qa-agent/src/application/use-cases/run-agent.usecase.ts:92-116` existem **três rotas distintas**:

| Rota | Condição | Comportamento |
|------|----------|---------------|
| **Tools** | `tools.enabled === true` e modo ≠ FULL_REACTIVE | `qa.plan.build` + `qa.plan.execute` (`runWithTools`) |
| **Plano factory/LLM** | sem tools, com plano | `runExecutionPlan` → `PlanExecutorService` |
| **Reativo** | `FULL_REACTIVE` ou sem plano | `runScenario`/`runTask` → `decideWithSemanticRetry` |

A config do codeshare usa `tools.enabled: true` (`@/c:/dev/apps/mesha/qa-agent/agent-qa.codeshare.config.json:58-60`), então entra na rota **Tools**, que internamente chama o mesmo `PlanExecutorService` — e portanto sofre da regressão 2.1.

O problema: **as três rotas têm capacidades de auto-correção diferentes**. O caminho reativo (`runTask`) tem `decideWithSemanticRetry`, promoção de expectativas, autocorreção de intent; o caminho de plano não tem nada disso e depende só de replan/deepThink. Comportamento depende da config, não do site → imprevisível.

### 2.5. Serviços novos não consolidados (MÉDIO)

Arquivos novos não commitados que ampliam superfície sem garantia de integração:

- `deep-think.service.ts` — substitui o fallback barato (regressão 2.1)
- `execution-monitor.service.ts` — desabilitado por padrão (correto), mas detecção de stall inline só emite warning, não age (`@/c:/dev/apps/mesha/qa-agent/src/application/services/plan-executor.service.ts:104-106`)
- `network-state-validator.service.ts`, `project-graph.service.ts`, `qa-value-metrics-calculator.service.ts`
- `plan-cache.port.ts` + 3 adapters (in-memory/file/redis)

Nenhum é "errado", mas todos foram adicionados juntos, sem commits incrementais e sem suite verde, dificultando isolar regressões.

---

## 3. Princípio Norteador

> **O núcleo determinístico (locator → ação → validação) deve ser sempre conectado, barato e testado. O LLM é uma escada de fallback graduada, do mais barato ao mais caro — e nunca o único caminho.**

Escada de decisão correta para um passo:

```
1. Locator determinístico (sem LLM)          ← grátis
2. ensureActionTargetAvailable (DOM/abertura) ← grátis
3. decide() — LLM barato, 1 chamada           ← barato  [DESCONECTADO HOJE]
4. replan() — LLM, reescreve plano            ← médio
5. deepThink() — LLM emergência, contexto rico ← caro    [HOJE É O ÚNICO FALLBACK]
```

Hoje os degraus 3 e 4 estão ausentes/curtos no caminho de plano, e o agente pula direto para o degrau 5 ou trava.

---

## 4. Roteiro de Refinamento (ordenado por prioridade)

### Fase 0 — Reconectar o núcleo (CRÍTICO, ~1 dia)

- [ ] **0.1** Reconectar `decide()` como primeiro fallback de LLM no `PlanExecutorService`. Quando `resolveAction` falhar e `ensureActionTargetAvailable` não resolver, chamar `resolveViaLlm()` (que usa `decide()`) **antes** de `tryReplan`/`deepThink`.
- [ ] **0.2** Rebaixar `deepThink()` para último recurso real: só após `decide()` e `replan()` falharem.
- [ ] **0.3** Fazer o teste `plan-executor.spec.ts:336` passar **sem alterar a expectativa** (a expectativa está correta; o código é que regrediu).
- [ ] **0.4** Garantir que no modo `PLAN_AND_EXECUTE` ainda exista o degrau `decide()` (já que `tryReplan` retorna `undefined` cedo).

### Fase 1 — Verde e portabilidade (ALTO, ~0.5 dia)

- [ ] **1.1** Corrigir normalização de path cross-platform em `load-clickup-config-settings` (degradar `C:\` corretamente ou ajustar a asserção para usar `path.resolve`).
- [ ] **1.2** Rodar `npm run check` e atingir **suite 100% verde** antes de qualquer nova feature.
- [ ] **1.3** Commit incremental isolando: (a) reconexão do decide, (b) cache de plano, (c) serviços novos — um commit por preocupação.

### Fase 2 — Unificar comportamento entre rotas (ALTO, ~1-2 dias)

- [ ] **2.1** Definir **uma** rota canônica de execução. Recomendação: a rota **Tools** delega ao `PlanExecutorService`, então centralizar toda a escada de fallback (degraus 1-5) **dentro** do `PlanExecutorService`, de modo que as 3 rotas herdem o mesmo comportamento.
- [ ] **2.2** Mover a inteligência de `decideWithSemanticRetry` (promoção de expectativas, autocorreção de intent) do caminho reativo (`run-agent.usecase.ts`) para o `PlanExecutorService`, eliminando a divergência de capacidades.
- [ ] **2.3** Documentar em tabela (como a seção 2.4) qual config ativa qual rota, e garantir que o resultado seja **idêntico** para o mesmo site.

### Fase 3 — Tornar a percepção de ambiente acionável (MÉDIO, ~1 dia)

- [ ] **3.1** A detecção de stall inline (`isStalled`) hoje só emite warning. Conectá-la à escada: stall confirmado → tentar `decide()` com contexto "página não mudou".
- [ ] **3.2** Garantir que `ScreenObservation` (elementos interativos, textos visíveis, pageState) seja a fonte única de verdade passada a todos os degraus de LLM, para o agente "sentir" o site.
- [ ] **3.3** Manter o `ExecutionMonitor` de background **desabilitado** por padrão (já está). Não reabilitar.

### Fase 4 — Controle de custo (MÉDIO, contínuo)

- [ ] **4.1** Adotar `executionPlanStrategy: 'factory_first'` nas configs simples (codeshare) para eliminar a chamada `buildPlan` desperdiçada.
- [ ] **4.2** Manter o cache de plano (já implementado via `PlanCachePort`) para zerar replanejamento em runs repetidas.
- [ ] **4.3** Instrumentar e logar a escada de fallback: registrar qual degrau resolveu cada passo, para auditar onde o custo nasce.

---

## 5. Critérios de Aceite da v1 Estável

A v1 é considerada estável quando, para **qualquer** site dado via config + comando:

1. `npm run check` — **suite 100% verde** (0 testes falhando).
2. O agente **nunca trava silenciosamente**: todo passo termina em PASSED, PASSED_WITH_WARNINGS, ou BLOCKED com bug registrado — jamais em loop ou parada muda.
3. A escada de fallback é **observável** no relatório: dá para ver qual degrau resolveu cada ação.
4. O mesmo site produz o **mesmo comportamento** independente da rota (tools/plano/reativo).
5. Teste de fumaça em **2 sites distintos** (meshamail autenticado + codeshare anônimo) passa de ponta a ponta.
6. Custo de LLM por run simples ≤ 5 chamadas (idealmente 2-3 com factory_first + cache).

---

## 6. O Que NÃO Fazer (anti-padrões observados)

- **Não** adicionar novos serviços antes da suite estar verde.
- **Não** substituir caminhos baratos e testados (`decide`) por caros (`deepThink`) sem manter o degrau barato.
- **Não** reabilitar o monitor de background (causou abas infinitas).
- **Não** deixar código morto (ex.: `resolveViaLlm` órfão) — ou reconecta, ou remove.
- **Não** acumular 50 mudanças num único bloco não commitado.

---

## 7. Mapa Rápido de Arquivos-Chave

| Arquivo | Papel | Ação |
|---------|-------|------|
| `src/application/services/plan-executor.service.ts` | Núcleo de execução de passos | Reconectar escada de fallback (Fase 0) |
| `src/application/services/deep-think.service.ts` | Fallback caro de emergência | Rebaixar para último recurso |
| `src/application/use-cases/run-agent.usecase.ts` | Orquestra as 3 rotas | Unificar comportamento (Fase 2) |
| `src/application/ports/decision-provider.port.ts` | Contrato LLM (`decide`/`deepThink`) | Manter, garantir uso correto |
| `test/plan-executor.spec.ts` | Garante fallback `decide` | Fazer passar sem mudar expectativa |
| `agent-qa.codeshare.config.json` | Config de teste universal | Adotar `factory_first` |

---

*Documento de diagnóstico — base para discussão e execução incremental da estabilização da v1.*
