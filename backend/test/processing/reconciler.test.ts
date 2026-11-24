import { describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { createTestDb } from '../helpers/test-db.js';
import { validEnv } from '../helpers/valid-env.js';
import { FakeChain, FakeProvider } from '../helpers/fakes.js';
import { loadEnv } from '../../src/config/env.js';
import { createSimulatedProvider } from '../../src/providers/simulated-provider.js';
import type { ProviderRegistry } from '../../src/providers/payment-provider.js';
import { PaymentRepository } from '../../src/repositories/payment-repository.js';
import { UserRepository } from '../../src/repositories/user-repository.js';
import { createPaymentProcessor } from '../../src/processing/payment-processor.js';
import { createReconciler } from '../../src/processing/reconciler.js';

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function setup() {
  const db = await createTestDb();
  const users = new UserRepository(db);
  const payments = new PaymentRepository(db);
  const user = await users.create({
    handle: 'ana',
    displayName: 'Ana',
    walletAddress: Keypair.generate().publicKey.toBase58(),
  });
  const chain = new FakeChain();
  const ozav = new FakeProvider();
  const env = { ...loadEnv(validEnv), MAX_MINT_ATTEMPTS: 3, MINT_CONFIRM_TIMEOUT_MS: 10 };
  const logs: { level: string; obj: Record<string, unknown>; msg?: string }[] = [];
  const log = {
    info: (obj: object, msg?: string) => void logs.push({ level: 'info', obj: obj as any, msg }),
    warn: (obj: object, msg?: string) => void logs.push({ level: 'warn', obj: obj as any, msg }),
    error: (obj: object, msg?: string) => void logs.push({ level: 'error', obj: obj as any, msg }),
  };
  const providers: ProviderRegistry = { ozav, simulated: createSimulatedProvider(db), mercadopago: undefined };
  /** A fresh processor + reconciler over the same DB and chain: what a process restart looks like. */
  const boot = () => {
    const processor = createPaymentProcessor({ payments, users, providers, token: chain, env, log });
    const reconciler = createReconciler({ payments, processor, intervalMs: 20, log });
    return { processor, reconciler };
  };
  const first = boot();
  const recharge = () => first.processor.createRecharge({ userId: user.id, amountCents: 2500n, provider: 'ozav' });
  const approve = (providerPaymentId: string, paymentId: string) =>
    ozav.states.set(providerPaymentId, {
      kind: 'approved',
      receivedAmountCents: 2500n,
      truncated: false,
      metadataPaymentId: paymentId,
    });
  const get = async (id: string) => (await payments.findById(id))!;
  const eventCount = async (id: string) =>
    (await db.query<{ n: number }>(`select count(*)::int as n from payment_events where payment_id = $1`, [id])).rows[0]!.n;
  return { db, payments, chain, ozav, logs, first, boot, recharge, approve, get, eventCount };
}

describe('Reconciler', () => {
  it('tick advances AWAITING_PAYMENT to MINTED once provider approves', async () => {
    const t = await setup();
    const p = await t.recharge();
    await t.first.processor.signal(p.id, 'webhook'); // provider still pending
    expect((await t.get(p.id)).status).toBe('AWAITING_PAYMENT');
    t.approve(p.providerPaymentId!, p.id);
    await t.first.reconciler.tick();
    const r = await t.get(p.id);
    expect(r.status).toBe('MINTED');
    expect(r.txSignature).not.toBeNull();
    expect(t.chain.sendMintCalls).toBe(1);
  });

  it('tick on still-pending payment writes no payment_events rows', async () => {
    const t = await setup();
    const p = await t.recharge();
    await t.first.processor.signal(p.id, 'webhook');
    const before = await t.eventCount(p.id);
    const fetches = t.ozav.fetchCalls;
    await t.first.reconciler.tick();
    await t.first.reconciler.tick();
    expect(t.ozav.fetchCalls).toBe(fetches + 2);
    expect(await t.eventCount(p.id)).toBe(before);
    expect((await t.get(p.id)).status).toBe('AWAITING_PAYMENT');
  });

  it('pix expired at provider while AWAITING_PAYMENT → FAILED pix_expired, no mint', async () => {
    const t = await setup();
    const p = await t.recharge();
    await t.first.processor.signal(p.id, 'webhook');
    t.ozav.states.set(p.providerPaymentId!, { kind: 'expired' });
    await t.first.reconciler.tick();
    const r = await t.get(p.id);
    expect(r.status).toBe('FAILED');
    expect(r.failureReason).toBe('pix_expired');
    expect(t.chain.sendMintCalls).toBe(0);
  });

  it('boot resume: payment left in MINT_PENDING with txSignature finishes MINTED without new sendMint', async () => {
    const t = await setup();
    const p = await t.recharge();
    t.approve(p.providerPaymentId!, p.id);
    t.chain.waitMode = 'timeout'; // tx landed, but the old process never saw the confirmation
    await t.first.processor.signal(p.id, 'webhook');
    const mid = await t.get(p.id);
    expect(mid.status).toBe('MINT_PENDING');
    expect(mid.txSignature).not.toBeNull();
    expect(mid.lastValidBlockHeight).not.toBeNull();
    expect(t.chain.sendMintCalls).toBe(1);

    t.chain.waitMode = 'auto';
    const second = t.boot();
    await second.reconciler.tick();
    const r = await t.get(p.id);
    expect(r.status).toBe('MINTED');
    expect(r.txSignature).toBe(mid.txSignature);
    expect(t.chain.sendMintCalls).toBe(1);
    expect(t.chain.minted).toHaveLength(1);
  });

  it('boot resume: MINT_PENDING whose blockhash expired and no receipt → APPROVED → resent once → MINTED', async () => {
    const t = await setup();
    const p = await t.recharge();
    t.approve(p.providerPaymentId!, p.id);
    t.chain.sendQueue.push('drop'); // broadcast lost: no tx, no receipt
    t.chain.waitMode = 'timeout';
    await t.first.processor.signal(p.id, 'webhook');
    const mid = await t.get(p.id);
    expect(mid.status).toBe('MINT_PENDING');
    expect(t.chain.sendMintCalls).toBe(1);
    expect(t.chain.receipts.size).toBe(0);

    t.chain.height = mid.lastValidBlockHeight! + 1n; // blockhash now expired
    t.chain.waitMode = 'auto';
    const second = t.boot();
    await second.reconciler.tick(); // expired → back to APPROVED
    expect((await t.get(p.id)).status).toBe('APPROVED');
    expect(t.chain.sendMintCalls).toBe(1);
    await second.reconciler.tick(); // APPROVED → resend → MINTED
    expect((await t.get(p.id)).status).toBe('MINTED');
    expect(t.chain.sendMintCalls).toBe(2); // one by the old process, exactly one by the new
    expect(t.chain.minted).toHaveLength(1);
  });

  it('boot resume: payment left in APPROVED after lost broadcast finishes MINTED with one mint total', async () => {
    const t = await setup();
    const p = await t.recharge();
    t.approve(p.providerPaymentId!, p.id);
    t.chain.sendQueue.push('land-then-throw'); // tx landed, response lost
    await t.first.processor.signal(p.id, 'webhook');
    expect((await t.get(p.id)).status).toBe('APPROVED');
    expect(t.chain.receipts.size).toBe(1);

    const second = t.boot();
    await second.reconciler.tick();
    const r = await t.get(p.id);
    expect(r.status).toBe('MINTED');
    expect(r.txSignature).toBe([...t.chain.receipts.values()][0]!.signature);
    expect(t.chain.minted).toHaveLength(1);
    expect(t.chain.sendMintCalls).toBe(1);
  });

  it('one payment throwing does not stop others', async () => {
    const calls: string[] = [];
    const logs: { obj: Record<string, unknown> }[] = [];
    const rows = ['a', 'b', 'c'].map((id) => ({ id, status: id === 'c' ? 'AWAITING_PAYMENT' : 'APPROVED' }));
    const r = createReconciler({
      payments: { listOpen: async () => rows as any },
      processor: {
        async process(id: string) {
          calls.push(`process:${id}`);
          if (id === 'a') throw Object.assign(new Error('https://rpc.example/?api-key=SECRET'), { name: 'TransientChainError' });
          return {} as any;
        },
        async signal(id: string) {
          calls.push(`signal:${id}`);
        },
      },
      intervalMs: 1000,
      log: { info() {}, warn() {}, error: (obj: object) => void logs.push({ obj: obj as any }) },
    });
    await r.tick();
    expect(calls).toEqual(['process:a', 'process:b', 'signal:c']);
    expect(logs).toHaveLength(1);
    expect(logs[0]!.obj).toEqual({ paymentId: 'a', error: 'TransientChainError' });
    expect(JSON.stringify(logs)).not.toContain('SECRET');
  });

  it('overlapping ticks do not run concurrently', async () => {
    const t = await setup();
    const p = await t.recharge();
    await t.first.processor.signal(p.id, 'webhook');
    const base = t.ozav.fetchCalls;
    const orig = t.ozav.fetchPayment.bind(t.ozav);
    t.ozav.fetchPayment = async (id: string) => {
      await sleep(60);
      return orig(id);
    };
    const a = t.first.reconciler.tick();
    const b = t.first.reconciler.tick();
    await Promise.all([a, b]);
    expect(t.ozav.fetchCalls - base).toBe(1);
  });

  it('start ticks immediately, repeats, and stop awaits the in-flight tick and halts the interval', async () => {
    let listed = 0;
    let finished = 0;
    const r = createReconciler({
      payments: {
        listOpen: async () => {
          listed++;
          await sleep(30);
          finished++;
          return [];
        },
      },
      processor: { process: async () => ({}) as any, signal: async () => {} },
      intervalMs: 10,
      log: { info() {}, warn() {}, error() {} },
    });
    r.start();
    expect(listed).toBe(1); // immediate boot tick
    await sleep(100);
    expect(finished).toBeGreaterThanOrEqual(2);
    await r.stop();
    expect(finished).toBe(listed); // nothing left in flight
    const after = listed;
    await sleep(60);
    expect(listed).toBe(after);
  });
});
