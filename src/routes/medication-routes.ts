import type {FastifyInstance} from 'fastify';
import { db } from '../db.js';
import { doses_history, medications } from '../schema.js';
import { verifySession } from '../middlewares/auth-middleware.js';
import { auth } from '../lib/auth.js';
import { get } from 'node:http';
import { eq, and, desc, count } from 'drizzle-orm';
import { computeNextAllowedDoseAt, computeNextDueAt, driftedWeeklyDaysOfWeek } from '../lib/nextDose.js';
import { computeStats } from '../lib/stats.js';
import {
    computeEndDate,
    computeTreatmentSummary,
    dailyAdherence,
    durationDaysFromRange,
    historyUntil,
    parseDurationDays,
    todayAdherence,
} from '../lib/treatmentSummary.js';
import { categoryForForm, parseMedicationColor, parseMedicationForm } from '../lib/medicationAppearance.js';
import { offsetDiffMinutes, toProcessZone, fromProcessZone, DEFAULT_TIMEZONE } from '../lib/timezone.js';

// Optional `form`/`color` in a create or edit body: absent means "keep the default/current".
function parseAppearance(body: unknown) {
    const { form: rawForm, color: rawColor } = (body ?? {}) as { form?: unknown; color?: unknown };
    const form = rawForm === undefined ? null : parseMedicationForm(rawForm);
    if (rawForm !== undefined && form === null) return { error: 'Forma do remédio inválida.' } as const;
    const color = rawColor === undefined ? null : parseMedicationColor(rawColor);
    if (rawColor !== undefined && color === null) return { error: 'Cor do remédio inválida.' } as const;
    return { form, color };
}

export async function medicationsRoutes(app: FastifyInstance) {
    app.post('/medications', {preHandler: [verifySession]}, async (request, reply) => {
 
    const { name, dosage, startDate, totalPills, category, scheduleType, intervalHours, fixedTime, graceWindowMinutes, daysOfWeek } = request.body as any;

    const session = await auth.api.getSession({
        headers: request.headers as any,
    });

    if (!session || !session.user) {
        return reply.status(401).send({ error: 'Unauthorized' });
    }

    const userId = session.user.id;

    const durationDays = parseDurationDays(request.body && (request.body as any).durationDays);
    if (durationDays === null) {
        return reply.status(400).send({ error: 'Informe a duração do tratamento em dias (de 1 a 365).' });
    }
    const diff = offsetDiffMinutes((session.user as any).timezone ?? DEFAULT_TIMEZONE);
    const start = new Date(startDate);
    if (Number.isNaN(start.getTime())) {
        return reply.status(400).send({ error: 'Data de início inválida.' });
    }

    const appearance = parseAppearance(request.body);
    if ('error' in appearance) {
        return reply.status(400).send({ error: appearance.error });
    }

    try {
        await db.insert(medications).values({
            name,
            dosage,
            totalPills,
            category: appearance.form ? categoryForForm(appearance.form) : category,
            ...(appearance.form ? { form: appearance.form } : {}),
            ...(appearance.color ? { color: appearance.color } : {}),
            scheduleType,
            intervalHours,
            fixedTime,
            daysOfWeek,
            graceWindowMinutes,
            startDate: start,
            endDate: computeEndDate(start, durationDays, diff),
            userId: userId,
        });
        
        return reply.status(201).send({ message: 'Remédio registrado com sucesso!'});
    } catch (error) {
        console.error('Erro ao registrar o remédio:', error);
        return reply.status(500).send({ error: 'Ocorreu um erro ao registrar o remédio.' });
    }
});

    app.get('/medications', {preHandler: [verifySession]}, async (request, reply) => {
const session = await auth.api.getSession({ headers: request.headers as any });
    if (!session || !session.user) return reply.status(401).send({ error: 'Unauthorized' });

    const userId = session.user.id;
    const diff = offsetDiffMinutes((session.user as any).timezone ?? DEFAULT_TIMEZONE);

    try {

        const userMeds = await db.select().from(medications).where(eq(medications.userId, userId));


        // One query for every dose of the user, grouped by medication.
        const userDoses = await db.select().from(doses_history).where(eq(doses_history.userId, userId));
        const dosesByMedication = new Map<number, typeof userDoses>();
        for (const dose of userDoses) {
            const list = dosesByMedication.get(dose.medicationId);
            if (list) list.push(dose);
            else dosesByMedication.set(dose.medicationId, [dose]);
        }

        const enrichedMeds = userMeds.map((med) => {
            const medDoses = dosesByMedication.get(med.id) ?? [];
            const lastDose = medDoses.reduce<(typeof medDoses)[number] | undefined>(
                (latest, dose) => (!latest || dose.takenAt.getTime() > latest.takenAt.getTime() ? dose : latest),
                undefined,
            );

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

            return {
                ...med,
                nextDoseAt: completed ? null : nextDoseAt,
                lastTakenAt: lastDose ? lastDose.takenAt.toISOString() : null,
                durationDays,
                completed,
                treatmentSummary,
                today,
            };
        });

        return reply.status(200).send({ data: enrichedMeds });

    } catch (error) {
        console.error('Erro ao buscar remédios:', error);
        return reply.status(500).send({ error: 'Erro interno ao buscar dados' });
    }
});

    app.post('/medication/:id/take', {preHandler: [verifySession]}, async (request, reply) =>{
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

        if (medication.scheduleType === 'weekly') {
            const takenDayOfWeek = toProcessZone(now, diff).getDay();
            const newDaysOfWeek = driftedWeeklyDaysOfWeek(medication.daysOfWeek, takenDayOfWeek);

            if (newDaysOfWeek) {
                await db.update(medications)
                    .set({ daysOfWeek: newDaysOfWeek })
                    .where(eq(medications.id, medicationId));
            }
        }

        await db.insert(doses_history).values({
            userId,
            medicationId,
            takenAt: now,
        })
        return reply.status(200).send({ message: 'Dose registrada com sucesso!' });
    })

    app.delete('/medication/:id/take', {preHandler: [verifySession]}, async (request, reply) => {
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

        const [lastDose] = await db.select()
            .from(doses_history)
            .where(and(eq(doses_history.medicationId, medicationId), eq(doses_history.userId, userId)))
            .orderBy(desc(doses_history.takenAt))
            .limit(1);

        if (!lastDose) {
            return reply.status(404).send({ error: 'Nenhuma dose para desfazer' });
        }

        try {
            await db.delete(doses_history).where(eq(doses_history.id, lastDose.id));
            return reply.status(200).send({ message: 'Dose desfeita com sucesso!' });
        } catch (error) {
            console.error('Erro ao desfazer dose:', error);
            return reply.status(500).send({ error: 'Ocorreu um erro ao desfazer a dose.' });
        }
    })

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

        const { name, dosage, category, scheduleType, daysOfWeek, fixedTime, durationDays: rawDuration } = request.body as any;

        const appearance = parseAppearance(request.body);
        if ('error' in appearance) {
            return reply.status(400).send({ error: appearance.error });
        }

        let endDateUpdate: { endDate?: Date; summaryDismissedAt?: null } = {};
        if (rawDuration !== undefined && rawDuration !== null && rawDuration !== '') {
            const durationDays = parseDurationDays(rawDuration);
            if (durationDays === null) {
                return reply.status(400).send({ error: 'Informe a duração do tratamento em dias (de 1 a 365).' });
            }
            const diff = offsetDiffMinutes((session.user as any).timezone ?? DEFAULT_TIMEZONE);
            const newEndDate = computeEndDate(medication.startDate, durationDays, diff);
            // Extending a finished treatment makes its summary relevant again; re-sending the same duration must not.
            const isExtended = !medication.endDate || newEndDate.getTime() > medication.endDate.getTime();
            endDateUpdate = isExtended && newEndDate.getTime() > Date.now()
                ? { endDate: newEndDate, summaryDismissedAt: null }
                : { endDate: newEndDate };
        }

        try {
            await db.update(medications)
                .set({
                    name,
                    dosage,
                    category: appearance.form ? categoryForForm(appearance.form) : category,
                    form: appearance.form ?? undefined,
                    color: appearance.color ?? undefined,
                    scheduleType,
                    daysOfWeek,
                    fixedTime,
                    ...endDateUpdate,
                })
                .where(and(eq(medications.id, medicationId), eq(medications.userId, userId)));

            return reply.status(200).send({ message: 'Remédio atualizado com sucesso!' });
        } catch (error) {
            console.error('Erro ao atualizar o remédio:', error);
            return reply.status(500).send({ error: 'Ocorreu um erro ao atualizar o remédio.' });
        }
    })

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
            // Same rule as the Today strip: all of today, or up to the end of the treatment.
            const until = historyUntil(nowLocal, endLocal);

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
                endDate: m.endDate ? toProcessZone(m.endDate, diff) : null,
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
                form: medications.form,
                color: medications.color,
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

}