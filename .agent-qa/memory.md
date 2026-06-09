# Memória do Projeto — qa-agent fixture

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
