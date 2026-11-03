# Lembretes de dose por e-mail — plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Mandar um e-mail pouco antes de cada dose, com antecedência configurável no perfil (padrão 10 min) e opção de desligar.

**Architecture:** Uma função pura (`src/lib/reminders.ts`) decide quais lembretes estão no horário, reaproveitando `nextDose.ts` e `timezone.ts`. Uma rota protegida (`GET /cron/reminders`), chamada pelo cron-job.org a cada 5 minutos, busca os dados, reserva cada lembrete na tabela `reminders_sent` (índice único evita duplicata) e envia pelo Resend. O front ganha a seção de preferências no perfil.

**Tech Stack:** Fastify 5, Drizzle ORM + Postgres (Neon), better-auth, Resend SDK, `node --test` com tsx; front React + Vite + better-auth/react.

**Spec:** `docs/superpowers/specs/2026-11-03-email-reminders-design.md`

## Global Constraints

- Repositório da API: `/home/pedro/Documents/medtrackerproject/medtracker-api`. Repositório do front: `/home/pedro/Documents/medtrackerproject/medtracker`. São dois repositórios git separados.
- Remetente: `MedTracker <lembretes@clov.com.br>`.
- Antecedências aceitas: 0, 5, 10, 15, 30, 60 minutos. Padrão: 10. Valor fora da lista vale 10.
- Tolerância de atraso: 15 minutos depois do horário da dose.
- Variáveis de ambiente (já criadas no projeto `medtracker-api` da Vercel): `RESEND_API_KEY`, `CRON_SECRET`, `APP_URL`.
- O banco é o de produção. `npm run db:push` **só roda com o ok explícito do Pedro.** Nada de `git push` sem o ok dele: os dois projetos fazem deploy de produção a cada push na `main`.
- Imports relativos na API terminam em `.js` (módulos ESM `nodenext`).
- Textos para o usuário em português.

---

### Task 1: Esquema — preferências do usuário e tabela `reminders_sent`

**Files:**
- Modify: `src/schema.ts`
- Modify: `src/lib/auth.ts`

**Interfaces:**
- Produces: colunas `user.reminderEnabled: boolean`, `user.reminderLeadMinutes: number`; tabela `reminders_sent` com `id`, `medicationId`, `userId`, `scheduledFor: Date`, `sentAt: Date`, índice único `reminders_sent_medication_slot_idx` em (`medicationId`, `scheduledFor`).

- [ ] **Step 1: Colunas novas em `user`**

Em `src/schema.ts`, dentro de `pgTable('user', { ... })`, logo abaixo de `timezone`:

```ts
  reminderEnabled: boolean('reminder_enabled').notNull().default(true),
  reminderLeadMinutes: integer('reminder_lead_minutes').notNull().default(10),
```

- [ ] **Step 2: Tabela `reminders_sent`**

Trocar o import da primeira linha de `src/schema.ts` por:

```ts
import { text, pgTable, serial, integer, timestamp, boolean, pgEnum, uniqueIndex } from 'drizzle-orm/pg-core';
```

E acrescentar no fim do arquivo:

```ts

export const reminders_sent = pgTable('reminders_sent', {
  id: serial('id').primaryKey(),
  medicationId: integer('medication_id').notNull().references(() => medications.id, { onDelete: "cascade" }),
  userId: text("user_id").notNull().references(() => user.id, { onDelete: "cascade" }),
  scheduledFor: timestamp('scheduled_for').notNull(),
  sentAt: timestamp('sent_at').notNull().defaultNow(),
}, (table) => [
  uniqueIndex('reminders_sent_medication_slot_idx').on(table.medicationId, table.scheduledFor),
]);
```

- [ ] **Step 3: Campos no better-auth**

Em `src/lib/auth.ts`, dentro de `user.additionalFields`, abaixo de `timezone`:

```ts
      reminderEnabled: {
        type: "boolean",
        required: false,
        defaultValue: true,
        input: true,
      },
      reminderLeadMinutes: {
        type: "number",
        required: false,
        defaultValue: 10,
        input: true,
      },
```

- [ ] **Step 4: Compilar**

Run: `npm run build`
Expected: termina sem erros.

- [ ] **Step 5: Commit**

```bash
git add src/schema.ts src/lib/auth.ts
git commit -m "feat: preferências de lembrete no usuário e tabela reminders_sent"
```

(Não rodar `db:push` aqui; isso é na Task 6.)

---

### Task 2: Lógica pura dos lembretes

**Files:**
- Create: `src/lib/reminders.ts`
- Test: `src/lib/reminders.test.ts`

**Interfaces:**
- Consumes: `computeNextDoseAt`, `computeNextDueAt`, `NextDoseInput` de `./nextDose.js`; `offsetDiffMinutes`, `toProcessZone`, `fromProcessZone`, `DEFAULT_TIMEZONE` de `./timezone.js`.
- Produces:
  - `type ReminderCandidate = { medication: { id: number; name: string; dosage: string; scheduleType: 'fixed' | 'interval' | 'weekly'; fixedTime: string | null; intervalHours: number | null; daysOfWeek: number[] | null; startDate: Date; endDate: Date | null }; lastDoseTakenAt: Date | null; user: { id: string; email: string; name: string; timezone: string | null; reminderEnabled: boolean; reminderLeadMinutes: number | null } }`
  - `type DueReminder = { medicationId: number; userId: string; email: string; userName: string; medicationName: string; dosage: string; scheduledFor: Date; timezone: string }`
  - `normalizeLeadMinutes(value: number | null): number`
  - `findDueReminders(candidates: ReminderCandidate[], now: Date): DueReminder[]`

Regras (da spec, com um ajuste explicado no código):
1. Pula se `reminderEnabled` é falso ou se `endDate < now`.
2. Slots: `computeNextDueAt` (dose em aberto) e, para `fixed`/`weekly`, o primeiro slot depois de `now − 15 min` (`computeNextDoseAt`). Tudo no fuso do usuário.
3. Pula o slot se a última dose foi registrada a partir de `slot − antecedência − 15 min` (a dose daquele horário já foi tomada).
4. Avisa se `slot − antecedência ≤ now < slot + 15 min`. Slots iguais geram um só lembrete.

- [ ] **Step 1: Escrever os testes**

Criar `src/lib/reminders.test.ts`:

```ts
process.env.TZ = 'America/Sao_Paulo';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { findDueReminders, normalizeLeadMinutes, type ReminderCandidate } from './reminders.js';

function candidate(overrides: {
  medication?: Partial<ReminderCandidate['medication']>;
  user?: Partial<ReminderCandidate['user']>;
  lastDoseTakenAt?: Date | null;
} = {}): ReminderCandidate {
  return {
    medication: {
      id: 1,
      name: 'Losartana',
      dosage: '50mg',
      scheduleType: 'fixed',
      fixedTime: '14:00',
      intervalHours: null,
      daysOfWeek: null,
      startDate: new Date('2026-11-01T08:00:00-03:00'),
      endDate: null,
      ...overrides.medication,
    },
    lastDoseTakenAt: overrides.lastDoseTakenAt ?? null,
    user: {
      id: 'u1',
      email: 'pessoa@example.com',
      name: 'Pessoa',
      timezone: 'America/Sao_Paulo',
      reminderEnabled: true,
      reminderLeadMinutes: 10,
      ...overrides.user,
    },
  };
}

const at = (iso: string) => new Date(iso);

test('normalizeLeadMinutes: aceita valores da lista e cai para 10 fora dela', () => {
  assert.equal(normalizeLeadMinutes(0), 0);
  assert.equal(normalizeLeadMinutes(60), 60);
  assert.equal(normalizeLeadMinutes(7), 10);
  assert.equal(normalizeLeadMinutes(null), 10);
});

test('fixed: avisa dentro da antecedência', () => {
  const result = findDueReminders(
    [candidate({ lastDoseTakenAt: at('2026-11-02T14:01:00-03:00') })],
    at('2026-11-03T13:52:00-03:00')
  );
  assert.equal(result.length, 1);
  assert.equal(result[0]?.scheduledFor.toISOString(), at('2026-11-03T14:00:00-03:00').toISOString());
  assert.equal(result[0]?.medicationName, 'Losartana');
  assert.equal(result[0]?.email, 'pessoa@example.com');
});

test('fixed: não avisa antes da antecedência', () => {
  const result = findDueReminders(
    [candidate({ lastDoseTakenAt: at('2026-11-02T14:01:00-03:00') })],
    at('2026-11-03T13:45:00-03:00')
  );
  assert.equal(result.length, 0);
});

test('fixed: ainda avisa até 15 min depois do horário, e não depois disso', () => {
  const inside = findDueReminders(
    [candidate({ lastDoseTakenAt: at('2026-11-02T14:01:00-03:00') })],
    at('2026-11-03T14:10:00-03:00')
  );
  assert.equal(inside.length, 1);

  const outside = findDueReminders(
    [candidate({ lastDoseTakenAt: at('2026-11-02T14:01:00-03:00') })],
    at('2026-11-03T14:16:00-03:00')
  );
  assert.equal(outside.length, 0);
});

test('fixed: dose de hoje já registrada não gera lembrete', () => {
  const result = findDueReminders(
    [candidate({ lastDoseTakenAt: at('2026-11-03T14:02:00-03:00') })],
    at('2026-11-03T14:05:00-03:00')
  );
  assert.equal(result.length, 0);
});

test('fixed: dose de ontem não registrada não impede o lembrete de hoje', () => {
  const result = findDueReminders(
    [candidate({ lastDoseTakenAt: at('2026-11-01T14:00:00-03:00') })],
    at('2026-11-03T13:55:00-03:00')
  );
  assert.equal(result.length, 1);
  assert.equal(result[0]?.scheduledFor.toISOString(), at('2026-11-03T14:00:00-03:00').toISOString());
});

test('interval: horário é a última dose mais o intervalo', () => {
  const result = findDueReminders(
    [candidate({
      medication: { scheduleType: 'interval', fixedTime: null, intervalHours: 8 },
      lastDoseTakenAt: at('2026-11-03T06:00:00-03:00'),
    })],
    at('2026-11-03T13:55:00-03:00')
  );
  assert.equal(result.length, 1);
  assert.equal(result[0]?.scheduledFor.toISOString(), at('2026-11-03T14:00:00-03:00').toISOString());
});

test('interval: sem dose anterior, usa a data de início', () => {
  const result = findDueReminders(
    [candidate({
      medication: { scheduleType: 'interval', fixedTime: null, intervalHours: 8, startDate: at('2026-11-03T09:00:00-03:00') },
    })],
    at('2026-11-03T08:52:00-03:00')
  );
  assert.equal(result.length, 1);
  assert.equal(result[0]?.scheduledFor.toISOString(), at('2026-11-03T09:00:00-03:00').toISOString());
});

test('weekly: avisa só nos dias configurados', () => {
  // 2026-11-03 é terça (getDay() === 2)
  const tuesday = findDueReminders(
    [candidate({
      medication: { scheduleType: 'weekly', fixedTime: '09:00', daysOfWeek: [2, 4] },
      lastDoseTakenAt: at('2026-10-30T09:00:00-03:00'),
    })],
    at('2026-11-03T08:55:00-03:00')
  );
  assert.equal(tuesday.length, 1);

  const wednesday = findDueReminders(
    [candidate({
      medication: { scheduleType: 'weekly', fixedTime: '09:00', daysOfWeek: [2, 4] },
      lastDoseTakenAt: at('2026-11-03T09:00:00-03:00'),
    })],
    at('2026-11-04T08:55:00-03:00')
  );
  assert.equal(wednesday.length, 0);
});

test('remédio encerrado não gera lembrete', () => {
  const result = findDueReminders(
    [candidate({
      medication: { endDate: at('2026-11-02T23:59:00-03:00') },
      lastDoseTakenAt: at('2026-11-02T14:00:00-03:00'),
    })],
    at('2026-11-03T13:55:00-03:00')
  );
  assert.equal(result.length, 0);
});

test('lembrete desligado não gera lembrete', () => {
  const result = findDueReminders(
    [candidate({ user: { reminderEnabled: false }, lastDoseTakenAt: at('2026-11-02T14:00:00-03:00') })],
    at('2026-11-03T13:55:00-03:00')
  );
  assert.equal(result.length, 0);
});

test('antecedência 0: avisa só a partir do horário', () => {
  const before = findDueReminders(
    [candidate({ user: { reminderLeadMinutes: 0 }, lastDoseTakenAt: at('2026-11-02T14:00:00-03:00') })],
    at('2026-11-03T13:59:00-03:00')
  );
  assert.equal(before.length, 0);

  const onTime = findDueReminders(
    [candidate({ user: { reminderLeadMinutes: 0 }, lastDoseTakenAt: at('2026-11-02T14:00:00-03:00') })],
    at('2026-11-03T14:00:00-03:00')
  );
  assert.equal(onTime.length, 1);
});

test('antecedência 60: avisa uma hora antes', () => {
  const result = findDueReminders(
    [candidate({ user: { reminderLeadMinutes: 60 }, lastDoseTakenAt: at('2026-11-02T14:00:00-03:00') })],
    at('2026-11-03T13:00:00-03:00')
  );
  assert.equal(result.length, 1);
});

test('fuso do usuário: 14:00 em Manaus é 15:00 em Brasília', () => {
  const result = findDueReminders(
    [candidate({ user: { timezone: 'America/Manaus' }, lastDoseTakenAt: at('2026-11-02T14:00:00-04:00') })],
    at('2026-11-03T13:55:00-04:00')
  );
  assert.equal(result.length, 1);
  assert.equal(result[0]?.scheduledFor.toISOString(), at('2026-11-03T14:00:00-04:00').toISOString());
  assert.equal(result[0]?.timezone, 'America/Manaus');
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL em `reminders.test.ts` com erro de módulo não encontrado (`./reminders.js`).

- [ ] **Step 3: Implementar**

Criar `src/lib/reminders.ts`:

```ts
import { computeNextDoseAt, computeNextDueAt, type NextDoseInput } from './nextDose.js';
import { offsetDiffMinutes, toProcessZone, fromProcessZone, DEFAULT_TIMEZONE } from './timezone.js';

export const REMINDER_LEAD_OPTIONS = [0, 5, 10, 15, 30, 60];
export const DEFAULT_REMINDER_LEAD_MINUTES = 10;
// How long after the dose time a reminder is still worth sending, to absorb
// a late or skipped cron run.
export const REMINDER_LATE_TOLERANCE_MINUTES = 15;

const MINUTE = 60 * 1000;

export type ReminderCandidate = {
  medication: {
    id: number;
    name: string;
    dosage: string;
    scheduleType: NextDoseInput['scheduleType'];
    fixedTime: string | null;
    intervalHours: number | null;
    daysOfWeek: number[] | null;
    startDate: Date;
    endDate: Date | null;
  };
  lastDoseTakenAt: Date | null;
  user: {
    id: string;
    email: string;
    name: string;
    timezone: string | null;
    reminderEnabled: boolean;
    reminderLeadMinutes: number | null;
  };
};

export type DueReminder = {
  medicationId: number;
  userId: string;
  email: string;
  userName: string;
  medicationName: string;
  dosage: string;
  scheduledFor: Date;
  timezone: string;
};

export function normalizeLeadMinutes(value: number | null): number {
  return value !== null && REMINDER_LEAD_OPTIONS.includes(value) ? value : DEFAULT_REMINDER_LEAD_MINUTES;
}

/**
 * The dose times (real instants) a reminder could be about: the open dose
 * (anchored on the last dose taken, like the dashboard shows) and, for
 * fixed/weekly schedules, the next slot from now. The second one keeps
 * reminders coming for people who forget to mark a dose as taken - without
 * it the open dose would stay stuck in the past forever.
 */
function candidateSlots(candidate: ReminderCandidate, now: Date): Date[] {
  const { medication, lastDoseTakenAt, user } = candidate;
  const diff = offsetDiffMinutes(user.timezone ?? DEFAULT_TIMEZONE);
  const input: NextDoseInput = {
    scheduleType: medication.scheduleType,
    fixedTime: medication.fixedTime,
    intervalHours: medication.intervalHours,
    daysOfWeek: medication.daysOfWeek,
    startDate: toProcessZone(medication.startDate, diff),
  };
  const lastInZone = lastDoseTakenAt ? toProcessZone(lastDoseTakenAt, diff) : null;

  const slots: Date[] = [];
  const due = computeNextDueAt(input, lastInZone);
  if (due) slots.push(fromProcessZone(due, diff));

  if (medication.scheduleType !== 'interval') {
    const from = new Date(now.getTime() - REMINDER_LATE_TOLERANCE_MINUTES * MINUTE);
    const upcoming = computeNextDoseAt(input, lastInZone, toProcessZone(from, diff));
    if (upcoming) slots.push(fromProcessZone(upcoming, diff));
  }

  return slots.filter((slot, index) => slots.findIndex((other) => other.getTime() === slot.getTime()) === index);
}

export function findDueReminders(candidates: ReminderCandidate[], now: Date): DueReminder[] {
  const reminders: DueReminder[] = [];

  for (const candidate of candidates) {
    const { medication, lastDoseTakenAt, user } = candidate;
    if (!user.reminderEnabled) continue;
    if (medication.endDate && medication.endDate.getTime() < now.getTime()) continue;

    const leadMs = normalizeLeadMinutes(user.reminderLeadMinutes) * MINUTE;
    const toleranceMs = REMINDER_LATE_TOLERANCE_MINUTES * MINUTE;

    for (const slot of candidateSlots(candidate, now)) {
      const windowStart = slot.getTime() - leadMs;
      const windowEnd = slot.getTime() + toleranceMs;

      // A dose registered from the start of this slot's window onwards
      // already covers it.
      if (lastDoseTakenAt && lastDoseTakenAt.getTime() >= windowStart - toleranceMs) continue;
      if (now.getTime() < windowStart || now.getTime() >= windowEnd) continue;

      reminders.push({
        medicationId: medication.id,
        userId: user.id,
        email: user.email,
        userName: user.name,
        medicationName: medication.name,
        dosage: medication.dosage,
        scheduledFor: slot,
        timezone: user.timezone ?? DEFAULT_TIMEZONE,
      });
    }
  }

  return reminders;
}
```

- [ ] **Step 4: Rodar e ver passar**

Run: `npm test`
Expected: todos os testes passam, incluindo os antigos de `nextDose`, `stats` e `timezone`.

- [ ] **Step 5: Commit**

```bash
git add src/lib/reminders.ts src/lib/reminders.test.ts
git commit -m "feat: lógica pura que decide quais lembretes de dose enviar"
```

---

### Task 3: Montagem e envio do e-mail

**Files:**
- Create: `src/lib/email.ts`
- Test: `src/lib/email.test.ts`
- Modify: `package.json`, `package-lock.json` (dependência `resend`)

**Interfaces:**
- Consumes: `DueReminder` de `./reminders.js`.
- Produces:
  - `buildReminderEmail(reminder: DueReminder, appUrl: string): { subject: string; html: string; text: string }`
  - `sendDoseReminder(reminder: DueReminder): Promise<void>` — lança `Error` se faltar `RESEND_API_KEY`/`APP_URL` ou se o Resend retornar erro.

- [ ] **Step 1: Instalar o SDK**

Run: `npm install resend`
Expected: `resend` aparece em `dependencies` do `package.json`.

- [ ] **Step 2: Escrever os testes**

Criar `src/lib/email.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { buildReminderEmail } from './email.js';
import type { DueReminder } from './reminders.js';

const reminder: DueReminder = {
  medicationId: 1,
  userId: 'u1',
  email: 'pessoa@example.com',
  userName: 'Pessoa',
  medicationName: 'Losartana',
  dosage: '50mg',
  scheduledFor: new Date('2026-11-03T14:00:00-03:00'),
  timezone: 'America/Sao_Paulo',
};

test('assunto traz o remédio e o horário no fuso do usuário', () => {
  const email = buildReminderEmail(reminder, 'https://app.example.com');
  assert.equal(email.subject, 'Hora do seu remédio: Losartana às 14:00');
});

test('horário respeita o fuso do usuário', () => {
  const email = buildReminderEmail({ ...reminder, timezone: 'America/Manaus' }, 'https://app.example.com');
  assert.equal(email.subject, 'Hora do seu remédio: Losartana às 13:00');
});

test('corpo traz nome, dosagem e link do app', () => {
  const email = buildReminderEmail(reminder, 'https://app.example.com');
  for (const body of [email.html, email.text]) {
    assert.match(body, /Pessoa/);
    assert.match(body, /Losartana/);
    assert.match(body, /50mg/);
    assert.match(body, /https:\/\/app\.example\.com/);
  }
});

test('html escapa texto vindo do usuário', () => {
  const email = buildReminderEmail({ ...reminder, medicationName: '<b>X</b>' }, 'https://app.example.com');
  assert.doesNotMatch(email.html, /<b>X<\/b>/);
  assert.match(email.html, /&lt;b&gt;X&lt;\/b&gt;/);
});
```

- [ ] **Step 3: Rodar e ver falhar**

Run: `npm test`
Expected: FAIL em `email.test.ts` com módulo não encontrado (`./email.js`).

- [ ] **Step 4: Implementar**

Criar `src/lib/email.ts`:

```ts
import { Resend } from 'resend';
import type { DueReminder } from './reminders.js';

const FROM = 'MedTracker <lembretes@clov.com.br>';

function escapeHtml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function formatTime(date: Date, timezone: string): string {
  return new Intl.DateTimeFormat('pt-BR', { timeZone: timezone, hour: '2-digit', minute: '2-digit' }).format(date);
}

export function buildReminderEmail(reminder: DueReminder, appUrl: string) {
  const time = formatTime(reminder.scheduledFor, reminder.timezone);
  const subject = `Hora do seu remédio: ${reminder.medicationName} às ${time}`;

  const text = [
    `Olá, ${reminder.userName}!`,
    '',
    `Às ${time} é hora de tomar ${reminder.medicationName} (${reminder.dosage}).`,
    '',
    `Depois de tomar, marque a dose no MedTracker: ${appUrl}`,
  ].join('\n');

  const html = `<!doctype html>
<html lang="pt-BR">
  <body style="margin:0;padding:24px;background:#f2f3f8;font-family:Arial,Helvetica,sans-serif;color:#111827;">
    <div style="max-width:480px;margin:0 auto;background:#ffffff;border-radius:24px;padding:32px;">
      <p style="margin:0 0 16px;font-size:16px;">Olá, ${escapeHtml(reminder.userName)}!</p>
      <p style="margin:0 0 8px;font-size:16px;">Às <strong>${time}</strong> é hora de tomar:</p>
      <p style="margin:0 0 24px;font-size:22px;font-weight:bold;">${escapeHtml(reminder.medicationName)} <span style="font-weight:normal;color:#6b7280;">${escapeHtml(reminder.dosage)}</span></p>
      <a href="${escapeHtml(appUrl)}" style="display:inline-block;background:#111827;color:#ffffff;text-decoration:none;padding:12px 24px;border-radius:999px;font-size:15px;">Abrir o MedTracker</a>
      <p style="margin:24px 0 0;font-size:12px;color:#9ca3af;">Você pode mudar ou desligar estes lembretes no seu perfil.</p>
    </div>
  </body>
</html>`;

  return { subject, html, text };
}

let client: Resend | null = null;

export async function sendDoseReminder(reminder: DueReminder): Promise<void> {
  const apiKey = process.env.RESEND_API_KEY;
  const appUrl = process.env.APP_URL;
  if (!apiKey) throw new Error('RESEND_API_KEY não configurada');
  if (!appUrl) throw new Error('APP_URL não configurada');

  client ??= new Resend(apiKey);
  const { subject, html, text } = buildReminderEmail(reminder, appUrl);
  const { error } = await client.emails.send({ from: FROM, to: reminder.email, subject, html, text });
  if (error) throw new Error(`Resend: ${error.name} - ${error.message}`);
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `npm test && npm run build`
Expected: todos os testes passam e o build termina sem erros.

- [ ] **Step 6: Commit**

```bash
git add package.json package-lock.json src/lib/email.ts src/lib/email.test.ts
git commit -m "feat: e-mail de lembrete de dose via Resend"
```

---

### Task 4: Rota `GET /cron/reminders`

**Files:**
- Create: `src/routes/cron-routes.ts`
- Modify: `src/server.ts`

**Interfaces:**
- Consumes: `findDueReminders`, `ReminderCandidate` de `../lib/reminders.js`; `sendDoseReminder` de `../lib/email.js`; `medications`, `doses_history`, `user`, `reminders_sent` de `../schema.js`; `db` de `../db.js`.
- Produces: `cronRoutes(app: FastifyInstance): Promise<void>`; endpoint `GET /cron/reminders` → `401` sem segredo, `500` sem `CRON_SECRET`, `200 { checked, sent, skipped, failed }`.

- [ ] **Step 1: Criar a rota**

Criar `src/routes/cron-routes.ts`:

```ts
import type { FastifyInstance } from 'fastify';
import { db } from '../db.js';
import { doses_history, medications, reminders_sent, user } from '../schema.js';
import { eq, inArray, max } from 'drizzle-orm';
import { findDueReminders, type ReminderCandidate } from '../lib/reminders.js';
import { sendDoseReminder } from '../lib/email.js';

export async function cronRoutes(app: FastifyInstance) {
    // Called every 5 minutes by cron-job.org with the shared CRON_SECRET.
    app.get('/cron/reminders', async (request, reply) => {
        const secret = process.env.CRON_SECRET;
        if (!secret) {
            return reply.status(500).send({ error: 'CRON_SECRET não configurado' });
        }
        if (request.headers.authorization !== `Bearer ${secret}`) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        const rows = await db.select({
            medication: medications,
            user: {
                id: user.id,
                email: user.email,
                name: user.name,
                timezone: user.timezone,
                reminderEnabled: user.reminderEnabled,
                reminderLeadMinutes: user.reminderLeadMinutes,
            },
        })
            .from(medications)
            .innerJoin(user, eq(medications.userId, user.id))
            .where(eq(user.reminderEnabled, true));

        const medicationIds = rows.map((row) => row.medication.id);
        const lastDoses = medicationIds.length === 0 ? [] : await db.select({
            medicationId: doses_history.medicationId,
            lastTakenAt: max(doses_history.takenAt),
        })
            .from(doses_history)
            .where(inArray(doses_history.medicationId, medicationIds))
            .groupBy(doses_history.medicationId);

        const lastTakenByMedication = new Map(lastDoses.map((dose) => [dose.medicationId, dose.lastTakenAt]));

        const candidates: ReminderCandidate[] = rows.map((row) => ({
            medication: row.medication,
            lastDoseTakenAt: lastTakenByMedication.get(row.medication.id) ?? null,
            user: row.user,
        }));

        const due = findDueReminders(candidates, new Date());
        let sent = 0;
        let skipped = 0;
        let failed = 0;

        for (const reminder of due) {
            // Claim the slot first: the unique index guarantees a single email
            // per dose even if two cron runs overlap.
            const [claimed] = await db.insert(reminders_sent)
                .values({
                    medicationId: reminder.medicationId,
                    userId: reminder.userId,
                    scheduledFor: reminder.scheduledFor,
                })
                .onConflictDoNothing({ target: [reminders_sent.medicationId, reminders_sent.scheduledFor] })
                .returning({ id: reminders_sent.id });

            if (!claimed) {
                skipped++;
                continue;
            }

            try {
                await sendDoseReminder(reminder);
                sent++;
            } catch (error) {
                // Release the claim so the next run retries this dose.
                await db.delete(reminders_sent).where(eq(reminders_sent.id, claimed.id));
                failed++;
                app.log.error({ err: error, medicationId: reminder.medicationId }, 'Falha ao enviar lembrete');
            }
        }

        return reply.status(200).send({ checked: candidates.length, sent, skipped, failed });
    });
}
```

- [ ] **Step 2: Registrar no servidor**

Em `src/server.ts`, abaixo de `import { medicationsRoutes } from './routes/medication-routes.js';`:

```ts
import { cronRoutes } from './routes/cron-routes.js';
```

E abaixo de `app.register(medicationsRoutes);`:

```ts
app.register(cronRoutes);
```

- [ ] **Step 3: Compilar e testar**

Run: `npm run build && npm test`
Expected: build sem erros, todos os testes passam.

- [ ] **Step 4: Testar o segredo localmente**

O servidor local usa o banco de produção pelo `.env`, mas este teste não chega a consultar o banco.

Run (em um terminal): `CRON_SECRET=teste-local npm run dev`
Run (em outro):
```bash
curl -s -o /dev/null -w "%{http_code}\n" http://localhost:3333/cron/reminders
curl -s -o /dev/null -w "%{http_code}\n" -H "Authorization: Bearer errado" http://localhost:3333/cron/reminders
```
Expected: `401` e `401`. Parar o servidor depois.

- [ ] **Step 5: Commit**

```bash
git add src/routes/cron-routes.ts src/server.ts
git commit -m "feat: rota /cron/reminders que envia os lembretes no horário"
```

---

### Task 5: Preferências de lembrete no perfil (front)

Repositório: `/home/pedro/Documents/medtrackerproject/medtracker`.

**Files:**
- Modify: `src/lib/auth-client.ts`
- Modify: `src/pages/profile.tsx`

**Interfaces:**
- Consumes: campos `reminderEnabled: boolean` e `reminderLeadMinutes: number` do usuário (Task 1), atualizados via `authClient.updateUser`.

- [ ] **Step 1: Tipos no auth client**

Em `src/lib/auth-client.ts`, dentro de `inferAdditionalFields({ user: { ... } })`, abaixo de `timezone`:

```ts
                reminderEnabled: {
                    type: "boolean",
                    required: false,
                },
                reminderLeadMinutes: {
                    type: "number",
                    required: false,
                },
```

- [ ] **Step 2: Estado e handlers no perfil**

Em `src/pages/profile.tsx`, abaixo de `TIMEZONE_OPTIONS`:

```tsx
const REMINDER_LEAD_OPTIONS = [
    { value: 0, label: "Na hora" },
    { value: 5, label: "5 minutos antes" },
    { value: 10, label: "10 minutos antes" },
    { value: 15, label: "15 minutos antes" },
    { value: 30, label: "30 minutos antes" },
    { value: 60, label: "1 hora antes" },
];
```

Remover a linha `const [showAlertNotice, setShowAlertNotice] = useState(false);`.

Abaixo de `const timezoneLabel = ...`:

```tsx
    const reminderUser = session?.user as { reminderEnabled?: boolean; reminderLeadMinutes?: number } | undefined;
    const reminderEnabled = reminderUser?.reminderEnabled ?? true;
    const reminderLeadMinutes = reminderUser?.reminderLeadMinutes ?? 10;
```

Abaixo de `changeTimezone`:

```tsx
    const updateReminders = async (data: { reminderEnabled?: boolean; reminderLeadMinutes?: number }) => {
        setIsSaving(true);
        try {
            await authClient.updateUser(data);
            await refetch?.();
        } catch (error) {
            console.error('Erro ao atualizar lembretes:', error);
        } finally {
            setIsSaving(false);
        }
    };
```

- [ ] **Step 3: Trocar o botão "Preferências de Alerta" pela seção de lembretes**

Substituir o `<button onClick={() => setShowAlertNotice(true)} ...>...</button>` inteiro (o que mostra "Preferências de Alerta" e "Em breve") por:

```tsx
                <div className="p-4 rounded-[20px] bg-white/70 shadow-[0_4px_20px_rgba(0,0,0,0.06)] flex flex-col gap-2">
                    <div className="flex items-center gap-3">
                        <div className="w-10 h-10 rounded-full bg-tertiary flex items-center justify-center text-lg shrink-0">
                            🔔
                        </div>
                        <div className="flex-1">
                            <p className="font-medium text-gray-900">Lembretes por e-mail</p>
                            <p className="text-xs text-gray-500">{reminderEnabled ? "Ligados" : "Desligados"}</p>
                        </div>
                        <button
                            type="button"
                            role="switch"
                            aria-checked={reminderEnabled}
                            aria-label="Receber lembretes por e-mail"
                            onClick={() => updateReminders({ reminderEnabled: !reminderEnabled })}
                            disabled={isSaving}
                            className={`relative w-12 h-7 rounded-full transition-colors shrink-0 ${reminderEnabled ? "bg-primary" : "bg-gray-300"}`}
                        >
                            <span className={`absolute top-1 left-1 w-5 h-5 rounded-full bg-white transition-transform ${reminderEnabled ? "translate-x-5" : ""}`} />
                        </button>
                    </div>
                    <label className="text-xs text-gray-500 mt-2" htmlFor="reminder-lead">Avisar com antecedência de</label>
                    <select
                        id="reminder-lead"
                        value={reminderLeadMinutes}
                        onChange={(e) => updateReminders({ reminderLeadMinutes: Number(e.target.value) })}
                        disabled={isSaving || !reminderEnabled}
                        className="w-full rounded-full border border-input px-4 py-2 text-sm bg-transparent disabled:opacity-50"
                    >
                        {REMINDER_LEAD_OPTIONS.map((option) => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                    </select>
                </div>
```

- [ ] **Step 4: Compilar**

Run: `npm run build`
Expected: build sem erros de TypeScript.

- [ ] **Step 5: Commit**

```bash
git add src/lib/auth-client.ts src/pages/profile.tsx
git commit -m "feat: preferências de lembrete por e-mail no perfil"
```

---

### Task 6: Migração, deploy e cron (com o Pedro)

Cada passo marcado com **[ok do Pedro]** só acontece depois de ele confirmar.

- [ ] **Step 1: Migração [ok do Pedro]**

No repositório da API: `npm run db:push`
Expected: drizzle-kit mostra só a criação de `reminder_enabled`, `reminder_lead_minutes` e `reminders_sent` e do índice único. Se aparecer qualquer `DROP` ou alteração em outra coluna, parar e mostrar ao Pedro.

- [ ] **Step 2: Push da API [ok do Pedro]**

`git push origin main` na API. Acompanhar o deploy do projeto `medtracker-api` até `READY`.

- [ ] **Step 3: Conferir a rota em produção**

```bash
curl -s -o /dev/null -w "%{http_code}\n" https://medtracker-api.vercel.app/cron/reminders
```
Expected: `401`.

- [ ] **Step 4: Push do front [ok do Pedro]**

`git push origin main` no front. Acompanhar o deploy do projeto `medtracker` até `READY`.

- [ ] **Step 5: Configurar o cron-job.org (Pedro)**

- URL: `https://medtracker-api.vercel.app/cron/reminders`
- Método: GET, a cada 5 minutos.
- Cabeçalho: `Authorization: Bearer <CRON_SECRET>` (valor que está na Vercel).

Depois da primeira execução, o histórico do cron-job.org deve mostrar `200` com `{ checked, sent, skipped, failed }`.

- [ ] **Step 6: Teste de ponta a ponta (Pedro)**

Pedro cadastra um remédio de horário fixo para daqui a ~15 minutos, com antecedência de 10 minutos, e confirma que o e-mail chega uma única vez, vindo de `lembretes@clov.com.br`. Se não chegar: ver os logs de runtime do `medtracker-api` (`Falha ao enviar lembrete`) e o painel do Resend (domínio verificado?).
