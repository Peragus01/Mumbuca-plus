import type { FastifyPluginAsync } from 'fastify';
import type { VisitorPolicy } from '../../processing/visitor-policy.js';

export const publicRoutes: FastifyPluginAsync<{ policy: VisitorPolicy }> = async (app, { policy }) => {
  // Unauthenticated: 30/min per IP.
  app.get('/public/status', { config: { rateLimit: { max: 30, timeWindow: '1 minute' } } }, async () => ({
    visitorPurchasesOpen: await policy.purchasesOpen(),
  }));
};
