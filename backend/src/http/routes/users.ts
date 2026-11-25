import type { FastifyPluginAsync } from 'fastify';
import type { TokenGateway } from '../../chain/token-gateway.js';
import { DuplicateUser, InvalidWalletAddress, type User, type UserRepository } from '../../repositories/user-repository.js';
import { requireOperator } from '../auth.js';
import { errorClass, isUuid } from '../errors.js';

export interface UserRoutesOptions {
  users: UserRepository;
  token: TokenGateway;
}

export const toUserDto = (u: User) => ({
  id: u.id,
  handle: u.handle,
  displayName: u.displayName,
  walletAddress: u.walletAddress,
  createdAt: u.createdAt.toISOString(),
});

export const userRoutes: FastifyPluginAsync<UserRoutesOptions> = async (app, { users, token }) => {
  app.get('/users', async (req, reply) => {
    if (requireOperator(req, reply)) return reply;
    return (await users.list()).map(toUserDto);
  });

  app.post<{ Body: { handle: string; displayName: string; walletAddress: string } }>(
    '/users',
    {
      schema: {
        body: {
          type: 'object',
          required: ['handle', 'displayName', 'walletAddress'],
          properties: {
            handle: { type: 'string', minLength: 1, maxLength: 64 },
            displayName: { type: 'string', minLength: 1, maxLength: 120 },
            walletAddress: { type: 'string', maxLength: 64 },
          },
        },
      },
    },
    async (req, reply) => {
      if (requireOperator(req, reply)) return reply;
      try {
        const u = await users.create(req.body);
        return reply.code(201).send(toUserDto(u));
      } catch (e) {
        if (e instanceof InvalidWalletAddress) return reply.code(400).send({ error: 'invalid_wallet_address' });
        if (e instanceof DuplicateUser) return reply.code(409).send({ error: 'duplicate_user' });
        throw e;
      }
    },
  );

  app.get<{ Params: { id: string } }>('/users/:id/balance', async (req, reply) => {
    const own = req.session?.role === 'visitor' && req.session.userId.toLowerCase() !== req.params.id.toLowerCase();
    const user = !own && isUuid(req.params.id) ? await users.findById(req.params.id) : null;
    if (!user) return reply.code(404).send({ error: 'user_not_found' });
    try {
      const units = await token.balanceOf(user.walletAddress);
      return { balanceUnits: units.toString() };
    } catch (e) {
      req.log.warn({ userId: user.id, error: errorClass(e) }, 'balance lookup failed');
      return reply.code(503).send({ error: 'chain_unavailable' });
    }
  });
};
