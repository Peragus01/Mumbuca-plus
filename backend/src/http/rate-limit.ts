import type { FastifyRequest } from 'fastify';

/**
 * Visitor actions are limited per visitor (`vis:<userId>`, whatever the IP); anything else falls back
 * to the IP. Operators are exempt. req.session is set by the /api onRequest hook, which runs first.
 */
export const visitorRateLimit = (max: number) => ({
  rateLimit: {
    max,
    timeWindow: '1 minute',
    keyGenerator: (req: FastifyRequest) => (req.session?.role === 'visitor' ? `vis:${req.session.userId.toLowerCase()}` : req.ip),
    allowList: (req: FastifyRequest) => req.session?.role === 'operator',
  },
});
