# Universal Runtime Configuration Migration Plan

## Objetivo

Remover heuristicas de negocio embutidas no core do Agent QA e tornar a resolucao semantica configuravel por projeto.

O runtime deve continuar seguro e generico:

```txt
config semanticAliases / semanticKeys
-> memoria especifica do projeto
-> ScreenObservation + accessibility tree
-> ExecutionPlan / PlanPatch
-> policies configuraveis
-> PlanExecutorService
-> BrowserHarnessPort / PlaywrightHarness
```

O objetivo nao e remover conceitos de dominio do runtime. Conceitos tipados como `DEAUTHENTICATION`, `DISCLOSURE`, `APPEARANCE_CHANGE` e `DATA_ENTRY` continuam validos. O que deve sair do core sao labels, rotas, menus e provas de sucesso presumidas.

## Fronteira arquitetural

- `PlanExecutorService` continua sendo a autoridade final de execucao.
- A LLM sugere `ExecutionPlan` ou `PlanPatch`; ela nao executa Playwright diretamente.
- `ScreenObservation` e accessibility tree sao fontes de estado observavel.
- `LocatorDescriptor` continua declarativo; IDs `el_*` permanecem efemeros.
- Memoria aprendida e escopada por projeto e revisavel.
- Policies bloqueiam comportamento inseguro antes da execucao.
- Nenhuma tool publica representa `click`, `fill`, `press`, `navigate` ou script arbitrario.

## Estado atual

O projeto ja possui fundacoes reutilizaveis:

- `RunConfig.runtime.semanticAliases`;
- `RunConfig.runtime.semanticKeys`;
- `RunConfig.runtime.elementAvailability.allowedContainers`;
- `SemanticLocatorMemoryResolverService`;
- `AxTreeCollector`, `DomPurifier` e `ObservationService`;
- `ExecutionPlanSchema`, `PlanPatchSchema` e `PlanPatchApplierService`;
- `ActionPolicyService`;
- `PlanExecutorService`.

Ainda existem heuristicas fixas que limitam universalidade:

| Local | Responsabilidade atual | Problema |
|---|---|---|
| `src/application/services/element-availability-resolver.service.ts` | Associa palavras como logout, tema, conta e menu a containers conhecidos. | O core presume vocabulário e estrutura de navegacao. |
| `src/application/use-cases/run-agent.usecase.ts` | Aplica caminhos especiais para logout, tema e menu no loop reativo legado. | O use case conhece regras de negocio que deveriam vir de contratos/config. |
| `src/application/use-cases/run-agent.usecase.ts` | Valida logout por rotas e textos presumidos, como login e credenciais. | Aplicacoes com SSO, rotas diferentes ou UI icon-only podem gerar falso negativo. |
| `src/application/services/action-policy.service.ts` | Usa lista fixa de termos destrutivos. | Defaults seguros sao uteis, mas extensoes por projeto precisam ser configuraveis. |

## Modelo de configuracao proposto

Evoluir `RunConfig.runtime` de forma retrocompativel:

```ts
interface RuntimeSemanticConfig {
  semanticKeys: Record<string, {
    description: string;
    type: 'action' | 'state' | 'container';
  }>;
  semanticAliases: Record<string, string[]>;
  semanticFlows?: Record<string, {
    targetAliases?: string[];
    allowedContainerKeys?: string[];
    successConditions?: PlanCondition[];
  }>;
}

interface RuntimePolicyConfig {
  destructiveActionPolicy: DestructiveActionPolicy;
  destructiveTerms?: string[];
  safeDefaultsEnabled?: boolean;
}
```

Exemplo de configuracao por projeto:

```json
{
  "runtime": {
    "semanticAliases": {
      "DEAUTHENTICATION": ["Sair", "Encerrar sessao"],
      "APPEARANCE_CHANGE": ["Tema", "Aparencia"]
    },
    "semanticFlows": {
      "DEAUTHENTICATION": {
        "allowedContainerKeys": ["account_menu"],
        "successConditions": [
          { "type": "auth_state", "expected": "anonymous" }
        ]
      }
    }
  }
}
```

Os exemplos pertencem ao config do projeto, nao ao core.

## Plano incremental

### U4 - Extrair contratos semanticos configuraveis

Criar um schema Zod para `runtime.semanticFlows`.

Responsabilidades:

- declarar aliases opcionais por `ExpectedOutcome.kind`;
- declarar containers permitidos por fluxo;
- declarar `PlanCondition[]` de sucesso;
- manter defaults vazios para nao quebrar configs existentes.

Critérios:

- config antiga continua valida;
- config nova passa por Zod;
- nenhum selector CSS, `el_*` ou action solta e aceito como memoria estavel.

### U5 - Remover keyword mapping fixo do availability resolver

Alterar `ElementAvailabilityResolver` para receber containers candidatos explicitamente.

Ordem de resolucao:

```txt
LocatorDescriptor declarativo
-> aliases configurados
-> memoria do projeto
-> accessibility tree / ScreenObservation
-> allowedContainers configurados
-> reobservacao
-> replan controlado
```

Critérios:

- remover listas fixas de palavras de `ElementAvailabilityResolver`;
- abrir somente containers declarados em `allowedContainers`;
- respeitar `maxOpenAttempts`;
- nunca clicar genericamente fora da policy.

### U6 - Substituir branches especiais do loop legado

Remover tratamento especializado de logout, tema e menu de `RunAgentUseCase`.

Substituir por:

- `ExpectedOutcome.kind`;
- `StateContractTranslatorService`;
- `runtime.semanticFlows`;
- `PlanCondition`;
- `PlanExecutorService`;
- fallback legado temporario protegido por feature flag, se necessario.

Critérios:

- `RunAgentUseCase` nao pesquisa termos de logout, tema ou menu;
- `RunAgentUseCase` nao presume rota `/login`;
- validacao de estado ocorre por contratos declarativos;
- `PLAN_AND_EXECUTE` e `HYBRID_GUARDED` continuam passando.

### U7 - Integrar memoria especifica do projeto

Usar `SemanticLocatorMemoryResolverService` antes de pedir `decide` ou `replan`.

Memoria aprovada pode armazenar:

- semantic key;
- aliases revisados;
- locator declarativo confirmado;
- container key permitido;
- origem da evidencia;
- confianca;
- run de origem.

Memoria nao pode armazenar:

- `el_*`;
- tokens;
- cookies;
- credenciais;
- dump DOM arbitrario;
- script executavel.

Critérios:

- aprendizado permanece revisavel;
- segunda execucao pode reutilizar memoria promovida;
- impacto da memoria aparece em reports;
- ausencia de memoria nao bloqueia o runtime.

### U8 - Tornar policy destrutiva extensivel

Manter defaults seguros no `ActionPolicyService`, mas permitir termos adicionais por config.

Critérios:

- defaults seguros continuam ativos por padrao;
- projeto pode adicionar termos sem alterar source;
- projeto nao pode reduzir protecao sem optar explicitamente;
- policy continua executada antes do Harness.

### U9 - Validar portabilidade

Executar smokes em pelo menos tres perfis:

| Perfil | Objetivo |
|---|---|
| CodeShare | Campo anonimo sem label acessivel. |
| Fixture local composta | Login, formulario, upload, drag, dialogo, rich text, extracao e retry. |
| Aplicacao com config semantico proprio | Logout/menu/tema sem heuristica no core. |

Critérios:

- nenhuma alteracao de source entre projetos;
- diferencas ficam em config e memoria escopada;
- nenhum locator especifico do projeto entra em `src`;
- LLM calls ficam registradas e justificadas;
- falhas produzem evidence/report, nao falso positivo.

## Backlog completo de tasks

### Task U4.1 - Criar schema de `runtime.semanticFlows`

**Descricao**

Adicionar ao `RunConfigSchema` um contrato opcional para fluxos semanticos por `ExpectedOutcome.kind`.

Campos iniciais:

- `targetAliases?: string[]`;
- `allowedContainerKeys?: string[]`;
- `successConditions?: PlanCondition[]`.

**Arquivos principais**

- `src/domain/schemas/config.schema.ts`;
- `test/config-demand.spec.ts` ou novo teste focado de config.

**Criterios de aceite**

- Configs antigas continuam validas.
- `semanticFlows` e opcional.
- Fluxo valido passa por Zod.
- Fluxo invalido e rejeitado por Zod.
- `successConditions` reutiliza `PlanConditionSchema`.

### Task U4.2 - Documentar contrato de configuracao semantica

**Descricao**

Registrar diferenca entre:

- `semanticKeys`: catalogo de conceitos;
- `semanticAliases`: nomes observaveis por conceito;
- `semanticFlows`: containers permitidos e condicoes de sucesso.

**Arquivos principais**

- `docs/architecture/27-universal-runtime-config-migration-plan.md`;
- `doc/17-configuration-and-cli.md`.

**Criterios de aceite**

- Documentacao inclui exemplo generico.
- Nenhum exemplo e tratado como default obrigatorio do core.
- Fica explicito que config pertence ao projeto testado.

### Task U4.3 - Adicionar fixture de config semantico por projeto

**Descricao**

Criar fixture de teste com aliases, containers e condicoes de sucesso diferentes dos termos atualmente embutidos no runtime.

**Arquivos principais**

- `test/fixtures/`;
- teste de schema/config.

**Criterios de aceite**

- Fixture nao depende de MeshaMail ou CodeShare.
- Fixture usa vocabulario alternativo.
- Teste prova que o runtime aceita configuracao por projeto.

### Task U5.1 - Remover keyword mappings de `ElementAvailabilityResolver`

**Descricao**

Remover listas fixas de palavras para logout, tema, conta, perfil e menu.

**Arquivos principais**

- `src/application/services/element-availability-resolver.service.ts`;
- `test/element-availability-resolver.spec.ts`.

**Criterios de aceite**

- Resolver nao contem lista fixa de palavras de negocio.
- Resolver trabalha com descriptors e containers recebidos.
- Nenhum clique arbitrario e adicionado.

### Task U5.2 - Resolver containers permitidos por config

**Descricao**

Selecionar containers usando `semanticFlows.allowedContainerKeys` e `runtime.elementAvailability.allowedContainers`.

**Arquivos principais**

- `src/application/services/element-availability-resolver.service.ts`;
- `src/application/services/plan-executor.service.ts`;
- testes do resolver.

**Criterios de aceite**

- Apenas containers permitidos podem ser abertos.
- `maxOpenAttempts` continua respeitado.
- Ausencia de container permitido retorna resultado controlado.
- Reobservacao ocorre apos abertura autorizada.

### Task U5.3 - Preservar compatibilidade da tool interna

**Descricao**

Atualizar `qa.element.ensureAvailable` para usar o contrato configuravel sem expor detalhes do Harness.

**Arquivos principais**

- `src/application/tools/built-in/ensure_element_available.tool.ts`;
- `src/application/tools/built-in/contracts.ts`;
- `test/ensure-element-available-tool.spec.ts`.

**Criterios de aceite**

- Tool continua `internalOnly`.
- Tool nao aceita action livre.
- Tool valida policy e containers.
- Adapter externo nao exporta a tool.

### Task U6.1 - Mapear branches semanticos do loop legado

**Descricao**

Catalogar os metodos especializados existentes em `RunAgentUseCase`, incluindo logout, tema e menu, antes da remocao.

**Arquivos principais**

- `src/application/use-cases/run-agent.usecase.ts`;
- este documento.

**Criterios de aceite**

- Lista de metodos especializados documentada.
- Cada comportamento possui substituto declarativo identificado.
- Nenhum branch e removido sem teste equivalente.

### Task U6.2 - Migrar validacao de logout para `PlanCondition`

**Descricao**

Substituir provas fixas de logout por condicoes declaradas em `semanticFlows.DEAUTHENTICATION.successConditions`.

**Arquivos principais**

- `src/application/use-cases/run-agent.usecase.ts`;
- `src/application/services/state-contract-translator.service.ts`;
- `src/domain/schemas/config.schema.ts`;
- testes de logout.

**Criterios de aceite**

- Core nao presume `/login`.
- Core nao presume textos de formulario de login.
- Fluxo pode validar logout por `auth_state`, `route_state`, `ui_state`, `attribute_state` ou `storage_state`.
- Config ausente falha de forma controlada ou usa contrato tipado seguro.

### Task U6.3 - Migrar tema e menu para contratos declarativos

**Descricao**

Remover branches especiais para tema e menu do loop legado e usar `ExpectedOutcome`, `semanticFlows` e `PlanCondition`.

**Arquivos principais**

- `src/application/use-cases/run-agent.usecase.ts`;
- `src/application/services/state-contract-translator.service.ts`;
- testes de tema/menu.

**Criterios de aceite**

- `RunAgentUseCase` nao procura termos de tema ou menu.
- Mudanca visual exige pos-condicao observavel.
- Abertura de container respeita policy.

### Task U6.4 - Remover metodos legados especializados

**Descricao**

Excluir metodos que ficaram sem uso apos migracao declarativa.

Alvos esperados:

- `trySemanticLogout`;
- `logoutObservationValidation`;
- detectores ou promocoes especiais de logout, tema e menu que deixarem de ser necessarios.

**Arquivos principais**

- `src/application/use-cases/run-agent.usecase.ts`;
- testes relacionados.

**Criterios de aceite**

- `RunAgentUseCase` volta a focar em orquestracao.
- Nenhuma regressao nos modos `FULL_REACTIVE`, `HYBRID_GUARDED` e `PLAN_AND_EXECUTE`.
- Suite completa passa.

### Task U7.1 - Definir schema de memoria semantica promovida

**Descricao**

Definir formato revisavel para locators aprendidos por projeto.

Campos minimos:

- semantic key;
- aliases;
- locator declarativo;
- container key opcional;
- evidencia de origem;
- confianca;
- `runId`;
- status de revisao.

**Arquivos principais**

- schemas/modelos de memoria existentes;
- `src/application/services/learning-extractor.service.ts`;
- testes de learning candidates.

**Criterios de aceite**

- Schema nao aceita `el_*` como locator persistente.
- Dados sensiveis sao sanitizados.
- Confirmado e inferido permanecem distintos.

### Task U7.2 - Consultar memoria antes de fallback LLM

**Descricao**

Usar `SemanticLocatorMemoryResolverService` antes de `decide` ou `replan`.

**Arquivos principais**

- `src/application/services/semantic-locator-memory-resolver.service.ts`;
- `src/application/services/execution-plan-factory.service.ts`;
- `src/application/services/plan-executor.service.ts`;
- testes do resolver.

**Criterios de aceite**

- Memoria aprovada adiciona candidates declarativos.
- Ausencia de memoria nao bloqueia execucao.
- Candidates continuam sujeitos a policy.
- Uso da memoria fica rastreavel.

### Task U7.3 - Persistir impacto da memoria em reports

**Descricao**

Registrar quando memoria influenciou planner, locator resolution ou recovery.

**Arquivos principais**

- modelos de run;
- report renderer;
- PR report renderer;
- testes de reports.

**Criterios de aceite**

- Report informa memoria consultada.
- Report informa candidates utilizados.
- Report diferencia resolucao deterministica, memoria, replan e decide.

### Task U7.4 - Criar fluxo manual de promocao de candidatos

**Descricao**

Documentar e implementar um caminho revisavel para promover `learning-candidates` aprovados para `.agent-qa/memory.md`.

**Arquivos principais**

- documentacao;
- servico ou comando de promocao, se necessario;
- testes de sanitizacao.

**Criterios de aceite**

- Promocao nao e automatica.
- Rejeicoes podem ser registradas.
- Nenhum segredo ou `el_*` e persistido.

### Task U8.1 - Extrair defaults de policy destrutiva

**Descricao**

Manter defaults seguros em responsabilidade isolada, fora da logica principal de validacao.

**Arquivos principais**

- `src/application/services/action-policy.service.ts`;
- novo arquivo de defaults, se necessario;
- `test/action-policy.spec.ts`.

**Criterios de aceite**

- Comportamento atual seguro e preservado.
- Defaults ficam legiveis e testaveis.
- Nenhum termo especifico de uma unica aplicacao e adicionado.

### Task U8.2 - Permitir termos destrutivos adicionais por config

**Descricao**

Adicionar `runtime.policy.destructiveTerms` ou contrato equivalente.

**Arquivos principais**

- `src/domain/schemas/config.schema.ts`;
- `src/application/services/action-policy.service.ts`;
- testes de config e policy.

**Criterios de aceite**

- Projeto pode adicionar termos.
- Defaults continuam ativos por padrao.
- Invalidacao ocorre antes do Harness.

### Task U8.3 - Proteger reducao de seguranca

**Descricao**

Exigir opcao explicita para reduzir defaults de policy, caso essa capacidade seja realmente necessaria.

**Criterios de aceite**

- Config comum nao remove defaults.
- Opt-out possui nome explicito e documentado.
- Reports registram quando protecao padrao foi reduzida.

### Task U9.1 - Criar fixture de portabilidade semantica

**Descricao**

Criar aplicacao local de teste com vocabulário diferente para conta, sessao e aparencia.

**Arquivos principais**

- `test/fixtures/`;
- testes de integracao.

**Criterios de aceite**

- Fixture nao usa labels esperados pelos hardcodes antigos.
- Fluxo passa apenas com config semantico.
- Nenhuma alteracao de `src` e necessaria para trocar vocabulario.

### Task U9.2 - Executar regressao CodeShare

**Descricao**

Rodar:

```bash
npm run qa-agent -- run --config agent-qa.codeshare.config.json
```

**Criterios de aceite**

- Editor recebe `teste`.
- Nenhum locator especifico do CodeShare entra em `src`.
- Resultado e reportado.
- Chamadas LLM sao registradas.

### Task U9.3 - Executar regressao fixture composta

**Descricao**

Validar login, navegacao, formulario, upload, drag, dialogo, rich text, extracao, screenshot diff, WCAG e retry.

**Criterios de aceite**

- Testes focados passam.
- Fluxos usam actions declarativas.
- Nenhum acesso livre ao Playwright e exposto.

### Task U9.4 - Rodar quality gates completos

**Descricao**

Executar:

```bash
npm run typecheck
npm run lint
npm test
npm run build
git diff --check
```

**Criterios de aceite**

- Todos os comandos passam.
- Falhas nao relacionadas sao documentadas.

### Task U9.5 - Fazer pente fino final de universalidade

**Descricao**

Buscar termos e estruturas especificas de aplicacao em `src`.

**Criterios de aceite**

- Nenhum label de projeto em `src`.
- Nenhuma rota de projeto em `src`.
- Nenhum selector de projeto em `src`.
- Excecoes tecnicas legitimas ficam documentadas.
- Configs e fixtures podem conter dados do projeto correspondente.

## Testes obrigatorios

- Schema aceita `semanticFlows` valido e rejeita estrutura insegura.
- `ElementAvailabilityResolver` abre somente container permitido por config.
- `ElementAvailabilityResolver` nao depende de palavras fixas.
- `RunAgentUseCase` nao possui branches especiais para logout, tema ou menu.
- `ActionPolicyService` aplica defaults e termos adicionais configurados.
- Memoria promovida melhora resolucao sem persistir `el_*`.
- CodeShare continua preenchendo `teste` sem locator especifico do site.
- Suite completa, lint, typecheck e build passam.

## Fora de escopo

- Prometer suporte perfeito para canvas, Shadow DOM fechado ou interfaces sem estado observavel.
- Expor Playwright para LLM.
- Persistir IDs efemeros.
- Promover memoria automaticamente sem revisao.
- Remover defaults seguros de policy.

## Definicao de pronto

A migracao termina quando:

- o core nao contem labels, rotas ou estruturas de menu especificas de aplicacao;
- `RunAgentUseCase` orquestra e nao interpreta regras de negocio;
- `ElementAvailabilityResolver` trabalha apenas com descriptors e config;
- memoria por projeto influencia resolucao de forma rastreavel;
- policies configuraveis preservam defaults seguros;
- smokes de portabilidade passam sem modificar `src`.
