# V1 RALPH PLAN — Loop de Estabilização

> **Como usar este arquivo (protocolo do loop Ralph):**
> A cada iteração: (1) **leia este arquivo inteiro**; (2) leia o `SCRATCHPAD` para restaurar contexto;
> (3) pegue a **primeira tarefa não marcada** em `FASES`; (4) implemente **só ela**; (5) rode a
> `VERIFICAÇÃO`; (6) marque a tarefa como `[x]` e **atualize o SCRATCHPAD**; (7) repita.
> **Nunca** pule fases. **Nunca** quebre testes que já passam. **Uma tarefa por vez.**

---

## MISSÃO

Estabilizar o `qa-agent` para que funcione de verdade em **qualquer site** dado via config + comando,
sem travar. Manter **simples e bem feito**. Base do diagnóstico: `docs/V1-STABILIZATION-PLAN.md`.

---

## CONTEXTO PRESERVADO (ler sempre antes de agir)

**Causa raiz da trava:** o fallback barato e testado `decision.decide()` foi desconectado.
O método `resolveViaLlm()` em `src/application/services/plan-executor.service.ts` (~linha 377) existe
mas **nunca é chamado**. O fluxo de "locator não encontrado" pula direto para `deepThink.think()`
(caro, frágil, único fallback). No modo `PLAN_AND_EXECUTE`, `tryReplan()` retorna `undefined` cedo,
então se o DeepThink falhar, **o agente trava**.

**Escada de decisão correta (do barato ao caro):**
```
1. Locator determinístico            ← grátis
2. ensureActionTargetAvailable       ← grátis
3. decide() — LLM barato (1 chamada) ← RECONECTAR (foco da Fase 0)
4. replan() — reescreve plano        ← médio
5. deepThink() — emergência          ← último recurso
```

**Arquivos-chave:**
- `src/application/services/plan-executor.service.ts` — núcleo; escada de fallback fica aqui.
- `src/application/services/deep-think.service.ts` — rebaixar para último recurso.
- `test/plan-executor.spec.ts:336` — teste que prova a regressão (espera `decide`).
- `test/load-clickup-config-settings.spec.ts` — bug de path no Windows.
- `src/application/use-cases/run-agent.usecase.ts:92-116` — 3 rotas de execução.

**Estado dos testes no início:** 2 falhando — `plan-executor` (decide fallback) e `load-clickup-config-settings` (path Windows). Resto verde.

---

## INVARIANTES (regras que nunca mudam)

- **I1** — Não alterar a *expectativa* de um teste para fazê-lo passar; corrigir o código.
- **I2** — Não reabilitar o monitor de background (causou abas infinitas).
- **I3** — O LLM nunca é o único caminho; sempre há degrau determinístico antes.
- **I4** — Commit incremental: uma preocupação por commit, suite verde antes de avançar de fase.
- **I5** — Não adicionar serviço novo enquanto a suite não estiver verde.
- **I6** — Código morto: ou reconecta, ou remove. Nunca deixa órfão.

---

## VERIFICAÇÃO (rodar conforme a fase)

```bash
# Teste alvo da Fase 0
npx vitest run test/plan-executor.spec.ts --reporter=verbose

# Teste alvo da Fase 1.1
npx vitest run test/load-clickup-config-settings.spec.ts --reporter=verbose

# Typecheck
npx tsc --noEmit

# Portão de qualidade completo (Fase 1.2 / fim de cada fase)
npm run check
```

---

## FASES

### Fase 0 — Reconectar o núcleo (CRÍTICO)
- [x] **0.1** Reconectar `decide()` (via `resolveViaLlm`) como **primeiro** fallback de LLM no
  `PlanExecutorService`, quando `resolveAction` falhar e `ensureActionTargetAvailable` não resolver,
  **antes** de `tryReplan`/`deepThink`.
- [x] **0.2** Rebaixar `deepThink()` para **último** recurso (só após `decide()` e `replan()` falharem).
- [x] **0.3** Fazer `test/plan-executor.spec.ts` passar (incluindo o caso "uses decision provider
  fallback when a locator cannot be resolved") **sem alterar a expectativa** (I1).
- [x] **0.4** Garantir que no modo `PLAN_AND_EXECUTE` o degrau `decide()` exista (tryReplan retorna undefined cedo).
- [x] **0.5** `npx tsc --noEmit` limpo. (Commit Fase 0: PENDENTE — aguardando usuário.)

### Fase 1 — Verde e portabilidade (ALTO)
- [x] **1.1** Corrigir normalização de path cross-platform em `load-clickup-config-settings` (I1).
- [x] **1.2** typecheck + lint + `npm test` 100% verde (1484 passed, 3 skipped, 0 falhas).
- [ ] **1.3** Commit incremental isolado (PENDENTE — aguardando usuário).

### Fase 2 — Unificar comportamento entre rotas (ALTO)
- [ ] **2.1** Centralizar toda a escada de fallback (degraus 1-5) **dentro** do `PlanExecutorService`,
  para as 3 rotas (tools/plano/reativo) herdarem o mesmo comportamento.
- [ ] **2.2** Mover inteligência de `decideWithSemanticRetry` (promoção de expectativas, autocorreção
  de intent) do `run-agent.usecase.ts` para o `PlanExecutorService`.
- [ ] **2.3** Documentar tabela config→rota e garantir resultado idêntico por site.
- [ ] **2.4** `npm run check` verde + commit.

### Fase 3 — Percepção acionável (MÉDIO)
- [ ] **3.1** Conectar `isStalled` à escada: stall confirmado → `decide()` com contexto "página não mudou".
- [ ] **3.2** `ScreenObservation` como fonte única passada a todos os degraus de LLM.
- [ ] **3.3** Manter monitor de background desabilitado (I2).
- [ ] **3.4** `npm run check` verde + commit.

### Fase 4 — Controle de custo (MÉDIO)
- [ ] **4.1** `executionPlanStrategy: 'factory_first'` nas configs simples (codeshare).
- [ ] **4.2** Manter cache de plano (`PlanCachePort`) ativo.
- [ ] **4.3** Logar qual degrau resolveu cada passo (auditoria de custo).
- [ ] **4.4** Smoke em 2 sites (meshamail + codeshare) + commit final.

---

## CRITÉRIOS DE ACEITE DA V1

1. `npm run check` 100% verde.
2. Agente nunca trava mudo: todo passo termina PASSED / PASSED_WITH_WARNINGS / BLOCKED-com-bug.
3. Escada de fallback observável no relatório.
4. Mesmo site → mesmo comportamento independente da rota.
5. Smoke em 2 sites distintos passa ponta a ponta.
6. ≤ 5 chamadas LLM por run simples (ideal 2-3 com factory_first + cache).

---

## SCRATCHPAD (atualizar a cada iteração — memória do loop)

> **Iteração atual:** 2 (Fases 0 e 1 concluídas)
> **Fase atual:** Fase 2 — Unificar comportamento entre rotas (ALTO, refatoração arquitetural)
> **Próxima ação:** 2.1 — centralizar a escada de fallback (degraus 1-5) dentro do
>   `PlanExecutorService` para tools/plano/reativo herdarem o mesmo comportamento.
> **Aprendizados acumulados:**
> - CAUSA RAIZ RESOLVIDA: escada de fallback reconectada em `plan-executor.service.ts:141-178`
>   (decide() → replan() → deepThink()). try/catch aninhado preserva atribuição definitiva de `action`.
> - Path test (1.1): a função `resolveAgentQaConfigPath` usa `resolve` (correto p/ produção); a raiz
>   era a asserção do teste com `join` (não-portável no Windows). Alinhei a asserção a `resolve`.
> - Lint corrigido: `isStalled(_config)` e remoção de `join` em `file-plan-cache.adapter.ts`.
> - Suite COMPLETA verde: 1484 passed, 3 skipped, 0 falhas. typecheck + lint limpos.
> **VALIDAÇÃO COM RUN REAL (codeshare):** exit 0, status PASSED_WITH_WARNINGS, 3/3 steps PASSED,
>   0 bugs, 0 evaluations falhas. **Agente NÃO travou** — confirma a correção da Fase 0 na prática.
>   - LLM calls: 4 (1 ainda desperdiçada em buildPlan rejeitado por policy → Fase 4.1 factory_first elimina).
>   - Warning observado: T002 "Stalled: page unchanged for 30000ms" — só warning, não bloqueou (alvo da Fase 3.1).
> **Bloqueios:** Fase 2 é refatoração arquitetural de risco (mexe em run-agent.usecase + 3 rotas).
>   Recomendado COMMITAR Fases 0-1 antes de iniciar a Fase 2.
> **Commits pendentes:** Fase 0 (reconexão decide) e Fase 1 (path + lint) — aguardando ok do usuário.
