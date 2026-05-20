# 09 — ADR: Loop Reativo com Quiescência, IDs Efêmeros e Dados Dinâmicos Rastreados

## Status

Aceita

## Contexto

O Agent QA executa ações em aplicações web modernas, onde o estado da tela pode mudar de forma assíncrona após cada interação. Além disso, os elementos observáveis são reconstruídos a cada ciclo, e dados dinâmicos usados em inputs precisam continuar disponíveis para asserções posteriores.

Sem regras por design, o agente:

```txt
- observa cedo demais e age sobre tela ainda em mutação
- usa elementos de observação anterior já invalidados
- valida com texto diferente do digitado
- fica preso em modais/dropdowns sem rota de escape
```

## Decisão

O Harness deverá:

```txt
- aguardar quiescência após cada ação
- invalidar todos os IDs de elementos após cada nova observação
- manter um RunDataStore para dados dinâmicos resolvidos
- disponibilizar ações globais de emergência (Escape, clickOutside, clickAtCoordinates restrito)
```

## Regras

```txt
1. Toda ação precisa referenciar o observationId atual
2. IDs de elementos são efêmeros e válidos apenas para uma observação
3. Após qualquer ação, o LocatorResolver deve ser reconstruído
4. Dados dinâmicos resolvidos devem ser armazenados no RunDataStore
5. Asserções também devem passar pelo DataHarness antes da execução
6. O Harness deve esperar DOM/network idle antes de reobservar a tela
7. O agente pode usar Escape/clickOutside para sair de modais, dropdowns e tooltips
```

## Consequências positivas

```txt
- Reduz cliques duplicados
- Reduz race conditions
- Evita uso de locators obsoletos
- Permite validação com dados realmente digitados
- Melhora recuperação de estados flutuantes
- Reduz loops infinitos
- Reduz falsos bugs por dado duplicado
- Reduz alucinação de elemento inexistente
```

## Consequências negativas

```txt
- Runtime fica mais complexo
- Cada ação fica um pouco mais lenta por causa da quiescência
- Exige controle rigoroso de estado por observação
- Exige Zod (ou similar) em todo schema de ação
- LLM precisa de prompt ensinando placeholders e observationId
```

## Resultado esperado

Maturidade operacional do MVP. Agente passa de "bem arquitetado" para confiável em aplicação web real.

## Componentes introduzidos

```txt
QuiescenceGuard
LocatorResolver (revisado, com observationId)
RunDataStore
DataHarness
QaActionEnvelope
PressAction / ClickOutsideAction / ClickAtCoordinatesAction
```

## Tipos novos

```txt
QaRuntimeErrorCode
QaStepStatus (estendido)
```

## Política do runtime

```txt
Nenhuma ação executa sem observationId atual.
Nenhuma observação reaproveita IDs antigos.
Nenhuma validação usa dado dinâmico não resolvido.
Nenhuma decisão nova ocorre antes da quiescência.
Nenhum estado flutuante fica sem rota de escape.
```

## Referências internas

- `doc/02-quiescence-guard.md`
- `doc/03-ephemeral-ids.md`
- `doc/04-data-harness.md`
- `doc/05-emergency-actions.md`
- `doc/06-llm-action-contract.md`
- `doc/07-runtime-flow.md`
