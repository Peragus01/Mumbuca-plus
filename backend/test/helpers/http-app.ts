import { createHmac } from 'node:crypto';
import { Keypair } from '@solana/web3.js';
import { loadEnv, type Env } from '../../src/config/env.js';
import { buildApp } from '../../src/http/app.js';
import { createPaymentProcessor } from '../../src/processing/payment-processor.js';
import type { ProviderRegistry, WebhookResult } from '../../src/providers/payment-provider.js';
import { verifyOzavWebhook } from '../../src/providers/ozav/ozav-signature.js';
import { createSimulatedProvider } from '../../src/providers/simulated-provider.js';
import { PaymentRepository } from '../../src/repositories/payment-repository.js';
import { UserRepository } from '../../src/repositories/user-repository.js';
import { FakeChain, FakeProvider } from './fakes.js';
import type { Db } from '../../src/db/db.js';
import { createTestDb } from './test-db.js';
import { validEnv } from './valid-env.js';

export const WEBHOOK_SECRET = 'ozav_whsec_http_test';
export const PASSWORD = validEnv.DEMO_PASSWORD!;

/** FakeProvider plus the real OZAV webhook verification (HMAC with WEBHOOK_SECRET). */
export class WebhookFakeProvider extends FakeProvider {
  verifyWebhook(raw: Buffer, headers: Record<string, string | undefined>, now: Date): WebhookResult {
    return verifyOzavWebhook(raw, headers, WEBHOOK_SECRET, now);
  }
}

const quiet = { info() {}, warn() {}, error() {} };

// One PGlite per test file (tests inside a file run sequentially); emptied for every setupApp.
let sharedDb: Promise<Db> | null = null;
async function freshDb(): Promise<Db> {
  sharedDb ??= createTestDb();
  const db = await sharedDb;
  await db.query('truncate payment_events, payments, users, simulated_charges, auth_challenges, signup_ip_counts restart identity cascade', []);
  return db;
}

export async function setupApp(over: Partial<Env> = {}, opts: { staticDir?: string } = {}) {
  const db = await freshDb();
  const users = new UserRepository(db);
  const payments = new PaymentRepository(db);
  const env: Env = { ...loadEnv(validEnv), MINT_CONFIRM_TIMEOUT_MS: 10, ...over };
  const chain = new FakeChain();
  const ozav = new WebhookFakeProvider();
  const providers: ProviderRegistry = { ozav, simulated: createSimulatedProvider(db), mercadopago: undefined };
  const processor = createPaymentProcessor({ payments, users, providers, token: chain, env, log: quiet });
  const app = buildApp({ env, payments, users, processor, providers, token: chain, staticDir: opts.staticDir });
  await app.ready();

  async function login(): Promise<string> {
    const res = await app.inject({ method: 'POST', url: '/api/login', payload: { password: PASSWORD } });
    if (res.statusCode !== 204) throw new Error(`login failed: ${res.statusCode}`);
    const c = res.cookies.find((x) => x.name === 'mp_session')!;
    return `mp_session=${c.value}`;
  }
  const cookie = await login();

  const api = (method: 'GET' | 'POST', url: string, payload?: object) =>
    app.inject({ method, url, payload, headers: { cookie } });

  const newUser = (handle = 'ana') =>
    users.create({ handle, displayName: handle.toUpperCase(), walletAddress: Keypair.generate().publicKey.toBase58() });

  return { db, app, env, chain, ozav, providers, processor, users, payments, cookie, login, api, newUser };
}

export function signedWebhook(event: object, opts: { secret?: string; t?: number } = {}) {
  const raw = Buffer.from(JSON.stringify(event));
  const t = opts.t ?? Math.floor(Date.now() / 1000);
  const v1 = createHmac('sha256', opts.secret ?? WEBHOOK_SECRET).update(`${t}.`).update(raw).digest('hex');
  return {
    payload: raw,
    headers: {
      'content-type': 'application/json',
      'x-ozav-signature': `t=${t},v1=${v1}`,
      'x-ozav-event-id': (event as { id: string }).id,
    },
  };
}

export const transferEvent = (id: string, transferId: string, metadata?: Record<string, string>) => ({
  id,
  object: 'event',
  type: 'transfer.updated',
  data: { id: transferId, object: 'transfer', status: 'payment_confirmed', ...(metadata ? { metadata } : {}) },
});

/**
 * PGlite start-up (WASM + migrations) and the first Fastify boot are slow when several test files
 * start at once; pay for them in a beforeAll with a generous timeout instead of in the first test.
 */
export async function warmup(): Promise<void> {
  const t = await setupApp();
  await t.app.close();
}
export const WARMUP_TIMEOUT_MS = 180_000;
