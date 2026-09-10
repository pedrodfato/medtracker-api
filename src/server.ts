process.env.TZ = 'America/Sao_Paulo';

import Fastify from 'fastify';
import cors from '@fastify/cors';
import { medicationsRoutes } from './routes/medication-routes.js';
import { auth } from './lib/auth.js';
import { toNodeHandler } from "better-auth/node";
import { parseTrustedOrigins } from './lib/trustedOrigins.js';
import 'dotenv/config'

const app = Fastify({logger: true})

const trustedOrigins = [
    ...parseTrustedOrigins(process.env.TRUSTED_ORIGINS),
    "http://localhost:5173",
];

app.register(cors, {
    origin: trustedOrigins,
    credentials: true,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE'],
});

app.all('/api/auth/*', async (request, reply) => {

    const origin = request.headers.origin;

    if (origin && trustedOrigins.includes(origin)) {
        reply.raw.setHeader("Access-Control-Allow-Credentials", "true");
        reply.raw.setHeader("Access-Control-Allow-Origin", origin);
    }

    if (request.body) {
        (request.raw as any).body = request.body;
    }
    
    const handler = toNodeHandler(auth);

    await handler(request.raw, reply.raw);

    return reply.hijack();
})

app.register(medicationsRoutes);

app.listen({host: '0.0.0.0', port: process.env.PORT ? Number(process.env.PORT) : 3333})