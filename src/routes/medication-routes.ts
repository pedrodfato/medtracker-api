import type {FastifyInstance} from 'fastify';
import { db } from '../db.js';
import { doses_history, medications } from '../schema.js';
import { verifySession } from '../middlewares/auth-middleware.js';
import { auth } from '../lib/auth.js';
import { get } from 'node:http';
import { eq, and, desc, count } from 'drizzle-orm';
import { computeNextDoseAt, computeNextAllowedDoseAt } from '../lib/nextDose.js';
import { computeStats } from '../lib/stats.js';

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
            startDate: new Date(startDate),
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

}