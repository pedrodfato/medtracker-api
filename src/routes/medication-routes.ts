import type {FastifyInstance} from 'fastify';
import { db } from '../db.js';
import { doses_history, medications } from '../schema.js';
import { verifySession } from '../middlewares/auth-middleware.js';
import { auth } from '../lib/auth.js';
import { get } from 'node:http';
import { eq, desc, count } from 'drizzle-orm';

export async function medicationsRoutes(app: FastifyInstance) {
    app.post('/medications', {preHandler: [verifySession]}, async (request, reply) => {
        const  { name, dosage, frequencyHours, startDate, totalPills, category } = request.body as any;

        const session = await auth.api.getSession({
            headers: request.headers as any,
        });

        if (!session || !session.user) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        const userId = (request as any).user.id;

        try {
            await db.insert(medications).values({
                name,
                dosage,
                totalPills,
                frequencyHours,
                category,
                startDate: new Date(startDate),
                userId: userId,
            })
            return reply.status(201).send({ message: 'Remédio registrado com sucesso!'});
        } catch (error) {
            console.error('Erro ao registrar o remédio:', error);
            return reply.status(500).send({ error: 'Ocorreu um erro ao registrar o remédio.' });
        }
        });

    app.get('/medications', {preHandler: [verifySession]}, async (request, reply) => {
        const session = await auth.api.getSession({headers: request.headers as any});

        if (!session || !session.user) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }


        try {
            const myMedications = await db.select({id: medications.id, name: medications.name, dosage: medications.dosage, totalPills: medications.totalPills, frequencyHours: medications.frequencyHours, startDate: medications.startDate}).from(medications).where(eq(medications.userId, session.user.id));
            return reply.status(200).send({data: myMedications});
    } catch (error) {
        return reply.status(500).send({error: 'Ocorreu um erro ao buscar as medicações.'})
    }
    })

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

        await db.insert(doses_history).values({
            userId,
            medicationId,
            takenAt: new Date(),
        })
        return reply.status(200).send({ message: 'Dose registrada com sucesso!' });
    })

    app.get('/api/medication/', async (request, reply) => {
        const session = await auth.api.getSession({headers: request.headers as any});

        if (!session || !session.user) {
            return reply.status(401).send({ error: 'Unauthorized' });
        }

        const userMedications = await db.select().from(medications).where(eq(medications.userId, session.user.id));

        const enrichedMedications = await Promise.all(userMedications.map(async (med) => {
            const [dosesResult] = await db.select({ value: count() }).from(doses_history).where(eq(doses_history.medicationId, med.id));

            const [lastDose] = await db.select().from(doses_history).where(eq(doses_history.medicationId, med.id)).orderBy(desc(doses_history.takenAt)).limit(1);

            let nextDoseAt = null;

            if (lastDose) {
            nextDoseAt = new Date(lastDose.takenAt.getTime() + (med.frequencyHours * 60 * 60 * 1000));
        } else {
            nextDoseAt = med.startDate;
        }

        return {
            ...med,
            dosesTaken: dosesResult ? dosesResult.value : 0,
            nextDoseAt: nextDoseAt.toISOString(),
            streak: 0 
        };
        }));

        return { data: enrichedMedications };
    });
}