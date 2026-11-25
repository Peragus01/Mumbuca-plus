import path from 'node:path';
import Fastify, { type FastifyInstance, type FastifyServerOptions } from 'fastify';
import cookie from '@fastify/cookie';
import rateLimit from '@fastify/rate-limit';
import fastifyStatic from '@fastify/static';
import type { TokenGateway } from '../chain/token-gateway.js';
import type { Env } from '../config/env.js';
import type { PaymentProcessor } from '../processing/payment-processor.js';
import type { ProviderRegistry } from '../providers/payment-provider.js';
import type { PaymentRepository } from '../repositories/payment-repository.js';
import type { AuthRepository } from '../repositories/auth-repository.js';
import type { UserRepository } from '../repositories/user-repository.js';
import { PUBLIC_API_ROUTES, authRoutes, readSession } from './auth.js';
import { errorClass } from './errors.js';
import { phantomAuthRoutes } from './routes/phantom-auth.js';
import { opsRoutes } from './routes/ops.js';
import { paymentRoutes } from './routes/payments.js';
import { userRoutes } from './routes/users.js';
import { webhookRoutes } from './routes/webhooks.js';

declare module 'fastify' {
  interface FastifyInstance {
    /**
     * Fire-and-forget payment processing (webhook / simulate / reprocess). Rejections are caught
     * and logged by error class only, so there is never an unhandled rejection.
     */
    runInBackground(task: string, paymentId: string, job: () => Promise<unknown>): void;
    /** Resolves once every background job has settled (tests, graceful shutdown). */
    idle(): Promise<void>;
  }
}

export interface AppDeps {
  env: Env;
  payments: PaymentRepository;
  users: UserRepository;
  auth: AuthRepository;
  processor: PaymentProcessor;
  providers: ProviderRegistry;
  token: TokenGateway;
  /** Built frontend (SPA). Unknown non-API GETs fall back to index.html. */
  staticDir?: string;
  logger?: FastifyServerOptions['logger'];
  /** Proxy hops to trust for the client IP (rate limit). Default: none. */
  trustProxy?: FastifyServerOptions['trustProxy'];
  /** Secure session cookie. Default: on unless NODE_ENV=development. */
  secureCookie?: boolean;
}

export function buildApp(deps: AppDeps): FastifyInstance {
  const { env, payments, users, auth, processor, providers, token, staticDir } = deps;
  const app = Fastify({
    logger: deps.logger ?? false,
    trustProxy: deps.trustProxy ?? false,
    // Money travels as strings: never coerce a JSON number into one.
    ajv: { customOptions: { coerceTypes: false } },
  });

  // ---- background jobs ----
  const pending = new Set<Promise<void>>();
  app.decorate('runInBackground', (task: string, paymentId: string, job: () => Promise<unknown>) => {
    const run: Promise<void> = Promise.resolve()
      .then(job)
      .then(
        () => undefined,
        (e: unknown) => app.log.error({ task, paymentId, error: errorClass(e) }, 'background processing failed'),
      )
      .finally(() => pending.delete(run));
    pending.add(run);
  });
  app.decorate('idle', async () => {
    while (pending.size > 0) await Promise.all([...pending]);
  });
  app.addHook('onClose', async () => {
    await app.idle();
  });

  // ---- errors: generic bodies, class-only logs ----
  app.setErrorHandler((err: { validation?: unknown; statusCode?: number }, req, reply) => {
    if (err.validation) return reply.code(400).send({ error: 'invalid_request' });
    const status = err.statusCode;
    if (status === 429) return reply.code(429).send({ error: 'rate_limited' });
    if (typeof status === 'number' && status >= 400 && status < 500) return reply.code(status).send({ error: 'bad_request' });
    req.log.error({ error: errorClass(err) }, 'request failed');
    return reply.code(500).send({ error: 'internal_error' });
  });

  app.register(cookie, { secret: env.SESSION_SECRET });
  app.register(rateLimit, { global: false });

  const secureCookie = deps.secureCookie ?? process.env.NODE_ENV !== 'development';

  app.register(
    async (api) => {
      api.decorateRequest('session', null);
      api.addHook('onRequest', async (req, reply) => {
        req.session = readSession(req);
        if (req.routeOptions.url && PUBLIC_API_ROUTES.has(req.routeOptions.url)) return;
        if (!req.session) return reply.code(401).send({ error: 'unauthorized' });
      });
      await api.register(authRoutes, { password: env.DEMO_PASSWORD, secureCookie });
      await api.register(phantomAuthRoutes, { env, users, auth, secureCookie });
      await api.register(userRoutes, { users, token });
      await api.register(paymentRoutes, { env, payments, processor, providers });
      await api.register(opsRoutes, { env, token });
    },
    { prefix: '/api' },
  );

  app.register(webhookRoutes, { payments, processor, providers });

  if (staticDir) app.register(fastifyStatic, { root: path.resolve(staticDir) });

  app.setNotFoundHandler((req, reply) => {
    const isApi = req.url.startsWith('/api') || req.url.startsWith('/webhooks');
    if (staticDir && req.method === 'GET' && !isApi) return reply.sendFile('index.html');
    return reply.code(404).send({ error: 'not_found' });
  });

  return app;
}
