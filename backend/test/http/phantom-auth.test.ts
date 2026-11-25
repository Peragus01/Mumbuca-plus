import { Keypair } from '@solana/web3.js';
import { base58 } from '@scure/base';
import { ed25519 } from '@noble/curves/ed25519';
import { afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { setupApp, WARMUP_TIMEOUT_MS, warmup } from '../helpers/http-app.js';

type T = Awaited<ReturnType<typeof setupApp>>;
const sign = (msg: string, kp: Keypair) => base58.encode(ed25519.sign(new TextEncoder().encode(msg), kp.secretKey.slice(0, 32)));

async function challenge(t: T, kp: Keypair) {
  const res = await t.app.inject({ method: 'POST', url: '/api/auth/phantom/challenge', payload: { walletAddress: kp.publicKey.toBase58() } });
  expect(res.statusCode).toBe(200);
  return res.json<{ nonce: string; message: string }>();
}
const verify = (t: T, kp: Keypair, nonce: string, signature: string, walletAddress = kp.publicKey.toBase58()) =>
  t.app.inject({ method: 'POST', url: '/api/auth/phantom/verify', payload: { walletAddress, nonce, signature } });
const cookieHeader = (res: { cookies: { name: string; value: string }[] }, name: string) => {
  const c = res.cookies.find((x) => x.name === name);
  return c ? `${name}=${c.value}` : undefined;
};
const signup = (t: T, cookie: string | undefined, displayName: unknown) =>
  t.app.inject({ method: 'POST', url: '/api/auth/signup', payload: { displayName }, headers: cookie ? { cookie } : {} });
/** A valid mp_signup cookie issued `agoMs` ago. */
const signupCookie = (t: T, kp: Keypair, agoMs = 0) =>
  `mp_signup=${t.app.signCookie(`${kp.publicKey.toBase58()}:${Date.now() - agoMs}`)}`;
const cookieValue = (t: T, header: string) => t.app.unsignCookie(header.split('=')[1]!).value;

describe('phantom sign-in and signup', () => {
  beforeAll(warmup, WARMUP_TIMEOUT_MS);
  afterEach(() => vi.useRealTimers());

  it('new wallet: challenge -> verify needs_signup -> signup creates a visitor', async () => {
    const t = await setupApp();
    const kp = Keypair.generate();
    const ch = await challenge(t, kp);
    const v = await verify(t, kp, ch.nonce, sign(ch.message, kp));
    expect(v.statusCode).toBe(200);
    expect(v.json()).toEqual({ status: 'needs_signup' });
    const sc = v.cookies.find((c) => c.name === 'mp_signup')!;
    expect(sc.httpOnly).toBe(true);
    expect(sc.sameSite).toBe('Lax');
    expect(sc.maxAge).toBe(600);
    expect(t.app.unsignCookie(sc.value).value).toMatch(new RegExp(`^${kp.publicKey.toBase58()}:\\d+$`));
    expect(cookieHeader(v, 'mp_session')).toBeUndefined();

    const s = await signup(t, cookieHeader(v, 'mp_signup'), ' Ana ');
    expect(s.statusCode).toBe(201);
    expect(s.json()).toEqual({ status: 'signed_in' });
    const sess = cookieHeader(s, 'mp_session')!;
    const me = await t.app.inject({ method: 'GET', url: '/api/session', headers: { cookie: sess } });
    expect(me.json()).toEqual({ authenticated: true, role: 'visitor' });
    const user = await t.users.findByWallet(kp.publicKey.toBase58());
    expect(user?.displayName).toBe('Ana');
    expect(user?.handle).toMatch(/^v_/);
  });

  it('wallet already registered by the operator signs in directly', async () => {
    const t = await setupApp();
    const kp = Keypair.generate();
    const u = await t.users.create({ handle: 'op', displayName: 'Op', walletAddress: kp.publicKey.toBase58() });
    const ch = await challenge(t, kp);
    const v = await verify(t, kp, ch.nonce, sign(ch.message, kp));
    expect(v.json()).toEqual({ status: 'signed_in' });
    expect(cookieValue(t, cookieHeader(v, 'mp_session')!)).toMatch(new RegExp(`^v2:vis:${u.id}:\\d+$`));
  });

  it('a nonce can be used only once', async () => {
    const t = await setupApp();
    const kp = Keypair.generate();
    const ch = await challenge(t, kp);
    const sig = sign(ch.message, kp);
    expect((await verify(t, kp, ch.nonce, sig)).statusCode).toBe(200);
    const again = await verify(t, kp, ch.nonce, sig);
    expect(again.statusCode).toBe(401);
    expect(again.json()).toEqual({ error: 'invalid_signature' });
  });

  it('an expired nonce is rejected', async () => {
    const t = await setupApp();
    const kp = Keypair.generate();
    const ch = await challenge(t, kp);
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() + 6 * 60_000 });
    expect((await verify(t, kp, ch.nonce, sign(ch.message, kp))).statusCode).toBe(401);
  });

  it('a signature from another keypair is rejected', async () => {
    const t = await setupApp();
    const kp = Keypair.generate();
    const ch = await challenge(t, kp);
    const res = await verify(t, kp, ch.nonce, sign(ch.message, Keypair.generate()));
    expect(res.statusCode).toBe(401);
  });

  it('a nonce issued to another wallet is rejected', async () => {
    const t = await setupApp();
    const a = Keypair.generate();
    const b = Keypair.generate();
    const ch = await challenge(t, a);
    expect((await verify(t, b, ch.nonce, sign(ch.message, b))).statusCode).toBe(401);
  });

  it('signup without a valid mp_signup is 401 signup_expired', async () => {
    const t = await setupApp();
    const none = await signup(t, undefined, 'Ana');
    expect(none.statusCode).toBe(401);
    expect(none.json()).toEqual({ error: 'signup_expired' });
    const old = await signup(t, signupCookie(t, Keypair.generate(), 11 * 60_000), 'Ana');
    expect(old.statusCode).toBe(401);
    expect(old.json()).toEqual({ error: 'signup_expired' });
    const forged = await signup(t, `mp_signup=${Keypair.generate().publicKey.toBase58()}:${Date.now()}`, 'Ana');
    expect(forged.statusCode).toBe(401);
  });

  it.each([['   '], ['A'], [' A '], ['x'.repeat(41)], ['\u0007x']])('invalid displayName %j is 400', async (name) => {
    const t = await setupApp();
    const res = await signup(t, signupCookie(t, Keypair.generate()), name);
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_display_name' });
  });

  it('limits signups per IP per day', async () => {
    const t = await setupApp({ VISITOR_SIGNUPS_PER_IP_PER_DAY: 2 });
    for (let i = 0; i < 2; i++) {
      expect((await signup(t, signupCookie(t, Keypair.generate()), `P${i}`)).statusCode).toBe(201);
    }
    const res = await signup(t, signupCookie(t, Keypair.generate()), 'P3');
    expect(res.statusCode).toBe(429);
    expect(res.json()).toEqual({ error: 'rate_limited' });
  });

  it('concurrent signups for one wallet end as the same visitor', async () => {
    const t = await setupApp();
    const kp = Keypair.generate();
    const c = signupCookie(t, kp);
    const [a, b] = await Promise.all([signup(t, c, 'Ana'), signup(t, c, 'Ana')]);
    const vals = [a, b].map((r) => {
      expect(r.statusCode).toBe(201);
      return cookieValue(t, cookieHeader(r, 'mp_session')!)!;
    });
    expect(vals[0]).toMatch(/^v2:vis:/);
    expect(vals[0]!.split(':')[2]).toBe(vals[1]!.split(':')[2]);
    expect((await t.users.list()).length).toBe(1);
  });

  it('is disabled with VISITOR_SIGNIN_ENABLED=false', async () => {
    const t = await setupApp({ VISITOR_SIGNIN_ENABLED: false });
    const res = await t.app.inject({ method: 'POST', url: '/api/auth/phantom/challenge', payload: { walletAddress: Keypair.generate().publicKey.toBase58() } });
    expect(res.statusCode).toBe(403);
    expect(res.json()).toEqual({ error: 'signin_disabled' });
  });

  it('challenge rejects an invalid wallet address', async () => {
    const t = await setupApp();
    const res = await t.app.inject({ method: 'POST', url: '/api/auth/phantom/challenge', payload: { walletAddress: 'nope' } });
    expect(res.statusCode).toBe(400);
    expect(res.json()).toEqual({ error: 'invalid_wallet_address' });
  });
});
