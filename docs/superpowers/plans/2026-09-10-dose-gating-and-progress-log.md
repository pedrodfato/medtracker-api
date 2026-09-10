# Dose Gating and Progress Log Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Stop the Dashboard's "Confirmar dose" button from allowing a medication to be marked taken repeatedly before its next scheduled dose is actually due, show when a medication was last taken, and add a Progress page showing a chronological log of every dose ever taken.

**Architecture:** The backend already computes `nextDoseAt` (via `computeNextDoseAt`, which factors in the last dose taken) for `GET /medications` — this plan reuses that exact same function as an authoritative server-side gate on `POST /medication/:id/take`, so the rule can't be bypassed by calling the API directly. `GET /medications` additionally exposes `lastTakenAt` per medication (data it already fetches internally but doesn't return). A new `GET /doses` endpoint returns the full per-user dose history joined with medication name/dosage/category, for a new `/progress` timeline page. The Dashboard's dose button switches from a raw `<button>` to the shared `Button` component (which now correctly forwards `disabled`) so the disabled state is real, not just visual.

**Tech Stack:** Fastify + Drizzle + Postgres (medtracker-api), React + Vite + Tailwind (medtracker). Backend business-logic change (Task 1) needs a real regression check since it's the security-relevant part; frontend tasks are verified via `tsc -b && vite build` plus a manual end-to-end Playwright check with a real local login (the pattern used throughout this session: register a throwaway account, run the backend locally with `TRUSTED_ORIGINS=http://localhost:5173` in `.env`, point `VITE_API_URL=http://localhost:3333` in a throwaway `.env.local`).

## Global Constraints

- The "can't take again yet" rule must be enforced server-side (`POST /medication/:id/take` itself must reject it), not just hidden in the UI — a disabled button alone is not enough.
- Do not gate the very first-ever dose of a medication (when no `doses_history` row exists yet for it) — only gate re-takes. `computeNextDoseAt`'s `fixed`/`weekly` branches don't use the last-dose timestamp at all and can return a "next dose" in the future purely based on time-of-day, which would incorrectly block a brand-new medication's first log if gating applied unconditionally.
- The Progress page timeline must reuse the existing category→visual lookup (`getMedicationVisual`) and the existing pulsing-ring motif already used on the Reminder screen (`bg-primary/40 animate-ping`) for its "today" indicator — do not invent a new color palette or a new pulse effect.
- Backend package is `medtracker-api`, frontend package is `medtracker`, at `/home/pedro/Documents/medtrackerproject/medtracker-api` and `/home/pedro/Documents/medtrackerproject/medtracker` respectively. Each has its own git repo. Work directly on `main` in both (explicit user consent already given for this whole session's work).

---

### Task 1: Gate `POST /medication/:id/take` server-side

**Files:**
- Modify: `medtracker-api/src/routes/medication-routes.ts`

**Interfaces:**
- Consumes: `computeNextDoseAt` (already imported in this file from `../lib/nextDose.js`).
- Produces: `POST /medication/:id/take` now returns `409 { error: string, nextDoseAt: string }` when a dose already exists for this medication and the next one isn't due yet, instead of always inserting.

- [ ] **Step 1: Add the gate**

In `medtracker-api/src/routes/medication-routes.ts`, find the `POST /medication/:id/take` handler:

```ts
        const [medication] = await db.select()
            .from(medications)
            .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)));

        if (!medication) {
            return reply.status(404).send({ error: 'Medicamento não encontrado' });
        }

        await db.insert(doses_history).values({
            userId,
            medicationId,
            takenAt: new Date(),
        })
        return reply.status(200).send({ message: 'Dose registrada com sucesso!' });
    })
```

Replace it with:

```ts
        const [medication] = await db.select()
            .from(medications)
            .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)));

        if (!medication) {
            return reply.status(404).send({ error: 'Medicamento não encontrado' });
        }

        const [lastDose] = await db.select()
            .from(doses_history)
            .where(eq(doses_history.medicationId, medicationId))
            .orderBy(desc(doses_history.takenAt))
            .limit(1);

        const now = new Date();
        const nextDoseDate = computeNextDoseAt(
            {
                scheduleType: medication.scheduleType,
                fixedTime: medication.fixedTime,
                intervalHours: medication.intervalHours,
                daysOfWeek: medication.daysOfWeek,
                startDate: medication.startDate,
            },
            lastDose ? lastDose.takenAt : null,
            now
        );

        if (lastDose && nextDoseDate && nextDoseDate.getTime() > now.getTime()) {
            return reply.status(409).send({
                error: 'Dose ainda não disponível',
                nextDoseAt: nextDoseDate.toISOString(),
            });
        }

        await db.insert(doses_history).values({
            userId,
            medicationId,
            takenAt: now,
        })
        return reply.status(200).send({ message: 'Dose registrada com sucesso!' });
    })
```

- [ ] **Step 2: Verify the backend builds**

```bash
cd medtracker-api
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 3: Manual regression check against a real database**

This is the security-relevant part of this plan, so verify it against real data rather than trusting the build alone. Using the pattern from earlier in this session (backend running locally via `npm run dev`, pointed at the real Neon database via the existing `.env`):

1. Register a throwaway account (or use an existing one), add a medication with `scheduleType: weekly`, today's weekday selected, and a `fixedTime` a few minutes in the past (so it's currently due).
2. `curl` or use the browser to call `POST /medication/:id/take` once — expect `200`.
3. Immediately call it again for the same medication — expect `409` with `error: "Dose ainda não disponível"` and a `nextDoseAt` in the future.
4. Confirm `doses_history` only has ONE new row for that medication (query it directly, or check `GET /medications` shows `lastTakenAt` only updated once).

- [ ] **Step 4: Commit**

```bash
git add src/routes/medication-routes.ts
git commit -m "feat: reject POST /medication/:id/take before the next dose is due"
```

---

### Task 2: Expose `lastTakenAt` on `GET /medications`

**Files:**
- Modify: `medtracker-api/src/routes/medication-routes.ts`

**Interfaces:**
- Produces: each medication object in `GET /medications`'s `data` array now also has `lastTakenAt: string | null`.

- [ ] **Step 1: Add the field**

In the same file, find this block inside the `GET /medications` handler:

```ts
            return {
                ...med,
                nextDoseAt 
            };
```

Replace it with:

```ts
            return {
                ...med,
                nextDoseAt,
                lastTakenAt: lastDose ? lastDose.takenAt.toISOString() : null,
            };
```

- [ ] **Step 2: Verify the backend builds**

```bash
cd medtracker-api
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 3: Commit**

```bash
git add src/routes/medication-routes.ts
git commit -m "feat: expose lastTakenAt on GET /medications"
```

---

### Task 3: `GET /doses` — full dose history log

**Files:**
- Modify: `medtracker-api/src/routes/medication-routes.ts`

**Interfaces:**
- Produces: `GET /doses` → `200 { data: Array<{ id: number, medicationId: number, medicationName: string, dosage: string, category: 'pill' | 'drop' | 'vitamin', takenAt: string }> }`, newest first, scoped to the authenticated user.

- [ ] **Step 1: Add the route**

Add this route at the end of `medicationsRoutes`, right after the `GET /stats` handler's closing `})` and before the function's final closing `}`:

```ts
    app.get('/doses', {preHandler: [verifySession]}, async (request, reply) => {
        const session = await auth.api.getSession({ headers: request.headers as any });
        if (!session || !session.user) return reply.status(401).send({ error: 'Unauthorized' });

        const userId = session.user.id;

        try {
            const rows = await db.select({
                id: doses_history.id,
                medicationId: doses_history.medicationId,
                takenAt: doses_history.takenAt,
                medicationName: medications.name,
                dosage: medications.dosage,
                category: medications.category,
            })
                .from(doses_history)
                .innerJoin(medications, eq(doses_history.medicationId, medications.id))
                .where(eq(doses_history.userId, userId))
                .orderBy(desc(doses_history.takenAt));

            return reply.status(200).send({
                data: rows.map((r) => ({ ...r, takenAt: r.takenAt.toISOString() })),
            });
        } catch (error) {
            console.error('Erro ao buscar historico de doses:', error);
            return reply.status(500).send({ error: 'Erro interno ao buscar historico' });
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
git commit -m "feat: add GET /doses history log endpoint"
git push
```

---

### Task 4: Dashboard — disabled dose button + last-taken display

**Files:**
- Modify: `medtracker/src/types/medType.ts`
- Modify: `medtracker/src/pages/dashboard.tsx`

**Interfaces:**
- Consumes: `Button` from `../components/button` (already forwards `disabled`/`onClick` correctly — see this session's earlier fix to that component).
- Produces: `Medication.lastTakenAt?: string | null`.

- [ ] **Step 1: Widen the `Medication` type**

In `medtracker/src/types/medType.ts`, add `lastTakenAt` next to the existing optional fields:

```ts
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
}
```

- [ ] **Step 2: Update the Dashboard**

In `medtracker/src/pages/dashboard.tsx`, add the `Button` import:

```tsx
import { Button } from "../components/button";
```

right after the existing `import { getMedicationVisual, type MedicationCategory } from "../lib/medicationVisuals";` line.

Replace the `handleTakeMedication` function:

```tsx
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
```

with:

```tsx
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
```

Add this right after the existing `hoursUntilNextDose` calculation:

```tsx
    const canTakeNow = !nextMedication?.nextDoseAt || new Date(nextMedication.nextDoseAt).getTime() <= Date.now();
```

Then find this block:

```tsx
                        </button>
                        <button
                            onClick={() => handleTakeMedication(nextMedication.id)}
                            className="w-full py-3 bg-[#F2F3F5] hover:bg-[#E5E7EB] text-black font-medium rounded-xl transition-colors active:scale-[0.98]"
                        >
                            Confirmar dose
                        </button>
                        </>
```

Replace it with:

```tsx
                        </button>
                        {nextMedication.lastTakenAt && (
                            <p className="text-xs text-gray-400 mb-3 -mt-2">
                                Última dose: {new Date(nextMedication.lastTakenAt).toLocaleString('pt-BR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' })}
                            </p>
                        )}
                        <Button
                            variant="secondary"
                            onClick={() => handleTakeMedication(nextMedication.id)}
                            disabled={!canTakeNow}
                            className="w-full"
                        >
                            {canTakeNow ? "Confirmar dose" : "Próxima dose ainda não disponível"}
                        </Button>
                        </>
```

- [ ] **Step 3: Verify the build**

```bash
cd medtracker
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 4: End-to-end verification**

Using the local-backend pattern from earlier in this session: register, add a `weekly` medication with today's weekday selected and `fixedTime` a few minutes in the past. On `/dashboard`:
1. Confirm the "Confirmar dose"/"Última dose" line is absent (never taken yet) and the button is enabled and reads "Confirmar dose".
2. Click it. Confirm the dashboard refetches and now shows "Última dose: ..." and the button is disabled, grayed out (not just visually — try clicking it; nothing should happen), reading "Próxima dose ainda não disponível".
3. Confirm no console errors.

- [ ] **Step 5: Commit**

```bash
git add src/types/medType.ts src/pages/dashboard.tsx
git commit -m "feat: disable dose button until next dose is due, show last-taken time"
```

---

### Task 5: Progress page — dose history timeline

**Files:**
- Create: `medtracker/src/pages/progress.tsx`
- Modify: `medtracker/src/App.tsx`

**Interfaces:**
- Consumes: `getMedicationVisual`, `type MedicationCategory` from `../lib/medicationVisuals`; `API_URL` from `../lib/api`.
- Produces: route `/progress` (registered inside the `LogadoLayout` route group, so the bottom nav — which already links here — shows on this page).

- [ ] **Step 1: Create the Progress page**

Create `medtracker/src/pages/progress.tsx`:

```tsx
import { useEffect, useState } from "react";
import { API_URL } from "../lib/api";
import { getMedicationVisual, type MedicationCategory } from "../lib/medicationVisuals";

type DoseLogEntry = {
    id: number;
    medicationId: number;
    medicationName: string;
    dosage: string;
    category: MedicationCategory;
    takenAt: string;
};

function isSameDay(a: Date, b: Date): boolean {
    return a.toDateString() === b.toDateString();
}

function dayLabel(date: Date, today: Date): string {
    const yesterday = new Date(today);
    yesterday.setDate(yesterday.getDate() - 1);
    if (isSameDay(date, today)) return "Hoje";
    if (isSameDay(date, yesterday)) return "Ontem";
    return date.toLocaleDateString('pt-BR', { day: '2-digit', month: 'long' });
}

export function Progress() {
    const [doses, setDoses] = useState<DoseLogEntry[]>([]);
    const [isLoading, setIsLoading] = useState(true);

    useEffect(() => {
        const loadDoses = async () => {
            try {
                const response = await fetch(`${API_URL}/doses`, {
                    method: 'GET',
                    credentials: 'include',
                });
                if (!response.ok) throw new Error('Failed to fetch doses');
                const responseData = await response.json();
                setDoses(responseData.data);
            } catch (error) {
                console.error('Error fetching dose history:', error);
            } finally {
                setIsLoading(false);
            }
        };
        loadDoses();
    }, []);

    const today = new Date();
    const groups: { label: string; entries: DoseLogEntry[] }[] = [];
    doses.forEach((dose) => {
        const label = dayLabel(new Date(dose.takenAt), today);
        const lastGroup = groups[groups.length - 1];
        if (lastGroup && lastGroup.label === label) {
            lastGroup.entries.push(dose);
        } else {
            groups.push({ label, entries: [dose] });
        }
    });

    return (
        <main className="bg-linear-to-b from-[#eef1f4] to-[#f7f8fa] to-35% min-h-screen p-6 flex flex-col gap-6">
            <h1 className="text-4xl font-heading text-gray-900 mt-8 mb-2 text-start">Progresso</h1>

            {isLoading ? (
                <p className="text-gray-500 text-center">Carregando...</p>
            ) : groups.length === 0 ? (
                <div className="bg-white p-6 rounded-[24px] text-center border border-dashed border-gray-300">
                    <p className="text-gray-500">Nenhuma dose registrada ainda. Toda vez que você confirmar um remédio, ele aparece aqui.</p>
                </div>
            ) : (
                groups.map((group, groupIndex) => (
                    <div key={group.label} className="flex flex-col gap-3">
                        <h2 className="text-sm font-semibold text-gray-500 uppercase tracking-wide">{group.label}</h2>
                        <div className="relative flex flex-col gap-4 pl-6">
                            <div className="absolute left-[7px] top-2 bottom-2 w-px bg-gray-200" aria-hidden="true" />
                            {group.entries.map((dose, entryIndex) => {
                                const visual = getMedicationVisual(dose.category);
                                const isFirstToday = groupIndex === 0 && entryIndex === 0 && group.label === "Hoje";
                                return (
                                    <div
                                        key={dose.id}
                                        className="relative flex items-center gap-3 animate-in fade-in slide-in-from-left-2"
                                        style={{ animationDelay: `${entryIndex * 60}ms`, animationFillMode: 'backwards' }}
                                    >
                                        <div className="absolute -left-6 top-1/2 -translate-y-1/2 flex items-center justify-center">
                                            {isFirstToday && (
                                                <span className="absolute w-4 h-4 rounded-full bg-primary/40 animate-ping" />
                                            )}
                                            <span className={`relative w-3.5 h-3.5 rounded-full border-2 border-white ${isFirstToday ? 'bg-primary' : 'bg-gray-300'}`} />
                                        </div>
                                        <div className="flex-1 flex items-center gap-3 bg-white/70 rounded-2xl p-3 shadow-[0_4px_20px_rgba(0,0,0,0.05)]">
                                            <div className={`w-10 h-10 rounded-xl ${visual.bgClass} flex items-center justify-center text-xl shrink-0`}>
                                                {visual.emoji}
                                            </div>
                                            <div className="flex-1">
                                                <p className="font-medium text-gray-900 text-sm">{dose.medicationName}</p>
                                                <p className="text-xs text-gray-500">{dose.dosage}</p>
                                            </div>
                                            <p className="text-sm font-medium text-gray-700">
                                                {new Date(dose.takenAt).toLocaleTimeString('pt-BR', { hour: '2-digit', minute: '2-digit' })}
                                            </p>
                                        </div>
                                    </div>
                                );
                            })}
                        </div>
                    </div>
                ))
            )}
        </main>
    );
}
```

- [ ] **Step 2: Register the route**

In `medtracker/src/App.tsx`, add the import:

```tsx
import { Progress } from './pages/progress';
```

Add the route inside the `<Route element={<LogadoLayout />}>` block, alongside `/dashboard`, `/list`, `/add`:

```tsx
          <Route path="/progress" element={<PrivateRoute><Progress /></PrivateRoute>} />
```

- [ ] **Step 3: Verify the build**

```bash
cd medtracker
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 4: End-to-end verification**

Using the same local-backend pattern: after taking at least one dose in Task 4's verification, navigate to `/progress`. Confirm:
1. A "Hoje" group appears with the dose just taken, showing medication name, dosage, and time.
2. The first entry's timeline dot has the pulsing ring animation; other entries (if any) don't.
3. The bottom nav's "Progresso" tab is visible and highlighted active.
4. No console errors.

- [ ] **Step 5: Commit and push**

```bash
git add src/pages/progress.tsx src/App.tsx
git commit -m "feat: add Progress page with dose history timeline"
git push
```
