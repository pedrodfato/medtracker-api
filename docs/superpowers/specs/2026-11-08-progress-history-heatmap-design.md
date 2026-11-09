# Progresso: faixa de hoje e histórico por remédio — design

## Objetivo
Na página de Progresso, mostrar no topo quais remédios já foram tomados hoje (coloridos) e quais ainda não (cinza). Tocar num remédio abre, logo abaixo, uma grade de dias no estilo do gráfico de contribuições do GitHub com o histórico de adesão daquele remédio.

## Decisões
- Cada quadrado da grade é um dia. A cor representa a **porcentagem das doses previstas que foram tomadas** naquele dia.
- A grade cobre do **início do tratamento até hoje**, ou até o fim do tratamento se ele já terminou.
- O remédio do histórico é escolhido **tocando nele na faixa de hoje**; o primeiro da faixa vem selecionado.
- O cálculo fica **na API**, reaproveitando a geração de horários de `treatmentSummary.ts`. O frontend só desenha.
- A linha do tempo de doses atual continua no fim da página.
- `progressTracker.tsx` e `daysStreak.tsx` (protótipos sem uso) ficam como estão.

## Cálculo (medtracker-api, `src/lib/treatmentSummary.ts`)
Nova função pura:

```
dailyAdherence(schedule, doses, from, until): DayAdherence[]
todayAdherence(schedule, doses, now, endDate): { expected, taken }
type Schedule = Omit<SummaryMedication, 'endDate'>
type DayAdherence = { date: 'YYYY-MM-DD'; expected: number; taken: number }
```

- `from`/`until`: janela consultada. A grade de horários continua ancorada no `startDate` do remédio (importante para o intervalo); `from` só filtra.
- Gera as doses previstas com a mesma lógica de `expectedSlots` (que passa a aceitar um limite final em vez de ler sempre `endDate`).
- Devolve **um item por dia de calendário**, do dia de `max(from, startDate)` ao dia de `until`, inclusive, em ordem. Dias sem dose prevista vêm com `expected: 0`.
- `taken` conta as doses tomadas naquele dia, **limitado a `expected`** quando `expected > 0` (dose extra não infla o dia). Em dia com `expected: 0`, `taken` é o número real de doses tomadas.
- Doses fora de `[startDate, until]` são ignoradas.
- Datas já deslocadas com `toProcessZone`, como no resto do módulo.
- `computeTreatmentSummary` continua com o mesmo contrato e os mesmos testes; só passa a usar o `expectedSlots` refatorado.

`todayAdherence` chama `dailyAdherence` com `from` = 00:00 de hoje e `until` = 23:59:59.999 de hoje (limitado ao `endDate`), e usa o único item devolvido. Com isso, uma dose prevista para mais tarde no dia conta como prevista e ainda não tomada (cinza). O histórico usa a mesma regra (`historyUntil`): o dia de hoje vai até 23:59, então uma dose de mais tarde já conta como prevista na grade, igual à faixa.

## API
- `GET /medications`: cada item ganha `today: { expected: number; taken: number }`. Remédio concluído: `today: { expected: 0, taken: 0 }`.
- `GET /medications/:id/history` (novo, `verifySession`):
  - 404 se o remédio não for do usuário; 400 se o id não for numérico.
  - Resposta: `{ data: { medicationId, startDate, endDate, days: DayAdherence[], expected, taken } }`, em que `expected`/`taken` são as somas de `days`.
  - Usa as doses daquele remédio (uma consulta) e o fuso do usuário.

## Frontend (medtracker)
- `src/types/medType.ts`: `today?: { expected: number; taken: number }` em `Medication`; tipo `DayAdherence` e `MedicationHistory`.
- `src/components/todayStrip.tsx` (novo): faixa "Hoje · X de Y tomados".
  - Um botão por remédio ativo com emoji e cor da categoria (`medicationVisuals.ts`) e o nome abaixo.
  - Estados: tudo tomado → colorido; parte → colorido com selo `taken/expected`; nada tomado → cinza (`grayscale` + opacidade); sem dose hoje → cinza mais claro com "sem dose hoje".
  - Remédios concluídos no fim, depois de um separador, com selo "Concluído".
  - O selecionado ganha borda; toque chama `onSelect(id)`.
  - "X de Y" conta remédios com `today.expected > 0` e, entre eles, os com `taken >= expected`.
- `src/components/adherenceHeatmap.tsx` (novo): recebe `days` e desenha a grade.
  - Colunas = semanas (começando no domingo), linhas = dias; rótulos Seg/Qua/Sex à esquerda e mês acima da primeira coluna de cada mês.
  - Cor: `taken >= expected > 0` → verde forte; `0 < taken < expected` → verde claro; `expected > 0 e taken = 0` → vazio com borda; `expected = 0 e taken > 0` → verde forte; `expected = 0 e taken = 0` e dias fora do período → neutro.
  - Legenda "Menos ▢ ▣ ■ Mais" e rodapé "X de Y doses · Z%".
  - Tocar num quadrado mostra abaixo da grade a data por extenso e "2 de 3 doses" (ou "sem dose prevista").
  - Rolagem horizontal quando não cabe; ao carregar, rola até o fim (dias recentes).
- `src/pages/progress.tsx`: busca `/medications` (faixa) e `/medications/:id/history` do selecionado; mantém a linha do tempo atual no fim.

## Erros
- Falha ao carregar o histórico: mensagem "Não foi possível carregar o histórico." no lugar da grade; a faixa e a linha do tempo continuam.
- Sem remédios cadastrados: a faixa mostra o mesmo tipo de aviso vazio já usado na página; a grade não aparece.

## Testes
- `dailyAdherence`, com `node:test` como os testes existentes: fixo (dia a dia, dia perdido, dose extra limitada), semanal com folga (`expected: 0`), dose tomada em dia de folga, intervalo agrupado por dia, `until` antes do `endDate` (corta no dia de hoje), remédio sem `endDate`, dose fora do período ignorada, e "hoje" com a dose ainda por vir (`expected: 1, taken: 0`).
- Os 69 testes atuais continuam passando (garante que o refactor de `expectedSlots` não mudou `computeTreatmentSummary`).
- Verificação no navegador **somente com um banco que não seja produção**. O `dbURL` do `.env` local é o de produção; antes de qualquer teste com o app, o Pedro fornece a URL de outro banco ou de uma branch do Neon, passada só na linha de comando.

## Limitações conhecidas
- Remédio semanal de um dia só que muda de dia (`driftedWeeklyDaysOfWeek`) aparece na grade com o dia em que foi tomado verde e o dia previsto vazio. O resumo final do tratamento continua contando a semana como cumprida.

## Fora de escopo
Filtros de período, comparar remédios, exportar histórico, reaproveitar os protótipos `progressTracker`/`daysStreak`.
