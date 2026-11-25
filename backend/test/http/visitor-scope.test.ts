import { beforeAll, describe, expect, it } from 'vitest';
import { setupApp, WARMUP_TIMEOUT_MS, warmup } from '../helpers/http-app.js';

async function setup() {
  const t = await setupApp();
  const a = await t.newUser('alice');
  const b = await t.newUser('bob');
  const asA = (method: 'GET' | 'POST', url: string, payload?: object) =>
    t.app.inject({ method, url, payload, headers: { cookie: t.visitorCookie(a.id) } });
  const pay = async (userId: string) => {
    const res = await t.api('POST', '/api/payments', { userId, amountCents: '5000', provider: 'simulated' });
    expect(res.statusCode).toBe(201);
    return res.json().id as string;
  };
  const payA = await pay(a.id);
  const payB = await pay(b.id);
  return { t, a, b, asA, payA, payB };
}

describe('visitor scope', () => {
  beforeAll(warmup, WARMUP_TIMEOUT_MS);

  it('operator-only routes answer 403', async () => {
    const { asA, payA } = await setup();
    expect((await asA('GET', '/api/users')).statusCode).toBe(403);
    expect((await asA('POST', '/api/users', { handle: 'x', displayName: 'X', walletAddress: 'y' })).statusCode).toBe(403);
    expect((await asA('GET', '/api/ops/status')).statusCode).toBe(403);
    expect((await asA('POST', `/api/payments/${payA}/reprocess`)).statusCode).toBe(403);
  });

  it('balance: own 200, other 404', async () => {
    const { asA, a, b } = await setup();
    expect((await asA('GET', `/api/users/${a.id}/balance`)).statusCode).toBe(200);
    expect((await asA('GET', `/api/users/${b.id}/balance`)).statusCode).toBe(404);
  });

  it('balance matches the session userId case-insensitively', async () => {
    const { t, a } = await setup();
    const res = await t.app.inject({
      method: 'GET',
      url: `/api/users/${a.id}/balance`,
      headers: { cookie: t.visitorCookie(a.id.toUpperCase()) },
    });
    expect(res.statusCode).toBe(200);
  });

  it('list payments ignores userId and returns only own', async () => {
    const { asA, a, b, payA } = await setup();
    for (const url of ['/api/payments', `/api/payments?userId=${b.id}`]) {
      const res = await asA('GET', url);
      expect(res.statusCode).toBe(200);
      const list = res.json();
      expect(list.map((p: { id: string }) => p.id)).toEqual([payA]);
      expect(list.every((p: { userId: string }) => p.userId === a.id)).toBe(true);
    }
  });

  it("other's payment: get and simulate → 404; own → 200", async () => {
    const { asA, payA, payB } = await setup();
    expect((await asA('GET', `/api/payments/${payB}`)).statusCode).toBe(404);
    expect((await asA('POST', `/api/payments/${payB}/simulate`)).statusCode).toBe(404);
    expect((await asA('GET', `/api/payments/${payA}`)).statusCode).toBe(200);
    expect((await asA('POST', `/api/payments/${payA}/simulate`)).statusCode).toBe(200);
  });

  it('create: userId from session, createdVia visitor', async () => {
    const { t, asA, a, b } = await setup();
    const res = await asA('POST', '/api/payments', { userId: b.id, provider: 'simulated', amountCents: '5000' });
    expect(res.statusCode).toBe(201);
    expect(res.json().userId).toBe(a.id);
    const p = await t.payments.findById(res.json().id);
    expect(p?.createdVia).toBe('visitor');
  });

  it('create with another provider → 422 provider_not_enabled', async () => {
    const { asA, a } = await setup();
    const res = await asA('POST', '/api/payments', { userId: a.id, provider: 'ozav', amountCents: '5000' });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'provider_not_enabled' });
  });

  it('/api/me', async () => {
    const { t, asA, a } = await setup();
    const res = await asA('GET', '/api/me');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ role: 'visitor', user: { id: a.id, handle: 'alice' } });
    expect((await t.api('GET', '/api/me')).json()).toEqual({ role: 'operator' });
    const ghost = await t.app.inject({
      method: 'GET',
      url: '/api/me',
      headers: { cookie: t.visitorCookie('00000000-0000-4000-8000-000000000000') },
    });
    expect(ghost.statusCode).toBe(401);
    expect(ghost.json()).toEqual({ error: 'unauthorized' });
  });
});
