import type { FastifyPluginAsync } from 'fastify';
import type { UserRepository } from '../../repositories/user-repository.js';
import { isUuid } from '../errors.js';
import { toUserDto } from './users.js';

export interface MeRoutesOptions {
  users: UserRepository;
}

export const meRoutes: FastifyPluginAsync<MeRoutesOptions> = async (app, { users }) => {
  app.get('/me', async (req, reply) => {
    const session = req.session;
    if (session?.role === 'operator') return { role: 'operator' };
    const user = session && isUuid(session.userId) ? await users.findById(session.userId) : null;
    if (!user) return reply.code(401).send({ error: 'unauthorized' });
    return { role: 'visitor', user: toUserDto(user) };
  });
};
