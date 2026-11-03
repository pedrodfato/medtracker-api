# Lembretes de dose por e-mail — design

## Objetivo

Mandar um e-mail ao usuário pouco antes do horário de cada dose, lembrando de tomar o remédio. Antecedência padrão de 10 minutos, ajustável no perfil, com opção de desligar.

## Decisões

- **Provedor de e-mail:** Resend, remetente `MedTracker <lembretes@clov.com.br>`. O domínio `clov.com.br` (DNS na Cloudflare) precisa estar verificado no Resend (SPF/DKIM).
- **Disparo:** cron-job.org chama `GET /cron/reminders` a cada 5 minutos. O Vercel Cron foi descartado porque no plano Hobby só roda uma vez por dia.
- **Escopo:** um e-mail por dose agendada. Sem e-mail de "dose atrasada", sem push, sem resumo diário.

## 1. Dados

### Colunas novas em `user`

| Coluna | Tipo | Padrão |
|---|---|---|
| `reminder_enabled` | boolean not null | `true` |
| `reminder_lead_minutes` | integer not null | `10` |

As duas entram em `additionalFields` do better-auth em `src/lib/auth.ts` (`input: true`), igual ao `timezone`. Assim o front atualiza com `authClient.updateUser({ reminderEnabled, reminderLeadMinutes })`, o mesmo caminho do fuso no perfil.

Valores aceitos para `reminderLeadMinutes`: 0, 5, 10, 15, 30, 60. Valor fora da lista é tratado como 10 na lógica de lembretes.

### Tabela nova `reminders_sent`

| Coluna | Tipo |
|---|---|
| `id` | serial pk |
| `medication_id` | integer not null → `medications.id` on delete cascade |
| `user_id` | text not null → `user.id` on delete cascade |
| `scheduled_for` | timestamp not null (instante real da dose, UTC) |
| `sent_at` | timestamp not null default now |

Índice único em (`medication_id`, `scheduled_for`). É a garantia de no máximo um e-mail por dose, mesmo com o cron rodando em paralelo, repetido ou atrasado.

### Migração

O banco Neon é o mesmo da produção. Todas as mudanças só acrescentam (colunas com default e tabela nova); nada é apagado ou renomeado. O `npm run db:push` só roda com o ok explícito do Pedro.

## 2. Lógica — `src/lib/reminders.ts`

Função pura, sem acesso a banco nem rede:

```ts
type ReminderCandidate = {
  medication: { id; name; dosage; scheduleType; fixedTime; intervalHours; daysOfWeek; startDate; endDate };
  lastDoseTakenAt: Date | null;
  user: { id; email; name; timezone; reminderEnabled; reminderLeadMinutes };
};

type DueReminder = { medicationId; userId; email; name; medicationName; dosage; scheduledFor: Date; timezone };

function findDueReminders(candidates: ReminderCandidate[], now: Date): DueReminder[];
```

Para cada candidato:

1. Pula se `user.reminderEnabled` é falso.
2. Pula se `medication.endDate` existe e é anterior a `now`.
3. Calcula o horário da dose com `computeNextDueAt` de `nextDose.ts`, convertendo para o fuso do usuário com `offsetDiffMinutes`, `toProcessZone` e `fromProcessZone` de `timezone.ts`, igual à rota `/medication/:id/take`. `computeNextDueAt` ancora na última dose tomada, então uma dose já registrada empurra o horário para o próximo slot e não gera lembrete.
4. Para `fixed` e `weekly`, considera também o próximo slot a partir de agora (`computeNextDoseAt(medication, lastDoseTakenAt, now)`). Sem isso, quem esquece de marcar uma dose como tomada pararia de receber lembretes, porque `computeNextDueAt` fica preso na dose atrasada. Para `interval` não existe esse segundo slot: o próximo horário depende da última dose registrada, então quem não registra só recebe o lembrete da dose em aberto.
5. Inclui o lembrete de cada slot se `scheduledFor − lead ≤ now < scheduledFor + 15 min`. Os 15 minutos de folga cobrem atraso do cron. Uma dose atrasada há mais tempo não gera novo e-mail. Se os dois slots caírem no mesmo instante, gera um só.

## 3. Rota `GET /cron/reminders`

Arquivo novo `src/routes/cron-routes.ts`, registrado em `server.ts`.

1. Exige `Authorization: Bearer ${CRON_SECRET}`. Sem o cabeçalho ou com valor errado: 401. Se `CRON_SECRET` não estiver configurado: 500, sem processar nada.
2. Busca remédios ativos junto com o usuário dono e a última dose de cada um, só de usuários com `reminder_enabled = true`.
3. Chama `findDueReminders(candidatos, new Date())`.
4. Para cada lembrete, em sequência:
   - `INSERT INTO reminders_sent ... ON CONFLICT DO NOTHING RETURNING id`. Sem linha retornada: já enviado, pula.
   - Envia pelo Resend. Se falhar, apaga a linha inserida para a próxima rodada tentar de novo e conta como falha.
5. Responde `200 { checked, sent, skipped, failed }`. Erros de cada e-mail vão para o log (`app.log.error`) sem derrubar a rodada.

## 4. E-mail — `src/lib/email.ts`

- **SDK:** `resend`. Um módulo com `sendDoseReminder(reminder: DueReminder): Promise<void>` que lança erro se o Resend retornar erro.
- **Assunto:** `Hora do seu remédio: <nome> às <HH:mm>`.
- **Corpo** (HTML e texto puro, em português): saudação com o nome, remédio, dosagem, horário no fuso do usuário e um botão "Abrir o MedTracker" apontando para `APP_URL`.
- **Formatação do horário:** `Intl.DateTimeFormat('pt-BR', { timeZone: user.timezone, hour: '2-digit', minute: '2-digit' })`.

### Variáveis de ambiente novas (projeto `medtracker-api` na Vercel)

- `RESEND_API_KEY` (sensitive)
- `CRON_SECRET` (sensitive, gerado aleatoriamente)
- `APP_URL` = `https://medtracker-opal.vercel.app`

## 5. Front — perfil (`medtracker/src/pages/profile.tsx`)

Seção "Lembretes por e-mail", seguindo o estilo das seções atuais do perfil:

- Interruptor "Receber lembretes" → `authClient.updateUser({ reminderEnabled })`.
- Seletor "Avisar com antecedência de" com as opções: Na hora, 5 min, 10 min, 15 min, 30 min, 1 hora → `authClient.updateUser({ reminderLeadMinutes })`. Desabilitado quando o interruptor está desligado.
- `inferAdditionalFields` em `src/lib/auth-client.ts` ganha os dois campos novos.

## 6. Testes

`src/lib/reminders.test.ts`, no padrão de `nextDose.test.ts` (`node --test` via `npm test`):

- `fixed`: avisa dentro da janela, não avisa antes dela nem depois de `+15 min`.
- `interval`: horário = última dose + intervalo; sem dose anterior, usa `startDate`.
- `weekly`: avisa só nos dias configurados.
- Dose já tomada para o slot: sem lembrete.
- `fixed` com dose de ontem não registrada: avisa no horário de hoje mesmo assim.
- `endDate` vencido: sem lembrete.
- `reminderEnabled = false`: sem lembrete.
- Antecedência 0 e 60 minutos.
- Usuário em `America/Manaus`: horário calculado no fuso dele.

A rota e o envio são verificados manualmente: chamada com e sem o segredo, e um e-mail real para o Pedro depois do deploy.

## 7. Passos do Pedro

1. Criar conta no Resend, adicionar `clov.com.br` e criar os registros de DNS na Cloudflare.
2. Gerar uma API key no Resend e passar para configurar na Vercel.
3. Criar um job no cron-job.org: `GET https://medtracker-api.vercel.app/cron/reminders`, a cada 5 minutos, com o cabeçalho `Authorization: Bearer <CRON_SECRET>`.
