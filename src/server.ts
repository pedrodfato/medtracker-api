import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyJwt from '@fastify/jwt';
import { userRoutes } from './routes/users.js';
import { medicationsRoutes } from './routes/medications.js';


const app = Fastify({logger: true})

app.register(fastifyJwt, {
  secret: process.env.JWT_SECRfET || 'chave_super_secreta_medtracker_2026'
});



app.register(cors, {
    origin: true,
});



app.register(userRoutes);
app.register(medicationsRoutes);

app.listen({host: '0.0.0.0', port: process.env.PORT ? Number(process.env.PORT) : 3333})