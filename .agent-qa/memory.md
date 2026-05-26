# Memória do projeto — agent-qa (dogfooding)

Memória persistente para execuções de QA neste repositório. Alinhada a `.agent-qa/structure.md`.

---

## Agent QA — runtime CLI

<!-- type: project | id: PROJ-AGENT-QA-001 -->

Runtime de QA guiado por LLM (TypeScript, NestJS, Playwright, Zod). CLI principal: `qa-agent`. Documentação canônica em `doc/README.md`. Release estável documentada: v0.2-stable com Hybrid Guarded Execution e QaToolRegistry.

Princípio: LLM decide, harness executa, orchestrator governa, schemas validam, evidence registra.

---

## Fixture smoke — cadastro

<!-- type: route | id: ROUTE-FIXTURE-SMOKE-001 -->

- **URL**: `http://127.0.0.1:4173/` (servidor local `node ./test/fixtures/server.mjs`)
- **Página**: `test/fixtures/smoke.html` — formulário "Cadastro" com campo Nome e botão Salvar
- **Domínio config**: `127.0.0.1` em `appDomains`
- **Config de exemplo**: `agent-qa.fixture.config.json`

---

## Fixture login

<!-- type: route | id: ROUTE-FIXTURE-LOGIN-001 -->

- **URL**: `http://127.0.0.1:4173/login` (mesmo servidor fixture)
- **Página**: `test/fixtures/login.html`
- **Credenciais**: definir via env vars do config de auth (`formLogin` — `usernameEnv`, `passwordEnv`); ver `test/fixtures/login.html` para comportamento esperado

---

## Smoke local — validate e run

<!-- type: flow | id: FLOW-FIXTURE-SMOKE-001 -->

1. Subir fixture: `node ./test/fixtures/server.mjs`
2. Validar config: `npm run qa-agent -- validate-config --config ./agent-qa.fixture.config.json`
3. Executar: `npm run qa-agent -- run --config ./agent-qa.fixture.config.json`
4. Provider recomendado para teste local: `llm.provider: fake`
5. Demanda exemplo: preencher campo Nome e salvar (status "Salvo" na página)

---

## Locators — smoke.html

<!-- type: semantic_locator | id: LOC-SMOKE-NAME-001 -->

- Campo **Nome**: `input[name="name"]` ou label "Nome"
- Botão **Salvar**: `button` com texto "Salvar"
- Confirmação: `#status` com texto "Salvo" após clique

---

## Locators — login.html

<!-- type: semantic_locator | id: LOC-LOGIN-FORM-001 -->

- Título página: "Acessar conta"
- Email: `#email` ou `input[name="email"]`
- Senha: `#password` ou `input[name="password"]`
- Submit: `#submit` texto "Entrar"
- Erro: `#error` role alert "Credenciais inválidas"
- Sucesso: `#dashboard` "Bem-vindo ao Dashboard" (URL `/dashboard`)

---

## Cenário fixture smoke

<!-- type: scenario | id: SCN-FIXTURE-SMOKE-001 -->

**Objetivo**: Preencher Nome e salvar no fixture de cadastro.

**Critérios observáveis**:
- Campo nome preenchido
- Após Salvar, `#status` exibe "Salvo"

**Config**: `demand.id: DEM-001`, `agent-qa.fixture.config.json`

---

## Limitações conhecidas do runtime

<!-- type: known_issue | id: ISSUE-RUNTIME-LIMITS-001 -->

- Providers LLM externos (Groq, OpenAI) podem falhar em alguns ambientes; fallback para factory plan é esperado
- `inspect` e `report` requerem `--runs-dir` e `--run-id`
- Escopo atual é CLI; SDK pública estável não é garantida
- Serviços BM25 (`MemorySearchService`, `MemoryChunker`, `BM25MemoryIndex`) implementados — consulta via tool `qa.memory.search`

---

## Aprendizados de runtime

<!-- type: runtime_learning | id: LEARN-PLACEHOLDER-001 -->

_Placeholder_: learnings de locators, cenários pass/fail e recovery serão appendados aqui ou via pipeline de learning (PRJ-11323) após runs reais documentadas.

Regra: preferir registrar locators estáveis como `semantic_locator` e outcomes como novos ids `runtime_learning`.
