import type { FastifyInstance } from 'fastify';
import bcrypt from 'bcrypt';
import { eq } from 'drizzle-orm';
import { db } from '../db.js'; 
import { users } from '../schema.js';

export async function userRoutes(app: FastifyInstance) {

    app.post('/users', async (request, reply) => {
        const {email, password} = request.body as any;

        const hashedPassword = await bcrypt.hash(password, 10);

        try{
            await db.insert(users).values({
                email,
                passwordHash: hashedPassword,
            });

            return reply.status(201).send({ message: 'Usuário criado com sucesso!' });
        } catch (error) {
            console.error('Erro ao criar usuário:', error);
            return reply.status(500).send({ message: 'Erro ao criar usuário' });
        }
    });

    app.post('/login', async (request, reply) => {
        const {email, password} = request.body as any;

        const result = await db.select().from(users).where(eq(users.email, email));
        const user = result[0];

        if (!user) {
            return reply.status(401).send({ message: 'Credenciais inválidas' });
        }

        const isPasswordValid = await bcrypt.compare(password, user.passwordHash);

        if (!isPasswordValid) {
            return reply.status(401).send({ message: 'Credenciais inválidas' });
        }

        const token = app.jwt.sign({sub: user.id}, {expiresIn: '7d'});

        return reply.send({
            message: 'Login bem-sucedido',
            token
        });
    });
}