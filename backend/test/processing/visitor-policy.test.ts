import { describe, expect, it, vi } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { loadEnv, type Env } from '../../src/config/env.js';
import type { CreatedVia } from '../../src/domain/payment.js';
import { createVisitorPolicy, type PolicyResult } from '../../src/processing/visitor-policy.js';
import { PaymentRepository } from '../../src/repositories/payment-repository.js';
import { UserRepository } from '../../src/repositories/user-repository.js';
import { FakeChain } from '../helpers/fakes.js';
import { createTestDb } from '../helpers/test-db.js';
import { validEnv } from '../helpers/valid-env.js';

let dbP: ReturnType<typeof createTestDb> | null = null;

async function setup(over: Partial<Env> = {}) {
  dbP ??= createTestDb();
  const db = await dbP;
  await db.query('truncate payment_events, payments, users restart identity cascade', []);
  const users = new UserRepository(db);
  const payments = new PaymentRepository(db);
  const chain = new FakeChain();
  const env: Env = { ...loadEnv(validEnv), ...over };
  const clock = { t: Date.now() };
  const policy = createVisitorPolicy({ env, payments, token: chain, now: () => clock.t });
  const newUser = (handle: string) =>
    users.create({ handle, displayName: handle, walletAddress: Keypair.generate().publicKey.toBase58() });
  const buy = async (
    userId: string,
    cents: bigint,
    status: 'AWAITING_PAYMENT' | 'MINTED' | 'FAILED' = 'MINTED',
    via: CreatedVia = 'visitor',
  ) => {
    const p = await payments.create({
      userId,
      provider: 'simulated',
      providerEnv: 'sandbox',
      requestedAmountCents: cents,
      createdVia: via,
    });
    if (status !== 'AWAITING_PAYMENT') await payments.transition(p.id, ['AWAITING_PAYMENT'], status);
    return p;
  };
  return { policy, chain, clock, newUser, buy, payments };
}

const error = (r: PolicyResult) => (r.ok ? null : r.error);

describe('visitor policy', () => {
  it('rejects amounts outside the range with min/max', async () => {
    const { policy, newUser } = await setup();
    const u = await newUser('a');
    for (const c of [1099n, 10001n]) {
      expect(await policy.checkCreate(u.id, c)).toEqual({
        ok: false,
        error: 'amount_out_of_range',
        minCents: 1100n,
        maxCents: 10000n,
      });
    }
    expect(await policy.checkCreate(u.id, 1100n)).toEqual({ ok: true });
    expect(await policy.checkCreate(u.id, 10000n)).toEqual({ ok: true });
  });

  it('4th purchase of the day on the same wallet is daily_limit; FAILED does not count', async () => {
    const { policy, newUser, buy } = await setup();
    const u = await newUser('a');
    await buy(u.id, 5000n, 'FAILED');
    for (let i = 0; i < 3; i++) {
      expect(await policy.checkCreate(u.id, 5000n)).toEqual({ ok: true });
      await buy(u.id, 5000n);
    }
    expect(error(await policy.checkCreate(u.id, 5000n))).toBe('daily_limit');
  });

  it('the per-wallet count rolls off after 24h', async () => {
    const { policy, newUser, buy, clock } = await setup();
    const u = await newUser('a');
    for (let i = 0; i < 3; i++) await buy(u.id, 5000n);
    clock.t += 25 * 3600_000;
    expect(await policy.checkCreate(u.id, 5000n)).toEqual({ ok: true });
  });

  it('global cap: second 10000 purchase on another account is daily_limit', async () => {
    const { policy, newUser, buy } = await setup({ VISITOR_DAILY_CAP_CENTS: 15000n });
    const a = await newUser('a');
    const b = await newUser('b');
    expect(await policy.checkCreate(a.id, 10000n)).toEqual({ ok: true });
    await buy(a.id, 10000n);
    expect(error(await policy.checkCreate(b.id, 10000n))).toBe('daily_limit');
    expect(await policy.checkCreate(b.id, 5000n)).toEqual({ ok: true });
  });

  it('recent AWAITING_PAYMENT is open_payment; after 31 min it is allowed and no longer counts to the cap', async () => {
    const { policy, newUser, buy, clock } = await setup({ VISITOR_DAILY_CAP_CENTS: 15000n });
    const a = await newUser('a');
    const b = await newUser('b');
    await buy(a.id, 10000n, 'AWAITING_PAYMENT');
    expect(error(await policy.checkCreate(a.id, 5000n))).toBe('open_payment');
    clock.t += 31 * 60_000;
    expect(await policy.checkCreate(a.id, 5000n)).toEqual({ ok: true });
    expect(await policy.checkCreate(b.id, 10000n)).toEqual({ ok: true });
  });

  it('operator payments count for nothing', async () => {
    const { policy, newUser, buy } = await setup({ VISITOR_DAILY_CAP_CENTS: 15000n });
    const a = await newUser('a');
    for (let i = 0; i < 4; i++) await buy(a.id, 10000n, 'MINTED', 'operator');
    await buy(a.id, 10000n, 'AWAITING_PAYMENT', 'operator');
    expect(await policy.checkCreate(a.id, 10000n)).toEqual({ ok: true });
    expect(await policy.purchasesOpen()).toBe(true);
  });

  it('closed when paused (checkCreate and checkPay)', async () => {
    const { policy, chain, newUser } = await setup();
    const u = await newUser('a');
    chain.config = { ...chain.config, paused: true };
    expect(error(await policy.checkCreate(u.id, 5000n))).toBe('purchases_closed');
    expect(error(await policy.checkPay())).toBe('purchases_closed');
    expect(await policy.purchasesOpen()).toBe(false);
  });

  it('closed on a config issue, low SOL, chain failure, or sign-in disabled', async () => {
    const b = await setup();
    b.chain.config = { ...b.chain.config, maxMintPerTx: 1n };
    expect(await b.policy.purchasesOpen()).toBe(false);

    const c = await setup({ LOW_SOL_THRESHOLD_LAMPORTS: 10n ** 10n });
    expect(await c.policy.purchasesOpen()).toBe(false);

    const d = await setup();
    d.chain.configErrors.push(new Error('rpc down'));
    expect(await d.policy.purchasesOpen()).toBe(false);

    const e = await setup({ VISITOR_SIGNIN_ENABLED: false });
    expect(await e.policy.purchasesOpen()).toBe(false);
  });

  it('closed when the daily cap is reached', async () => {
    const { policy, newUser, buy } = await setup({ VISITOR_DAILY_CAP_CENTS: 10000n });
    const a = await newUser('a');
    await buy(a.id, 10000n);
    expect(await policy.purchasesOpen()).toBe(false);
  });

  it('checkPay: a visitor charge older than 30 min is payment_expired; operator ones are not', async () => {
    const { policy, clock } = await setup();
    const at = (min: number) => new Date(clock.t - min * 60_000);
    expect(await policy.checkPay({ createdVia: 'visitor', createdAt: at(29) })).toEqual({ ok: true });
    expect(error(await policy.checkPay({ createdVia: 'visitor', createdAt: at(31) }))).toBe('payment_expired');
    expect(await policy.checkPay({ createdVia: 'operator', createdAt: at(31) })).toEqual({ ok: true });
  });

  it('chain status is cached for 30 s', async () => {
    const { policy, chain, clock } = await setup();
    expect(await policy.purchasesOpen()).toBe(true);
    chain.config = { ...chain.config, paused: true };
    clock.t += 29_000;
    expect(await policy.purchasesOpen()).toBe(true);
    clock.t += 2_000;
    expect(await policy.purchasesOpen()).toBe(false);
  });
  it('concurrent purchasesOpen() calls at cache expiry share one chain lookup', async () => {
    const { policy, chain, clock } = await setup();
    const spy = vi.spyOn(chain, 'programConfig');
    expect(await policy.purchasesOpen()).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    clock.t += 31_000;
    const results = await Promise.all(Array.from({ length: 5 }, () => policy.purchasesOpen()));
    expect(results).toEqual([true, true, true, true, true]);
    expect(spy).toHaveBeenCalledTimes(2);
  });

  it('purchasesOpen caches the visitor totals for 5 s; checkCreate never uses the cache', async () => {
    const { policy, payments, newUser, buy, clock } = await setup({ VISITOR_DAILY_CAP_CENTS: 10000n });
    const spy = vi.spyOn(payments, 'visitorTotals');
    expect(await policy.purchasesOpen()).toBe(true);
    expect(await policy.purchasesOpen()).toBe(true);
    expect(spy).toHaveBeenCalledTimes(1);
    const a = await newUser('a');
    await buy(a.id, 10000n);
    // cached: still open within 5 s, but checkCreate reads fresh totals
    expect(await policy.purchasesOpen()).toBe(true);
    expect(error(await policy.checkCreate(a.id, 5000n))).toBe('daily_limit');
    clock.t += 5_001;
    expect(await policy.purchasesOpen()).toBe(false);
  });
});
