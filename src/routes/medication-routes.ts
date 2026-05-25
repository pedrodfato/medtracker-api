import type {FastifyInstance} from 'fastify';
import { db } from '../db.js';
import { doses_history, medications } from '../schema.js';
import { verifySession } from '../middlewares/auth-middleware.js';
import { auth } from '../lib/auth.js';
import { get } from 'node:http';
import { eq, desc, count } from 'drizzle-orm';

export async function medicationsRoutes(app: FastifyInstance) {
    app.post('/medications', {preHandler: [verifySession]}, async (request, reply) => {
 
    const { name, dosage, startDate, totalPills, category, scheduleType, intervalHours, fixedTime, graceWindowMinutes } = request.body as any;

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

            return {
                ...med,
                nextDoseAt 
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

        await db.insert(doses_history).values({
            userId,
            medicationId,
            takenAt: new Date(),
        })
        return reply.status(200).send({ message: 'Dose registrada com sucesso!' });
    })

    
}