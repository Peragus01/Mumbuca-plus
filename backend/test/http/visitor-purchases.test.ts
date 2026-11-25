import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import type { Env } from '../../src/config/env.js';
import { setupApp, WARMUP_TIMEOUT_MS, warmup } from '../helpers/http-app.js';

async function setup(over: Partial<Env> = {}) {
  const t = await setupApp(over);
  const a = await t.newUser('alice');
  const asA = (method: 'GET' | 'POST', url: string, payload?: object, remoteAddress?: string) =>
    t.app.inject({ method, url, payload, headers: { cookie: t.visitorCookie(a.id) }, ...(remoteAddress ? { remoteAddress } : {}) });
  const create = (cents: string, remoteAddress?: string) =>
    asA('POST', '/api/payments', { userId: a.id, provider: 'simulated', amountCents: cents }, remoteAddress);
  const status = () => t.app.inject({ method: 'GET', url: '/api/public/status' });
  return { t, a, asA, create, status };
}

describe('visitor purchases', () => {
  beforeAll(warmup, WARMUP_TIMEOUT_MS);

  it('happy path: create R$50 -> simulate -> MINTED to their wallet', async () => {
    const { t, a, asA, create } = await setup();
    const res = await create('5000');
    expect(res.statusCode).toBe(201);
    const sim = await asA('POST', `/api/payments/${res.json().id}/simulate`);
    expect(sim.statusCode).toBe(200);
    await t.app.idle();
    const p = await t.payments.findById(res.json().id);
    expect(p?.status).toBe('MINTED');
    expect(t.chain.minted.map((m) => m.recipient)).toEqual([a.walletAddress]);
  });

  it('amount out of range -> 422 with min/max', async () => {
    const { create } = await setup();
    for (const c of ['1099', '10001']) {
      const res = await create(c);
      expect(res.statusCode).toBe(422);
      expect(res.json()).toEqual({ error: 'amount_out_of_range', minCents: '1100', maxCents: '10000' });
    }
  });

  it('open payment -> 409 open_payment', async () => {
    const { create } = await setup();
    expect((await create('5000')).statusCode).toBe(201);
    const res = await create('5000');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'open_payment' });
  });

  it('4th purchase of the day -> 429 daily_limit', async () => {
    const { t, create } = await setup();
    for (let i = 0; i < 3; i++) {
      const res = await create('5000');
      expect(res.statusCode).toBe(201);
      await t.payments.transition(res.json().id, ['AWAITING_PAYMENT'], 'MINTED');
    }
    const res = await create('5000');
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: 'daily_limit' });
  });

  it('paused chain -> create 409 purchases_closed and public status false', async () => {
    const { t, create, status } = await setup();
    t.chain.config = { ...t.chain.config, paused: true };
    const c = await create('5000');
    expect(c.statusCode).toBe(409);
    expect(c.json()).toEqual({ error: 'purchases_closed' });
    const st = await status();
    expect(st.statusCode).toBe(200);
    expect(st.json()).toEqual({ visitorPurchasesOpen: false });
  });

  it('paused chain -> simulate 409 purchases_closed', async () => {
    const { t, create, asA } = await setup();
    const made = await create('5000');
    expect(made.statusCode).toBe(201);
    t.chain.config = { ...t.chain.config, paused: true };
    // past the 30 s chain-status cache, still well inside the 30 min payment window
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(Date.now() + 31_000);
      const sim = await asA('POST', `/api/payments/${made.json().id}/simulate`);
      expect(sim.statusCode).toBe(409);
      expect(sim.json()).toEqual({ error: 'purchases_closed' });
    } finally {
      vi.useRealTimers();
    }
  });

  it('visitor cannot simulate an operator-created charge on their own user (404)', async () => {
    const { t, a, asA } = await setup();
    const made = await t.api('POST', '/api/payments', { userId: a.id, provider: 'simulated', amountCents: '5000' });
    expect(made.statusCode).toBe(201);
    const sim = await asA('POST', `/api/payments/${made.json().id}/simulate`);
    expect(sim.statusCode).toBe(404);
    expect(sim.json()).toEqual({ error: 'payment_not_found' });
    await t.app.idle();
    expect(t.chain.minted).toEqual([]);
  });

  it('5 concurrent creates from one session: exactly one 201, the rest 409 open_payment', async () => {
    const { t, create } = await setup();
    // widen the check-then-insert window so every unserialized check would pass before any insert
    const original = t.processor.createRecharge.bind(t.processor);
    vi.spyOn(t.processor, 'createRecharge').mockImplementation(async (input) => {
      await new Promise((r) => setTimeout(r, 50));
      return original(input);
    });
    const res = await Promise.all(Array.from({ length: 5 }, () => create('5000')));
    const codes = res.map((r) => r.statusCode).sort();
    expect(codes).toEqual([201, 409, 409, 409, 409]);
    for (const r of res.filter((x) => x.statusCode === 409)) expect(r.json()).toEqual({ error: 'open_payment' });
    const a = await t.payments.listAll();
    expect(a).toHaveLength(1);
  });

  describe('stale charge', () => {
    afterEach(() => vi.useRealTimers());
    const advance = (min: number) => {
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + min * 60_000);
    };

    it('31 min old -> simulate 409 payment_expired and nothing minted', async () => {
      const { t, create, asA } = await setup();
      const res = await create('5000');
      expect(res.statusCode).toBe(201);
      advance(31);
      const sim = await asA('POST', `/api/payments/${res.json().id}/simulate`);
      expect(sim.statusCode).toBe(409);
      expect(sim.json()).toEqual({ error: 'payment_expired' });
      await t.app.idle();
      expect(t.chain.minted).toEqual([]);
    });

    it('29 min old still works', async () => {
      const { t, create, asA } = await setup();
      const res = await create('5000');
      advance(29);
      expect((await asA('POST', `/api/payments/${res.json().id}/simulate`)).statusCode).toBe(200);
      await t.app.idle();
      expect(t.chain.minted).toHaveLength(1);
    });
  });

  it('low SOL -> 409 purchases_closed', async () => {
    const { create } = await setup({ LOW_SOL_THRESHOLD_LAMPORTS: 10n ** 10n });
    const res = await create('5000');
    expect(res.statusCode).toBe(409);
    expect(res.json()).toEqual({ error: 'purchases_closed' });
  });

  it('public status needs no session and is open by default', async () => {
    const { status } = await setup();
    const res = await status();
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ visitorPurchasesOpen: true });
  });

  it('operator is not subject to the policy (amount, quotas, rate limit)', async () => {
    const { t, a } = await setup();
    for (let i = 0; i < 7; i++) {
      const res = await t.api('POST', '/api/payments', { userId: a.id, provider: 'simulated', amountCents: '20000' });
      expect(res.statusCode).toBe(201);
    }
  });

  it('visitor create is rate limited to 5/min per visitor, across IPs', async () => {
    const { t, create } = await setup();
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await create('1099', i % 2 ? '10.0.0.1' : '10.0.0.2')).statusCode);
    expect(codes.slice(0, 5)).toEqual([422, 422, 422, 422, 422]);
    expect(codes[5]).toBe(429);
    // another visitor on the same IP is not affected
    const b = await t.newUser('bob');
    const other = await t.app.inject({
      method: 'POST',
      url: '/api/payments',
      payload: { userId: b.id, provider: 'simulated', amountCents: '1099' },
      headers: { cookie: t.visitorCookie(b.id) },
      remoteAddress: '10.0.0.1',
    });
    expect(other.statusCode).toBe(422);
  });

  it('visitor simulate is rate limited to 5/min per visitor; operator is exempt', async () => {
    const { t, asA } = await setup();
    const missing = '00000000-0000-4000-8000-000000000000';
    const codes: number[] = [];
    for (let i = 0; i < 6; i++) codes.push((await asA('POST', `/api/payments/${missing}/simulate`, undefined, `10.0.1.${i}`)).statusCode);
    expect(codes).toEqual([404, 404, 404, 404, 404, 429]);
    for (let i = 0; i < 7; i++) expect((await t.api('POST', `/api/payments/${missing}/simulate`)).statusCode).toBe(404);
  });

  it('public status is rate limited to 30/min', async () => {
    const { status } = await setup();
    for (let i = 0; i < 30; i++) expect((await status()).statusCode).toBe(200);
    const res = await status();
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: 'rate_limited' });
  });

  it('balance is rate limited to 30/min for visitors; operator is exempt', async () => {
    const { t, a, asA } = await setup();
    for (let i = 0; i < 30; i++) expect((await asA('GET', `/api/users/${a.id}/balance`)).statusCode).toBe(200);
    expect((await asA('GET', `/api/users/${a.id}/balance`)).statusCode).toBe(429);
    for (let i = 0; i < 35; i++) expect((await t.api('GET', `/api/users/${a.id}/balance`)).statusCode).toBe(200);
  });
});
