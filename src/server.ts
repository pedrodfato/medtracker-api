import Fastify from 'fastify';
import cors from '@fastify/cors';
import { medicationsRoutes } from './routes/medication-routes.js';
import { auth } from './lib/auth.js';
import { toNodeHandler } from "better-auth/node";
import 'dotenv/config'

const app = Fastify({logger: true})

app.register(cors, {
    origin: true,
    credentials: true,
});

app.all('/api/auth/*', async (request, reply) => {

    if (request.body) {
        (request.raw as any).body = request.body;
    }
    
    const handler = toNodeHandler(auth);

    await handler(request.raw, reply.raw);

    return reply.hijack();
})

app.register(medicationsRoutes);

app.listen({host: '0.0.0.0', port: process.env.PORT ? Number(process.env.PORT) : 3333})