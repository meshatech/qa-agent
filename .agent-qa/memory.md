<!-- agent-qa-memory v1 -->

# Memória do Projeto — qa-agent fixture

## Pipeline all (comando agregado)

<!-- type: flow | id: pipeline-all -->
- **Comando**: `qa-agent pipeline all --config ./agent-qa.config.json`
- **Sequência**: prepare → correlate → generate-plan → execute → report → learning → promote-learning (`--auto-approve`)
- **Gates**: prepare/correlate BLOCKED → para pipeline, comenta no PR (se `GITHUB_REPOSITORY` + PR number + token), exit 6
- **Exit final**: mais severo entre etapas (`mostSevereExitCode`); learning/promote 0-count = OK
- **Log**: JSON `steps[]` + linha `[pipeline all] prepare=OK correlate=OK …`

## Distribuição Docker (release)

<!-- type: project | id: docker-release -->
- **Imagem**: `ghcr.io/meshatech/qa-agent` (dinâmico: `ghcr.io/${{ github.repository }}`)
- **Build local**: `npm run docker:build:release` (requer `dist/` pré-compilado)
- **CLI na imagem**: `/usr/local/bin/qa-agent` → `dist/main.js`; `wait-for-ready.sh` em `/opt/qa-agent/wait-for-ready.sh`
- **CI**: `.github/workflows/ci.yml` — `check` em `mcr.microsoft.com/playwright:v1.60.0-noble`; `docker-smoke` valida `--version`, `pipeline --help`, `validate-config` fixture
- **Release**: tag `v*` dispara `.github/workflows/release.yml` (semver + `latest` + `v2` quando aplicável)

## Base URL

<!-- type: route | id: base-url -->
- **URL**: `http://127.0.0.1:4173/`
- **Descrição**: Página inicial do fixture de teste
- **Auth**: none
- **Elementos observados**: página carrega sem erros de console

## Smoke Test Onboarding

<!-- type: scenario | id: onboarding-smoke -->
- **Fluxo**: Navegar para base URL → Verificar carregamento sem erros
- **Ações**: navigate, waitForStable
- **Resultado esperado**: status READY, 2 steps executados, 0 warnings
- **Referência**: baseline-report.md gerado no onboarding

## Padrão de Elementos

<!-- type: semantic_locator | id: fixture-generic -->
- **Descrição**: O fixture é uma página simples usada para smoke tests.
- **Locators estáveis**: Não há elementos interativos complexos; a página é um alvo básico de navegação.
- **Observação**: Durante o onboarding, nenhum route ou elemento acessível além da própria página foi detectado.

## Credencial meshamail no histórico git

<!-- type: known_issue | id: meshamail-auth-git-history -->
- **Problema**: `meshamail-auth.json` chegou a ser versionado; remoção do índice está em andamento mas o arquivo ainda pode existir em `HEAD` e commits antigos
- **Impacto**: exposição de credencial no histórico permanente do repositório até purge + rotação
- **Mitigação atual**: `.gitignore` (`*-auth.json`, `meshamail-auth.json`); auth de run via env (`MESHA_EMAIL`, `MESHA_PASSWORD`) e sessão efêmera `{runDir}/.auth/storage-state.json`
- **Pendente**: commit da remoção, purge de histórico, rotação da credencial — ver `.cursor/memory/decisions.md`


## Execution plan used fallback

<!-- type: runtime_learning | id: LC-AGENT-QA-PIPELINE-ALL-E2E-GSR895-1781211056418-PLAN-FALLBACK -->
- **Description**: Execution plan used fallback
- **Content**: LLM buildPlan returned semantically unsafe ExecutionPlan: plan steps must preserve scenarioId/taskId from scenarioCatalog
- **Source**: confirmed
- **Confidence**: 0.9
- **Risk**: low
- **Generated**: 2026-06-11T20:50:56.419Z
