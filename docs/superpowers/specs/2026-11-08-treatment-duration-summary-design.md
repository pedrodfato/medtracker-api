# Duração do tratamento e resumo final — design

## Objetivo
Todo remédio passa a ter uma duração em dias (ex.: "10 dias", como o médico receitou). No último dia do tratamento, o dashboard mostra um popup com o resultado: quantas doses foram tomadas das previstas, e em quais dias houve doses perdidas.

## Decisões
- Duração informada em **número de dias**, campo obrigatório ao criar (de 1 a 365). O dia do cadastro conta como dia 1.
- Remédios concluídos saem do dashboard ("Próxima Dose") e ficam na lista com selo "Concluído" e o score final. O histórico de doses é mantido.
- O popup **não** depende de o usuário tomar a "última dose". Ele aparece quando a última dose prevista do último dia já passou, na primeira abertura do app a partir daí (no próprio dia ou depois), até o usuário dispensar.
- O score cobre o tratamento inteiro, do início ao fim.
- Vários remédios terminando ao mesmo tempo: um popup por vez.
- Remédios antigos sem `end_date` seguem como hoje, sem popup.

## Dados (medtracker-api)
- `medications.end_date` já existe. Passa a ser preenchido: fim do dia N no fuso do usuário (`startDate` + N-1 dias, 23:59:59).
- Nova coluna `medications.summary_dismissed_at timestamp null` (migração Drizzle).
- `POST /medications` recebe `durationDays` (inteiro >= 1, senão 400) e grava `endDate`.
- `PATCH /medications/:id` aceita `durationDays` e recalcula `endDate` a partir do `startDate`. Se o novo `endDate` ficar no futuro, zera `summary_dismissed_at`.
- Hoje o PATCH ignora `endDate` e o POST nunca o grava; ambos mudam.

## Cálculo (módulo puro `src/lib/treatmentSummary.ts`)
Entrada: medicamento (`scheduleType`, `fixedTime`, `intervalHours`, `daysOfWeek`, `startDate`, `endDate`), doses tomadas, fuso. Saída:

```
{ expected, taken, perfect, missedDays: [{ date: 'YYYY-MM-DD', missed, expected }], readyAt }
```

- Enumera as doses previstas entre `startDate` e `endDate`: `fixed` = 1 por dia no `fixedTime`; `weekly` = 1 nos dias de `daysOfWeek`; `interval` = grade a cada `intervalHours` a partir do `startDate`.
- Agrupa por dia local. `taken` por dia é limitado ao previsto do dia, então tomar doses a mais não compensa dias perdidos.
- `missedDays` lista só os dias com `taken < expected`. `perfect` = nenhum dia perdido.
- Contagem por dia, o mesmo critério do `stats.ts` (que também não casa dose a dose por horário).
- `readyAt` é o horário da última dose prevista (ou o `endDate`, se não houver nenhuma). O popup só dispara com `now > readyAt`.
- Weekly: `daysOfWeek` é ajustado quando o usuário toma em outro dia (`driftedWeeklyDaysOfWeek`). O resumo usa os `daysOfWeek` atuais; para remédios de um dia só por semana, a dose é casada por bloco de 7 dias contados do início (tomar na quarta em vez da quinta, na mesma semana, conta).
- Trabalha em fuso do processo, via `toProcessZone`/`fromProcessZone` de `timezone.ts`, como o resto da API.

## API
- `GET /medications` devolve em cada item: `durationDays`, `completed` (boolean: `now > readyAt`, ou seja, não há mais dose prevista) e `treatmentSummary` (objeto acima mais `dismissed`, ou `null` se ainda não concluído). Para concluídos, `nextDoseAt` é `null`.
- `POST /medications/:id/summary/dismiss` grava `summary_dismissed_at = now()` (404 se o remédio não for do usuário).
- O popup aparece para itens com `treatmentSummary.dismissed === false`; a lista mostra o score de todos os concluídos.
- As estatísticas (`stats.ts`) deixam de esperar doses depois do `endDate`, para o remédio concluído não acumular "doses perdidas" nos insights.

## Frontend (medtracker)
- `addMedications.tsx`: campo numérico "Por quantos dias?" (obrigatório, min 1); em edição, pré-preenchido com a duração atual. Envia `durationDays`.
- `medType.ts`: `endDate`, `completed`, `treatmentSummary`.
- `dashboard.tsx`:
  - Filtra remédios `completed` da "Próxima Dose" e das estatísticas por medicamento.
  - Popup (mesmo padrão do modal de desfazer): "Tratamento concluído — {nome}", "Você tomou X de Y doses". Se `perfect`, mensagem de parabéns. Senão, lista de dias com doses perdidas (data e quantidade). Botão "Entendi" chama o dismiss e abre o próximo popup pendente.
- `medicationList.tsx`: selo "Concluído" e score `X/Y` nos remédios concluídos.

## Erros
- `durationDays` ausente ou inválido: 400 com mensagem; o formulário valida antes de enviar.
- Falha no dismiss: popup permanece e reaparece na próxima abertura. Não há perda de dados.

## Testes
- `treatmentSummary.ts`, com Vitest como o `reminders.test.ts`: fixed, weekly (com e sem drift), interval; tratamento perfeito, com dias perdidos, com dose a mais; borda antes e depois de `lastSlotAt`; virada de dia em fuso diferente de UTC.
- Rotas: validação de `durationDays`, cálculo de `endDate`, dismiss de remédio de outro usuário (404).
- Frontend: verificação manual no navegador do fluxo cadastro → popup → lista.

## Fora de escopo
Renovar/repetir tratamento, duração opcional ("uso contínuo"), push/e-mail de resumo final.
