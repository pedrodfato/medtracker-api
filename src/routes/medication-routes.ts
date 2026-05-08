import type {FastifyInstance} from 'fastify';
import { db } from '../db.js';
import { medications } from '../schema.js';
import { verifySession } from '../middlewares/auth-middleware.js';

export async function medicationsRoutes(app: FastifyInstance) {
    app.post('/medications', {preHandler: [verifySession]}, async (request, reply) => {
        const  { name, dosage, frequencyHours, startDate, totalPills } = request.body as any;

        const userId = (request as any).user.id;

        try {
            await db.insert(medications).values({
                name,
                dosage,
                totalPills,
                frequencyHours,
                startDate: new Date(startDate),
                userId: userId,
            })
            return reply.status(201).send({ message: 'Remédio registrado com sucesso!'});
        } catch (error) {
            console.error('Erro ao registrar o remédio:', error);
            return reply.status(500).send({ error: 'Ocorreu um erro ao registrar o remédio.' });
        }
        });

    app.get('/medications', async (request, reply) => {
        try {
            const myMedications = await db.select({id: medications.id, name: medications.name, dosage: medications.dosage, totalPills: medications.totalPills, frequencyHours: medications.frequencyHours, startDate: medications.startDate, userId: medications.userId}).from(medications);
            return reply.status(200).send({data: myMedications});
    } catch (error) {
        return reply.status(500).send({error: 'Ocorreu um erro ao buscar as medicações.'})
    }
    })
}