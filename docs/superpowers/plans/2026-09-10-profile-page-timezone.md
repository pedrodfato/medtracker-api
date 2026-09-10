# Profile Page with Editable Timezone Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the Profile page (the `/profile` route the bottom nav already links to but that doesn't exist yet — same class of gap as the earlier missing `/progress` route). Let the user edit their name and pick their own timezone from a curated list of Brazilian zones, so medication scheduling math is correct for users outside São Paulo — Render's free tier only offers an Ohio host with no region choice, so this can't be fixed by picking a different server location.

**Architecture:** The backend's Node process is pinned to `America/Sao_Paulo` (`process.env.TZ`, set earlier this session in `server.ts`), and all the existing schedule math (`computeNextDoseAt`, `computeNextAllowedDoseAt`, `computeStats`) reads wall-clock time via that process-local timezone. Since Brazil has observed no daylight saving time since 2019, every Brazilian IANA zone has a *fixed* UTC offset — so instead of rewriting that already-tested date math to be timezone-aware, this plan adds a thin, pure "shift" layer: before calling into the existing math, shift every `Date` input by the difference between the user's chosen zone and the process's zone (`America/Sao_Paulo`); after getting a result back out, shift it back by the same amount before returning it to the client. The existing math never needs to know timezones exist. A `timezone` column is added to the `user` table via better-auth's `additionalFields` mechanism, and a new Profile page lets the user edit their name and timezone (both via better-auth's built-in `updateUser`) and log out.

**Tech Stack:** Fastify + Drizzle + Postgres (medtracker-api), React + Vite + Tailwind (medtracker), better-auth (`additionalFields`, `updateUser`, `signOut` — all built into the auth library already in use, no new dependency). Backend shift-math gets Node test-runner coverage (`npm test`, already configured). Frontend has no test runner; verified via `tsc -b && vite build` plus a manual end-to-end Playwright check with a real local login.

## Global Constraints

- No photo upload — the avatar is initials-based (first letters of the user's name), matching this session's earlier decision to defer photo upload indefinitely.
- Scope is Brazilian timezones only: `America/Sao_Paulo` (default), `America/Manaus`, `America/Rio_Branco`, `America/Noronha`. All four have fixed, DST-free UTC offsets — the shift-based approach in this plan relies on that and is NOT safe to reuse for DST-observing zones without more work.
- "Editar" (pencil, on the avatar card) and the "Meus Dados" row both open the SAME name-editing UI — there's no separate personal-data field to justify two different flows.
- "Preferências de Alerta" stays non-functional (no notification system exists yet, deferred earlier this session) — tapping it shows a small "Em breve" note, nothing else.
- "Sair da conta" must actually log the user out (`authClient.signOut()`) and return to `/`.
- Backend package is `medtracker-api`, frontend package is `medtracker`, at `/home/pedro/Documents/medtrackerproject/medtracker-api` and `/home/pedro/Documents/medtrackerproject/medtracker` respectively. Each has its own git repo. Work directly on `main` in both (explicit user consent already given for this whole session).

---

### Task 1: Add `timezone` field to the `user` table

**Files:**
- Modify: `medtracker-api/src/schema.ts`
- Modify: `medtracker-api/src/lib/auth.ts`

**Interfaces:**
- Produces: `user.timezone: text, not null, default 'America/Sao_Paulo'` column in Postgres. `session.user.timezone` becomes available server-side after `auth.api.getSession(...)`, and client-side via `authClient.useSession()`, once better-auth is told about the field via `additionalFields`.

- [ ] **Step 1: Add the column to the Drizzle schema**

In `medtracker-api/src/schema.ts`, find:

```ts
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean("email_verified").notNull(),
  image: text('image'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp("updated_at").notNull(),
})
```

Replace it with:

```ts
export const user = pgTable('user', {
  id: text('id').primaryKey(),
  name: text('name').notNull(),
  email: text('email').notNull().unique(),
  emailVerified: boolean("email_verified").notNull(),
  image: text('image'),
  timezone: text('timezone').notNull().default('America/Sao_Paulo'),
  createdAt: timestamp('created_at').defaultNow(),
  updatedAt: timestamp("updated_at").notNull(),
})
```

- [ ] **Step 2: Tell better-auth about the field**

In `medtracker-api/src/lib/auth.ts`, find:

```ts
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg", 
    schema: schema,
  }),
  
  emailAndPassword: {
    enabled: true,
  },
  
  baseURL: process.env.apiURL || process.env.BETTER_AUTH_URL,
  trustedOrigins: process.env.TRUSTED_ORIGINS ? process.env.TRUSTED_ORIGINS.split(',') : undefined,
  advanced: {
    defaultCookieAttributes: {
      sameSite: "none",
      secure: true,
    },
  },
});
```

Replace it with:

```ts
export const auth = betterAuth({
  database: drizzleAdapter(db, {
    provider: "pg", 
    schema: schema,
  }),
  
  emailAndPassword: {
    enabled: true,
  },
  
  baseURL: process.env.apiURL || process.env.BETTER_AUTH_URL,
  trustedOrigins: process.env.TRUSTED_ORIGINS ? process.env.TRUSTED_ORIGINS.split(',') : undefined,
  advanced: {
    defaultCookieAttributes: {
      sameSite: "none",
      secure: true,
    },
  },
  user: {
    additionalFields: {
      timezone: {
        type: "string",
        required: false,
        defaultValue: "America/Sao_Paulo",
        input: true,
      },
    },
  },
});
```

- [ ] **Step 3: Push the schema change to the database**

```bash
cd medtracker-api
npm run db:push
```

The `.env` in this directory already has a working `dbURL` pointing to the real Neon database used in production (set up earlier this session). If `drizzle-kit` prompts to confirm adding the column, confirm it.

- [ ] **Step 4: Verify the column exists**

```bash
node -e "
import('dotenv/config').then(async () => {
  const postgres = (await import('postgres')).default;
  const sql = postgres(process.env.dbURL, { ssl: 'require' });
  const cols = await sql\`select column_name, is_nullable, column_default from information_schema.columns where table_name = 'user' and column_name = 'timezone'\`;
  console.log(cols);
  await sql.end();
});
"
```

Expected: one row, `{ column_name: 'timezone', is_nullable: 'NO', column_default: "'America/Sao_Paulo'::text" }`.

- [ ] **Step 5: Verify the build**

```bash
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/schema.ts src/lib/auth.ts
git commit -m "feat: add timezone field to user table"
```

---

### Task 2: Pure timezone-shift module

**Files:**
- Create: `medtracker-api/src/lib/timezone.ts`
- Create: `medtracker-api/src/lib/timezone.test.ts`

**Interfaces:**
- Produces:
  ```ts
  export const BRAZIL_TIMEZONE_OFFSETS: Record<string, number>;
  export const DEFAULT_TIMEZONE: string; // "America/Sao_Paulo"
  export function offsetDiffMinutes(userTimezone: string): number;
  export function toProcessZone(date: Date, diffMinutes: number): Date;
  export function fromProcessZone(date: Date, diffMinutes: number): Date;
  ```
- Consumes: nothing from other tasks.

- [ ] **Step 1: Write the failing tests**

Create `medtracker-api/src/lib/timezone.test.ts`:

```ts
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { offsetDiffMinutes, toProcessZone, fromProcessZone, DEFAULT_TIMEZONE } from './timezone.js';

test('offsetDiffMinutes is 0 for the process timezone itself (America/Sao_Paulo)', () => {
  assert.equal(offsetDiffMinutes('America/Sao_Paulo'), 0);
});

test('offsetDiffMinutes is 0 for the default timezone', () => {
  assert.equal(offsetDiffMinutes(DEFAULT_TIMEZONE), 0);
});

test('offsetDiffMinutes: Manaus is 1 hour behind Sao Paulo', () => {
  assert.equal(offsetDiffMinutes('America/Manaus'), -60);
});

test('offsetDiffMinutes: Rio Branco (Acre) is 2 hours behind Sao Paulo', () => {
  assert.equal(offsetDiffMinutes('America/Rio_Branco'), -120);
});

test('offsetDiffMinutes: Noronha is 1 hour ahead of Sao Paulo', () => {
  assert.equal(offsetDiffMinutes('America/Noronha'), 60);
});

test('offsetDiffMinutes: unknown timezone falls back to the default (diff 0)', () => {
  assert.equal(offsetDiffMinutes('Not/A_Real_Zone'), 0);
});

test('toProcessZone shifts a date forward by the diff in minutes', () => {
  const date = new Date('2026-09-10T12:00:00.000Z');
  const shifted = toProcessZone(date, -60);
  assert.equal(shifted.toISOString(), '2026-09-10T11:00:00.000Z');
});

test('fromProcessZone shifts a date backward by the diff in minutes', () => {
  const date = new Date('2026-09-10T11:00:00.000Z');
  const shifted = fromProcessZone(date, -60);
  assert.equal(shifted.toISOString(), '2026-09-10T12:00:00.000Z');
});

test('toProcessZone and fromProcessZone are exact inverses', () => {
  const date = new Date('2026-09-10T15:30:00.000Z');
  const diff = -120;
  const roundTripped = fromProcessZone(toProcessZone(date, diff), diff);
  assert.equal(roundTripped.toISOString(), date.toISOString());
});
```

- [ ] **Step 2: Run the tests to verify they fail**

```bash
cd medtracker-api
npm test
```

Expected: FAIL with `Cannot find module './timezone.js'`.

- [ ] **Step 3: Implement the module**

Create `medtracker-api/src/lib/timezone.ts`:

```ts
// Brazil has observed no daylight saving time since 2019, so every
// Brazilian IANA zone has a fixed UTC offset (in minutes, e.g. -180 for
// UTC-3). This lets us shift a Date by a simple, constant number of
// minutes to "pretend" it happened in a different zone, instead of doing
// full calendar-aware timezone conversion.
export const BRAZIL_TIMEZONE_OFFSETS: Record<string, number> = {
  'America/Noronha': -120,
  'America/Sao_Paulo': -180,
  'America/Manaus': -240,
  'America/Rio_Branco': -300,
};

export const DEFAULT_TIMEZONE = 'America/Sao_Paulo';

// Must match the TZ the Node process itself runs in (set via
// `process.env.TZ` at the top of server.ts) - all of the existing
// schedule math in nextDose.ts/stats.ts reads wall-clock time using the
// process's local timezone via native Date methods.
const PROCESS_TIMEZONE = 'America/Sao_Paulo';

export function offsetDiffMinutes(userTimezone: string): number {
  const userOffset = BRAZIL_TIMEZONE_OFFSETS[userTimezone] ?? BRAZIL_TIMEZONE_OFFSETS[DEFAULT_TIMEZONE];
  const processOffset = BRAZIL_TIMEZONE_OFFSETS[PROCESS_TIMEZONE];
  return userOffset - processOffset;
}

// Shifts a real instant so that, when read with process-local Date
// methods (getHours, getDay, setDate, ...), it reads as if it were
// wall-clock time in the user's chosen zone.
export function toProcessZone(date: Date, diffMinutes: number): Date {
  return new Date(date.getTime() + diffMinutes * 60000);
}

// Inverse of toProcessZone: turns a "pretend" process-zone Date back into
// a real instant.
export function fromProcessZone(date: Date, diffMinutes: number): Date {
  return new Date(date.getTime() - diffMinutes * 60000);
}
```

- [ ] **Step 4: Run the tests to verify they pass**

```bash
npm test
```

Expected: all tests pass. This adds 9 new tests to the existing suite (17 from earlier plans + 9 = 26).

- [ ] **Step 5: Verify the build**

```bash
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 6: Commit**

```bash
git add src/lib/timezone.ts src/lib/timezone.test.ts
git commit -m "feat: add pure timezone-shift module for Brazil's fixed-offset zones"
```

---

### Task 3: Wire the timezone shift into the schedule-computing routes

**Files:**
- Modify: `medtracker-api/src/routes/medication-routes.ts`

**Interfaces:**
- Consumes: `offsetDiffMinutes`, `toProcessZone`, `fromProcessZone`, `DEFAULT_TIMEZONE` from `../lib/timezone.js` (Task 2).
- Produces: `GET /medications`, `POST /medication/:id/take`, and `GET /stats` now compute schedule/stats math relative to the requesting user's own `timezone` (falling back to `America/Sao_Paulo` if unset), instead of always using the server process's timezone.

- [ ] **Step 1: Add the import**

At the top of `medtracker-api/src/routes/medication-routes.ts`, add:

```ts
import { offsetDiffMinutes, toProcessZone, fromProcessZone, DEFAULT_TIMEZONE } from '../lib/timezone.js';
```

- [ ] **Step 2: Wire `GET /medications`**

Find:

```ts
    app.get('/medications', {preHandler: [verifySession]}, async (request, reply) => {
const session = await auth.api.getSession({ headers: request.headers as any });
    if (!session || !session.user) return reply.status(401).send({ error: 'Unauthorized' });

    const userId = session.user.id;

    try {
        
        const userMeds = await db.select().from(medications).where(eq(medications.userId, userId));

     
        const enrichedMeds = await Promise.all(userMeds.map(async (med) => {
            
           
            const [lastDose] = await db.select()
                .from(doses_history)
                .where(eq(doses_history.medicationId, med.id))
                .orderBy(desc(doses_history.takenAt))
                .limit(1);

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

            return {
                ...med,
                nextDoseAt,
                lastTakenAt: lastDose ? lastDose.takenAt.toISOString() : null,
            };
        }));

        return reply.status(200).send({ data: enrichedMeds });

    } catch (error) {
        console.error('Erro ao buscar remédios:', error);
        return reply.status(500).send({ error: 'Erro interno ao buscar dados' });
    }
});
```

Replace it with:

```ts
    app.get('/medications', {preHandler: [verifySession]}, async (request, reply) => {
const session = await auth.api.getSession({ headers: request.headers as any });
    if (!session || !session.user) return reply.status(401).send({ error: 'Unauthorized' });

    const userId = session.user.id;
    const diff = offsetDiffMinutes((session.user as any).timezone ?? DEFAULT_TIMEZONE);

    try {
        
        const userMeds = await db.select().from(medications).where(eq(medications.userId, userId));

     
        const enrichedMeds = await Promise.all(userMeds.map(async (med) => {
            
           
            const [lastDose] = await db.select()
                .from(doses_history)
                .where(eq(doses_history.medicationId, med.id))
                .orderBy(desc(doses_history.takenAt))
                .limit(1);

            const nextDoseDate = computeNextDoseAt(
                {
                    scheduleType: med.scheduleType,
                    fixedTime: med.fixedTime,
                    intervalHours: med.intervalHours,
                    daysOfWeek: med.daysOfWeek,
                    startDate: toProcessZone(med.startDate, diff),
                },
                lastDose ? toProcessZone(lastDose.takenAt, diff) : null,
                toProcessZone(new Date(), diff)
            );
            const nextDoseAt = nextDoseDate ? fromProcessZone(nextDoseDate, diff).toISOString() : null;

            return {
                ...med,
                nextDoseAt,
                lastTakenAt: lastDose ? lastDose.takenAt.toISOString() : null,
            };
        }));

        return reply.status(200).send({ data: enrichedMeds });

    } catch (error) {
        console.error('Erro ao buscar remédios:', error);
        return reply.status(500).send({ error: 'Erro interno ao buscar dados' });
    }
});
```

Note `lastTakenAt` is deliberately NOT shifted — it's a real instant shown to the user, and the frontend already formats it via `toLocaleString('pt-BR', ...)` using the browser's own local timezone, which is correct as-is and independent of this app-level preference.

- [ ] **Step 3: Wire `POST /medication/:id/take`**

Find:

```ts
        const [lastDose] = await db.select()
            .from(doses_history)
            .where(eq(doses_history.medicationId, medicationId))
            .orderBy(desc(doses_history.takenAt))
            .limit(1);

        const now = new Date();

        if (lastDose) {
            const nextAllowedDate = computeNextAllowedDoseAt(
                {
                    scheduleType: medication.scheduleType,
                    fixedTime: medication.fixedTime,
                    intervalHours: medication.intervalHours,
                    daysOfWeek: medication.daysOfWeek,
                    startDate: medication.startDate,
                },
                lastDose.takenAt
            );

            if (nextAllowedDate && nextAllowedDate.getTime() > now.getTime()) {
                return reply.status(409).send({
                    error: 'Dose ainda não disponível',
                    nextDoseAt: nextAllowedDate.toISOString(),
                });
            }
        }

        await db.insert(doses_history).values({
            userId,
            medicationId,
            takenAt: now,
        })
        return reply.status(200).send({ message: 'Dose registrada com sucesso!' });
```

Replace it with:

```ts
        const [lastDose] = await db.select()
            .from(doses_history)
            .where(eq(doses_history.medicationId, medicationId))
            .orderBy(desc(doses_history.takenAt))
            .limit(1);

        const now = new Date();
        const diff = offsetDiffMinutes((session.user as any).timezone ?? DEFAULT_TIMEZONE);

        if (lastDose) {
            const nextAllowedDate = computeNextAllowedDoseAt(
                {
                    scheduleType: medication.scheduleType,
                    fixedTime: medication.fixedTime,
                    intervalHours: medication.intervalHours,
                    daysOfWeek: medication.daysOfWeek,
                    startDate: toProcessZone(medication.startDate, diff),
                },
                toProcessZone(lastDose.takenAt, diff)
            );

            if (nextAllowedDate && fromProcessZone(nextAllowedDate, diff).getTime() > now.getTime()) {
                return reply.status(409).send({
                    error: 'Dose ainda não disponível',
                    nextDoseAt: fromProcessZone(nextAllowedDate, diff).toISOString(),
                });
            }
        }

        await db.insert(doses_history).values({
            userId,
            medicationId,
            takenAt: now,
        })
        return reply.status(200).send({ message: 'Dose registrada com sucesso!' });
```

`now` (used for both the DB insert and the 409 comparison) stays a REAL, unshifted instant — only the values fed into `computeNextAllowedDoseAt` and its returned `nextAllowedDate` go through the shift/unshift dance.

- [ ] **Step 4: Wire `GET /stats`**

Find:

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

Replace it with:

```ts
    app.get('/stats', {preHandler: [verifySession]}, async (request, reply) => {
        const session = await auth.api.getSession({ headers: request.headers as any });
        if (!session || !session.user) return reply.status(401).send({ error: 'Unauthorized' });

        const userId = session.user.id;
        const diff = offsetDiffMinutes((session.user as any).timezone ?? DEFAULT_TIMEZONE);

        try {
            const userMeds = await db.select().from(medications).where(eq(medications.userId, userId));
            const userDoses = await db.select().from(doses_history).where(eq(doses_history.userId, userId));
            const now = toProcessZone(new Date(), diff);

            const toStatsMedication = (m: typeof userMeds[number]) => ({
                id: m.id,
                scheduleType: m.scheduleType,
                intervalHours: m.intervalHours,
                daysOfWeek: m.daysOfWeek,
                startDate: toProcessZone(m.startDate, diff),
            });
            const toStatsDose = (d: typeof userDoses[number]) => ({ medicationId: d.medicationId, takenAt: toProcessZone(d.takenAt, diff) });

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

`computeStats`'s returned numbers (`currentStreak`, `dosesTaken`, `weeklyAdherenceRate`, `missedDoses`, `missedByMedication`) are all counts/rates, not `Date` values, so nothing needs to be unshifted on the way out here — only the `now`/`startDate`/`takenAt` values going IN need shifting.

- [ ] **Step 5: Verify the build**

```bash
cd medtracker-api
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 6: Manual regression check with a non-default timezone**

This is the correctness-critical part of this plan, so verify it concretely against the real database rather than trusting the build alone (the pattern used for the dose-gating plan's Task 1 earlier this session — a throwaway script or curl flow against the real Neon DB, with cleanup).

1. Register (or reuse) a test account. Update its `timezone` directly in the database to `'America/Manaus'` (one hour behind São Paulo):
   ```bash
   node -e "
   import('dotenv/config').then(async () => {
     const postgres = (await import('postgres')).default;
     const sql = postgres(process.env.dbURL, { ssl: 'require' });
     await sql\`update \"user\" set timezone = 'America/Manaus' where email = 'YOUR_TEST_EMAIL'\`;
     await sql.end();
     console.log('updated');
   });
   "
   ```
2. Add a `weekly` medication for that user with `fixedTime` a few minutes in the future (e.g. if it's currently 14:00 in Sao Paulo server time, use `13:05` — since Manaus is 1 hour behind, 13:05 Manaus-local should compute as roughly "5 minutes from now" for that user, not "23 hours from now").
3. Call `GET /medications` as that user and confirm `nextDoseAt` reflects the *Manaus-relative* interpretation of `fixedTime` (i.e., is ~5 minutes in the future, not ~1h5m or -55m from now) — compute the exact expected ISO timestamp by hand (real now + 5 minutes, since the 1-hour zone difference should cancel out against the 1-hour-earlier fixedTime you chose) and compare.
4. Reset that test account's `timezone` back to `'America/Sao_Paulo'` afterward so it doesn't leave inconsistent test data behind.

- [ ] **Step 7: Commit and push**

```bash
git add src/routes/medication-routes.ts
git commit -m "feat: schedule math now uses the requesting user's own timezone"
git push
```

---

### Task 4: Profile page

**Files:**
- Create: `medtracker/src/pages/profile.tsx`
- Modify: `medtracker/src/App.tsx`

**Interfaces:**
- Consumes: `authClient` (`../lib/auth-client`) — `authClient.useSession()`, `authClient.updateUser({ name? , timezone? })`, `authClient.signOut()` (all built into better-auth's client, already used elsewhere in this codebase for `useSession`). `Input` (`@/components/ui/input`), `Button` (`../components/button`).
- Produces: route `/profile`, registered inside the `LogadoLayout` group (the bottom nav — `src/components/bottomMenu.tsx` — already links here with active-state styling; this is what finally makes that link resolve instead of a blank screen).

- [ ] **Step 1: Create the Profile page**

Create `medtracker/src/pages/profile.tsx`:

```tsx
import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { authClient } from "../lib/auth-client";
import { Input } from "@/components/ui/input";
import { Button } from "../components/button";

const TIMEZONE_OPTIONS = [
    { value: "America/Sao_Paulo", label: "Horário de Brasília (SP)" },
    { value: "America/Manaus", label: "Manaus (AM)" },
    { value: "America/Rio_Branco", label: "Acre (AC)" },
    { value: "America/Noronha", label: "Fernando de Noronha" },
];

export function Profile() {
    const navigate = useNavigate();
    const { data: session, refetch } = authClient.useSession();
    const [isEditingName, setIsEditingName] = useState(false);
    const [nameInput, setNameInput] = useState("");
    const [isEditingTimezone, setIsEditingTimezone] = useState(false);
    const [showAlertNotice, setShowAlertNotice] = useState(false);
    const [isSaving, setIsSaving] = useState(false);

    const userTimezone = (session?.user as { timezone?: string } | undefined)?.timezone ?? "America/Sao_Paulo";
    const timezoneLabel = TIMEZONE_OPTIONS.find((tz) => tz.value === userTimezone)?.label ?? "Horário de Brasília (SP)";

    const startEditingName = () => {
        setNameInput(session?.user?.name ?? "");
        setIsEditingName(true);
    };

    const saveName = async () => {
        if (!nameInput.trim()) return;
        setIsSaving(true);
        try {
            await authClient.updateUser({ name: nameInput.trim() });
            await refetch?.();
            setIsEditingName(false);
        } catch (error) {
            console.error('Erro ao atualizar nome:', error);
        } finally {
            setIsSaving(false);
        }
    };

    const changeTimezone = async (value: string) => {
        setIsSaving(true);
        try {
            await authClient.updateUser({ timezone: value });
            await refetch?.();
            setIsEditingTimezone(false);
        } catch (error) {
            console.error('Erro ao atualizar fuso horário:', error);
        } finally {
            setIsSaving(false);
        }
    };

    const handleLogout = async () => {
        await authClient.signOut();
        navigate("/");
    };

    const initials = (session?.user?.name ?? "?")
        .split(" ")
        .map((part) => part[0])
        .filter(Boolean)
        .slice(0, 2)
        .join("")
        .toUpperCase();

    return (
        <main className="bg-linear-to-b from-[#eef1f4] to-[#f7f8fa] to-35% min-h-screen p-6 flex flex-col gap-6">
            <h1 className="text-4xl font-heading text-gray-900 mt-8 mb-2 text-start">Perfil</h1>

            <div className="p-4 rounded-[24px] bg-white/70 shadow-[0_4px_20px_rgba(0,0,0,0.06)] flex items-center gap-4">
                <div className="w-16 h-16 rounded-full bg-primary text-primary-foreground flex items-center justify-center text-xl font-semibold shrink-0">
                    {initials}
                </div>
                <div className="flex-1 min-w-0">
                    {isEditingName ? (
                        <div className="flex flex-col gap-2">
                            <Input
                                value={nameInput}
                                onChange={(e: React.ChangeEvent<HTMLInputElement>) => setNameInput(e.target.value)}
                                placeholder="Seu nome"
                            />
                            <div className="flex gap-2">
                                <Button variant="primary" className="flex-1" onClick={saveName} disabled={isSaving}>
                                    Salvar
                                </Button>
                                <Button variant="secondary" className="flex-1" onClick={() => setIsEditingName(false)} disabled={isSaving}>
                                    Cancelar
                                </Button>
                            </div>
                        </div>
                    ) : (
                        <>
                            <h2 className="text-lg font-semibold text-gray-900 truncate">{session?.user?.name ?? "..."}</h2>
                            <p className="text-sm text-gray-500 truncate">{session?.user?.email ?? ""}</p>
                        </>
                    )}
                </div>
                {!isEditingName && (
                    <button onClick={startEditingName} className="text-sm text-primary font-medium shrink-0">
                        Editar
                    </button>
                )}
            </div>

            <div className="flex flex-col gap-3">
                <button
                    onClick={startEditingName}
                    className="p-4 rounded-[20px] bg-white/70 shadow-[0_4px_20px_rgba(0,0,0,0.06)] flex items-center gap-3 text-left"
                >
                    <div className="w-10 h-10 rounded-full bg-tertiary flex items-center justify-center text-lg shrink-0">
                        👤
                    </div>
                    <span className="font-medium text-gray-900">Meus Dados</span>
                </button>

                <button
                    onClick={() => setShowAlertNotice(true)}
                    className="p-4 rounded-[20px] bg-white/70 shadow-[0_4px_20px_rgba(0,0,0,0.06)] flex items-center gap-3 text-left"
                >
                    <div className="w-10 h-10 rounded-full bg-tertiary flex items-center justify-center text-lg shrink-0">
                        🔔
                    </div>
                    <span className="font-medium text-gray-900 flex-1">Preferências de Alerta</span>
                    {showAlertNotice && <span className="text-xs text-gray-400">Em breve</span>}
                </button>

                <div className="p-4 rounded-[20px] bg-white/70 shadow-[0_4px_20px_rgba(0,0,0,0.06)] flex flex-col gap-2">
                    <button
                        onClick={() => setIsEditingTimezone((prev) => !prev)}
                        className="flex items-center gap-3 text-left w-full"
                    >
                        <div className="w-10 h-10 rounded-full bg-tertiary flex items-center justify-center text-lg shrink-0">
                            🕐
                        </div>
                        <div className="flex-1">
                            <p className="font-medium text-gray-900">Fuso Horário</p>
                            <p className="text-xs text-gray-500">{timezoneLabel}</p>
                        </div>
                    </button>
                    {isEditingTimezone && (
                        <select
                            value={userTimezone}
                            onChange={(e) => changeTimezone(e.target.value)}
                            disabled={isSaving}
                            className="mt-2 w-full rounded-full border border-input px-4 py-2 text-sm bg-transparent"
                        >
                            {TIMEZONE_OPTIONS.map((tz) => (
                                <option key={tz.value} value={tz.value}>{tz.label}</option>
                            ))}
                        </select>
                    )}
                </div>
            </div>

            <button onClick={handleLogout} className="text-red-500 font-medium text-center mt-2">
                Sair da conta
            </button>
        </main>
    );
}
```

- [ ] **Step 2: Register the route**

In `medtracker/src/App.tsx`, add the import:

```tsx
import { Profile } from './pages/profile';
```

Add the route inside the `<Route element={<LogadoLayout />}>` block, alongside `/dashboard`, `/list`, `/add`, `/progress`:

```tsx
          <Route path="/profile" element={<PrivateRoute><Profile /></PrivateRoute>} />
```

- [ ] **Step 3: Verify the build**

```bash
cd medtracker
npm run build
```

Expected: no TypeScript errors. If `authClient.updateUser` or `authClient.signOut` don't resolve as methods (TypeScript error on those calls), it means better-auth's client didn't pick up the field/method as expected — check `src/lib/auth-client.ts` for how `authClient` is constructed and confirm no special client-side plugin/config is needed for `updateUser` (it's a base better-auth client method, should work with the existing `createAuthClient({ baseURL: API_URL })` setup with no changes).

- [ ] **Step 4: End-to-end verification**

Using the local-backend pattern from earlier in this session (register a throwaway account, run `medtracker-api` locally via `npm run dev` with `TRUSTED_ORIGINS=http://localhost:5173` in its `.env`, point `VITE_API_URL=http://localhost:3333` in a throwaway `medtracker/.env.local`):

1. Navigate to `/profile` (or tap "Perfil" in the bottom nav). Confirm the avatar shows initials, and name/email match the logged-in account.
2. Tap "Editar" (or "Meus Dados") — confirm the avatar card switches to an editable name field. Change the name, tap "Salvar" — confirm it persists (re-navigate away and back to `/profile`, or reload, and confirm the new name is shown).
3. Tap "Preferências de Alerta" — confirm the "Em breve" note appears and nothing else happens (no navigation, no error).
4. Tap "Fuso Horário" — confirm a dropdown with the 4 Brazilian zones appears. Select a different one — confirm the label above updates immediately to match.
5. Tap "Sair da conta" — confirm it navigates to `/` (onboarding) and that `/dashboard` is no longer reachable without logging in again (confirms the session was actually cleared, not just a client-side redirect).
6. No console errors throughout.

- [ ] **Step 5: Commit and push**

```bash
git add src/pages/profile.tsx src/App.tsx
git commit -m "feat: add Profile page with editable name, timezone, and logout"
git push
```
