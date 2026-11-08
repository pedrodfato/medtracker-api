# Duração do tratamento e resumo final — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Cada remédio tem uma duração em dias; quando a última dose prevista passa, o dashboard mostra um popup com o score `tomadas/previstas` e os dias com doses perdidas.

**Architecture:** Um módulo puro (`treatmentSummary.ts`) gera as doses previstas entre `startDate` e `endDate` e as compara com `doses_history`, agrupando por dia. As rotas de `medications` gravam `endDate` a partir de `durationDays` e devolvem `completed` + `treatmentSummary`. O frontend mostra o campo no formulário, um popup no dashboard e o selo "Concluído" na lista.

**Tech Stack:** Fastify 5, Drizzle ORM (Postgres), `node:test` + `tsx` (API); React 19, Vite, Tailwind (frontend).

**Repositórios:** `medtracker-api` e `medtracker` são repositórios git separados. Cada task diz em qual commitar. Spec: `docs/superpowers/specs/2026-11-08-treatment-duration-summary-design.md`.

## Global Constraints

- Duração em **número de dias**, obrigatória ao criar (inteiro de 1 a 365). O dia do cadastro é o dia 1.
- `endDate` = fim do dia N (`23:59:59.999`) no fuso do usuário.
- Dose tomada acima do previsto no dia **não** compensa dia perdido.
- O resumo usa os `daysOfWeek` atuais do remédio.
- Remédios sem `end_date` (antigos) seguem como hoje: sem popup, sem `completed`.
- Textos de interface em português do Brasil.
- Código da API no estilo existente: `.js` nos imports relativos, `noUncheckedIndexedAccess` ligado (use `?? 0` ou `!` ao indexar).
- Testes da API: `npm test` (`node --import tsx --test src/lib/*.test.ts`); todo arquivo de teste começa com `process.env.TZ = 'America/Sao_Paulo';`.
- Datas dos testes são em 2026-11 (02/11 é segunda-feira).

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `medtracker-api/src/lib/treatmentSummary.ts` | criar | cálculo puro: `parseDurationDays`, `computeEndDate`, `durationDaysFromRange`, `computeTreatmentSummary` |
| `medtracker-api/src/lib/treatmentSummary.test.ts` | criar | testes do módulo acima |
| `medtracker-api/src/lib/stats.ts` | alterar | exportar `dateKey`; parar de contar doses esperadas depois do `endDate` |
| `medtracker-api/src/lib/stats.test.ts` | alterar | teste do limite por `endDate` |
| `medtracker-api/src/schema.ts` | alterar | coluna `summary_dismissed_at` |
| `medtracker-api/src/routes/medication-routes.ts` | alterar | POST/PATCH/GET de medicamentos, rota de dismiss, `/stats` |
| `medtracker/src/types/medType.ts` | alterar | novos campos do tipo `Medication` |
| `medtracker/src/pages/addMedications.tsx` | alterar | campo "Por quantos dias?" |
| `medtracker/src/components/treatmentSummaryDialog.tsx` | criar | popup de resumo |
| `medtracker/src/pages/dashboard.tsx` | alterar | filtra concluídos, abre o popup, dismiss |
| `medtracker/src/pages/medicationList.tsx` | alterar | selo "Concluído" e score |

---

### Task 1: Módulo puro de resumo do tratamento

**Files:**
- Modify: `medtracker-api/src/lib/stats.ts` (exportar `dateKey`)
- Create: `medtracker-api/src/lib/treatmentSummary.ts`
- Test: `medtracker-api/src/lib/treatmentSummary.test.ts`

**Interfaces:**
- Consumes: `dateKey(d: Date): string` de `stats.ts`; `toProcessZone`/`fromProcessZone` de `timezone.ts`.
- Produces (usados nas Tasks 3 e seguintes):
  - `MAX_DURATION_DAYS = 365`
  - `parseDurationDays(value: unknown): number | null`
  - `computeEndDate(startDate: Date, durationDays: number, diffMinutes: number): Date`
  - `durationDaysFromRange(startDate: Date, endDate: Date, diffMinutes: number): number`
  - `type SummaryMedication = { scheduleType: 'fixed'|'interval'|'weekly'; fixedTime: string|null; intervalHours: number|null; daysOfWeek: number[]|null; startDate: Date; endDate: Date }`
  - `type SummaryDose = { takenAt: Date }`
  - `type MissedDay = { date: string; missed: number; expected: number }`
  - `type TreatmentSummary = { expected: number; taken: number; perfect: boolean; missedDays: MissedDay[]; readyAt: Date }`
  - `computeTreatmentSummary(medication: SummaryMedication, doses: SummaryDose[]): TreatmentSummary`
  - Todas as datas de `computeTreatmentSummary` já vêm deslocadas com `toProcessZone` (mesma convenção de `stats.ts`). `readyAt` é a última dose prevista, ou o próprio `endDate` se não houver nenhuma.

- [ ] **Step 1: Exportar `dateKey` em `stats.ts`**

Em `medtracker-api/src/lib/stats.ts`, trocar `function dateKey(d: Date): string {` por:

```ts
export function dateKey(d: Date): string {
```

- [ ] **Step 2: Escrever os testes que falham**

Criar `medtracker-api/src/lib/treatmentSummary.test.ts`:

```ts
process.env.TZ = 'America/Sao_Paulo';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  computeEndDate,
  computeTreatmentSummary,
  durationDaysFromRange,
  parseDurationDays,
  type SummaryMedication,
} from './treatmentSummary.js';

const at = (iso: string) => new Date(iso);
const doses = (...isos: string[]) => isos.map((iso) => ({ takenAt: at(iso) }));

function med(startIso: string, days: number, overrides: Partial<SummaryMedication> = {}): SummaryMedication {
  const startDate = at(startIso);
  return {
    scheduleType: 'fixed',
    fixedTime: '08:00',
    intervalHours: null,
    daysOfWeek: null,
    startDate,
    endDate: computeEndDate(startDate, days, 0),
    ...overrides,
  };
}

test('parseDurationDays: aceita inteiros de 1 a 365, número ou texto', () => {
  assert.equal(parseDurationDays(10), 10);
  assert.equal(parseDurationDays('10'), 10);
  assert.equal(parseDurationDays(365), 365);
  assert.equal(parseDurationDays(0), null);
  assert.equal(parseDurationDays(-1), null);
  assert.equal(parseDurationDays(366), null);
  assert.equal(parseDurationDays(1.5), null);
  assert.equal(parseDurationDays('abc'), null);
  assert.equal(parseDurationDays(''), null);
  assert.equal(parseDurationDays(undefined), null);
  assert.equal(parseDurationDays(null), null);
});

test('computeEndDate: fim do dia N no fuso do processo', () => {
  const end = computeEndDate(at('2026-11-02T15:00:00-03:00'), 10, 0);
  assert.equal(end.toISOString(), at('2026-11-11T23:59:59.999-03:00').toISOString());
});

test('computeEndDate: respeita o fuso do usuário (Manaus, UTC-4)', () => {
  // 15:00 em São Paulo = 14:00 em Manaus; o dia 10 termina às 23:59:59.999 de Manaus.
  const end = computeEndDate(at('2026-11-02T15:00:00-03:00'), 10, -60);
  assert.equal(end.toISOString(), at('2026-11-11T23:59:59.999-04:00').toISOString());
});

test('durationDaysFromRange: inverso de computeEndDate', () => {
  const start = at('2026-11-02T15:00:00-03:00');
  assert.equal(durationDaysFromRange(start, computeEndDate(start, 10, 0), 0), 10);
  assert.equal(durationDaysFromRange(start, computeEndDate(start, 10, -60), -60), 10);
  assert.equal(durationDaysFromRange(start, computeEndDate(start, 1, 0), 0), 1);
});

test('fixed: tratamento perfeito', () => {
  const summary = computeTreatmentSummary(
    med('2026-11-02T07:00:00-03:00', 3),
    doses('2026-11-02T08:05:00-03:00', '2026-11-03T08:02:00-03:00', '2026-11-04T08:10:00-03:00'),
  );
  assert.equal(summary.expected, 3);
  assert.equal(summary.taken, 3);
  assert.equal(summary.perfect, true);
  assert.deepEqual(summary.missedDays, []);
  assert.equal(summary.readyAt.toISOString(), at('2026-11-04T08:00:00-03:00').toISOString());
});

test('fixed: cadastro depois do horário do dia não conta a dose já passada', () => {
  const summary = computeTreatmentSummary(med('2026-11-02T09:00:00-03:00', 3), []);
  assert.equal(summary.expected, 2);
  assert.deepEqual(summary.missedDays.map((d) => d.date), ['2026-11-03', '2026-11-04']);
});

test('fixed: lista o dia com dose perdida', () => {
  const summary = computeTreatmentSummary(
    med('2026-11-02T07:00:00-03:00', 3),
    doses('2026-11-02T08:05:00-03:00', '2026-11-04T08:10:00-03:00'),
  );
  assert.equal(summary.taken, 2);
  assert.equal(summary.perfect, false);
  assert.deepEqual(summary.missedDays, [{ date: '2026-11-03', missed: 1, expected: 1 }]);
});

test('fixed: dose extra no dia não compensa dia perdido', () => {
  const summary = computeTreatmentSummary(
    med('2026-11-02T07:00:00-03:00', 3),
    doses('2026-11-02T08:05:00-03:00', '2026-11-02T20:00:00-03:00', '2026-11-04T08:10:00-03:00'),
  );
  assert.equal(summary.taken, 2);
  assert.deepEqual(summary.missedDays, [{ date: '2026-11-03', missed: 1, expected: 1 }]);
});

test('doses fora do período do tratamento são ignoradas', () => {
  const summary = computeTreatmentSummary(
    med('2026-11-02T07:00:00-03:00', 3),
    doses('2026-11-02T08:05:00-03:00', '2026-11-05T08:00:00-03:00'),
  );
  assert.equal(summary.taken, 1);
});

test('interval: agrupa a grade de horários por dia', () => {
  const summary = computeTreatmentSummary(
    med('2026-11-02T08:00:00-03:00', 2, { scheduleType: 'interval', fixedTime: null, intervalHours: 8 }),
    doses(
      '2026-11-02T08:05:00-03:00',
      '2026-11-02T16:10:00-03:00',
      '2026-11-03T00:10:00-03:00',
      '2026-11-03T08:05:00-03:00',
    ),
  );
  // Grade: 02/11 08h e 16h; 03/11 00h, 08h e 16h.
  assert.equal(summary.expected, 5);
  assert.equal(summary.taken, 4);
  assert.deepEqual(summary.missedDays, [{ date: '2026-11-03', missed: 1, expected: 3 }]);
  assert.equal(summary.readyAt.toISOString(), at('2026-11-03T16:00:00-03:00').toISOString());
});

test('weekly com vários dias: só conta os dias escolhidos', () => {
  const summary = computeTreatmentSummary(
    med('2026-11-02T07:00:00-03:00', 7, { scheduleType: 'weekly', daysOfWeek: [1, 3, 5] }),
    doses('2026-11-02T08:00:00-03:00', '2026-11-06T08:00:00-03:00'),
  );
  assert.equal(summary.expected, 3);
  assert.equal(summary.taken, 2);
  assert.deepEqual(summary.missedDays, [{ date: '2026-11-04', missed: 1, expected: 1 }]);
});

test('weekly com um dia só: tomar em outro dia da mesma semana conta (drift)', () => {
  // daysOfWeek atual = [quinta]; a primeira dose foi tomada na quarta, antes do ajuste.
  const summary = computeTreatmentSummary(
    med('2026-11-02T07:00:00-03:00', 14, { scheduleType: 'weekly', daysOfWeek: [4] }),
    doses('2026-11-04T08:00:00-03:00', '2026-11-12T08:00:00-03:00'),
  );
  assert.equal(summary.expected, 2);
  assert.equal(summary.taken, 2);
  assert.equal(summary.perfect, true);
});

test('weekly com um dia só: semana sem dose aparece como perdida', () => {
  const summary = computeTreatmentSummary(
    med('2026-11-02T07:00:00-03:00', 14, { scheduleType: 'weekly', daysOfWeek: [4] }),
    doses('2026-11-04T08:00:00-03:00'),
  );
  assert.equal(summary.taken, 1);
  assert.deepEqual(summary.missedDays, [{ date: '2026-11-12', missed: 1, expected: 1 }]);
});

test('sem nenhuma dose prevista: perfeito e pronto no fim do período', () => {
  const m = med('2026-11-02T07:00:00-03:00', 3, { scheduleType: 'weekly', daysOfWeek: [] });
  const summary = computeTreatmentSummary(m, []);
  assert.equal(summary.expected, 0);
  assert.equal(summary.perfect, true);
  assert.equal(summary.readyAt.getTime(), m.endDate.getTime());
});
```

- [ ] **Step 3: Rodar os testes e ver falhar**

Run: `cd /home/pedro/Documents/medtrackerproject/medtracker-api && node --import tsx --test src/lib/treatmentSummary.test.ts`
Expected: FAIL — `Cannot find module './treatmentSummary.js'`.

- [ ] **Step 4: Implementar o módulo**

Criar `medtracker-api/src/lib/treatmentSummary.ts`:

```ts
import { dateKey } from './stats.js';
import { fromProcessZone, toProcessZone } from './timezone.js';

export const MAX_DURATION_DAYS = 365;

const DAY_MS = 24 * 60 * 60 * 1000;

export type SummaryMedication = {
  scheduleType: 'fixed' | 'interval' | 'weekly';
  fixedTime: string | null;
  intervalHours: number | null;
  daysOfWeek: number[] | null;
  startDate: Date;
  endDate: Date;
};
export type SummaryDose = { takenAt: Date };
export type MissedDay = { date: string; missed: number; expected: number };
export type TreatmentSummary = {
  expected: number;
  taken: number;
  perfect: boolean;
  missedDays: MissedDay[];
  readyAt: Date;
};

export function parseDurationDays(value: unknown): number | null {
  const n: unknown = typeof value === 'string' && value.trim() !== '' ? Number(value) : value;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > MAX_DURATION_DAYS) return null;
  return n;
}

// End of day N (day 1 = the day the medication starts) in the user's zone.
export function computeEndDate(startDate: Date, durationDays: number, diffMinutes: number): Date {
  const local = toProcessZone(startDate, diffMinutes);
  local.setDate(local.getDate() + durationDays - 1);
  local.setHours(23, 59, 59, 999);
  return fromProcessZone(local, diffMinutes);
}

export function durationDaysFromRange(startDate: Date, endDate: Date, diffMinutes: number): number {
  const start = toProcessZone(startDate, diffMinutes);
  start.setHours(0, 0, 0, 0);
  const end = toProcessZone(endDate, diffMinutes);
  end.setHours(0, 0, 0, 0);
  return Math.round((end.getTime() - start.getTime()) / DAY_MS) + 1;
}

function dayStartMs(d: Date): number {
  const copy = new Date(d);
  copy.setHours(0, 0, 0, 0);
  return copy.getTime();
}

// Every dose the schedule expects between startDate and endDate, oldest first.
// Mirrors nextDose.ts: with no dose taken yet, the first one is the first slot
// at or after startDate.
function expectedSlots(m: SummaryMedication): Date[] {
  const slots: Date[] = [];
  const startMs = m.startDate.getTime();
  const endMs = m.endDate.getTime();

  if (m.scheduleType === 'interval') {
    if (!m.intervalHours) return slots;
    const step = m.intervalHours * 60 * 60 * 1000;
    for (let t = startMs; t <= endMs; t += step) slots.push(new Date(t));
    return slots;
  }

  if (!m.fixedTime) return slots;
  if (m.scheduleType === 'weekly' && (!m.daysOfWeek || m.daysOfWeek.length === 0)) return slots;

  const [hours = 0, minutes = 0] = m.fixedTime.split(':').map(Number);
  const cursor = new Date(m.startDate);
  cursor.setHours(0, 0, 0, 0);
  while (cursor.getTime() <= endMs) {
    const slot = new Date(cursor);
    slot.setHours(hours, minutes, 0, 0);
    const onScheduledDay = m.scheduleType === 'fixed' || m.daysOfWeek!.includes(slot.getDay());
    if (onScheduledDay && slot.getTime() >= startMs && slot.getTime() <= endMs) slots.push(slot);
    cursor.setDate(cursor.getDate() + 1);
  }
  return slots;
}

export function computeTreatmentSummary(m: SummaryMedication, doses: SummaryDose[]): TreatmentSummary {
  const slots = expectedSlots(m);

  // A once-a-week medication moves to whichever weekday it was actually taken
  // on (see driftedWeeklyDaysOfWeek), so it is matched per 7-day block counted
  // from the start date; every other schedule is matched per calendar day.
  const perWeek = m.scheduleType === 'weekly' && m.daysOfWeek?.length === 1;
  const startDay = dayStartMs(m.startDate);
  const bucketOf = (d: Date): string =>
    perWeek ? `w${Math.floor(Math.round((dayStartMs(d) - startDay) / DAY_MS) / 7)}` : dateKey(d);

  const expectedByBucket = new Map<string, { date: string; count: number }>();
  for (const slot of slots) {
    const key = bucketOf(slot);
    const entry = expectedByBucket.get(key);
    if (entry) entry.count += 1;
    else expectedByBucket.set(key, { date: dateKey(slot), count: 1 });
  }

  const takenByBucket = new Map<string, number>();
  for (const dose of doses) {
    const t = dose.takenAt.getTime();
    if (t < m.startDate.getTime() || t > m.endDate.getTime()) continue;
    const key = bucketOf(dose.takenAt);
    takenByBucket.set(key, (takenByBucket.get(key) ?? 0) + 1);
  }

  let taken = 0;
  const missedDays: MissedDay[] = [];
  for (const [key, { date, count }] of expectedByBucket) {
    const takenInBucket = Math.min(takenByBucket.get(key) ?? 0, count);
    taken += takenInBucket;
    if (takenInBucket < count) missedDays.push({ date, missed: count - takenInBucket, expected: count });
  }

  return {
    expected: slots.length,
    taken,
    perfect: missedDays.length === 0,
    missedDays,
    readyAt: slots.length > 0 ? slots[slots.length - 1]! : m.endDate,
  };
}
```

- [ ] **Step 5: Rodar os testes e ver passar**

Run: `cd /home/pedro/Documents/medtrackerproject/medtracker-api && node --import tsx --test src/lib/treatmentSummary.test.ts`
Expected: todos os testes PASS (14 testes). Se um teste de fuso falhar, confira se o arquivo começa com `process.env.TZ = 'America/Sao_Paulo';`.

- [ ] **Step 6: Rodar a suíte inteira e o typecheck**

Run: `cd /home/pedro/Documents/medtrackerproject/medtracker-api && npm test && npx tsc --noEmit`
Expected: todos os testes PASS, `tsc` sem erros.

- [ ] **Step 7: Commit (repositório `medtracker-api`)**

```bash
cd /home/pedro/Documents/medtrackerproject/medtracker-api
git add src/lib/stats.ts src/lib/treatmentSummary.ts src/lib/treatmentSummary.test.ts
git commit -m "feat: cálculo puro do resumo do tratamento

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 2: Estatísticas param de esperar doses depois do fim do tratamento

Sem isso, um remédio concluído continua acumulando "doses perdidas" nos insights do dashboard, porque `stats.ts` hoje conta doses esperadas até `now` sem olhar `endDate`.

**Files:**
- Modify: `medtracker-api/src/lib/stats.ts` (tipo `StatsMedication` e `expectedDosesInWindow`)
- Test: `medtracker-api/src/lib/stats.test.ts`

**Interfaces:**
- Consumes: nada novo.
- Produces: `StatsMedication.endDate?: Date | null` (opcional, para não quebrar chamadores e testes existentes). Usado pela Task 3 em `/stats`.

- [ ] **Step 1: Escrever o teste que falha**

Ver o início de `stats.test.ts` para reaproveitar os imports já existentes:

Run: `sed -n 1,25p /home/pedro/Documents/medtrackerproject/medtracker-api/src/lib/stats.test.ts`

Acrescentar ao final do arquivo (ajustando o nome do import `computeStats` se o arquivo importar de outra forma):

```ts
test('computeStats: não espera doses depois do endDate do tratamento', () => {
  const stats = computeStats(
    [{
      id: 1,
      scheduleType: 'fixed',
      intervalHours: null,
      daysOfWeek: null,
      startDate: new Date('2026-11-01T08:00:00-03:00'),
      endDate: new Date('2026-11-03T23:59:59.999-03:00'),
    }],
    [],
    new Date('2026-11-08T12:00:00-03:00'),
  );
  // Janela da semana começa em 02/11; o tratamento só vai até 03/11 (2 dias).
  assert.equal(stats.missedDoses, 2);
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /home/pedro/Documents/medtrackerproject/medtracker-api && node --import tsx --test src/lib/stats.test.ts`
Expected: FAIL — erro de tipo/valor, `missedDoses` é 7 em vez de 2 (o tsx pode reclamar de `endDate` desconhecido só no typecheck; o assert falha de qualquer forma).

- [ ] **Step 3: Implementar**

Em `stats.ts`, no tipo `StatsMedication`, acrescentar após `startDate: Date;`:

```ts
  endDate?: Date | null;
```

Em `expectedDosesInWindow`, trocar a assinatura e o início da função. Antes:

```ts
function expectedDosesInWindow(medication: StatsMedication, windowStart: Date, now: Date): number {
  const effectiveStart = medication.startDate.getTime() > windowStart.getTime() ? medication.startDate : windowStart;
  if (effectiveStart.getTime() > now.getTime()) return 0;

  const daysInWindow = daysBetweenInclusive(effectiveStart, now);
```

Depois:

```ts
function expectedDosesInWindow(medication: StatsMedication, windowStart: Date, now: Date): number {
  const effectiveStart = medication.startDate.getTime() > windowStart.getTime() ? medication.startDate : windowStart;
  // A finished treatment stops expecting doses at its end date.
  const until = medication.endDate && medication.endDate.getTime() < now.getTime() ? medication.endDate : now;
  if (effectiveStart.getTime() > until.getTime()) return 0;

  const daysInWindow = daysBetweenInclusive(effectiveStart, until);
```

Mais abaixo, no ramo `interval`, trocar `now.getTime() - effectiveStart.getTime()` por `until.getTime() - effectiveStart.getTime()`:

```ts
    const hoursInWindow = (until.getTime() - effectiveStart.getTime()) / (60 * 60 * 1000);
```

- [ ] **Step 4: Rodar e ver passar**

Run: `cd /home/pedro/Documents/medtrackerproject/medtracker-api && npm test && npx tsc --noEmit`
Expected: todos PASS (os testes antigos de `stats` continuam verdes, pois `endDate` é opcional).

- [ ] **Step 5: Commit (`medtracker-api`)**

```bash
cd /home/pedro/Documents/medtrackerproject/medtracker-api
git add src/lib/stats.ts src/lib/stats.test.ts
git commit -m "fix: estatísticas não esperam doses depois do fim do tratamento

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Schema e rotas da API

**Files:**
- Modify: `medtracker-api/src/schema.ts` (tabela `medications`)
- Modify: `medtracker-api/src/routes/medication-routes.ts`

**Interfaces:**
- Consumes (Task 1): `parseDurationDays`, `computeEndDate`, `durationDaysFromRange`, `computeTreatmentSummary`. (Task 2): `StatsMedication.endDate`.
- Produces (usado pelo frontend, Tasks 4–6):
  - `POST /medications` aceita `durationDays` (obrigatório; 400 se inválido).
  - `PATCH /medications/:id` aceita `durationDays` opcional.
  - `GET /medications` devolve, por item, além dos campos atuais: `durationDays: number | null`, `completed: boolean`, `treatmentSummary: { expected, taken, perfect, missedDays: {date, missed, expected}[], dismissed: boolean } | null`. Para remédios concluídos, `nextDoseAt` é `null`.
  - `POST /medications/:id/summary/dismiss` → 200 `{ message }` ou 404.

- [ ] **Step 1: Adicionar a coluna ao schema**

Em `medtracker-api/src/schema.ts`, na tabela `medications`, acrescentar depois da linha de `graceWindowMinutes`:

```ts
  summaryDismissedAt: timestamp('summary_dismissed_at'),
```

- [ ] **Step 2: Aplicar no banco**

O projeto usa `drizzle-kit push` (não há pasta de migrações). O `.env` aponta para o banco configurado em `dbURL`. **Antes de rodar, confirme com o Pedro qual banco é esse (local ou produção).** Depois:

Run: `cd /home/pedro/Documents/medtrackerproject/medtracker-api && npm run db:push`
Expected: o drizzle-kit mostra a adição da coluna `summary_dismissed_at` em `medications`; confirmar quando perguntar. Nenhuma coluna removida.

- [ ] **Step 3: Imports em `medication-routes.ts`**

Acrescentar abaixo do import de `computeStats`:

```ts
import {
    computeEndDate,
    computeTreatmentSummary,
    durationDaysFromRange,
    parseDurationDays,
} from '../lib/treatmentSummary.js';
```

- [ ] **Step 4: `POST /medications` grava o `endDate`**

Na rota `app.post('/medications'`, trocar o bloco `try { await db.insert(...) ... }` e acrescentar a validação logo depois do `const userId = session.user.id;`. O trecho final da rota fica:

```ts
    const userId = session.user.id;

    const durationDays = parseDurationDays(request.body && (request.body as any).durationDays);
    if (durationDays === null) {
        return reply.status(400).send({ error: 'Informe a duração do tratamento em dias (de 1 a 365).' });
    }
    const diff = offsetDiffMinutes((session.user as any).timezone ?? DEFAULT_TIMEZONE);
    const start = new Date(startDate);

    try {
        await db.insert(medications).values({
            name,
            dosage,
            totalPills,
            category,
            scheduleType,
            intervalHours,
            fixedTime,
            daysOfWeek,
            graceWindowMinutes,
            startDate: start,
            endDate: computeEndDate(start, durationDays, diff),
            userId: userId,
        });
```

(o `return reply.status(201)...` e o `catch` continuam como estão).

- [ ] **Step 5: `GET /medications` devolve `completed` e `treatmentSummary`**

Substituir o corpo do `userMeds.map(async (med) => { ... })` (do `const [lastDose]` até o `return { ...med, ... }`) por:

```ts
            const [lastDose] = await db.select()
                .from(doses_history)
                .where(eq(doses_history.medicationId, med.id))
                .orderBy(desc(doses_history.takenAt))
                .limit(1);

            const nextDoseDate = computeNextDueAt(
                {
                    scheduleType: med.scheduleType,
                    fixedTime: med.fixedTime,
                    intervalHours: med.intervalHours,
                    daysOfWeek: med.daysOfWeek,
                    startDate: toProcessZone(med.startDate, diff),
                },
                lastDose ? toProcessZone(lastDose.takenAt, diff) : null
            );
            const nextDoseAt = nextDoseDate ? fromProcessZone(nextDoseDate, diff).toISOString() : null;

            let durationDays: number | null = null;
            let completed = false;
            let treatmentSummary = null;

            if (med.endDate) {
                durationDays = durationDaysFromRange(med.startDate, med.endDate, diff);
                const medDoses = await db.select()
                    .from(doses_history)
                    .where(eq(doses_history.medicationId, med.id));
                const summary = computeTreatmentSummary(
                    {
                        scheduleType: med.scheduleType,
                        fixedTime: med.fixedTime,
                        intervalHours: med.intervalHours,
                        daysOfWeek: med.daysOfWeek,
                        startDate: toProcessZone(med.startDate, diff),
                        endDate: toProcessZone(med.endDate, diff),
                    },
                    medDoses.map((d) => ({ takenAt: toProcessZone(d.takenAt, diff) })),
                );
                // Treatment is over once its last expected dose time has passed.
                completed = toProcessZone(new Date(), diff).getTime() > summary.readyAt.getTime();
                if (completed) {
                    treatmentSummary = {
                        expected: summary.expected,
                        taken: summary.taken,
                        perfect: summary.perfect,
                        missedDays: summary.missedDays,
                        dismissed: med.summaryDismissedAt !== null,
                    };
                }
            }

            return {
                ...med,
                nextDoseAt: completed ? null : nextDoseAt,
                lastTakenAt: lastDose ? lastDose.takenAt.toISOString() : null,
                durationDays,
                completed,
                treatmentSummary,
            };
```

- [ ] **Step 6: `PATCH /medications/:id` aceita `durationDays`**

Na rota `app.patch('/medications/:id'`, substituir da linha `const { name, dosage, category, ...` até o `await db.update(...)` inclusive por:

```ts
        const { name, dosage, category, scheduleType, daysOfWeek, fixedTime, durationDays: rawDuration } = request.body as any;

        let endDateUpdate: { endDate?: Date; summaryDismissedAt?: null } = {};
        if (rawDuration !== undefined && rawDuration !== null && rawDuration !== '') {
            const durationDays = parseDurationDays(rawDuration);
            if (durationDays === null) {
                return reply.status(400).send({ error: 'Informe a duração do tratamento em dias (de 1 a 365).' });
            }
            const diff = offsetDiffMinutes((session.user as any).timezone ?? DEFAULT_TIMEZONE);
            const newEndDate = computeEndDate(medication.startDate, durationDays, diff);
            // Extending a finished treatment makes its summary relevant again.
            endDateUpdate = newEndDate.getTime() > Date.now()
                ? { endDate: newEndDate, summaryDismissedAt: null }
                : { endDate: newEndDate };
        }

        try {
            await db.update(medications)
                .set({ name, dosage, category, scheduleType, daysOfWeek, fixedTime, ...endDateUpdate })
                .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)));
```

(o `return reply.status(200)...` e o `catch` seguintes continuam iguais).

- [ ] **Step 7: Rota de dismiss**

Acrescentar logo antes de `app.delete('/medications/:id'`:

```ts
    app.post('/medications/:id/summary/dismiss', {preHandler: [verifySession]}, async (request, reply) => {
        const {id} = request.params as {id: string};
        const medicationId = Number(id);

        if (Number.isNaN(medicationId)) {
            return reply.status(400).send({ error: 'Invalid medication id' });
        }

        const session = await auth.api.getSession({headers: request.headers as any});

        if (!session || !session.user) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        try {
            const updated = await db.update(medications)
                .set({ summaryDismissedAt: new Date() })
                .where(and(eq(medications.id, medicationId), eq(medications.userId, session.user.id)))
                .returning({ id: medications.id });

            if (updated.length === 0) {
                return reply.status(404).send({ error: 'Medicamento não encontrado' });
            }

            return reply.status(200).send({ message: 'Resumo dispensado.' });
        } catch (error) {
            console.error('Erro ao dispensar resumo:', error);
            return reply.status(500).send({ error: 'Ocorreu um erro ao dispensar o resumo.' });
        }
    })
```

- [ ] **Step 8: `/stats` respeita o `endDate`**

Em `toStatsMedication` (rota `app.get('/stats'`), acrescentar a linha após `startDate`:

```ts
                endDate: m.endDate ? toProcessZone(m.endDate, diff) : null,
```

- [ ] **Step 9: Typecheck e testes**

Run: `cd /home/pedro/Documents/medtrackerproject/medtracker-api && npx tsc --noEmit && npm test`
Expected: `tsc` sem erros; todos os testes PASS.

- [ ] **Step 10: Verificar a API de verdade**

Run: `cd /home/pedro/Documents/medtrackerproject/medtracker-api && (npm run dev > /tmp/claude-1000/-home-pedro-Documents-medtrackerproject/a7c6f331-213b-42ed-b95c-556ed1805dd1/scratchpad/api.log 2>&1 &) ; sleep 4; curl -s -o /dev/null -w "%{http_code}\n" -X POST localhost:3333/medications -H 'Content-Type: application/json' -d '{}'`
Expected: `401` (rota protegida; confirma que o servidor sobe com as rotas novas). A validação de `durationDays` e o fluxo completo são exercitados na verificação manual da Task 6, com login. Depois, encerrar o servidor: `pkill -f "tsx watch src/server.ts"`.

- [ ] **Step 11: Commit (`medtracker-api`)**

```bash
cd /home/pedro/Documents/medtrackerproject/medtracker-api
git add src/schema.ts src/routes/medication-routes.ts
git commit -m "feat: duração do tratamento e resumo final nas rotas de medicamentos

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Frontend — tipo e campo "Por quantos dias?"

**Files:**
- Modify: `medtracker/src/types/medType.ts`
- Modify: `medtracker/src/pages/addMedications.tsx`

**Interfaces:**
- Consumes (Task 3): resposta de `GET /medications` com `durationDays`, `completed`, `treatmentSummary`; `POST/PATCH` aceitam `durationDays`.
- Produces (Tasks 5 e 6): tipos `TreatmentSummary` e os campos novos em `Medication`.

- [ ] **Step 1: Tipos**

Substituir o conteúdo de `medtracker/src/types/medType.ts` por:

```ts
export interface TreatmentSummary {
    expected: number;
    taken: number;
    perfect: boolean;
    missedDays: { date: string; missed: number; expected: number }[];
    dismissed: boolean;
}

export interface Medication {
id: string;
    name: string;
    dosage: string;
    category: 'pill' | 'drop' | 'vitamin';
    scheduleType: 'fixed' | 'interval' | 'weekly';
    intervalHours: number | null;
    fixedTime: string | null;
    daysOfWeek?: number[] | null;
    lastTakenAt?: string | null;
    nextDoseAt?: string;
    durationDays?: number | null;
    completed?: boolean;
    treatmentSummary?: TreatmentSummary | null;
}
```

- [ ] **Step 2: Estado e validação no formulário**

Em `addMedications.tsx`, depois da linha do `useState` de `intervalHours`, acrescentar:

```tsx
    const [durationDays, setDurationDays] = useState(editingMedication?.durationDays?.toString() ?? "");
```

Em `handleSubmit`, logo depois do bloco que valida `parsedIntervalHours`, acrescentar:

```tsx
        // Na edição, deixar vazio mantém a duração atual (remédios antigos não têm uma).
        const parsedDuration = durationDays.trim() === "" ? null : Number(durationDays);
        if (parsedDuration === null && !isEditMode) {
            setErrorMsg("Informe por quantos dias você vai tomar o remédio.");
            return;
        }
        if (parsedDuration !== null && (!Number.isInteger(parsedDuration) || parsedDuration < 1 || parsedDuration > 365)) {
            setErrorMsg("A duração deve ser um número inteiro de 1 a 365 dias.");
            return;
        }
```

Depois do objeto `body` (logo após `startDate: new Date().toISOString(),\n            };`), acrescentar:

```tsx
            if (parsedDuration !== null) {
                body.durationDays = parsedDuration;
            }
```

- [ ] **Step 3: Campo na tela**

Inserir entre o bloco "Categoria" e o bloco `bg-gray-50 ... Frequência e Horário`:

```tsx
                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Por quantos dias?</label>
                        <div className="flex items-center gap-2">
                            <Input
                                required={!isEditMode}
                                type="number"
                                min={1}
                                max={365}
                                placeholder="Ex: 10"
                                value={durationDays}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDurationDays(e.target.value)}
                                className="max-w-24"
                            />
                            <span className="text-sm text-gray-500">dias</span>
                        </div>
                        <p className="text-xs text-gray-500 mt-1">Conforme a receita. Hoje conta como o dia 1.</p>
                    </div>
```

- [ ] **Step 4: Build e lint**

Run: `cd /home/pedro/Documents/medtrackerproject/medtracker && npm run build && npx eslint src/pages/addMedications.tsx src/types/medType.ts`
Expected: build conclui sem erros de tipo; eslint sem erros novos.

- [ ] **Step 5: Commit (repositório `medtracker`)**

```bash
cd /home/pedro/Documents/medtrackerproject/medtracker
git add src/types/medType.ts src/pages/addMedications.tsx
git commit -m "feat: campo de duração do tratamento no cadastro de remédio

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Frontend — popup de resumo no dashboard

**Files:**
- Create: `medtracker/src/components/treatmentSummaryDialog.tsx`
- Modify: `medtracker/src/pages/dashboard.tsx`

**Interfaces:**
- Consumes (Task 4): `Medication`, `TreatmentSummary`. (Task 3): `POST /medications/:id/summary/dismiss`.
- Produces: `TreatmentSummaryDialog` com props `{ medicationName: string; summary: TreatmentSummary; isDismissing: boolean; onDismiss: () => void }`.

- [ ] **Step 1: Criar o componente**

Criar `medtracker/src/components/treatmentSummaryDialog.tsx`:

```tsx
import type { TreatmentSummary } from "../types/medType";
import { Button } from "./button";

type Props = {
    medicationName: string;
    summary: TreatmentSummary;
    isDismissing: boolean;
    onDismiss: () => void;
};

const formatDay = (date: string) =>
    new Date(`${date}T12:00:00`).toLocaleDateString("pt-BR", { weekday: "short", day: "2-digit", month: "2-digit" });

export function TreatmentSummaryDialog({ medicationName, summary, isDismissing, onDismiss }: Props) {
    return (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-6">
            <div
                role="dialog"
                aria-modal="true"
                aria-labelledby="treatment-summary-title"
                className="w-full max-w-sm max-h-[85vh] overflow-y-auto rounded-[24px] bg-white p-6 shadow-xl flex flex-col gap-4"
            >
                <h2 id="treatment-summary-title" className="text-lg font-semibold text-gray-900">
                    Tratamento concluído: {medicationName}
                </h2>

                <div className="rounded-2xl bg-gray-50 p-4 text-center">
                    <p className="text-4xl font-semibold text-gray-900">
                        {summary.taken}/{summary.expected}
                    </p>
                    <p className="text-sm text-gray-500">doses tomadas no período</p>
                </div>

                {summary.perfect ? (
                    <p className="text-gray-700">
                        Você tomou o remédio corretamente em todos os dias. Parabéns!
                    </p>
                ) : (
                    <>
                        <p className="text-gray-700">
                            Você não tomou todas as doses. Estes foram os dias com doses perdidas:
                        </p>
                        <ul className="flex flex-col gap-1">
                            {summary.missedDays.map((day) => (
                                <li key={day.date} className="flex justify-between text-sm text-gray-700">
                                    <span className="capitalize">{formatDay(day.date)}</span>
                                    <span className="text-gray-500">
                                        {day.missed} de {day.expected} {day.expected === 1 ? "dose" : "doses"}
                                    </span>
                                </li>
                            ))}
                        </ul>
                    </>
                )}

                <Button className="w-full" onClick={onDismiss} disabled={isDismissing}>
                    Entendi
                </Button>
            </div>
        </div>
    );
}
```

- [ ] **Step 2: Integrar no dashboard — import e estado**

Em `dashboard.tsx`, acrescentar abaixo do import de `Button`:

```tsx
import { TreatmentSummaryDialog } from "../components/treatmentSummaryDialog";
```

E abaixo de `const [isUndoing, setIsUndoing] = useState(false);`:

```tsx
    const [isDismissingSummary, setIsDismissingSummary] = useState(false);
```

- [ ] **Step 3: Esconder concluídos e achar o resumo pendente**

Substituir o bloco `const sortedMedications = [...medications].sort(...)` por:

```tsx
    const sortedMedications = medications
        .filter((m) => !m.completed)
        .sort((a, b) => {
            if (!a.nextDoseAt) return 1;
            if (!b.nextDoseAt) return -1;
            return new Date(a.nextDoseAt).getTime() - new Date(b.nextDoseAt).getTime();
        });

    // One summary popup at a time; the next one shows after this is dismissed.
    const summaryTarget = medications.find((m) => m.treatmentSummary && !m.treatmentSummary.dismissed) ?? null;
```

(`.filter` já devolve um array novo, então o `.sort` não altera o estado.)

- [ ] **Step 4: Handler de dismiss**

Acrescentar depois de `handleUndoMedication`:

```tsx
    const handleDismissSummary = async (medId: string) => {
        setIsDismissingSummary(true);
        try {
            const response = await fetch(`${API_URL}/medications/${medId}/summary/dismiss`, {
                method: "POST",
                credentials: 'include',
            });
            if (!response.ok) {
                const data = await response.json().catch(() => null);
                console.error('Erro ao dispensar resumo:', data?.error ?? response.status);
                return;
            }
            await fetchMedications();
        } catch (error) {
            console.error(error);
        } finally {
            setIsDismissingSummary(false);
        }
    };
```

- [ ] **Step 5: Renderizar o popup**

Inserir antes do bloco `{undoTarget && (`:

```tsx
            {summaryTarget?.treatmentSummary && (
                <TreatmentSummaryDialog
                    medicationName={summaryTarget.name}
                    summary={summaryTarget.treatmentSummary}
                    isDismissing={isDismissingSummary}
                    onDismiss={() => handleDismissSummary(summaryTarget.id)}
                />
            )}
```

- [ ] **Step 6: Build e lint**

Run: `cd /home/pedro/Documents/medtrackerproject/medtracker && npm run build && npx eslint src/pages/dashboard.tsx src/components/treatmentSummaryDialog.tsx`
Expected: build sem erros; eslint sem erros novos.

- [ ] **Step 7: Commit (`medtracker`)**

```bash
cd /home/pedro/Documents/medtrackerproject/medtracker
git add src/components/treatmentSummaryDialog.tsx src/pages/dashboard.tsx
git commit -m "feat: popup de resumo do tratamento no dashboard

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

---

### Task 6: Frontend — selo "Concluído" na lista e verificação ponta a ponta

**Files:**
- Modify: `medtracker/src/pages/medicationList.tsx`

**Interfaces:**
- Consumes (Task 4): `Medication.completed`, `Medication.treatmentSummary`.

- [ ] **Step 1: Mostrar o selo e o score**

Em `medicationList.tsx`, substituir o parágrafo final do cartão (o `<p className="text-gray-600 capitalize">Próximo: ...</p>`, de `Próximo:` até o `</p>` que o fecha) por:

```tsx
                                {med.completed && med.treatmentSummary ? (
                                    <p className="text-right text-sm font-medium text-green-700">
                                        Concluído · {med.treatmentSummary.taken}/{med.treatmentSummary.expected} doses
                                    </p>
                                ) : (
                                    <p className="text-gray-600 capitalize">Próximo: {med.nextDoseAt ? new Date(med.nextDoseAt).toLocaleTimeString("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: true
}) : "Aguardando"} </p>
                                )}
```

- [ ] **Step 2: Build e lint**

Run: `cd /home/pedro/Documents/medtrackerproject/medtracker && npm run build && npx eslint src/pages/medicationList.tsx`
Expected: sem erros.

- [ ] **Step 3: Commit (`medtracker`)**

```bash
cd /home/pedro/Documents/medtrackerproject/medtracker
git add src/pages/medicationList.tsx
git commit -m "feat: selo de tratamento concluído na lista de remédios

Co-Authored-By: Claude Sonnet 5.5 <noreply@anthropic.com>"
```

- [ ] **Step 4: Verificação manual no navegador**

Subir API (`cd medtracker-api && npm run dev`) e frontend (`cd medtracker && npm run dev`), logar e conferir, nesta ordem:

1. **Cadastro sem duração:** em "Novo Medicamento", deixar "Por quantos dias?" vazio e salvar → o navegador bloqueia (campo obrigatório).
2. **Cadastro com duração:** criar um remédio "Todo dia" com horário daqui a alguns minutos, duração 1 → vai para a lista com "Próximo: ...".
3. **Popup:** esperar passar o horário da dose (ou, para testar sem esperar, no banco ajustar `start_date`/`end_date`/`fixed_time` do remédio para um período já passado, com `summary_dismissed_at` nulo) e recarregar o dashboard → o remédio some de "Próxima Dose" e o popup abre com `X/Y` e a lista de dias perdidos (ou a mensagem de parabéns, se tiver tomado tudo).
4. **Dismiss:** clicar "Entendi" → popup fecha; recarregar a página → não reaparece.
5. **Lista:** o remédio mostra "Concluído · X/Y doses".
6. **Edição:** editar o remédio concluído para 5 dias → volta para "Próxima Dose" e o selo some; editar um remédio antigo (sem duração) sem preencher o campo → salva sem mudar nada.
7. **Insights:** "Doses perdidas" no dashboard não cresce para o remédio concluído.

Expected: todos os 7 itens se comportam como descrito. Anotar qualquer divergência e corrigir antes de encerrar.

---

## Self-review (spec × plano)

| Requisito da spec | Onde |
|---|---|
| Campo "Por quantos dias?" obrigatório, mín. 1 | Task 4 (UI), Task 3 step 4 (API 400) |
| `endDate` = fim do dia N no fuso do usuário | Task 1 `computeEndDate`, Task 3 steps 4 e 6 |
| Coluna `summary_dismissed_at` | Task 3 steps 1–2 |
| PATCH recalcula `endDate` e reabre o resumo se for ao futuro | Task 3 step 6 |
| Score `taken/expected`, dias perdidos, `perfect`, dose extra não compensa | Task 1 |
| Popup na primeira abertura depois da última dose prevista, até dispensar | Task 3 step 5 (`completed`/`dismissed`), Task 5 |
| Dismiss em rota própria, 404 para remédio de outro usuário | Task 3 step 7 |
| Concluído sai da "Próxima Dose", fica na lista com score | Tasks 5 e 6 |
| Um popup por vez | Task 5 step 3 (`find` do primeiro pendente) |
| Antigos sem `end_date` seguem como hoje | `completed=false` quando `endDate` é nulo (Task 3 step 5); edição aceita campo vazio (Task 4 step 2) |
| Weekly com drift | Task 1 (blocos de 7 dias para `daysOfWeek` de um dia só, 2 testes) |

**Diferenças em relação à spec** (a spec foi atualizada junto com este plano):
- `completed` passou a significar "a última dose prevista já passou" (não `now > endDate`). Assim o remédio sai do dashboard no mesmo momento em que o popup aparece.
- O campo da spec `lastSlotAt` virou `readyAt` (cai para `endDate` quando não há dose prevista).
- Máximo de 365 dias.
- Incluída a Task 2 (estatísticas respeitarem `endDate`), que a spec não citava, mas sem ela os insights continuariam contando doses perdidas de remédios concluídos.
- O `GET /medications` também devolve `durationDays`, para pré-preencher a edição.

**Limite conhecido:** nos tratamentos `interval`, a grade de horários parte do `startDate` e não acompanha o deslocamento causado por doses tomadas fora de hora; o casamento é por dia, com o teto de doses previstas no dia, o que absorve a maior parte disso.
