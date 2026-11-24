import 'dotenv/config';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createSolanaTokenGateway } from './chain/token-gateway.js';
import { loadEnv } from './config/env.js';
import { createPgDb, migrate } from './db/db.js';
import { buildApp } from './http/app.js';
import { errorClass } from './http/errors.js';
import { createPaymentProcessor, type ProcessorLog } from './processing/payment-processor.js';
import { createReconciler } from './processing/reconciler.js';
import type { ProviderRegistry } from './providers/payment-provider.js';
import { createOzavProvider } from './providers/ozav/ozav-provider.js';
import { createSimulatedProvider } from './providers/simulated-provider.js';
import { PaymentRepository } from './repositories/payment-repository.js';
import { UserRepository } from './repositories/user-repository.js';

/** backend/ — works from src/main.ts (tsx) and dist/src/main.js (tsc build). */
function backendRoot(): string {
  let dir = path.dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 4; i++) {
    if (existsSync(path.join(dir, 'migrations')) && existsSync(path.join(dir, 'package.json'))) return dir;
    dir = path.dirname(dir);
  }
  throw new Error('backend root (with migrations/) not found');
}

async function main(): Promise<void> {
  const env = loadEnv(process.env);
  const root = backendRoot();

  const db = createPgDb(env.DATABASE_URL, env.DATABASE_SSL);
  await migrate(db, path.join(root, 'migrations'));
  const users = new UserRepository(db);
  const payments = new PaymentRepository(db);

  const token = createSolanaTokenGateway({
    rpcUrl: env.SOLANA_RPC_URL,
    programId: env.PROGRAM_ID,
    minterSecretKey: env.minterSecretKey,
    commitment: 'confirmed',
  });

  // Mercado Pago is a stub (src/providers/mercadopago-provider.ts) and is not enabled.
  const providers: ProviderRegistry = {
    ozav: createOzavProvider({
      baseUrl: env.OZAV_BASE_URL,
      apiKey: env.OZAV_API_KEY,
      customerId: env.OZAV_CUSTOMER_ID,
      walletId: env.OZAV_WALLET_ID,
      targetCurrency: env.OZAV_TARGET_CURRENCY,
      targetChain: env.OZAV_TARGET_CHAIN,
      env: env.PROVIDER_ENV,
      webhookSecret: env.OZAV_WEBHOOK_SECRET,
    }),
    simulated: createSimulatedProvider(db),
    mercadopago: undefined,
  };

  // The processor/reconciler log through the Fastify (pino) logger, created right below.
  let logger: ProcessorLog | null = null;
  const log: ProcessorLog = {
    info: (o, m) => logger?.info(o, m),
    warn: (o, m) => logger?.warn(o, m),
    error: (o, m) => logger?.error(o, m),
  };

  const processor = createPaymentProcessor({ payments, users, providers, token, env, log });
  const reconciler = createReconciler({ payments, processor, intervalMs: env.RECONCILE_INTERVAL_MS, log });

  const staticDir = path.resolve(root, '../frontend/dist');
  const hasStatic = existsSync(path.join(staticDir, 'index.html'));
  const app = buildApp({
    env,
    payments,
    users,
    processor,
    providers,
    token,
    staticDir: hasStatic ? staticDir : undefined,
    logger: { level: process.env.LOG_LEVEL ?? 'info' },
    // Trust exactly one reverse proxy (PaaS) in front: real client IP for the login rate limit.
    trustProxy: (_addr: string, hop: number) => hop === 0,
  });
  logger = app.log;
  if (!hasStatic) app.log.warn('frontend build not found (../frontend/dist); serving the API only');
  if (!env.OZAV_WEBHOOK_SECRET) app.log.warn('OZAV_WEBHOOK_SECRET not set: webhooks will be rejected (reconciler still polls)');

  await app.listen({ port: env.PORT, host: '0.0.0.0' });
  reconciler.start();

  let closing = false;
  const shutdown = async (signal: string) => {
    if (closing) return;
    closing = true;
    app.log.info({ signal }, 'shutting down');
    try {
      await reconciler.stop();
      await app.close(); // waits for in-flight background processing
      await db.end();
    } catch (e) {
      app.log.error({ error: errorClass(e) }, 'shutdown failed');
    }
    process.exit(0);
  };
  process.once('SIGTERM', () => void shutdown('SIGTERM'));
  process.once('SIGINT', () => void shutdown('SIGINT'));
}

main().catch((e: unknown) => {
  // loadEnv messages are safe (they never echo values); anything else: class only.
  const msg = e instanceof Error && e.message.startsWith('Invalid environment configuration') ? e.message : errorClass(e);
  console.error(`startup failed: ${msg}`);
  process.exit(1);
});
