import Fastify from 'fastify';
import cors from '@fastify/cors';
import { DatabasePostgres } from './database-postgres.js';
import { userRoutes } from './routes/users';


const app = Fastify({logger: true})

const database = new DatabasePostgres();

app.register(cors, {
    origin: true,
});

interface RemedioQuery {
    search?: string;
}

app.get<{ Querystring: RemedioQuery }>('/remedios', async (request) => {
    const search = request.query.search
    const remedios = await database.list(search)

    console.log(remedios)
    return remedios
});

interface RemedioBody {
    name: string;
    dosage: string;
    total_pills: number;
    frequency_hours: number;
    start_date: string;
    end_date?: string | null;
}

app.post<{ Body: RemedioBody }>('/remedios', async (request, reply) => {

    await database.create(request.body as any)

    return reply.status(201).send()
})

app.put<{ Params: { id: number }, Body: RemedioBody }>('/remedios/:id', async (request, reply) => {
    const remedioId = request.params.id

    await database.update(Number(remedioId), request.body as any)

    return reply.status(204).send()
})

app.delete<{ Params: { id: number } }>('/remedios/:id', async (request, reply) => {
    const remedioId = request.params.id

    await database.delete(Number(remedioId))

    return reply.status(204).send()
})

app.register(userRoutes);

app.listen({host: '0.0.0.0', port: process.env.PORT ? Number(process.env.PORT) : 3333})