import type {FastifyInstance} from 'fastify';

export async function medicationsRoutes(app: FastifyInstance) {
    app.addHook('onRequest', async(request, reply) => {
        try{
            await request.jwtVerify();
        } catch (err) {
            return reply.status(401).send({ error: 'Acesso Negado.' });
        }
    });

    app.post('/medications', async (request, reply) => {
        const userId = (request.user as { sub: string }).sub;

        return reply.send({
            message: `Veja suas medicaçõess criadas`,
            yourId: userId,
            instrucao: "Faça uma requisição GET para /medications para ver suas medicações criadas."
        })
    });

}