# Edit/Delete Medication Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the already-present but non-functional Editar/Excluir buttons on the Medications List actually edit and delete a medication.

**Architecture:** Backend gets two new ownership-checked routes, `PATCH /medications/:id` and `DELETE /medications/:id`, following the exact auth/ownership pattern already used by `POST /medication/:id/take`. Frontend reuses the existing Add Medication page in a dual create/edit mode (medication passed via `location.state`, same pattern already used for the Reminder screen), and adds a small hand-built confirmation overlay to the Medications List for delete (matching the app's existing hand-built dropdown-menu style — no new UI library dependency).

**Tech Stack:** Fastify + Drizzle + Postgres (medtracker-api), React + Vite + Tailwind (medtracker). Backend tests via Node's built-in test runner (`npm test` already configured). Frontend has no test runner; frontend tasks are verified via `tsc -b && vite build` plus a manual end-to-end Playwright check with a real local login (the pattern used at the end of the previous plan, registering a throwaway account against a locally-run backend).

## Global Constraints

- Editing an existing `fixed`/`interval` medication through this form converts it to `weekly` (the Add Medication form only has weekly-scheduling UI) — this is expected, not a bug to work around.
- Delete is a hard delete. `doses_history.medicationId` already has `onDelete: "cascade"` in `src/schema.ts:69` — deleting a medication row automatically deletes its dose history at the database level. Do not add any application-level cascade logic.
- Every new route must verify the medication belongs to the requesting session's user before mutating it, exactly like `POST /medication/:id/take` in `src/routes/medication-routes.ts:95-125` does (select-by-id-and-userId, 404 if not found).
- Backend package is `medtracker-api`, frontend package is `medtracker`, at `/home/pedro/Documents/medtrackerproject/medtracker-api` and `/home/pedro/Documents/medtrackerproject/medtracker` respectively. Each has its own git repo. Work directly on `main` in both (explicit user consent already given for this whole plan, consistent with prior work this session).

---

### Task 1: `PATCH /medications/:id`

**Files:**
- Modify: `medtracker-api/src/routes/medication-routes.ts`

**Interfaces:**
- Produces: `PATCH /medications/:id` — body `{ name, dosage, category, scheduleType, daysOfWeek, fixedTime }` → `200 { message: string }` on success, `404 { error: string }` if the medication doesn't exist or isn't owned by the caller, `401` if unauthenticated.

- [ ] **Step 1: Add the route**

In `medtracker-api/src/routes/medication-routes.ts`, add this route immediately after the `POST /medication/:id/take` handler (after the closing `})` on the line currently reading `})` right before `app.get('/stats', ...)`):

```ts
    app.patch('/medications/:id', {preHandler: [verifySession]}, async (request, reply) => {
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

        const [medication] = await db.select()
            .from(medications)
            .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)));

        if (!medication) {
            return reply.status(404).send({ error: 'Medicamento não encontrado' });
        }

        const { name, dosage, category, scheduleType, daysOfWeek, fixedTime } = request.body as any;

        try {
            await db.update(medications)
                .set({ name, dosage, category, scheduleType, daysOfWeek, fixedTime })
                .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)));

            return reply.status(200).send({ message: 'Remédio atualizado com sucesso!' });
        } catch (error) {
            console.error('Erro ao atualizar o remédio:', error);
            return reply.status(500).send({ error: 'Ocorreu um erro ao atualizar o remédio.' });
        }
    })

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
git commit -m "feat: add PATCH /medications/:id"
```

---

### Task 2: `DELETE /medications/:id`

**Files:**
- Modify: `medtracker-api/src/routes/medication-routes.ts`

**Interfaces:**
- Consumes: nothing new from Task 1 (independent route, same file).
- Produces: `DELETE /medications/:id` → `200 { message: string }` on success, `404 { error: string }` if not found/not owned, `401` if unauthenticated.

- [ ] **Step 1: Add the route**

Add this route directly after the `PATCH /medications/:id` route added in Task 1 (same file, right after its closing `})`):

```ts
    app.delete('/medications/:id', {preHandler: [verifySession]}, async (request, reply) => {
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

        const [medication] = await db.select()
            .from(medications)
            .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)));

        if (!medication) {
            return reply.status(404).send({ error: 'Medicamento não encontrado' });
        }

        try {
            await db.delete(medications)
                .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)));

            return reply.status(200).send({ message: 'Remédio excluído com sucesso!' });
        } catch (error) {
            console.error('Erro ao excluir o remédio:', error);
            return reply.status(500).send({ error: 'Ocorreu um erro ao excluir o remédio.' });
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
git commit -m "feat: add DELETE /medications/:id"
git push
```

---

### Task 3: `AddMedication` dual create/edit mode

**Files:**
- Modify: `medtracker/src/pages/addMedications.tsx`

**Interfaces:**
- Consumes: `Medication` type from `../types/medType` (already has `id`, `name`, `dosage`, `category`, `daysOfWeek?`, `fixedTime`).
- Produces: reading `location.state` shaped as `{ medication?: Medication } | null` (same shape Task 9 of the previous plan used for the Reminder screen). When `medication` is present, the page is in edit mode and `PATCH`es `${API_URL}/medications/${medication.id}`; otherwise it `POST`s to `${API_URL}/medications` exactly as before.

- [ ] **Step 1: Replace the component body**

Replace the entire contents of `medtracker/src/pages/addMedications.tsx` with:

```tsx
import { useState } from "react";
import { useNavigate, useLocation, Link } from "react-router-dom";
import { Input } from "@/components/ui/input";
import { Button } from "../components/button";
import { API_URL } from "../lib/api";
import type { Medication } from "../types/medType";

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
    const location = useLocation();
    const editingMedication = (location.state as { medication?: Medication } | null)?.medication;
    const isEditMode = !!editingMedication;

    const [name, setName] = useState(editingMedication?.name ?? "");
    const [dosage, setDosage] = useState(editingMedication?.dosage ?? "");
    const [category, setCategory] = useState<"pill" | "drop" | "vitamin">(editingMedication?.category ?? "pill");
    const [daysOfWeek, setDaysOfWeek] = useState<number[]>(editingMedication?.daysOfWeek ?? [1, 3, 5]);
    const [fixedTime, setFixedTime] = useState(editingMedication?.fixedTime ?? "08:00");
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
            const url = isEditMode
                ? `${API_URL}/medications/${editingMedication!.id}`
                : `${API_URL}/medications`;

            const response = await fetch(url, {
                method: isEditMode ? "PATCH" : "POST",
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

            if (!response.ok) throw new Error(isEditMode ? "Falha ao atualizar" : "Falha ao salvar");
            navigate("/list");

        } catch (error) {
            console.error('Erro ao salvar remédio:', error);
            setErrorMsg(isEditMode ? "Erro ao atualizar remédio." : "Erro ao adicionar remédio.");
        } finally {
            setIsLoading(false);
        }
    }

    return (
        <main className="bg-[#F7F8FA] min-h-screen py-6 flex flex-col items-center justify-center">
            <div className="w-full max-w-md bg-white p-6 rounded-[24px] shadow-sm">
                <div className="flex justify-between items-center mb-6">
                    <h1 className="text-2xl font-bold text-gray-900">{isEditMode ? "Editar Medicamento" : "Novo Medicamento"}</h1>
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
                        {isLoading ? "Salvando..." : isEditMode ? "Salvar Alterações" : "Salvar Medicamento"}
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

- [ ] **Step 3: Commit**

```bash
git add src/pages/addMedications.tsx
git commit -m "feat: dual create/edit mode on Add Medication page"
```

---

### Task 4: Wire Editar/Excluir on the Medications List

**Files:**
- Modify: `medtracker/src/pages/medicationList.tsx`

**Interfaces:**
- Consumes: `PATCH /medications/:id` is not called from this file (that's Task 3's job, reached via navigation); this task calls `DELETE /medications/:id` from Task 2.
- Produces: clicking "Editar" navigates to `/add` with `location.state = { medication: med }`. Clicking "Excluir" opens a confirmation overlay; confirming calls `DELETE ${API_URL}/medications/${id}` and removes the medication from local state on success.

- [ ] **Step 1: Replace the component body**

Replace the entire contents of `medtracker/src/pages/medicationList.tsx` with:

```tsx
import { Input } from "@/components/ui/input";
import { useState, useEffect } from "react"
import type { Medication } from "../types/medType";
import { EllipsisVertical, Pencil, Plus, Search, Trash2 } from "lucide-react";
import { Link, useNavigate } from "react-router-dom";
import { API_URL } from "../lib/api";
import { getMedicationVisual, type MedicationCategory } from "../lib/medicationVisuals";
import { Button } from "../components/button";

const CATEGORY_FILTERS: { label: string; value: MedicationCategory }[] = [
    { label: "Pílulas", value: "pill" },
    { label: "Líquidos", value: "drop" },
    { label: "Outros", value: "vitamin" },
];

export function MedicationList() {
    const navigate = useNavigate();
    const [medications, setMedications] = useState<Medication[]>([])
    const [openMenuId, setOpenMenuId] = useState<string | null>(null);
    const [search, setSearch] = useState("");
    const [activeCategory, setActiveCategory] = useState<MedicationCategory | null>(null);
    const [medicationToDelete, setMedicationToDelete] = useState<Medication | null>(null);
    const [isDeleting, setIsDeleting] = useState(false);

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

    const handleEdit = (med: Medication) => {
        setOpenMenuId(null);
        navigate("/add", { state: { medication: med } });
    };

    const handleDelete = async () => {
        if (!medicationToDelete) return;
        setIsDeleting(true);
        try {
            const response = await fetch(`${API_URL}/medications/${medicationToDelete.id}`, {
                method: "DELETE",
                credentials: 'include',
            });
            if (!response.ok) throw new Error("Falha ao excluir");
            setMedications((prev) => prev.filter((m) => m.id !== medicationToDelete.id));
        } catch (error) {
            console.error('Erro ao excluir remédio:', error);
        } finally {
            setIsDeleting(false);
            setMedicationToDelete(null);
        }
    };

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
                                            onClick={() => handleEdit(med)}
                                            className="w-full flex items-center gap-2 px-4 py-2 text-sm text-gray-700 hover:bg-gray-50 transition-colors"
                                        >
                                            <Pencil size={16} />
                                            Editar
                                        </button>

                                        <button
                                            onClick={() => { setOpenMenuId(null); setMedicationToDelete(med); }}
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

            {medicationToDelete && (
                <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 px-6">
                    <div className="bg-white rounded-2xl p-6 w-full max-w-sm shadow-xl">
                        <h2 className="text-lg font-semibold text-gray-900 mb-2">Excluir remédio?</h2>
                        <p className="text-gray-600 text-sm mb-6">
                            Tem certeza que deseja excluir <strong>{medicationToDelete.name}</strong>? Essa ação não pode ser desfeita.
                        </p>
                        <div className="flex gap-3">
                            <Button
                                type="button"
                                variant="secondary"
                                className="flex-1"
                                onClick={() => setMedicationToDelete(null)}
                                disabled={isDeleting}
                            >
                                Cancelar
                            </Button>
                            <Button
                                type="button"
                                variant="inverted"
                                className="flex-1 bg-red-600 text-white"
                                onClick={handleDelete}
                                disabled={isDeleting}
                            >
                                {isDeleting ? "Excluindo..." : "Excluir"}
                            </Button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    )
}
```

- [ ] **Step 2: Verify the build**

```bash
cd medtracker
npm run build
```

Expected: no TypeScript errors.

- [ ] **Step 3: End-to-end verification**

Using the pattern from the end of the previous plan (register a throwaway account against a locally-run backend, with `TRUSTED_ORIGINS=http://localhost:5173` added to `medtracker-api/.env` and the backend started via `npm run dev` in that directory, frontend `VITE_API_URL=http://localhost:3333` in a throwaway `medtracker/.env.local`):

1. Register, add a medication.
2. On `/list`, click the kebab menu → "Editar" → confirm the Add Medication form opens pre-filled with that medication's name/dosage/category/days/time, with the header reading "Editar Medicamento" and the button reading "Salvar Alterações".
3. Change the name, submit, confirm it navigates to `/list` and the card now shows the new name (not a duplicate row).
4. Click the kebab menu → "Excluir" → confirm the confirmation overlay appears with the medication's name. Click "Cancelar" → confirm the overlay closes and the medication is still listed. Open the menu again, click "Excluir", then click the red "Excluir" button in the overlay → confirm the card disappears from the list without a page reload.
5. Report any console errors and clean up the throwaway `.env.local` / revert the `.env` addition afterward (or leave `TRUSTED_ORIGINS` — it's git-ignored and harmless for future local testing, per the previous plan's precedent).

- [ ] **Step 4: Commit and push**

```bash
git add src/pages/medicationList.tsx
git commit -m "feat: wire Editar/Excluir on Medications List"
git push
```
