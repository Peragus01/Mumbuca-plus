import { randomUUID } from 'node:crypto';
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
    expect(t.app.unsignCookie(c.value).value).toMatch(/^v2:op:\d+$/);
    expect(c.httpOnly).toBe(true);
    expect(c.sameSite).toBe('Lax');
    expect(c.maxAge).toBe(12 * 60 * 60);
    const users = await t.app.inject({ method: 'GET', url: '/api/users', headers: { cookie: `mp_session=${c.value}` } });
    expect(users.statusCode).toBe(200);
    expect(users.json()).toEqual([]);
    const s = await t.app.inject({ method: 'GET', url: '/api/session', headers: { cookie: `mp_session=${c.value}` } });
    expect(s.json()).toEqual({ authenticated: true, role: 'operator' });
  });

  it('no cookie → 401 on /api/payments', async () => {
    const t = await setupApp();
    expect((await t.app.inject({ method: 'GET', url: '/api/payments' })).statusCode).toBe(401);
    expect((await t.app.inject({ method: 'GET', url: '/api/session' })).json()).toEqual({ authenticated: false, role: null });
  });

  it('tampered or unsigned cookie → 401', async () => {
    const t = await setupApp();
    const forged = `mp_session=${encodeURIComponent(`v1:${Date.now()}`)}`;
    expect((await t.app.inject({ method: 'GET', url: '/api/users', headers: { cookie: forged } })).statusCode).toBe(401);
    const tampered = t.cookie.replace(/.$/, (ch) => (ch === 'A' ? 'B' : 'A'));
    expect((await t.app.inject({ method: 'GET', url: '/api/users', headers: { cookie: tampered } })).statusCode).toBe(401);
  });

  it('legacy v1 cookie still operator', async () => {
    const t = await setupApp();
    const cookie = `mp_session=${t.app.signCookie(`v1:${Date.now()}`)}`;
    const res = await t.app.inject({ method: 'GET', url: '/api/users', headers: { cookie } });
    expect(res.statusCode).toBe(200);
  });

  it('visitor cookie gets 403 on operator-only route', async () => {
    const t = await setupApp();
    const cookie = `mp_session=${t.app.signCookie(`v2:vis:${randomUUID()}:${Date.now()}`)}`;
    const res = await t.app.inject({ method: 'GET', url: '/api/users', headers: { cookie } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'forbidden' });
    const s = await t.app.inject({ method: 'GET', url: '/api/session', headers: { cookie } });
    expect(s.json()).toEqual({ authenticated: true, role: 'visitor' });
    const post = await t.app.inject({ method: 'POST', url: '/api/users', headers: { cookie }, payload: { handle: 'a', displayName: 'A', walletAddress: 'x' } });
    expect(post.statusCode).toBe(403);
  });

  it('unsigned v2 cookie -> 401', async () => {
    const t = await setupApp();
    const cookie = `mp_session=${encodeURIComponent(`v2:op:${Date.now()}`)}`;
    expect((await t.app.inject({ method: 'GET', url: '/api/users', headers: { cookie } })).statusCode).toBe(401);
  });

  it('logout clears the cookie', async () => {
    const t = await setupApp();
    const res = await t.api('POST', '/api/logout');
    expect(res.statusCode).toBe(204);
    const c = res.cookies.find((x) => x.name === 'mp_session')!;
    expect(c.value).toBe('');
    expect(res.cookies.find((x) => x.name === 'mp_signup')?.value).toBe('');
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
