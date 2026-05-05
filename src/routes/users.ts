import { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { db } from '../db'; 
import { users } from '../schema';

export async function userRoutes(app: FastifyInstance) {

    app.post('/users', async (request, reply) => {
        const {email, password} = request.body as any;

        const hashedPassword = await bcrypt.hash(password, 10);

        try{
            await db.insert(users).values({
                email,
                passwordHash: hashedPassword,
            });

            return reply.status(201).send({ message: 'Usuário recrutado com sucesso!' });
        } catch (error) {
            console.error('Erro ao recrutar usuário:', error);
            return reply.status(500).send({ message: 'Erro ao recrutar usuário' });
        }
    });
}