import type { FastifyRequest, FastifyReply } from 'fastify';
import { auth } from '../lib/auth.js';

export async function verifySession(request: FastifyRequest, reply: FastifyReply) {
    const session = await auth.api.getSession({
        headers: request.headers as Record<string, string>,
    });

    if (!session) {
        return reply.status(401).send({ message: 'Acesso negado: sessão inválida ou expirada.' });
    }

    (request as FastifyRequest & { user: unknown }).user = session.user;
 }