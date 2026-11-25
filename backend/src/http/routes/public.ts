import type { FastifyPluginAsync } from 'fastify';
import type { VisitorPolicy } from '../../processing/visitor-policy.js';

export const publicRoutes: FastifyPluginAsync<{ policy: VisitorPolicy }> = async (app, { policy }) => {
  app.get('/public/status', async () => ({ visitorPurchasesOpen: await policy.purchasesOpen() }));
};
