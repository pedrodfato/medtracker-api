# Progresso: faixa de hoje e histórico por remédio — Plano de implementação

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Na página de Progresso, uma faixa "Hoje" com os remédios coloridos (tomados) ou cinza (pendentes) e, ao tocar num remédio, uma grade de dias estilo GitHub com a adesão daquele remédio.

**Architecture:** Duas funções puras novas em `treatmentSummary.ts` (`dailyAdherence`, `todayAdherence`) reaproveitam a geração de horários existente. A API expõe `today` em `GET /medications` e um endpoint novo `GET /medications/:id/history`. O frontend ganha dois componentes (`TodayStrip`, `AdherenceHeatmap`) montados em `progress.tsx`.

**Tech Stack:** Fastify 5 + Drizzle (API, testes com `node:test` + `tsx`); React 19 + Vite + Tailwind (frontend).

**Repositórios:** `medtracker-api` e `medtracker` são repositórios git separados; cada task diz onde commitar. Spec: `docs/superpowers/specs/2026-11-08-progress-history-heatmap-design.md`.

## Global Constraints

- Cor de cada dia = porcentagem das doses previstas tomadas naquele dia.
- Grade cobre do início do tratamento até hoje, ou até o fim do tratamento se já terminou.
- O remédio do histórico é escolhido tocando nele na faixa de hoje; o primeiro da faixa vem selecionado.
- Dose extra num dia com dose prevista não passa de `expected` (`taken` limitado). Em dia sem dose prevista (`expected: 0`), `taken` é o número real.
- Remédio por intervalo: a grade de horários é sempre ancorada no `startDate` do remédio, nunca no início da janela consultada.
- Textos de interface em português do Brasil.
- API: `.js` nos imports relativos; `noUncheckedIndexedAccess` ligado; testes começam com `process.env.TZ = 'America/Sao_Paulo';`; `npm test` e `npx tsc --noEmit`.
- **Nunca** subir o servidor da API nem rodar scripts contra o banco do `.env` local: ele é o banco de **produção**. Verificação das tasks é só por testes, typecheck e build.
- Commits terminam com a linha `Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>`.
- Datas dos testes em 2026-11 (02/11/2026 é segunda-feira).

## Mapa de arquivos

| Arquivo | Ação | Responsabilidade |
|---|---|---|
| `medtracker-api/src/lib/treatmentSummary.ts` | alterar | `expectedSlots` com limite final; `dailyAdherence`; `todayAdherence` |
| `medtracker-api/src/lib/adherence.test.ts` | criar | testes das duas funções novas |
| `medtracker-api/src/routes/medication-routes.ts` | alterar | `today` em `GET /medications`; rota `GET /medications/:id/history` |
| `medtracker/src/types/medType.ts` | alterar | `today`, `DayAdherence`, `MedicationHistory` |
| `medtracker/src/components/todayStrip.tsx` | criar | faixa "Hoje" |
| `medtracker/src/components/adherenceHeatmap.tsx` | criar | grade de dias |
| `medtracker/src/pages/progress.tsx` | alterar | busca dados e monta faixa + grade acima da linha do tempo |

---

### Task 1: Funções puras de adesão diária

**Files:**
- Modify: `medtracker-api/src/lib/treatmentSummary.ts`
- Test: `medtracker-api/src/lib/adherence.test.ts`

**Interfaces:**
- Consumes: `dateKey` (de `stats.ts`, já importado no arquivo), `SummaryMedication`, `SummaryDose`.
- Produces (Task 2 usa):
  - `type Schedule = Omit<SummaryMedication, 'endDate'>` (campos `scheduleType`, `fixedTime`, `intervalHours`, `daysOfWeek`, `startDate`)
  - `type DayAdherence = { date: string; expected: number; taken: number }`
  - `dailyAdherence(m: Schedule, doses: SummaryDose[], from: Date, until: Date): DayAdherence[]` — um item por dia de calendário de `max(from, m.startDate)` até `until`, inclusive.
  - `todayAdherence(m: Schedule, doses: SummaryDose[], now: Date, endDate: Date | null): { expected: number; taken: number }`
  - Todas as datas já deslocadas com `toProcessZone`.

- [ ] **Step 1: Escrever os testes que falham**

Criar `medtracker-api/src/lib/adherence.test.ts`:

```ts
process.env.TZ = 'America/Sao_Paulo';

import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dailyAdherence, todayAdherence, type Schedule } from './treatmentSummary.js';

const at = (iso: string) => new Date(iso);
const doses = (...isos: string[]) => isos.map((iso) => ({ takenAt: at(iso) }));

function sched(startIso: string, overrides: Partial<Schedule> = {}): Schedule {
  return {
    scheduleType: 'fixed',
    fixedTime: '08:00',
    intervalHours: null,
    daysOfWeek: null,
    startDate: at(startIso),
    ...overrides,
  };
}

test('dailyAdherence: fixed, um item por dia, dose extra limitada', () => {
  const m = sched('2026-11-02T07:00:00-03:00');
  const days = dailyAdherence(
    m,
    doses('2026-11-02T08:05:00-03:00', '2026-11-04T08:10:00-03:00', '2026-11-04T20:00:00-03:00'),
    m.startDate,
    at('2026-11-04T23:59:59.999-03:00'),
  );
  assert.deepEqual(days, [
    { date: '2026-11-02', expected: 1, taken: 1 },
    { date: '2026-11-03', expected: 1, taken: 0 },
    { date: '2026-11-04', expected: 1, taken: 1 },
  ]);
});

test('dailyAdherence: weekly, dia de folga tem expected 0 e conta dose tomada', () => {
  const m = sched('2026-11-02T07:00:00-03:00', { scheduleType: 'weekly', daysOfWeek: [1, 3] });
  const days = dailyAdherence(
    m,
    doses('2026-11-02T08:00:00-03:00', '2026-11-03T09:00:00-03:00'),
    m.startDate,
    at('2026-11-04T23:59:59.999-03:00'),
  );
  assert.deepEqual(days, [
    { date: '2026-11-02', expected: 1, taken: 1 },
    { date: '2026-11-03', expected: 0, taken: 1 },
    { date: '2026-11-04', expected: 1, taken: 0 },
  ]);
});

test('dailyAdherence: interval agrupa horários por dia', () => {
  const m = sched('2026-11-02T08:00:00-03:00', { scheduleType: 'interval', fixedTime: null, intervalHours: 8 });
  const days = dailyAdherence(
    m,
    doses('2026-11-02T08:05:00-03:00', '2026-11-02T16:10:00-03:00'),
    m.startDate,
    at('2026-11-03T23:59:59.999-03:00'),
  );
  assert.deepEqual(days, [
    { date: '2026-11-02', expected: 2, taken: 2 },
    { date: '2026-11-03', expected: 3, taken: 0 },
  ]);
});

test('dailyAdherence: until corta o período e doses depois dele são ignoradas', () => {
  const m = sched('2026-11-02T07:00:00-03:00');
  const days = dailyAdherence(m, doses('2026-11-04T08:00:00-03:00'), m.startDate, at('2026-11-03T12:00:00-03:00'));
  assert.deepEqual(days, [
    { date: '2026-11-02', expected: 1, taken: 0 },
    { date: '2026-11-03', expected: 1, taken: 0 },
  ]);
});

test('dailyAdherence: janela no meio do tratamento mantém a grade do interval ancorada no início', () => {
  // Grade a partir de 02/11 10h: 10h e 18h no dia 02; 02h, 10h e 18h no dia 03.
  const m = sched('2026-11-02T10:00:00-03:00', { scheduleType: 'interval', fixedTime: null, intervalHours: 8 });
  const days = dailyAdherence(m, [], at('2026-11-03T00:00:00-03:00'), at('2026-11-03T23:59:59.999-03:00'));
  assert.deepEqual(days, [{ date: '2026-11-03', expected: 3, taken: 0 }]);
});

test('dailyAdherence: until antes do início devolve lista vazia', () => {
  const m = sched('2026-11-03T07:00:00-03:00');
  assert.deepEqual(dailyAdherence(m, [], m.startDate, at('2026-11-02T12:00:00-03:00')), []);
});

test('todayAdherence: dose de mais tarde conta como prevista e não tomada', () => {
  const m = sched('2026-11-02T07:00:00-03:00', { fixedTime: '20:00' });
  assert.deepEqual(todayAdherence(m, [], at('2026-11-03T12:00:00-03:00'), null), { expected: 1, taken: 0 });
});

test('todayAdherence: dose de hoje tomada', () => {
  const m = sched('2026-11-02T07:00:00-03:00', { fixedTime: '20:00' });
  assert.deepEqual(
    todayAdherence(m, doses('2026-11-03T20:05:00-03:00'), at('2026-11-03T21:00:00-03:00'), null),
    { expected: 1, taken: 1 },
  );
});

test('todayAdherence: tratamento que terminou antes de hoje', () => {
  const m = sched('2026-11-01T07:00:00-03:00');
  assert.deepEqual(
    todayAdherence(m, [], at('2026-11-03T12:00:00-03:00'), at('2026-11-02T23:59:59.999-03:00')),
    { expected: 0, taken: 0 },
  );
});

test('todayAdherence: cadastrado hoje depois do horário não tem dose hoje', () => {
  const m = sched('2026-11-03T09:00:00-03:00');
  assert.deepEqual(todayAdherence(m, [], at('2026-11-03T12:00:00-03:00'), null), { expected: 0, taken: 0 });
});

test('todayAdherence: weekly em dia de folga', () => {
  const m = sched('2026-11-02T07:00:00-03:00', { scheduleType: 'weekly', daysOfWeek: [1] });
  assert.deepEqual(todayAdherence(m, [], at('2026-11-03T12:00:00-03:00'), null), { expected: 0, taken: 0 });
});
```

- [ ] **Step 2: Rodar e ver falhar**

Run: `cd /home/pedro/Documents/medtrackerproject/medtracker-api && node --import tsx --test src/lib/adherence.test.ts`
Expected: FAIL — `dailyAdherence`/`todayAdherence` não exportados (SyntaxError de import ou `is not a function`).

- [ ] **Step 3: Refatorar `expectedSlots` para receber o limite final**

Em `treatmentSummary.ts`, logo abaixo de `export type TreatmentSummary = { ... };`, acrescentar:

```ts
export type Schedule = Omit<SummaryMedication, 'endDate'>;
export type DayAdherence = { date: string; expected: number; taken: number };
```

Substituir a função `expectedSlots` inteira (comentário incluso) por:

```ts
// Every dose the schedule expects between startDate and `until`, oldest first.
// Mirrors nextDose.ts: with no dose taken yet, the first one is the first slot
// at or after startDate. Interval slots are always anchored on startDate.
function expectedSlots(m: Schedule, until: Date): Date[] {
  const slots: Date[] = [];
  const startMs = m.startDate.getTime();
  const endMs = until.getTime();

  if (m.scheduleType === 'interval') {
    if (!m.intervalHours || m.intervalHours < 0) return slots;
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
```

Na primeira linha de `computeTreatmentSummary`, trocar `const slots = expectedSlots(m);` por:

```ts
  const slots = expectedSlots(m, m.endDate);
```

- [ ] **Step 4: Implementar `dailyAdherence` e `todayAdherence`**

Acrescentar ao final de `treatmentSummary.ts`:

```ts
// One entry per calendar day from max(from, startDate) to `until`. `taken` is
// capped at `expected` on scheduled days; on days with nothing scheduled it is
// the real number of doses taken.
export function dailyAdherence(m: Schedule, doses: SummaryDose[], from: Date, until: Date): DayAdherence[] {
  const fromMs = Math.max(from.getTime(), m.startDate.getTime());
  const untilMs = until.getTime();
  if (untilMs < fromMs) return [];

  const days: DayAdherence[] = [];
  const byDate = new Map<string, DayAdherence>();
  const cursor = new Date(fromMs);
  cursor.setHours(0, 0, 0, 0);
  while (cursor.getTime() <= untilMs) {
    const day = { date: dateKey(cursor), expected: 0, taken: 0 };
    days.push(day);
    byDate.set(day.date, day);
    cursor.setDate(cursor.getDate() + 1);
  }

  for (const slot of expectedSlots(m, until)) {
    if (slot.getTime() < fromMs) continue;
    const day = byDate.get(dateKey(slot));
    if (day) day.expected += 1;
  }

  for (const dose of doses) {
    const t = dose.takenAt.getTime();
    if (t < fromMs || t > untilMs) continue;
    const day = byDate.get(dateKey(dose.takenAt));
    if (day) day.taken += 1;
  }

  for (const day of days) {
    if (day.expected > 0) day.taken = Math.min(day.taken, day.expected);
  }
  return days;
}

// The whole of today (including doses scheduled for later today), cut at the
// treatment's end date.
export function todayAdherence(
  m: Schedule,
  doses: SummaryDose[],
  now: Date,
  endDate: Date | null,
): { expected: number; taken: number } {
  const dayStart = new Date(now);
  dayStart.setHours(0, 0, 0, 0);
  const dayEnd = new Date(now);
  dayEnd.setHours(23, 59, 59, 999);
  const until = endDate && endDate.getTime() < dayEnd.getTime() ? endDate : dayEnd;
  const [day] = dailyAdherence(m, doses, dayStart, until);
  return day ? { expected: day.expected, taken: day.taken } : { expected: 0, taken: 0 };
}
```

- [ ] **Step 5: Rodar e ver passar**

Run: `cd /home/pedro/Documents/medtrackerproject/medtracker-api && node --import tsx --test src/lib/adherence.test.ts`
Expected: 11 testes PASS.

- [ ] **Step 6: Suíte inteira e typecheck**

Run: `cd /home/pedro/Documents/medtrackerproject/medtracker-api && npm test && npx tsc --noEmit`
Expected: 80 testes PASS (69 anteriores + 11 novos; os de `treatmentSummary.test.ts` provam que o refactor de `expectedSlots` não mudou nada), `tsc` sem erros.

- [ ] **Step 7: Commit (`medtracker-api`)**

```bash
cd /home/pedro/Documents/medtrackerproject/medtracker-api
git add src/lib/treatmentSummary.ts src/lib/adherence.test.ts
git commit -m "feat: adesão por dia e de hoje a partir da agenda do remédio

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 2: API — `today` e `GET /medications/:id/history`

**Files:**
- Modify: `medtracker-api/src/routes/medication-routes.ts`

**Interfaces:**
- Consumes (Task 1): `dailyAdherence`, `todayAdherence`.
- Produces (Tasks 3–4):
  - `GET /medications`: cada item ganha `today: { expected: number; taken: number }` (`{0,0}` para concluídos).
  - `GET /medications/:id/history` → 200 `{ data: { medicationId: number, startDate: string (ISO), endDate: string | null, days: { date: 'YYYY-MM-DD', expected, taken }[], expected: number, taken: number } }`; 400 id inválido; 401; 404 remédio de outro usuário; 500.

- [ ] **Step 1: Imports**

No bloco `import { ... } from '../lib/treatmentSummary.js';`, acrescentar `dailyAdherence` e `todayAdherence` à lista (mantendo a ordem alfabética):

```ts
import {
    computeEndDate,
    computeTreatmentSummary,
    dailyAdherence,
    durationDaysFromRange,
    parseDurationDays,
    todayAdherence,
} from '../lib/treatmentSummary.js';
```

- [ ] **Step 2: `today` no `GET /medications`**

Dentro do `userMeds.map((med) => { ... })` da rota `app.get('/medications'`, imediatamente antes do `return {` que monta o item (o que tem `...med,` e `nextDoseAt: completed ? null : nextDoseAt,`), inserir:

```ts
            const today = completed
                ? { expected: 0, taken: 0 }
                : todayAdherence(
                    {
                        scheduleType: med.scheduleType,
                        fixedTime: med.fixedTime,
                        intervalHours: med.intervalHours,
                        daysOfWeek: med.daysOfWeek,
                        startDate: toProcessZone(med.startDate, diff),
                    },
                    medDoses.map((d) => ({ takenAt: toProcessZone(d.takenAt, diff) })),
                    toProcessZone(new Date(), diff),
                    med.endDate ? toProcessZone(med.endDate, diff) : null,
                );
```

E no objeto devolvido, acrescentar `today,` depois de `treatmentSummary,`:

```ts
                durationDays,
                completed,
                treatmentSummary,
                today,
            };
```

- [ ] **Step 3: Rota de histórico**

Inserir imediatamente antes de `app.post('/medications/:id/summary/dismiss'`:

```ts
    app.get('/medications/:id/history', {preHandler: [verifySession]}, async (request, reply) => {
        const {id} = request.params as {id: string};
        const medicationId = Number(id);

        if (Number.isNaN(medicationId)) {
            return reply.status(400).send({ error: 'Invalid medication id' });
        }

        const session = await auth.api.getSession({headers: request.headers as any});

        if (!session || !session.user) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        const userId = session.user.id;
        const diff = offsetDiffMinutes((session.user as any).timezone ?? DEFAULT_TIMEZONE);

        try {
            const [medication] = await db.select()
                .from(medications)
                .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)));

            if (!medication) {
                return reply.status(404).send({ error: 'Medicamento não encontrado' });
            }

            const medDoses = await db.select()
                .from(doses_history)
                .where(eq(doses_history.medicationId, medicationId));

            const startLocal = toProcessZone(medication.startDate, diff);
            const nowLocal = toProcessZone(new Date(), diff);
            const endLocal = medication.endDate ? toProcessZone(medication.endDate, diff) : null;
            // History runs up to now, or to the end of the treatment if it is over.
            const until = endLocal && endLocal.getTime() < nowLocal.getTime() ? endLocal : nowLocal;

            const days = dailyAdherence(
                {
                    scheduleType: medication.scheduleType,
                    fixedTime: medication.fixedTime,
                    intervalHours: medication.intervalHours,
                    daysOfWeek: medication.daysOfWeek,
                    startDate: startLocal,
                },
                medDoses.map((d) => ({ takenAt: toProcessZone(d.takenAt, diff) })),
                startLocal,
                until,
            );

            return reply.status(200).send({
                data: {
                    medicationId,
                    startDate: medication.startDate.toISOString(),
                    endDate: medication.endDate ? medication.endDate.toISOString() : null,
                    days,
                    expected: days.reduce((sum, d) => sum + d.expected, 0),
                    taken: days.reduce((sum, d) => sum + d.taken, 0),
                },
            });
        } catch (error) {
            console.error('Erro ao buscar histórico do remédio:', error);
            return reply.status(500).send({ error: 'Erro interno ao buscar histórico' });
        }
    })
```

- [ ] **Step 4: Typecheck e testes**

Run: `cd /home/pedro/Documents/medtrackerproject/medtracker-api && npx tsc --noEmit && npm test`
Expected: `tsc` limpo, 80 testes PASS. **Não** subir o servidor: o `.env` aponta para produção (ver Global Constraints).

- [ ] **Step 5: Commit (`medtracker-api`)**

```bash
cd /home/pedro/Documents/medtrackerproject/medtracker-api
git add src/routes/medication-routes.ts
git commit -m "feat: adesão de hoje na lista e rota de histórico por remédio

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 3: Frontend — tipos, faixa "Hoje" e grade de histórico

**Files:**
- Modify: `medtracker/src/types/medType.ts`
- Create: `medtracker/src/components/todayStrip.tsx`
- Create: `medtracker/src/components/adherenceHeatmap.tsx`

**Interfaces:**
- Consumes (Task 2): formatos de `today` e da resposta de histórico.
- Produces (Task 4):
  - `TodayStrip` props `{ medications: Medication[]; selectedId: string | null; onSelect: (id: string) => void }`
  - `AdherenceHeatmap` props `{ days: DayAdherence[]; expected: number; taken: number }`
  - Tipos `DayAdherence`, `MedicationHistory`; `Medication.today?`.

- [ ] **Step 1: Tipos**

Em `medtracker/src/types/medType.ts`, acrescentar antes de `export interface Medication {`:

```ts
export interface DayAdherence {
    date: string;
    expected: number;
    taken: number;
}

export interface MedicationHistory {
    medicationId: number;
    startDate: string;
    endDate: string | null;
    days: DayAdherence[];
    expected: number;
    taken: number;
}

```

E dentro de `Medication`, depois de `treatmentSummary?: TreatmentSummary | null;`:

```ts
    today?: { expected: number; taken: number };
```

- [ ] **Step 2: Faixa "Hoje"**

Criar `medtracker/src/components/todayStrip.tsx`:

```tsx
import type { Medication } from "../types/medType";
import { getMedicationVisual, type MedicationCategory } from "../lib/medicationVisuals";

type Props = {
    medications: Medication[];
    selectedId: string | null;
    onSelect: (id: string) => void;
};

type TodayStatus = "done" | "partial" | "pending" | "off";

function todayStatus(med: Medication): TodayStatus {
    const expected = med.today?.expected ?? 0;
    const taken = med.today?.taken ?? 0;
    if (expected === 0) return "off";
    if (taken >= expected) return "done";
    if (taken > 0) return "partial";
    return "pending";
}

export function TodayStrip({ medications, selectedId, onSelect }: Props) {
    const active = medications.filter((m) => !m.completed);
    const completed = medications.filter((m) => m.completed);
    const scheduledToday = active.filter((m) => todayStatus(m) !== "off");
    const doneToday = scheduledToday.filter((m) => todayStatus(m) === "done");

    const renderItem = (med: Medication, isCompleted: boolean) => {
        const visual = getMedicationVisual(med.category as MedicationCategory);
        const status = todayStatus(med);
        const isSelected = String(med.id) === String(selectedId);
        const tone = isCompleted
            ? `${visual.bgClass} opacity-60`
            : status === "done" || status === "partial"
                ? visual.bgClass
                : status === "pending"
                    ? "bg-gray-200 grayscale"
                    : "bg-gray-100 grayscale opacity-50";

        return (
            <button
                key={med.id}
                type="button"
                onClick={() => onSelect(med.id)}
                aria-pressed={isSelected}
                className="flex flex-col items-center gap-1 w-16 shrink-0"
            >
                <div
                    className={`relative w-14 h-14 rounded-2xl flex items-center justify-center text-2xl border-2 transition-colors ${
                        isSelected ? "border-primary" : "border-transparent"
                    } ${tone}`}
                >
                    {visual.emoji}
                    {!isCompleted && status === "partial" && med.today && (
                        <span className="absolute -top-1.5 -right-1.5 rounded-full bg-primary px-1.5 py-0.5 text-[10px] font-semibold text-primary-foreground">
                            {med.today.taken}/{med.today.expected}
                        </span>
                    )}
                </div>
                <span className="w-full truncate text-center text-xs text-gray-700">{med.name}</span>
                {isCompleted ? (
                    <span className="text-[10px] text-green-700">Concluído</span>
                ) : status === "off" ? (
                    <span className="text-[10px] text-gray-400">sem dose hoje</span>
                ) : null}
            </button>
        );
    };

    return (
        <section className="p-4 rounded-[24px] bg-white/70 shadow-[0_4px_20px_rgba(0,0,0,0.06)] flex flex-col gap-3">
            <h2 className="text-lg font-semibold text-gray-900">
                Hoje{" "}
                <span className="text-sm font-normal text-gray-500">
                    · {doneToday.length} de {scheduledToday.length} tomados
                </span>
            </h2>
            <div className="flex gap-3 overflow-x-auto pb-1">
                {active.map((med) => renderItem(med, false))}
                {active.length > 0 && completed.length > 0 && (
                    <div className="w-px self-stretch bg-gray-200 shrink-0" aria-hidden="true" />
                )}
                {completed.map((med) => renderItem(med, true))}
            </div>
        </section>
    );
}
```

- [ ] **Step 3: Grade de histórico**

Criar `medtracker/src/components/adherenceHeatmap.tsx`:

```tsx
import { useEffect, useRef, useState } from "react";
import type { DayAdherence } from "../types/medType";

type Props = {
    days: DayAdherence[];
    expected: number;
    taken: number;
};

const ROW_LABELS = ["", "Seg", "", "Qua", "", "Sex", ""];

const toDate = (date: string) => new Date(`${date}T12:00:00`);

function cellClass(day: DayAdherence | null): string {
    if (!day) return "bg-transparent";
    if (day.expected === 0) return day.taken > 0 ? "bg-green-600" : "bg-gray-100";
    if (day.taken >= day.expected) return "bg-green-600";
    if (day.taken > 0) return "bg-green-300";
    return "bg-white border border-gray-300";
}

function describe(day: DayAdherence): string {
    if (day.expected === 0) {
        return day.taken > 0
            ? `sem dose prevista, ${day.taken} ${day.taken === 1 ? "tomada" : "tomadas"}`
            : "sem dose prevista";
    }
    return `${day.taken} de ${day.expected} ${day.expected === 1 ? "dose" : "doses"}`;
}

export function AdherenceHeatmap({ days, expected, taken }: Props) {
    const scrollRef = useRef<HTMLDivElement>(null);
    const [selected, setSelected] = useState<DayAdherence | null>(null);

    // Opens on the most recent days.
    useEffect(() => {
        if (scrollRef.current) scrollRef.current.scrollLeft = scrollRef.current.scrollWidth;
    }, [days]);

    if (days.length === 0) {
        return <p className="text-sm text-gray-500">O tratamento ainda não começou.</p>;
    }

    // Weeks start on Sunday, like GitHub; pad the first and last week.
    const cells: (DayAdherence | null)[] = [
        ...Array<null>(toDate(days[0]!.date).getDay()).fill(null),
        ...days,
    ];
    while (cells.length % 7 !== 0) cells.push(null);
    const weeks: (DayAdherence | null)[][] = [];
    for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));

    let lastMonth = -1;
    const monthLabels = weeks.map((week) => {
        const first = week.find((d) => d !== null);
        if (!first) return "";
        const month = toDate(first.date).getMonth();
        if (month === lastMonth) return "";
        lastMonth = month;
        return toDate(first.date).toLocaleDateString("pt-BR", { month: "short" }).replace(".", "");
    });

    const rate = expected === 0 ? null : Math.round((taken / expected) * 100);

    return (
        <div className="flex flex-col gap-3">
            <div className="flex gap-1">
                <div className="flex flex-col gap-1 pt-5 pr-1 text-[10px] text-gray-500">
                    {ROW_LABELS.map((label, i) => (
                        <span key={i} className="h-3.5 leading-[14px]">{label}</span>
                    ))}
                </div>
                <div ref={scrollRef} className="overflow-x-auto pb-1">
                    <div className="flex gap-1">
                        {weeks.map((week, w) => (
                            <div key={w} className="flex flex-col gap-1">
                                <span className="h-4 whitespace-nowrap text-[10px] capitalize text-gray-500">
                                    {monthLabels[w]}
                                </span>
                                {week.map((day, d) =>
                                    day ? (
                                        <button
                                            key={d}
                                            type="button"
                                            onClick={() => setSelected(day)}
                                            aria-label={`${day.date}: ${describe(day)}`}
                                            className={`w-3.5 h-3.5 rounded-[3px] ${cellClass(day)} ${
                                                selected?.date === day.date ? "ring-2 ring-gray-900" : ""
                                            }`}
                                        />
                                    ) : (
                                        <div key={d} className="w-3.5 h-3.5" />
                                    ),
                                )}
                            </div>
                        ))}
                    </div>
                </div>
            </div>

            <p className="min-h-5 text-sm text-gray-700">
                {selected
                    ? `${toDate(selected.date).toLocaleDateString("pt-BR", { weekday: "long", day: "numeric", month: "long" })}: ${describe(selected)}`
                    : "Toque num dia para ver os detalhes."}
            </p>

            <div className="flex items-center justify-between text-xs text-gray-500">
                <span>
                    {rate === null ? "Nenhuma dose prevista ainda" : `${taken} de ${expected} doses · ${rate}%`}
                </span>
                <span className="flex items-center gap-1">
                    Menos
                    <span className="w-3 h-3 rounded-[3px] bg-gray-100" />
                    <span className="w-3 h-3 rounded-[3px] bg-white border border-gray-300" />
                    <span className="w-3 h-3 rounded-[3px] bg-green-300" />
                    <span className="w-3 h-3 rounded-[3px] bg-green-600" />
                    Mais
                </span>
            </div>
        </div>
    );
}
```

- [ ] **Step 4: Build e lint**

Run: `cd /home/pedro/Documents/medtrackerproject/medtracker && npm run build && npx eslint src/types/medType.ts src/components/todayStrip.tsx src/components/adherenceHeatmap.tsx`
Expected: build sem erros; eslint sem erros nesses arquivos. (Os componentes ainda não são usados por nenhuma página; o build passa porque o `tsc -b` checa os arquivos mesmo assim.)

- [ ] **Step 5: Commit (`medtracker`)**

```bash
cd /home/pedro/Documents/medtrackerproject/medtracker
git add src/types/medType.ts src/components/todayStrip.tsx src/components/adherenceHeatmap.tsx
git commit -m "feat: componentes da faixa de hoje e da grade de histórico

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 4: Frontend — montar na página de Progresso

**Files:**
- Modify: `medtracker/src/pages/progress.tsx`

**Interfaces:**
- Consumes (Task 3): `TodayStrip`, `AdherenceHeatmap`, `Medication`, `MedicationHistory`. (Task 2): `GET /medications`, `GET /medications/:id/history`.

- [ ] **Step 1: Imports**

Em `progress.tsx`, substituir as três linhas de import do topo por:

```tsx
import { useEffect, useState } from "react";
import { API_URL } from "../lib/api";
import { getMedicationVisual, type MedicationCategory } from "../lib/medicationVisuals";
import type { Medication, MedicationHistory } from "../types/medType";
import { TodayStrip } from "../components/todayStrip";
import { AdherenceHeatmap } from "../components/adherenceHeatmap";
```

- [ ] **Step 2: Estado e carregamento**

Dentro de `export function Progress() {`, logo depois de `const [isLoading, setIsLoading] = useState(true);`, acrescentar:

```tsx
    const [medications, setMedications] = useState<Medication[]>([]);
    const [medicationsLoaded, setMedicationsLoaded] = useState(false);
    const [selectedId, setSelectedId] = useState<string | null>(null);
    const [history, setHistory] = useState<MedicationHistory | null>(null);
    const [historyError, setHistoryError] = useState(false);

    useEffect(() => {
        const loadMedications = async () => {
            try {
                const response = await fetch(`${API_URL}/medications`, {
                    method: 'GET',
                    credentials: 'include',
                });
                if (!response.ok) throw new Error('Failed to fetch medications');
                const responseData = await response.json();
                const meds: Medication[] = responseData.data;
                setMedications(meds);
                // Same order as the strip: active first, then completed.
                const first = meds.find((m) => !m.completed) ?? meds[0];
                if (first) setSelectedId(first.id);
            } catch (error) {
                console.error('Error fetching medications:', error);
            } finally {
                setMedicationsLoaded(true);
            }
        };
        loadMedications();
    }, []);

    useEffect(() => {
        if (!selectedId) return;
        let cancelled = false;
        const loadHistory = async () => {
            try {
                const response = await fetch(`${API_URL}/medications/${selectedId}/history`, {
                    method: 'GET',
                    credentials: 'include',
                });
                if (!response.ok) throw new Error('Failed to fetch history');
                const responseData = await response.json();
                if (!cancelled) setHistory(responseData.data);
            } catch (error) {
                console.error('Error fetching medication history:', error);
                if (!cancelled) setHistoryError(true);
            }
        };
        loadHistory();
        return () => {
            cancelled = true;
        };
    }, [selectedId]);

    const handleSelect = (id: string) => {
        setHistoryError(false);
        setSelectedId(id);
    };

    const selectedMedication = medications.find((m) => String(m.id) === String(selectedId)) ?? null;
    const historyIsCurrent = history !== null && String(history.medicationId) === String(selectedId);
```

- [ ] **Step 3: Renderizar faixa e grade**

Logo depois da linha `<h1 className="text-4xl font-heading text-gray-900 mt-8 mb-2 text-start">Progresso</h1>`, inserir:

```tsx
            {medicationsLoaded && medications.length === 0 && (
                <div className="bg-white p-6 rounded-[24px] text-center border border-dashed border-gray-300">
                    <p className="text-gray-500">Cadastre um remédio para acompanhar o progresso dele aqui.</p>
                </div>
            )}

            {medications.length > 0 && (
                <>
                    <TodayStrip medications={medications} selectedId={selectedId} onSelect={handleSelect} />

                    <section className="p-4 rounded-[24px] bg-white/70 shadow-[0_4px_20px_rgba(0,0,0,0.06)] flex flex-col gap-3">
                        <h2 className="text-lg font-semibold text-gray-900">
                            Histórico{selectedMedication ? ` · ${selectedMedication.name}` : ""}
                        </h2>
                        {historyError ? (
                            <p className="text-sm text-gray-500">Não foi possível carregar o histórico.</p>
                        ) : historyIsCurrent ? (
                            <AdherenceHeatmap
                                key={history.medicationId}
                                days={history.days}
                                expected={history.expected}
                                taken={history.taken}
                            />
                        ) : (
                            <p className="text-sm text-gray-500">Carregando...</p>
                        )}
                    </section>
                </>
            )}
```

(Se o TypeScript reclamar que `history` pode ser `null` dentro do ramo `historyIsCurrent`, trocar a condição por `historyIsCurrent && history ?` — mesmo comportamento.)

- [ ] **Step 4: Build e lint**

Run: `cd /home/pedro/Documents/medtrackerproject/medtracker && npm run build && npx eslint src/pages/progress.tsx`
Expected: build sem erros. Se o eslint acusar `react-hooks/set-state-in-effect`, conferir com `git stash` se o mesmo erro já existia em `progress.tsx` antes (o padrão de `loadDoses` é o mesmo); relatar em vez de reestruturar.

- [ ] **Step 5: Commit (`medtracker`)**

```bash
cd /home/pedro/Documents/medtrackerproject/medtracker
git add src/pages/progress.tsx
git commit -m "feat: faixa de hoje e histórico por remédio na página de Progresso

Co-Authored-By: Claude Opus 5.5 <noreply@anthropic.com>"
```

---

### Task 5: Verificação no navegador (controlador, com o Pedro)

Não delegar. Pré-requisito: o Pedro fornece a URL de um banco que **não** seja produção (ex.: uma branch do Neon).

- [ ] Aplicar o schema nesse banco: `dbURL='<url-nao-producao>' npm run db:push` (em `medtracker-api`).
- [ ] Subir a API com `dbURL='<url-nao-producao>' npm run dev` e o frontend com `VITE_API_URL=http://localhost:3333 npm run dev`.
- [ ] Com Playwright e uma conta de teste: criar três remédios ("Todo dia" com horário já passado e dose confirmada; "Todo dia" com horário mais tarde; "Dias específicos" sem o dia de hoje). Em Progresso, conferir:
  1. Faixa "Hoje · 1 de 2 tomados": o primeiro colorido, o segundo cinza, o terceiro cinza claro com "sem dose hoje".
  2. A grade do primeiro remédio aparece; o dia de hoje está verde forte; rodapé "1 de 1 doses · 100%".
  3. Tocar no segundo remédio troca a grade; tocar num quadrado mostra a data e "x de y doses".
  4. A linha do tempo de doses continua no fim da página.
- [ ] Apagar a conta de teste nesse banco e parar os servidores.

---

## Self-review (spec × plano)

| Requisito da spec | Onde |
|---|---|
| `dailyAdherence` por dia, `expected: 0` em folga, `taken` limitado | Task 1 (testes 1–4) |
| Grade do interval ancorada no início | Task 1 (teste 5), Global Constraints |
| `computeTreatmentSummary` inalterado | Task 1 step 6 (testes antigos) |
| "Hoje" inclui dose de mais tarde como pendente | Task 1 (`todayAdherence`, teste 7) |
| `today` em `GET /medications`, `{0,0}` para concluídos | Task 2 step 2 |
| `GET /medications/:id/history` com 400/401/404 e somas | Task 2 step 3 |
| Faixa: estados tomado / parte / pendente / sem dose / concluído; "X de Y" | Task 3 step 2 |
| Grade: semanas a partir de domingo, Seg/Qua/Sex, meses, cores, legenda, detalhe do dia, rolagem até o fim, rodapé | Task 3 step 3 |
| Primeiro remédio selecionado; toque troca; erro de histórico; lista vazia | Task 4 |
| Linha do tempo continua no fim | Task 4 (inserção acima dela) |
| Verificação só fora de produção | Global Constraints, Task 5 |

**Diferenças em relação à spec** (spec atualizada junto com este plano):
- `dailyAdherence` recebe `from` e `until` (não só `until`): a janela de "hoje" não pode mover o `startDate`, senão a grade do remédio por intervalo se desloca.
- A lógica de "hoje" virou a função pura `todayAdherence`, testada, em vez de ficar na rota.
- No histórico, o dia de hoje vai **até agora**: uma dose marcada para mais tarde ainda não conta como prevista na grade (só na faixa "Hoje").
