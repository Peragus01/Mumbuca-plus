import { beforeAll, describe, expect, it } from 'vitest';
import { PASSWORD, setupApp, WARMUP_TIMEOUT_MS, warmup } from '../helpers/http-app.js';

describe('http auth', () => {
  beforeAll(warmup, WARMUP_TIMEOUT_MS);

  it('login wrong password 401', async () => {
    const t = await setupApp();
    const res = await t.app.inject({ method: 'POST', url: '/api/login', payload: { password: 'wrong-password-xyz' } });
    expect(res.statusCode).toBe(401);
    expect(res.cookies.find((c) => c.name === 'mp_session')).toBeUndefined();
  });

  it('login ok sets cookie and /api/users works', async () => {
    const t = await setupApp();
    const res = await t.app.inject({ method: 'POST', url: '/api/login', payload: { password: PASSWORD } });
    expect(res.statusCode).toBe(204);
    const c = res.cookies.find((x) => x.name === 'mp_session')!;
    expect(c).toBeDefined();
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe('Lax');
    expect(c.maxAge).toBe(12 * 60 * 60);
    const users = await t.app.inject({ method: 'GET', url: '/api/users', headers: { cookie: `mp_session=${c.value}` } });
    expect(users.statusCode).toBe(200);
    expect(users.json()).toEqual([]);
    const s = await t.app.inject({ method: 'GET', url: '/api/session', headers: { cookie: `mp_session=${c.value}` } });
    expect(s.json()).toEqual({ authenticated: true });
  });

  it('no cookie → 401 on /api/payments', async () => {
    const t = await setupApp();
    expect((await t.app.inject({ method: 'GET', url: '/api/payments' })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'GET', url: '/api/session' })).json()).toEqual({ authenticated: false });
  });

  it('tampered or unsigned cookie → 401', async () => {
    const t = await setupApp();
    const forged = `mp_session=${encodeURIComponent(`v1:${Date.now()}`)}`;
    expect((await t.app.inject({ method: 'GET', url: '/api/users', headers: { cookie: forged } })).statusCode).toBe(401);
    const tampered = t.cookie.replace(/.$/, (ch) => (ch === 'A' ? 'B' : 'A'));
    expect((await t.app.inject({ method: 'GET', url: '/api/users', headers: { cookie: tampered } })).statusCode).toBe(401);
  });

  it('logout clears the cookie', async () => {
    const t = await setupApp();
    const res = await t.api('POST', '/api/logout');
    expect(res.statusCode).toBe(204);
    const c = res.cookies.find((x) => x.name === 'mp_session')!;
    expect(c.value).toBe('');
  });

  it('11th login in a minute → 429', async () => {
    const t = await setupApp(); // setupApp already logged in once
    const codes: number[] = [];
    for (let i = 0; i < 10; i++) {
      const res = await t.app.inject({ method: 'POST', url: '/api/login', payload: { password: 'wrong-password-xyz' } });
      codes.push(res.statusCode);
    }
    expect(codes.slice(0, 9).every((c) => c === 401)).toBe(true);
    expect(codes[9]).toBe(429);
  });
});
