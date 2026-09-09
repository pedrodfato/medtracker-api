# Dashboard/Medications/Add/Reminder Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add weekly (day-of-week) medication scheduling and adherence stats to the API, then redesign the Dashboard, Medications List, Add Medication, and a new in-app Reminder screen on the frontend to match the approved mockups.

**Architecture:** Backend gets a new `weekly` schedule type (day-of-week array + time-of-day) alongside the existing `fixed`/`interval` types, a pure/testable date-math module for next-dose calculation, and a pure/testable stats module exposed via a new `GET /stats` endpoint. Frontend adds a category→visual lookup (no photo upload), rebuilds three existing pages against the new/existing API shapes, and adds a new Reminder route reached by tapping the Dashboard's "next dose" card (in-app only, no push notifications).

**Tech Stack:** Fastify + Drizzle + Postgres (medtracker-api), React + Vite + Tailwind + shadcn (medtracker). Backend tests run via Node's built-in test runner through `tsx` (no new test framework dependency). Frontend has no test runner; frontend tasks are verified via `tsc -b && vite build` plus a manual Playwright visual check (documented per task), consistent with how this project has been verified throughout this session.

## Global Constraints

- Do not remove or break existing `fixed`/`interval` medications already in the database — `weekly` is additive.
- No photo upload: category (`pill`/`drop`/`vitamin`) always maps to a fixed icon/color, never a user-uploaded image.
- The Reminder screen is reachable only while the app is open (tapping the Dashboard "next dose" card). No service worker, no push notifications, no background scheduling.
- The "AI Assistant" card on Add Medication is visual only — no click handler, no API call.
- Backend package is `medtracker-api`, frontend package is `medtracker`, at `/home/pedro/Documents/medtrackerproject/medtracker-api` and `/home/pedro/Documents/medtrackerproject/medtracker` respectively. Each has its own git repo.

---

### Task 1: Add `weekly` schedule type to the schema

**Files:**
- Modify: `medtracker-api/src/schema.ts`

**Interfaces:**
- Produces: `scheduleTypeEnum` now includes `'weekly'`; `medications.daysOfWeek: integer[] | null` column (0=Sunday...6=Saturday).

- [ ] **Step 1: Edit the enum and add the column**

In `medtracker-api/src/schema.ts`, change:

```ts
export const scheduleTypeEnum = pgEnum('schedule_type', ['fixed', 'interval']);
```

to:

```ts
export const scheduleTypeEnum = pgEnum('schedule_type', ['fixed', 'interval', 'weekly']);
```

In the `medications` table definition, add a new column right after `fixedTime`:

```ts
  fixedTime: text('fixed_time'),
  daysOfWeek: integer('days_of_week').array(),
```

- [ ] **Step 2: Push the schema change**

Run (from `medtracker-api/`, with `.env` containing `dbURL` already set from earlier in this session):

```bash
npm run db:push
```

Expected: drizzle-kit reports it altered the `schedule_type` enum and added a `days_of_week` column, with no errors. If it prompts to confirm a column addition, confirm it.

- [ ] **Step 3: Verify the column exists**

Run:

```bash
node -e "
import('dotenv/config').then(async () => {
  const postgres = (await import('postgres')).default;
  const sql = postgres(process.env.dbURL, { ssl: 'require' });
  const cols = await sql\`select column_name from information_schema.columns where table_name = 'medications'\`;
  console.log(cols);
  await sql.end();
});
"
```

Expected: the output array includes `{ column_name: 'days_of_week' }`.

- [ ] **Step 4: Commit**

```bash
cd medtracker-api
git add src/schema.ts
git commit -m "feat: add weekly schedule type and daysOfWeek column"
```

---

### Task 2: Pure next-dose calculation module (with `weekly` support)

**Files:**
- Create: `medtracker-api/src/lib/nextDose.ts`
- Create: `medtracker-api/src/lib/nextDose.test.ts`
- Modify: `medtracker-api/package.json` (add `test` script)

**Interfaces:**
- Produces: `computeNextDoseAt(medication: NextDoseInput, lastDoseTakenAt: Date | null, now: Date): Date | null`
  ```ts
  export type NextDoseInput = {
    scheduleType: 'fixed' | 'interval' | 'weekly';
    fixedTime: string | null; // "HH:MM"
    intervalHours: number | null;
    daysOfWeek: number[] | null; // 0=Sun..6=Sat
    startDate: Date;
  };
  ```
- Consumes: nothing from other tasks.

- [ ] **Step 1: Replace the stub test script**

In `medtracker-api/package.json`, `"scripts"` already has a stub `"test"` entry (`"echo \"Error: no test specified\" && exit 1"`). Replace that line with:

```json
    "test": "node --import tsx --test src/lib/*.test.ts",
```

(Uses `src/lib/*.test.ts`, not `src/**/*.test.ts` — the double-star glob needs bash's `globstar` option, which isn't on by default; a single-star glob one level deep is enough since all test files in this plan live directly in `src/lib/`.)

- [ ] **Step 2: Write the failing test**

Create `medtracker-api/src/lib/nextDose.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeNextDoseAt } from './nextDose.js';

test('fixed schedule: returns today at fixedTime if not yet passed', () => {
  const now = new Date('2026-09-09T10:00:00');
  const result = computeNextDoseAt(
    { scheduleType: 'fixed', fixedTime: '14:00', intervalHours: null, daysOfWeek: null, startDate: new Date('2026-09-01') },
    null,
    now
  );
  assert.equal(result?.toISOString(), new Date('2026-09-09T14:00:00').toISOString());
});

test('fixed schedule: rolls to tomorrow if fixedTime already passed today', () => {
  const now = new Date('2026-09-09T20:00:00');
  const result = computeNextDoseAt(
    { scheduleType: 'fixed', fixedTime: '14:00', intervalHours: null, daysOfWeek: null, startDate: new Date('2026-09-01') },
    null,
    now
  );
  assert.equal(result?.toISOString(), new Date('2026-09-10T14:00:00').toISOString());
});

test('interval schedule: adds intervalHours to the last dose', () => {
  const now = new Date('2026-09-09T10:00:00');
  const lastDose = new Date('2026-09-09T06:00:00');
  const result = computeNextDoseAt(
    { scheduleType: 'interval', fixedTime: null, intervalHours: 8, daysOfWeek: null, startDate: new Date('2026-09-01') },
    lastDose,
    now
  );
  assert.equal(result?.toISOString(), new Date('2026-09-09T14:00:00').toISOString());
});

test('interval schedule: falls back to startDate if no dose taken yet', () => {
  const now = new Date('2026-09-09T10:00:00');
  const startDate = new Date('2026-09-01T09:00:00');
  const result = computeNextDoseAt(
    { scheduleType: 'interval', fixedTime: null, intervalHours: 8, daysOfWeek: null, startDate },
    null,
    now
  );
  assert.equal(result?.toISOString(), startDate.toISOString());
});

test('weekly schedule: picks today if today is a scheduled day and time has not passed', () => {
  // 2026-09-09 is a Wednesday (day 3)
  const now = new Date('2026-09-09T08:00:00');
  const result = computeNextDoseAt(
    { scheduleType: 'weekly', fixedTime: '20:00', intervalHours: null, daysOfWeek: [1, 3, 5], startDate: new Date('2026-09-01') },
    null,
    now
  );
  assert.equal(result?.toISOString(), new Date('2026-09-09T20:00:00').toISOString());
});

test('weekly schedule: skips to the next scheduled day if today already passed', () => {
  // 2026-09-09 is a Wednesday (day 3); next scheduled day is Friday (5)
  const now = new Date('2026-09-09T21:00:00');
  const result = computeNextDoseAt(
    { scheduleType: 'weekly', fixedTime: '20:00', intervalHours: null, daysOfWeek: [1, 3, 5], startDate: new Date('2026-09-01') },
    null,
    now
  );
  assert.equal(result?.toISOString(), new Date('2026-09-11T20:00:00').toISOString());
});

test('weekly schedule: wraps to next week if no scheduled day remains this week', () => {
  // 2026-09-09 is a Wednesday (day 3); only Monday (1) is scheduled -> next Monday is 2026-09-14
  const now = new Date('2026-09-09T21:00:00');
  const result = computeNextDoseAt(
    { scheduleType: 'weekly', fixedTime: '20:00', intervalHours: null, daysOfWeek: [1], startDate: new Date('2026-09-01') },
    null,
    now
  );
  assert.equal(result?.toISOString(), new Date('2026-09-14T20:00:00').toISOString());
});
```

- [ ] **Step 3: Run the test to verify it fails**

```bash
cd medtracker-api
npm test
```

Expected: FAIL with `Cannot find module './nextDose.js'` (file doesn't exist yet).

- [ ] **Step 4: Implement `computeNextDoseAt`**

Create `medtracker-api/src/lib/nextDose.ts`:

```ts
export type NextDoseInput = {
  scheduleType: 'fixed' | 'interval' | 'weekly';
  fixedTime: string | null;
  intervalHours: number | null;
  daysOfWeek: number[] | null;
  startDate: Date;
};

function atTime(base: Date, hhmm: string): Date {
  const [hours, minutes] = hhmm.split(':').map(Number);
  const result = new Date(base);
  result.setHours(hours, minutes, 0, 0);
  return result;
}

export function computeNextDoseAt(
  medication: NextDoseInput,
  lastDoseTakenAt: Date | null,
  now: Date
): Date | null {
  if (medication.scheduleType === 'fixed') {
    if (!medication.fixedTime) return null;
    const todayAtTime = atTime(now, medication.fixedTime);
    if (todayAtTime.getTime() > now.getTime()) return todayAtTime;
    const tomorrow = new Date(now);
    tomorrow.setDate(tomorrow.getDate() + 1);
    return atTime(tomorrow, medication.fixedTime);
  }

  if (medication.scheduleType === 'interval') {
    if (!medication.intervalHours) return null;
    if (lastDoseTakenAt) {
      return new Date(lastDoseTakenAt.getTime() + medication.intervalHours * 60 * 60 * 1000);
    }
    return medication.startDate;
  }

  if (medication.scheduleType === 'weekly') {
    if (!medication.fixedTime || !medication.daysOfWeek || medication.daysOfWeek.length === 0) return null;
    const sortedDays = [...medication.daysOfWeek].sort((a, b) => a - b);
    const todayDow = now.getDay();

    if (sortedDays.includes(todayDow)) {
      const todayAtTime = atTime(now, medication.fixedTime);
      if (todayAtTime.getTime() > now.getTime()) return todayAtTime;
    }

    const laterThisWeek = sortedDays.find((day) => day > todayDow);
    const targetDow = laterThisWeek !== undefined ? laterThisWeek : sortedDays[0];
    const daysUntil = laterThisWeek !== undefined
      ? targetDow - todayDow
      : 7 - todayDow + targetDow;

    const targetDate = new Date(now);
    targetDate.setDate(targetDate.getDate() + daysUntil);
    return atTime(targetDate, medication.fixedTime);
  }

  return null;
}
```

- [ ] **Step 5: Run the test to verify it passes**

```bash
npm test
```

Expected: all 7 tests pass (`# pass 7`).

- [ ] **Step 6: Commit**

```bash
git add src/lib/nextDose.ts src/lib/nextDose.test.ts package.json
git commit -m "feat: add computeNextDoseAt with weekly schedule support"
```

---

### Task 3: Wire `computeNextDoseAt` into `GET /medications`, accept `daysOfWeek` on create

**Files:**
- Modify: `medtracker-api/src/routes/medication-routes.ts`

**Interfaces:**
- Consumes: `computeNextDoseAt` from Task 2 (`medtracker-api/src/lib/nextDose.ts`).

- [ ] **Step 1: Accept `daysOfWeek` on `POST /medications`**

In `medtracker-api/src/routes/medication-routes.ts`, find:

```ts
    const { name, dosage, startDate, totalPills, category, scheduleType, intervalHours, fixedTime, graceWindowMinutes } = request.body as any;
```

Replace with:

```ts
    const { name, dosage, startDate, totalPills, category, scheduleType, intervalHours, fixedTime, graceWindowMinutes, daysOfWeek } = request.body as any;
```

Then find the `db.insert(medications).values({...})` call in the same handler and add `daysOfWeek` to the object:

```ts
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
            startDate: new Date(startDate),
            userId: userId,
        });
```

- [ ] **Step 2: Replace the inline next-dose calculation in `GET /medications`**

At the top of the file, add the import:

```ts
import { computeNextDoseAt } from '../lib/nextDose.js';
```

Find this block inside the `GET /medications` handler:

```ts
            let nextDoseAt = null;

            if (med.scheduleType === 'fixed' && med.fixedTime) {
                const timeParts = med.fixedTime.split(':');
                const hours = Number(timeParts[0]);
                const minutes = Number(timeParts[1] || '0');
                const now = new Date();
                const next = new Date(now);
                next.setHours(hours, minutes, 0, 0);

                if (now.getTime() > next.getTime()) {
                    next.setDate(next.getDate() + 1);
                }
                nextDoseAt = next.toISOString();

            } else if (med.scheduleType === 'interval' && med.intervalHours) {
         
                if (lastDose) {
                    
                    const next = new Date(lastDose.takenAt.getTime() + (med.intervalHours * 60 * 60 * 1000));
                    nextDoseAt = next.toISOString();
                } else {
                    nextDoseAt = med.startDate.toISOString();
                }
            }
```

Replace it with:

```ts
            const nextDoseDate = computeNextDoseAt(
                {
                    scheduleType: med.scheduleType,
                    fixedTime: med.fixedTime,
                    intervalHours: med.intervalHours,
                    daysOfWeek: med.daysOfWeek,
                    startDate: med.startDate,
                },
                lastDose ? lastDose.takenAt : null,
                new Date()
            );
            const nextDoseAt = nextDoseDate ? nextDoseDate.toISOString() : null;
```

- [ ] **Step 3: Verify the backend still builds**

```bash
cd medtracker-api
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/routes/medication-routes.ts
git commit -m "feat: accept daysOfWeek on create, use computeNextDoseAt for next dose"
```

---

### Task 4: Pure adherence stats module

**Files:**
- Create: `medtracker-api/src/lib/stats.ts`
- Create: `medtracker-api/src/lib/stats.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export type StatsMedication = {
    id: number;
    scheduleType: 'fixed' | 'interval' | 'weekly';
    intervalHours: number | null;
    daysOfWeek: number[] | null;
  };
  export type StatsDose = { medicationId: number; takenAt: Date };
  export type Stats = {
    currentStreak: number;
    dosesTaken: number;
    weeklyAdherenceRate: number; // 0-100, rounded
    missedDoses: number;
  };
  export function computeStats(medications: StatsMedication[], doses: StatsDose[], now: Date): Stats
  ```
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing test**

Create `medtracker-api/src/lib/stats.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { computeStats } from './stats.js';

test('dosesTaken counts all doses regardless of date', () => {
  const now = new Date('2026-09-09T12:00:00');
  const doses = [
    { medicationId: 1, takenAt: new Date('2026-09-01T08:00:00') },
    { medicationId: 1, takenAt: new Date('2026-09-08T08:00:00') },
  ];
  const stats = computeStats([], doses, now);
  assert.equal(stats.dosesTaken, 2);
});

test('currentStreak counts consecutive days up to today with at least one dose', () => {
  const now = new Date('2026-09-09T12:00:00');
  const doses = [
    { medicationId: 1, takenAt: new Date('2026-09-09T08:00:00') },
    { medicationId: 1, takenAt: new Date('2026-09-08T08:00:00') },
    { medicationId: 1, takenAt: new Date('2026-09-07T08:00:00') },
    { medicationId: 1, takenAt: new Date('2026-09-05T08:00:00') }, // gap on the 6th breaks the streak
  ];
  const stats = computeStats([], doses, now);
  assert.equal(stats.currentStreak, 3);
});

test('currentStreak is 0 when no dose was taken today or yesterday', () => {
  const now = new Date('2026-09-09T12:00:00');
  const doses = [{ medicationId: 1, takenAt: new Date('2026-09-01T08:00:00') }];
  const stats = computeStats([], doses, now);
  assert.equal(stats.currentStreak, 0);
});

test('weeklyAdherenceRate and missedDoses for a fixed-schedule medication with one miss', () => {
  // 2026-09-09 is Wednesday. Window is the 7 days ending today: 2026-09-03..2026-09-09 (7 expected doses for a daily fixed schedule).
  const now = new Date('2026-09-09T20:00:00');
  const medications = [{ id: 1, scheduleType: 'fixed' as const, intervalHours: null, daysOfWeek: null }];
  const doses = [
    { medicationId: 1, takenAt: new Date('2026-09-03T08:00:00') },
    { medicationId: 1, takenAt: new Date('2026-09-04T08:00:00') },
    { medicationId: 1, takenAt: new Date('2026-09-05T08:00:00') },
    { medicationId: 1, takenAt: new Date('2026-09-06T08:00:00') },
    { medicationId: 1, takenAt: new Date('2026-09-07T08:00:00') },
    { medicationId: 1, takenAt: new Date('2026-09-08T08:00:00') },
    // 2026-09-09 not taken yet -> 1 missed out of 7 expected
  ];
  const stats = computeStats(medications, doses, now);
  assert.equal(stats.missedDoses, 1);
  assert.equal(stats.weeklyAdherenceRate, 86); // round(6/7 * 100)
});

test('weekly adherence with zero expected doses reports 100% and 0 missed', () => {
  const now = new Date('2026-09-09T20:00:00');
  const stats = computeStats([], [], now);
  assert.equal(stats.weeklyAdherenceRate, 100);
  assert.equal(stats.missedDoses, 0);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npm test
```

Expected: FAIL with `Cannot find module './stats.js'`.

- [ ] **Step 3: Implement `computeStats`**

Create `medtracker-api/src/lib/stats.ts`:

```ts
export type StatsMedication = {
  id: number;
  scheduleType: 'fixed' | 'interval' | 'weekly';
  intervalHours: number | null;
  daysOfWeek: number[] | null;
};
export type StatsDose = { medicationId: number; takenAt: Date };
export type Stats = {
  currentStreak: number;
  dosesTaken: number;
  weeklyAdherenceRate: number;
  missedDoses: number;
};

function dateKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}

function computeCurrentStreak(doses: StatsDose[], now: Date): number {
  const daysWithDose = new Set(doses.map((d) => dateKey(d.takenAt)));
  let streak = 0;
  const cursor = new Date(now);
  while (daysWithDose.has(dateKey(cursor))) {
    streak += 1;
    cursor.setDate(cursor.getDate() - 1);
  }
  return streak;
}

function expectedDosesInLast7Days(medication: StatsMedication): number {
  if (medication.scheduleType === 'fixed') return 7;
  if (medication.scheduleType === 'weekly') return medication.daysOfWeek?.length ?? 0;
  if (medication.scheduleType === 'interval' && medication.intervalHours) {
    return Math.floor((7 * 24) / medication.intervalHours);
  }
  return 0;
}

export function computeStats(medications: StatsMedication[], doses: StatsDose[], now: Date): Stats {
  const windowStart = new Date(now);
  windowStart.setDate(windowStart.getDate() - 6);
  windowStart.setHours(0, 0, 0, 0);

  const dosesInWindow = doses.filter((d) => d.takenAt.getTime() >= windowStart.getTime());

  let totalExpected = 0;
  let totalMissed = 0;
  for (const medication of medications) {
    const expected = expectedDosesInLast7Days(medication);
    const taken = dosesInWindow.filter((d) => d.medicationId === medication.id).length;
    totalExpected += expected;
    totalMissed += Math.max(expected - taken, 0);
  }

  const weeklyAdherenceRate = totalExpected === 0
    ? 100
    : Math.round(((totalExpected - totalMissed) / totalExpected) * 100);

  return {
    currentStreak: computeCurrentStreak(doses, now),
    dosesTaken: doses.length,
    weeklyAdherenceRate,
    missedDoses: totalMissed,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test
```

Expected: all tests in both `nextDose.test.ts` and `stats.test.ts` pass.

- [ ] **Step 5: Commit**

```bash
git add src/lib/stats.ts src/lib/stats.test.ts
git commit -m "feat: add computeStats for streak/adherence calculations"
```

---

### Task 5: `GET /stats` endpoint

**Files:**
- Modify: `medtracker-api/src/routes/medication-routes.ts`

**Interfaces:**
- Consumes: `computeStats` from Task 4 (`medtracker-api/src/lib/stats.ts`).
- Produces: `GET /stats` → `{ currentStreak: number, dosesTaken: number, weeklyAdherenceRate: number, missedDoses: number }`.

- [ ] **Step 1: Add the route**

In `medtracker-api/src/routes/medication-routes.ts`, add the import:

```ts
import { computeStats } from '../lib/stats.js';
```

Add this route inside `medicationsRoutes`, after the `POST /medication/:id/take` handler and before the closing `}`:

```ts
    app.get('/stats', {preHandler: [verifySession]}, async (request, reply) => {
        const session = await auth.api.getSession({ headers: request.headers as any });
        if (!session || !session.user) return reply.status(401).send({ error: 'Unauthorized' });

        const userId = session.user.id;

        try {
            const userMeds = await db.select().from(medications).where(eq(medications.userId, userId));
            const userDoses = await db.select().from(doses_history).where(eq(doses_history.userId, userId));

            const stats = computeStats(
                userMeds.map((m) => ({
                    id: m.id,
                    scheduleType: m.scheduleType,
                    intervalHours: m.intervalHours,
                    daysOfWeek: m.daysOfWeek,
                })),
                userDoses.map((d) => ({ medicationId: d.medicationId, takenAt: d.takenAt })),
                new Date()
            );

            return reply.status(200).send({ data: stats });
        } catch (error) {
            console.error('Erro ao calcular estatisticas:', error);
            return reply.status(500).send({ error: 'Erro interno ao calcular estatisticas' });
        }
    })
```

- [ ] **Step 2: Verify the backend builds**

```bash
cd medtracker-api
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit and push**

```bash
git add src/routes/medication-routes.ts
git commit -m "feat: add GET /stats endpoint"
git push
```

---

### Task 6: Frontend category visuals (no photo upload)

**Files:**
- Create: `medtracker/src/lib/medicationVisuals.ts`

**Interfaces:**
- Produces: `getMedicationVisual(category: 'pill' | 'drop' | 'vitamin'): { emoji: string; bgClass: string }`

- [ ] **Step 1: Create the lookup**

Create `medtracker/src/lib/medicationVisuals.ts`:

```ts
export type MedicationCategory = 'pill' | 'drop' | 'vitamin';

const VISUALS: Record<MedicationCategory, { emoji: string; bgClass: string }> = {
  pill: { emoji: '💊', bgClass: 'bg-blue-100' },
  drop: { emoji: '💧', bgClass: 'bg-orange-100' },
  vitamin: { emoji: '☀️', bgClass: 'bg-yellow-100' },
};

export function getMedicationVisual(category: MedicationCategory) {
  return VISUALS[category];
}
```

- [ ] **Step 2: Verify the frontend builds**

```bash
cd medtracker
npm run build
```

Expected: no TypeScript errors (this file isn't wired up to any page yet, so the build just needs to compile it cleanly).

- [ ] **Step 3: Commit**

```bash
git add src/lib/medicationVisuals.ts
git commit -m "feat: add category-to-visual lookup (no photo upload)"
```

---

### Task 7: Rebuild `AddMedication` with weekday scheduling

**Files:**
- Modify: `medtracker/src/pages/addMedications.tsx`

**Interfaces:**
- Consumes: `Input` (`@/components/ui/input`), `Button` (`../components/button`), `API_URL` (`../lib/api`).
- Produces: `POST ${API_URL}/medications` body now sends `scheduleType: 'weekly'` and `daysOfWeek: number[]` instead of `intervalHours`/`fixedTime`-only fixed/interval fields.

- [ ] **Step 1: Replace the component body**

Replace the entire contents of `medtracker/src/pages/addMedications.tsx` with:

```tsx
import { useState } from "react";
import { useNavigate, Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "../components/button";
import { API_URL } from "../lib/api";

const WEEKDAYS: { label: string; value: number }[] = [
    { label: "Dom", value: 0 },
    { label: "Seg", value: 1 },
    { label: "Ter", value: 2 },
    { label: "Qua", value: 3 },
    { label: "Qui", value: 4 },
    { label: "Sex", value: 5 },
    { label: "Sab", value: 6 },
];

export function AddMedication() {
    const navigate = useNavigate();
    const [name, setName] = useState("");
    const [dosage, setDosage] = useState("");
    const [category, setCategory] = useState<"pill" | "drop" | "vitamin">("pill");
    const [daysOfWeek, setDaysOfWeek] = useState<number[]>([1, 3, 5]);
    const [fixedTime, setFixedTime] = useState("08:00");
    const [isLoading, setIsLoading] = useState(false);
    const [errorMsg, setErrorMsg] = useState("");

    const toggleDay = (day: number) => {
        setDaysOfWeek((prev) =>
            prev.includes(day) ? prev.filter((d) => d !== day) : [...prev, day].sort((a, b) => a - b)
        );
    };

    const handleSubmit = async (e: React.FormEvent<HTMLFormElement>) => {
        e.preventDefault();
        setErrorMsg("");

        if (daysOfWeek.length === 0) {
            setErrorMsg("Selecione pelo menos um dia da semana.");
            return;
        }

        setIsLoading(true);
        try {
            const response = await fetch(`${API_URL}/medications`, {
                method: "POST",
                credentials: 'include',
                headers: { "Content-Type": "application/json" },
                body: JSON.stringify({
                    name,
                    dosage,
                    category,
                    scheduleType: "weekly",
                    daysOfWeek,
                    fixedTime,
                    startDate: new Date().toISOString(),
                }),
            });

            if (!response.ok) throw new Error("Falha ao salvar");
            navigate("/list");

        } catch (error) {
            console.error('Erro ao adicionar remédio:', error);
            setErrorMsg("Erro ao adicionar remédio.");
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <main className="bg-[#F7F8FA] min-h-screen py-6 flex flex-col items-center justify-center">
            <div className="w-full max-w-md bg-white p-6 rounded-[24px] shadow-sm">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-2xl font-bold text-gray-900">Novo Medicamento</h1>
                    <Link to="/list" className="text-sm text-gray-500 hover:text-black">Cancelar</Link>
                </div>

                <form onSubmit={handleSubmit} className="flex flex-col gap-5">

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Medicamento</label>
                        <Input required placeholder="Ex: Ritalina" value={name} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setName(e.target.value)} />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Dosagem</label>
                        <Input required placeholder="Ex: 10mg" value={dosage} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setDosage(e.target.value)} />
                    </div>

                    <div>
                        <label className="block text-sm font-medium text-gray-700 mb-2">Categoria</label>
                        <div className="flex gap-2">
                            <button type="button" onClick={() => setCategory("pill")} className={`flex-1 py-2 rounded-lg text-sm transition-colors border ${category === "pill" ? "bg-primary/20 border-primary text-green-800 font-medium" : "bg-gray-50 border-gray-200 text-gray-500"}`}>💊 Pílula</button>
                            <button type="button" onClick={() => setCategory("drop")} className={`flex-1 py-2 rounded-lg text-sm transition-colors border ${category === "drop" ? "bg-orange-100 border-orange-400 text-orange-800 font-medium" : "bg-gray-50 border-gray-200 text-gray-500"}`}>💧 Gota</button>
                            <button type="button" onClick={() => setCategory("vitamin")} className={`flex-1 py-2 rounded-lg text-sm transition-colors border ${category === "vitamin" ? "bg-yellow-100 border-yellow-400 text-yellow-800 font-medium" : "bg-gray-50 border-gray-200 text-gray-500"}`}>☀️ Vitamina</button>
                        </div>
                    </div>

                    <div className="bg-gray-50 p-4 rounded-xl border border-gray-100">
                        <label className="block text-sm font-medium text-gray-700 mb-3">Frequência e Horário</label>
                        <div className="flex justify-between gap-1 mb-4">
                            {WEEKDAYS.map(({ label, value }) => (
                                <button
                                    key={value}
                                    type="button"
                                    onClick={() => toggleDay(value)}
                                    className={`flex-1 py-2 rounded-full text-xs font-medium transition-colors ${
                                        daysOfWeek.includes(value)
                                            ? "bg-primary text-primary-foreground"
                                            : "bg-gray-200 text-gray-500"
                                    }`}
                                >
                                    {label}
                                </button>
                            ))}
                        </div>
                        <label className="block text-xs text-gray-500 mb-1">Horário</label>
                        <Input required type="time" value={fixedTime} onChange={(e: React.ChangeEvent<HTMLInputElement>) => setFixedTime(e.target.value)} />
                    </div>

                    <div className="flex items-center gap-3 bg-tertiary rounded-xl p-4">
                        <span className="text-2xl" aria-hidden="true">🤖</span>
                        <p className="text-sm text-tertiary-foreground">Precisa de ajuda para configurar sua dosagem? Só perguntar!</p>
                    </div>

                    {errorMsg && <p className="text-red-500 text-sm text-center">{errorMsg}</p>}

                    <Button type="submit" disabled={isLoading} className="w-full mt-2">
                        {isLoading ? "Salvando..." : "Salvar Medicamento"}
                    </Button>
                </form>
            </div>
        </main>
    );
}
```

- [ ] **Step 2: Verify the build**

```bash
cd medtracker
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 3: Manual visual check**

Use the pattern established earlier in this session (Playwright script + `scripts/with_server.py`, with a throwaway `.env.local` containing `VITE_API_URL=http://127.0.0.1:9` to avoid the `OpenRoute` false-redirect described earlier in the session) to screenshot `/add` and confirm: name/dosage inputs, category buttons, 7 weekday toggle buttons, a time input, the AI Assistant card, and the Save button all render without console errors. Delete `.env.local` afterward.

- [ ] **Step 4: Commit**

```bash
git add src/pages/addMedications.tsx
git commit -m "feat: redesign Add Medication with weekday scheduling"
```

---

### Task 8: Rebuild `MedicationList` with search, category chips, and category visuals

**Files:**
- Modify: `medtracker/src/types/medType.ts`
- Modify: `medtracker/src/pages/medicationList.tsx`

**Interfaces:**
- Consumes: `getMedicationVisual` from Task 6 (`medtracker/src/lib/medicationVisuals.ts`).
- Produces: `Medication.scheduleType` now includes `'weekly'`; `Medication.daysOfWeek?: number[]`.

- [ ] **Step 1: Widen the `Medication` type**

In `medtracker/src/types/medType.ts`, change:

```ts
    scheduleType: 'fixed' | 'interval';
    intervalHours: number | null;
    fixedTime: string | null;
    nextDoseAt?: string; 
```

to:

```ts
    scheduleType: 'fixed' | 'interval' | 'weekly';
    intervalHours: number | null;
    fixedTime: string | null;
    daysOfWeek?: number[] | null;
    nextDoseAt?: string; 
```

- [ ] **Step 2: Replace the `medicationList.tsx` component body**

Replace the entire contents of `medtracker/src/pages/medicationList.tsx` with:

```tsx
import { Input } from "@/components/ui/input";
import { useState, useEffect } from "react"
import type { Medication } from "../types/medType";
import { EllipsisVertical, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Link } from "react-router-dom";
import { API_URL } from "../lib/api";
import { getMedicationVisual, type MedicationCategory } from "../lib/medicationVisuals";

const CATEGORY_FILTERS: { label: string; value: MedicationCategory }[] = [
    { label: "Pílulas", value: "pill" },
    { label: "Líquidos", value: "drop" },
    { label: "Outros", value: "vitamin" },
];

export function MedicationList() {
    const [medications, setMedications] = useState<Medication[]>([])
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [activeCategory, setActiveCategory] = useState<MedicationCategory | null>(null);

    const toggleMenu = (id: string) => {
        setOpenMenuId(openMenuId === id ? null : id);
    };

    useEffect(() => {
        const LoadMedications = async () => {
            try {
                const response = await fetch(`${API_URL}/medications`, {
                    method: 'GET',
                    credentials: 'include'
                });
                if (!response.ok) {
                    throw new Error('Failed to fetch medications');
                }
                const responseData = await response.json();
                setMedications(responseData.data);
            } catch (error) {
                console.error('Error fetching medications:', error);
            }
        };
        LoadMedications();
    }, []);

    const filteredMedications = medications.filter((med) => {
        const matchesSearch = med.name.toLowerCase().includes(search.toLowerCase());
        const matchesCategory = activeCategory === null || med.category === activeCategory;
        return matchesSearch && matchesCategory;
    });

    return (
        <div className="flex flex-col bg-linear-to-b from-[#eef1f4] to-[#f7f8fa] to-35% min-h-screen items-center justify-start w-full px-4 gap-4 pt-15">
            <div className="flex relative w-full">
                <Search className="absolute top-1/2 -translate-y-1/2 left-4 opacity-50" size={18} />
                <Input
                    className="pl-11"
                    placeholder="Procurar remédios..."
                    value={search}
                    onChange={(e: React.ChangeEvent<HTMLInputElement>) => setSearch(e.target.value)}
                />
            </div>

            <div className="flex gap-2 w-full overflow-x-auto">
                <button
                    onClick={() => setActiveCategory(null)}
                    className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                        activeCategory === null ? "bg-primary text-primary-foreground" : "bg-white text-gray-500"
                    }`}
                >
                    Todos
                </button>
                {CATEGORY_FILTERS.map(({ label, value }) => (
                    <button
                        key={value}
                        onClick={() => setActiveCategory(value)}
                        className={`px-4 py-1.5 rounded-full text-sm font-medium whitespace-nowrap transition-colors ${
                            activeCategory === value ? "bg-primary text-primary-foreground" : "bg-white text-gray-500"
                        }`}
                    >
                        {label}
                    </button>
                ))}
            </div>

            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4 w-full">
                {filteredMedications.map((med) => {
                    const visual = getMedicationVisual(med.category as MedicationCategory);
                    return (
                        <div key={med.id} className="flex p-4 rounded-3xl shadow gap-3 relative bg-white/70 shadow-[0_4px_20px_rgba(0,0,0,0.06)] backdrop-blur-md">
                            <div className={`w-18 h-18 rounded-2xl ${visual.bgClass} flex items-center justify-center shrink-0 text-3xl`}>
                                {visual.emoji}
                            </div>
                            <div className="flex flex-col items-start">
                                <h3 className="text-[18px] font-semibold tracking-tight">{med.name}</h3>
                                <p className="text-gray-600">{med.dosage}</p>
                                <p className="text-gray-600">{med.scheduleType === 'fixed'
                                    ? 'Daily'
                                    : med.scheduleType === 'weekly'
                                        ? 'Semanal'
                                        : `${med.intervalHours} - ${med.intervalHours} hours`
                                }</p>
                            </div>
                            <div className="flex flex-1 flex-col items-end justify-between"><button onClick={() => toggleMenu(med.id)}><EllipsisVertical className="" /></button>
                            {openMenuId === med.id && (
                                    <div className="absolute right-0 top-8 mt-1 w-36 bg-white rounded-xl shadow-lg border border-gray-100 py-2 z-10 animate-in fade-in slide-in-from-top-2 duration-200">

                                        <button
                                            onClick={() => {/* Lógica de Editar */}}
                                            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                                        >
                                            <Pencil size={16} />
                                            Editar
                                        </button>

                                        <button
                                            onClick={() => {/* Lógica de Excluir */}}
                                            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-red-600 hover:bg-red-50 transition-colors"
                                        >
                                            <Trash2 size={16} />
                                            Excluir
                                        </button>
                                    </div>
                                )}
                                <p className="text-gray-600 capitalize">Próximo: {med.nextDoseAt ? new Date(med.nextDoseAt).toLocaleTimeString("pt-BR", {
  hour: "2-digit",
  minute: "2-digit",
  hour12: true
}) : "Aguardando"} </p>
                            </div>
                        </div>
                    );
                })}
            </div>
            <Link to="/add">
                <Plus className="fixed bottom-28 right-6
w-14 h-14
rounded-full
bg-primary
text-primary-foreground
p-3
shadow-[0_10px_30px_rgba(0,0,0,0.12)]
backdrop-blur-xl
transition-all
active:scale-95 z-50" /></Link>
        </div>
    )
}
```

- [ ] **Step 3: Verify the build**

```bash
cd medtracker
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 4: Manual visual check**

Same Playwright + `with_server.py` pattern as Task 7, screenshotting `/list`. Confirm: search bar with icon, 4 filter chips (Todos + 3 categories), and cards showing the emoji/color per category instead of the old static pill image. Confirm typing in search narrows the list (test with a name from a medication you know exists, or seed one via the API first).

- [ ] **Step 5: Commit**

```bash
git add src/types/medType.ts src/pages/medicationList.tsx
git commit -m "feat: redesign Medications List with search, category chips, category visuals"
```

---

### Task 9: Reminder screen and route

**Files:**
- Create: `medtracker/src/pages/reminder.tsx`
- Modify: `medtracker/src/App.tsx`

**Interfaces:**
- Consumes: `API_URL` (`../lib/api`), `getMedicationVisual` from Task 6.
- Produces: route `/reminder`, expecting `location.state` shaped as `{ medication: Medication }` (passed by the Dashboard in Task 10). Redirects to `/dashboard` if that state is missing.

- [ ] **Step 1: Create the Reminder page**

Create `medtracker/src/pages/reminder.tsx`:

```tsx
import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { Button } from "../components/button";
import { API_URL } from "../lib/api";
import { getMedicationVisual, type MedicationCategory } from "../lib/medicationVisuals";
import type { Medication } from "../types/medType";

export function Reminder() {
    const location = useLocation();
    const navigate = useNavigate();
    const medication = (location.state as { medication?: Medication } | null)?.medication;
    const [now, setNow] = useState(new Date());
    const [snoozed, setSnoozed] = useState(false);

    useEffect(() => {
        const interval = setInterval(() => setNow(new Date()), 1000);
        return () => clearInterval(interval);
    }, []);

    useEffect(() => {
        if (!medication) {
            navigate("/dashboard");
        }
    }, [medication, navigate]);

    if (!medication) return null;

    const visual = getMedicationVisual(medication.category as MedicationCategory);

    const handleTaken = async () => {
        await fetch(`${API_URL}/medication/${medication.id}/take`, {
            method: "POST",
            credentials: 'include',
        });
        navigate("/dashboard");
    };

    const handleSnooze = () => {
        setSnoozed(true);
        setTimeout(() => setSnoozed(false), 5 * 60 * 1000);
    };

    const timeLabel = now.toLocaleTimeString("pt-BR", { hour: "2-digit", minute: "2-digit" });

    return (
        <main className="flex flex-col min-h-screen items-center justify-around bg-white px-8 text-center">
            <p className="text-5xl font-bold text-neutral">{timeLabel}</p>

            <div className="relative flex items-center justify-center">
                <span className="absolute w-48 h-48 rounded-full bg-primary/10 animate-ping" />
                <span className="absolute w-36 h-36 rounded-full bg-primary/20" />
                <div className={`relative w-28 h-28 rounded-full ${visual.bgClass} flex items-center justify-center text-5xl`}>
                    {visual.emoji}
                </div>
            </div>

            <div>
                <h1 className="text-2xl font-bold text-neutral">{medication.name}</h1>
                <p className="text-gray-500">Tomar 1 dose ({medication.dosage})</p>
            </div>

            <div className="w-full flex flex-col gap-3">
                <Button variant="primary" className="w-full" onClick={handleTaken}>
                    Tomei
                </Button>
                <Button variant="secondary" className="w-full" onClick={handleSnooze} disabled={snoozed}>
                    {snoozed ? "Vou lembrar em 5 min" : "Lembrar em 5 min"}
                </Button>
            </div>
        </main>
    );
}
```

- [ ] **Step 2: Register the route**

In `medtracker/src/App.tsx`, add the import:

```tsx
import { Reminder } from './pages/reminder';
```

Add the route inside the `<Route element={<LogadoLayout />}>` block, alongside the other private routes:

```tsx
          <Route path="/reminder" element={<PrivateRoute><Reminder /></PrivateRoute>} />
```

- [ ] **Step 3: Verify the build**

```bash
cd medtracker
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 4: Commit**

```bash
git add src/pages/reminder.tsx src/App.tsx
git commit -m "feat: add in-app Reminder screen and /reminder route"
```

---

### Task 10: Rebuild `Dashboard` with real greeting, streak card, adherence insights, and Reminder link

**Files:**
- Modify: `medtracker/src/pages/dashboard.tsx`

**Interfaces:**
- Consumes: `getMedicationVisual` from Task 6, `API_URL` from `../lib/api`, `authClient` from `../lib/auth-client`, `Stats` shape from `GET /stats` (Task 5): `{ currentStreak: number, dosesTaken: number, weeklyAdherenceRate: number, missedDoses: number }`.
- Produces: navigates to `/reminder` with `state: { medication }` when the "next dose" card is tapped.

- [ ] **Step 1: Replace the component body**

Replace the entire contents of `medtracker/src/pages/dashboard.tsx` with:

```tsx
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Medication } from "../types/medType";
import { API_URL } from "../lib/api";
import { authClient } from "../lib/auth-client";
import { getMedicationVisual, type MedicationCategory } from "../lib/medicationVisuals";

type Stats = {
    currentStreak: number;
    dosesTaken: number;
    weeklyAdherenceRate: number;
    missedDoses: number;
};

export function Dashboard() {
    const navigate = useNavigate();
    const { data: session } = authClient.useSession();
    const [medications, setMedications] = useState<Medication[]>([]);
    const [stats, setStats] = useState<Stats | null>(null);

    const fetchMedications = async () => {
        try {
            const response = await fetch(`${API_URL}/medications`, {
                method: 'GET',
                credentials: 'include'
            });
            if (!response.ok) throw new Error('Failed to fetch medications');
            const responseData = await response.json();
            setMedications(responseData.data);
        } catch (error) {
            console.error('Error fetching medications:', error);
        }
    };

    const fetchStats = async () => {
        try {
            const response = await fetch(`${API_URL}/stats`, {
                method: 'GET',
                credentials: 'include'
            });
            if (!response.ok) throw new Error('Failed to fetch stats');
            const responseData = await response.json();
            setStats(responseData.data);
        } catch (error) {
            console.error('Error fetching stats:', error);
        }
    };

    useEffect(() => {
        fetchMedications();
        fetchStats();
    }, []);

    const nextMedication = medications.length > 0
        ? [...medications].sort((a, b) => {
            if (!a.nextDoseAt) return 1;
            if (!b.nextDoseAt) return -1;
            return new Date(a.nextDoseAt).getTime() - new Date(b.nextDoseAt).getTime();
        })[0]
        : null;

    const handleTakeMedication = async (medId: string) => {
        try {
            await fetch(`${API_URL}/medication/${medId}/take`, {
                method: "POST",
                credentials: 'include',
            });
            fetchMedications();
            fetchStats();
        } catch (error) {
            console.error(error);
        }
    };

    const openReminder = () => {
        if (nextMedication) navigate("/reminder", { state: { medication: nextMedication } });
    };

    const hoursUntilNextDose = nextMedication?.nextDoseAt
        ? Math.max(0, Math.round((new Date(nextMedication.nextDoseAt).getTime() - Date.now()) / (1000 * 60 * 60)))
        : null;

    return (
        <main className="bg-linear-to-b from-[#eef1f4] to-[#f7f8fa] to-35% min-h-screen p-6 gap-5 flex flex-col">
            <h1 className="text-4xl font-heading text-gray-900 mt-8 mb-2 text-start">
                Bom dia, {session?.user?.name ?? "..."}
            </h1>

            <div className="p-4 rounded-[24px] bg-white/70 shadow-[0_4px_20px_rgba(0,0,0,0.06)] flex flex-col items-start gap-3">
                <h2 className="text-lg font-semibold text-gray-900">Streak de Remédios</h2>
                <div className="w-full flex justify-between text-sm text-gray-600">
                    <span>Sequência Atual</span>
                    <span className="font-medium text-gray-900">{stats?.currentStreak ?? 0} dias</span>
                </div>
                <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${Math.min(100, (stats?.currentStreak ?? 0) * 10)}%` }} />
                </div>

                <div className="w-full flex justify-between text-sm text-gray-600">
                    <span>Doses Tomadas</span>
                    <span className="font-medium text-gray-900">{stats?.dosesTaken ?? 0}</span>
                </div>
                <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${Math.min(100, (stats?.dosesTaken ?? 0))}%` }} />
                </div>

                <div className="w-full flex justify-between text-sm text-gray-600">
                    <span>Próxima Dose em</span>
                    <span className="font-medium text-gray-900">{hoursUntilNextDose !== null ? `${hoursUntilNextDose}h` : "-"}</span>
                </div>
            </div>

            <div className="p-4 rounded-[24px] bg-white/70 shadow-[0_4px_20px_rgba(0,0,0,0.06)] flex flex-col items-start">
                <h2 className="text-lg font-semibold text-gray-900 mb-3">Próxima Dose</h2>
                {nextMedication ? (
                        <>
                        <button onClick={openReminder} className="flex gap-4 items-center mb-4 w-full text-left">
                            <div className={`rounded-2xl p-2 w-20 h-20 flex items-center justify-center shrink-0 text-3xl ${getMedicationVisual(nextMedication.category as MedicationCategory).bgClass}`}>
                                {getMedicationVisual(nextMedication.category as MedicationCategory).emoji}
                            </div>
                            <div className="flex flex-col flex-1 items-start">
                                <h3 className="text-black font-semibold text-2xl">{nextMedication.name}</h3>
                                <div className="flex gap-4 mt-1">
                                    <div>
                                        <p className="text-[#7B7F82] text-xs text-start">Dosagem</p>
                                        <p className="text-gray-800 font-medium text-start text-2xl">{nextMedication.dosage}</p>
                                    </div>
                                    <div>
                                        <p className="text-[#7B7F82] text-xs text-start">Horário</p>
                                        <p className="text-gray-800 font-medium text-start text-2xl">
                                            {nextMedication.nextDoseAt
                                                ? new Date(nextMedication.nextDoseAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                                                : "Aguardando"
                                            }
                                        </p>
                                    </div>
                                </div>
                            </div>
                        </button>
                        <button
                            onClick={() => handleTakeMedication(nextMedication.id)}
                            className="w-full py-3 bg-[#F2F3F5] hover:bg-[#E5E7EB] text-black font-medium rounded-xl transition-colors active:scale-[0.98]"
                        >
                            Confirmar dose
                        </button>
                        </>
                ) : (
                    <div className="bg-white p-6 rounded-[24px] text-center border border-dashed border-gray-300 w-full">
                        <p className="text-gray-500 mb-4">Você não tem remédios pendentes.</p>
                    </div>
                )}
            </div>

            <div>
                <h2 className="text-lg font-semibold text-gray-900 mb-3">Insights de Adesão</h2>
                <div className="grid grid-cols-2 gap-3">
                    <div className="p-4 rounded-[20px] bg-white/70 shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
                        <p className="text-xs text-gray-500">Adesão da semana</p>
                        <p className="text-2xl font-semibold text-gray-900">{stats?.weeklyAdherenceRate ?? 0}%</p>
                    </div>
                    <div className="p-4 rounded-[20px] bg-white/70 shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
                        <p className="text-xs text-gray-500">Doses perdidas</p>
                        <p className="text-2xl font-semibold text-gray-900">{stats?.missedDoses ?? 0}</p>
                    </div>
                </div>
            </div>
        </main>
    );
}
```

- [ ] **Step 2: Verify the build**

```bash
cd medtracker
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 3: Manual visual check**

Same Playwright pattern as Task 7/8, screenshotting `/dashboard`. Confirm: greeting, streak card with 3 rows, next-dose card (tap navigates to `/reminder` with the medication in `location.state`, confirmed by checking the Reminder screen renders that medication's name), and the two adherence insight cards.

- [ ] **Step 4: Commit and push**

```bash
git add src/pages/dashboard.tsx
git commit -m "feat: redesign Dashboard with real greeting, streak card, adherence insights"
git push
```

---

## Post-plan follow-ups (explicitly out of scope for this plan)

- Real push notifications for the Reminder screen (needs a service worker + VAPID keys + a push endpoint).
- Real photo upload for medications (needs object storage + a new column + an upload endpoint).
- Functional Edit/Delete on the Medications List (buttons exist as no-op placeholders today; needs `PATCH`/`DELETE /medications/:id` on the API plus a confirmation UI).
- A real AI Assistant behind the Add Medication card.
