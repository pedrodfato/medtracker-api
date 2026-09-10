# Swipeable "Próxima Dose" Card Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the Dashboard's "Próxima Dose" card swipeable between medications; when the user swipes to a different medication, the "Streak de Remédios" card above it switches to that medication's own stats instead of an aggregate. The "Insights de Adesão" card stays aggregate, but its "Doses perdidas" number gets a per-medication breakdown so the user can see which medication's doses they're missing.

**Architecture:** `computeStats` (already accepts an array of medications + doses and already loops per-medication internally to sum `missedDoses`/`weeklyAdherenceRate`) gets two small additions: it now also returns a `missedByMedication` breakdown from that same loop, and the `GET /stats` route calls it once for the aggregate ("overall") and once per medication ("perMedication"), computed up front in a single request/response so swiping never needs a new network round-trip. The frontend replaces the single "next medication" card with a `swiper` carousel (already an unused dependency) and switches the Streak card's data source based on the currently-visible slide.

**Tech Stack:** Fastify + Drizzle + Postgres (medtracker-api), React + Vite + Tailwind (medtracker), `swiper` v12 (`swiper/react`, `swiper/modules`). Backend logic changes get Node test-runner coverage (`npm test`, already configured). Frontend has no test runner; verified via `tsc -b && vite build` plus a manual end-to-end Playwright check with a real local login (the pattern used throughout this session).

## Global Constraints

- Swiping between medications must NOT trigger a new network request — both `/medications` and `/stats` are already fetched once on Dashboard mount and must contain everything needed for every slide.
- Only the "Streak de Remédios" card (Sequência Atual / Doses Tomadas / Próxima Dose em) becomes per-medication. "Insights de Adesão" (Adesão da semana / Doses perdidas) stays aggregate across all medications — confirmed with the user.
- The "Doses perdidas" number gets a per-medication breakdown (medication name + how many doses of that medication were missed), so the user can see which specific medication is being missed, not just a total count.
- Backend package is `medtracker-api`, frontend package is `medtracker`, at `/home/pedro/Documents/medtrackerproject/medtracker-api` and `/home/pedro/Documents/medtrackerproject/medtracker` respectively. Each has its own git repo. Work directly on `main` in both (explicit user consent already given for this whole session).

---

### Task 1: `computeStats` returns a per-medication missed-doses breakdown

**Files:**
- Modify: `medtracker-api/src/lib/stats.ts`
- Modify: `medtracker-api/src/lib/stats.test.ts`

**Interfaces:**
- Produces: `Stats` type gains `missedByMedication: { medicationId: number; missedCount: number }[]` (sorted by `missedCount` descending, only entries with `missedCount > 0`). All other `Stats` fields unchanged. `computeStats`'s signature is unchanged.

- [ ] **Step 1: Write the failing test**

Add this test to the end of `medtracker-api/src/lib/stats.test.ts` (after the existing `'a medication added today is not charged for doses missed before it existed'` test):

```ts
test('missedByMedication breaks down missed doses per medication, sorted by count desc, zero-miss meds omitted', () => {
  const now = new Date('2026-09-09T20:00:00');
  const medications = [
    { id: 1, scheduleType: 'fixed' as const, intervalHours: null, daysOfWeek: null, startDate: new Date('2026-08-01T00:00:00') }, // 7 expected, 0 taken -> 7 missed
    { id: 2, scheduleType: 'fixed' as const, intervalHours: null, daysOfWeek: null, startDate: new Date('2026-08-01T00:00:00') }, // 7 expected, 5 taken -> 2 missed
    { id: 3, scheduleType: 'fixed' as const, intervalHours: null, daysOfWeek: null, startDate: new Date('2026-08-01T00:00:00') }, // 7 expected, 7 taken -> 0 missed, omitted
  ];
  const doses = [
    { medicationId: 2, takenAt: new Date('2026-09-03T08:00:00') },
    { medicationId: 2, takenAt: new Date('2026-09-04T08:00:00') },
    { medicationId: 2, takenAt: new Date('2026-09-05T08:00:00') },
    { medicationId: 2, takenAt: new Date('2026-09-06T08:00:00') },
    { medicationId: 2, takenAt: new Date('2026-09-07T08:00:00') },
    { medicationId: 3, takenAt: new Date('2026-09-03T08:00:00') },
    { medicationId: 3, takenAt: new Date('2026-09-04T08:00:00') },
    { medicationId: 3, takenAt: new Date('2026-09-05T08:00:00') },
    { medicationId: 3, takenAt: new Date('2026-09-06T08:00:00') },
    { medicationId: 3, takenAt: new Date('2026-09-07T08:00:00') },
    { medicationId: 3, takenAt: new Date('2026-09-08T08:00:00') },
    { medicationId: 3, takenAt: new Date('2026-09-09T08:00:00') },
  ];
  const stats = computeStats(medications, doses, now);
  assert.deepEqual(stats.missedByMedication, [
    { medicationId: 1, missedCount: 7 },
    { medicationId: 2, missedCount: 2 },
  ]);
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
cd medtracker-api
npm test
```

Expected: FAIL — `stats.missedByMedication` is `undefined`, `assert.deepEqual` fails.

- [ ] **Step 3: Implement the breakdown**

In `medtracker-api/src/lib/stats.ts`, change:

```ts
export type Stats = {
  currentStreak: number;
  dosesTaken: number;
  weeklyAdherenceRate: number;
  missedDoses: number;
};
```

to:

```ts
export type Stats = {
  currentStreak: number;
  dosesTaken: number;
  weeklyAdherenceRate: number;
  missedDoses: number;
  missedByMedication: { medicationId: number; missedCount: number }[];
};
```

Then change the body of `computeStats`:

```ts
export function computeStats(medications: StatsMedication[], doses: StatsDose[], now: Date): Stats {
  const windowStart = new Date(now);
  windowStart.setDate(windowStart.getDate() - 6);
  windowStart.setHours(0, 0, 0, 0);

  const dosesInWindow = doses.filter((d) => d.takenAt.getTime() >= windowStart.getTime());

  let totalExpected = 0;
  let totalMissed = 0;
  for (const medication of medications) {
    const expected = expectedDosesInWindow(medication, windowStart, now);
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

to:

```ts
export function computeStats(medications: StatsMedication[], doses: StatsDose[], now: Date): Stats {
  const windowStart = new Date(now);
  windowStart.setDate(windowStart.getDate() - 6);
  windowStart.setHours(0, 0, 0, 0);

  const dosesInWindow = doses.filter((d) => d.takenAt.getTime() >= windowStart.getTime());

  let totalExpected = 0;
  let totalMissed = 0;
  const missedByMedication: { medicationId: number; missedCount: number }[] = [];
  for (const medication of medications) {
    const expected = expectedDosesInWindow(medication, windowStart, now);
    const taken = dosesInWindow.filter((d) => d.medicationId === medication.id).length;
    const missed = Math.max(expected - taken, 0);
    totalExpected += expected;
    totalMissed += missed;
    if (missed > 0) {
      missedByMedication.push({ medicationId: medication.id, missedCount: missed });
    }
  }
  missedByMedication.sort((a, b) => b.missedCount - a.missedCount);

  const weeklyAdherenceRate = totalExpected === 0
    ? 100
    : Math.round(((totalExpected - totalMissed) / totalExpected) * 100);

  return {
    currentStreak: computeCurrentStreak(doses, now),
    dosesTaken: doses.length,
    weeklyAdherenceRate,
    missedDoses: totalMissed,
    missedByMedication,
  };
}
```

- [ ] **Step 4: Run the test to verify it passes**

```bash
npm test
```

Expected: all tests pass (17/17 — 16 pre-existing plus this new one).

- [ ] **Step 5: Verify the build**

```bash
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/stats.ts src/lib/stats.test.ts
git commit -m "feat: computeStats returns per-medication missed-dose breakdown"
```

---

### Task 2: `GET /stats` returns overall + per-medication stats in one response

**Files:**
- Modify: `medtracker-api/src/routes/medication-routes.ts`

**Interfaces:**
- Consumes: `computeStats` from Task 1 (now returning `missedByMedication` too — no signature change, so this task doesn't need to know the internals, just that `Stats` has the new field).
- Produces: `GET /stats` response shape changes from `{ data: Stats }` to `{ data: { overall: Stats, perMedication: Record<number, Stats> } }`.

- [ ] **Step 1: Replace the handler body**

In `medtracker-api/src/routes/medication-routes.ts`, find the `GET /stats` handler:

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
                    startDate: m.startDate,
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

Replace it with:

```ts
    app.get('/stats', {preHandler: [verifySession]}, async (request, reply) => {
        const session = await auth.api.getSession({ headers: request.headers as any });
        if (!session || !session.user) return reply.status(401).send({ error: 'Unauthorized' });

        const userId = session.user.id;

        try {
            const userMeds = await db.select().from(medications).where(eq(medications.userId, userId));
            const userDoses = await db.select().from(doses_history).where(eq(doses_history.userId, userId));
            const now = new Date();

            const toStatsMedication = (m: typeof userMeds[number]) => ({
                id: m.id,
                scheduleType: m.scheduleType,
                intervalHours: m.intervalHours,
                daysOfWeek: m.daysOfWeek,
                startDate: m.startDate,
            });
            const toStatsDose = (d: typeof userDoses[number]) => ({ medicationId: d.medicationId, takenAt: d.takenAt });

            const overall = computeStats(userMeds.map(toStatsMedication), userDoses.map(toStatsDose), now);

            const perMedication: Record<number, ReturnType<typeof computeStats>> = {};
            for (const med of userMeds) {
                const medDoses = userDoses.filter((d) => d.medicationId === med.id);
                perMedication[med.id] = computeStats([toStatsMedication(med)], medDoses.map(toStatsDose), now);
            }

            return reply.status(200).send({ data: { overall, perMedication } });
        } catch (error) {
            console.error('Erro ao calcular estatisticas:', error);
            return reply.status(500).send({ error: 'Erro interno ao calcular estatisticas' });
        }
    })
```

- [ ] **Step 2: Verify the build**

```bash
cd medtracker-api
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit and push**

```bash
git add src/routes/medication-routes.ts
git commit -m "feat: GET /stats returns overall + per-medication stats in one response"
git push
```

---

### Task 3: Dashboard — swipeable "Próxima Dose" card with per-medication streak

**Files:**
- Modify: `medtracker/src/pages/dashboard.tsx`

**Interfaces:**
- Consumes: `swiper/react` (`Swiper`, `SwiperSlide`), `swiper/modules` (`Pagination`) — already a dependency (`swiper: ^12.1.3` in `medtracker/package.json`), confirmed installed with these subpaths available (`swiper/react`, `swiper/modules`, `swiper/css`, `swiper/css/pagination`). New `GET /stats` response shape from Task 2: `{ overall: Stats, perMedication: Record<number, Stats> }` where `Stats` now includes `missedByMedication: { medicationId: number; missedCount: number }[]` (Task 1).
- Produces: no new exports — this is a leaf page component.

- [ ] **Step 1: Replace the component body**

Replace the entire contents of `medtracker/src/pages/dashboard.tsx` with:

```tsx
import { useState, useEffect } from "react";
import { useNavigate } from "react-router-dom";
import { Swiper, SwiperSlide } from "swiper/react";
import { Pagination } from "swiper/modules";
import "swiper/css";
import "swiper/css/pagination";
import type { Medication } from "../types/medType";
import { API_URL } from "../lib/api";
import { authClient } from "../lib/auth-client";
import { getMedicationVisual, type MedicationCategory } from "../lib/medicationVisuals";
import { Button } from "../components/button";

type Stats = {
    currentStreak: number;
    dosesTaken: number;
    weeklyAdherenceRate: number;
    missedDoses: number;
    missedByMedication: { medicationId: number; missedCount: number }[];
};

type DashboardStats = {
    overall: Stats;
    perMedication: Record<string, Stats>;
};

export function Dashboard() {
    const navigate = useNavigate();
    const { data: session } = authClient.useSession();
    const [medications, setMedications] = useState<Medication[]>([]);
    const [stats, setStats] = useState<DashboardStats | null>(null);
    const [activeMedicationIndex, setActiveMedicationIndex] = useState(0);

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

    const sortedMedications = [...medications].sort((a, b) => {
        if (!a.nextDoseAt) return 1;
        if (!b.nextDoseAt) return -1;
        return new Date(a.nextDoseAt).getTime() - new Date(b.nextDoseAt).getTime();
    });

    const activeMedication = sortedMedications[activeMedicationIndex] ?? null;
    const activeStats = activeMedication ? stats?.perMedication[activeMedication.id] : undefined;

    const handleTakeMedication = async (medId: string) => {
        try {
            const response = await fetch(`${API_URL}/medication/${medId}/take`, {
                method: "POST",
                credentials: 'include',
            });
            if (!response.ok) {
                const data = await response.json().catch(() => null);
                console.error('Erro ao confirmar dose:', data?.error ?? response.status);
                return;
            }
            fetchMedications();
            fetchStats();
        } catch (error) {
            console.error(error);
        }
    };

    const openReminder = () => {
        if (activeMedication) navigate("/reminder", { state: { medication: activeMedication } });
    };

    const hoursUntilNextDose = activeMedication?.nextDoseAt
        ? Math.max(0, Math.round((new Date(activeMedication.nextDoseAt).getTime() - Date.now()) / (1000 * 60 * 60)))
        : null;

    const canTakeMedicationNow = (med: Medication) =>
        !med.lastTakenAt || !med.nextDoseAt || new Date(med.nextDoseAt).getTime() <= Date.now();

    return (
        <main className="bg-linear-to-b from-[#eef1f4] to-[#f7f8fa] to-35% min-h-screen p-6 gap-5 flex flex-col">
            <h1 className="text-4xl font-heading text-gray-900 mt-8 mb-2 text-start">
                Bom dia, {session?.user?.name ?? "..."}
            </h1>

            <div className="p-4 rounded-[24px] bg-white/70 shadow-[0_4px_20px_rgba(0,0,0,0.06)] flex flex-col items-start gap-3">
                <h2 className="text-lg font-semibold text-gray-900">Streak de Remédios</h2>
                <div className="w-full flex justify-between text-sm text-gray-600">
                    <span>Sequência Atual</span>
                    <span className="font-medium text-gray-900">{activeStats?.currentStreak ?? 0} dias</span>
                </div>
                <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${Math.min(100, (activeStats?.currentStreak ?? 0) * 10)}%` }} />
                </div>

                <div className="w-full flex justify-between text-sm text-gray-600">
                    <span>Doses Tomadas</span>
                    <span className="font-medium text-gray-900">{activeStats?.dosesTaken ?? 0}</span>
                </div>
                <div className="w-full h-2 bg-gray-200 rounded-full overflow-hidden">
                    <div className="h-full bg-primary" style={{ width: `${Math.min(100, (activeStats?.dosesTaken ?? 0))}%` }} />
                </div>

                <div className="w-full flex justify-between text-sm text-gray-600">
                    <span>Próxima Dose em</span>
                    <span className="font-medium text-gray-900">{hoursUntilNextDose !== null ? `${hoursUntilNextDose}h` : "-"}</span>
                </div>
            </div>

            <div className="p-4 rounded-[24px] bg-white/70 shadow-[0_4px_20px_rgba(0,0,0,0.06)] flex flex-col items-start">
                <h2 className="text-lg font-semibold text-gray-900 mb-3">Próxima Dose</h2>
                {sortedMedications.length > 0 ? (
                    <Swiper
                        modules={[Pagination]}
                        pagination={{ clickable: true }}
                        onSlideChange={(swiper) => setActiveMedicationIndex(swiper.activeIndex)}
                        className="w-full pb-8"
                    >
                        {sortedMedications.map((med) => (
                            <SwiperSlide key={med.id}>
                                <button onClick={openReminder} className="flex gap-4 items-center mb-4 w-full text-left">
                                    <div className={`rounded-2xl p-2 w-20 h-20 flex items-center justify-center shrink-0 text-3xl ${getMedicationVisual(med.category as MedicationCategory).bgClass}`}>
                                        {getMedicationVisual(med.category as MedicationCategory).emoji}
                                    </div>
                                    <div className="flex flex-col flex-1 items-start">
                                        <h3 className="text-black font-semibold text-2xl">{med.name}</h3>
                                        <div className="flex gap-4 mt-1">
                                            <div>
                                                <p className="text-[#7B7F82] text-xs text-start">Dosagem</p>
                                                <p className="text-gray-800 font-medium text-start text-2xl">{med.dosage}</p>
                                            </div>
                                            <div>
                                                <p className="text-[#7B7F82] text-xs text-start">Horário</p>
                                                <p className="text-gray-800 font-medium text-start text-2xl">
                                                    {med.nextDoseAt
                                                        ? new Date(med.nextDoseAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })
                                                        : "Aguardando"
                                                    }
                                                </p>
                                            </div>
                                        </div>
                                    </div>
                                </button>
                                {med.lastTakenAt && (
                                    <p className="text-xs text-gray-400 mb-3 -mt-2">
                                        Última dose: {new Date(med.lastTakenAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                                    </p>
                                )}
                                <Button
                                    variant="secondary"
                                    onClick={() => handleTakeMedication(med.id)}
                                    disabled={!canTakeMedicationNow(med)}
                                    className="w-full"
                                >
                                    {canTakeMedicationNow(med) ? "Confirmar dose" : "Próxima dose ainda não disponível"}
                                </Button>
                            </SwiperSlide>
                        ))}
                    </Swiper>
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
                        <p className="text-2xl font-semibold text-gray-900">{stats?.overall.weeklyAdherenceRate ?? 0}%</p>
                    </div>
                    <div className="p-4 rounded-[20px] bg-white/70 shadow-[0_4px_20px_rgba(0,0,0,0.06)]">
                        <p className="text-xs text-gray-500">Doses perdidas</p>
                        <p className="text-2xl font-semibold text-gray-900">{stats?.overall.missedDoses ?? 0}</p>
                        {stats?.overall.missedByMedication && stats.overall.missedByMedication.length > 0 && (
                            <div className="mt-2 flex flex-col gap-0.5">
                                {stats.overall.missedByMedication.map((entry) => {
                                    const med = medications.find((m) => m.id === String(entry.medicationId));
                                    return (
                                        <p key={entry.medicationId} className="text-xs text-gray-500 truncate">
                                            {med?.name ?? "Remédio"}: {entry.missedCount}
                                        </p>
                                    );
                                })}
                            </div>
                        )}
                    </div>
                </div>
            </div>
        </main>
    );
}
```

Notable design choices carried over from the plan, in case a reviewer wonders why:
- `activeMedicationIndex` only drives which slide's data feeds the "Streak de Remédios" card and `openReminder`/`hoursUntilNextDose`. Each slide's "Confirmar dose" button computes its OWN enabled state via `canTakeMedicationNow(med)` (not tied to `activeMedicationIndex`) — Swiper keeps every slide mounted in the DOM (not just the visible one), so if the button's gating logic were scoped to only the active medication, every off-screen slide's button would incorrectly show as always-enabled regardless of that medication's real due status. Each slide must independently know whether its own medication is due.
- `stats.perMedication` keys arrive from JSON as strings (`Record<string, Stats>`), and `Medication.id` (from `medtracker/src/types/medType.ts`) is already typed `string`, so `stats?.perMedication[activeMedication.id]` needs no type coercion.

- [ ] **Step 2: Verify the build**

```bash
cd medtracker
npm run build
```

Expected: no TypeScript errors. If `swiper/react` or `swiper/modules` fail to resolve, run `npm ls swiper` to confirm the installed version still exposes those subpaths (confirmed present in `swiper@12.1.3` at plan-writing time).

- [ ] **Step 3: End-to-end verification**

Using the local-backend pattern established throughout this session (register a throwaway account, run `medtracker-api` locally via `npm run dev` with `TRUSTED_ORIGINS=http://localhost:5173` in its `.env`, point `VITE_API_URL=http://localhost:3333` in a throwaway `medtracker/.env.local`):

1. Add two medications with different categories/names (e.g. "Levotiroxina" and "Vitamina D"). Take a dose on only one of them.
2. On `/dashboard`, confirm the "Próxima Dose" card shows the first medication with pagination dots below it, and swiping (or using Playwright's `locator.swipe`/mouse drag, or clicking a pagination dot) moves to the second medication's card content (name/dosage/horário/última dose/button state all change).
3. Confirm the "Streak de Remédios" numbers above change when swiping — take a dose on one medication only, then verify swiping to it shows `Doses Tomadas: 1` while swiping to the untaken one shows `Doses Tomadas: 0` (or whatever counts apply given each medication's own schedule).
4. Confirm "Insights de Adesão" values (Adesão da semana / Doses perdidas) stay the same while swiping between slides.
5. Confirm the "Doses perdidas" card shows a small per-medication breakdown line for any medication with a nonzero missed count (e.g. "Levotiroxina: 2"), and shows nothing extra if `missedByMedication` is empty.
6. Confirm tapping a slide's medication info still opens `/reminder` for that specific medication (not always the first).
7. Delete down to a single medication and confirm the card still renders correctly (Swiper with one slide, no broken pagination).
8. Delete the last medication and confirm the "Você não tem remédios pendentes" empty state still renders (no Swiper mounted).
9. No console errors throughout.

- [ ] **Step 4: Commit and push**

```bash
git add src/pages/dashboard.tsx
git commit -m "feat: swipeable Proxima Dose card with per-medication streak"
git push
```
