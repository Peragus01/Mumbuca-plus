import { createHash } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import type { Env } from '../../config/env.js';
import { CHALLENGE_TTL_MS, buildSignInMessage, verifySignature } from '../../auth/phantom-challenge.js';
import { parseSolanaAddress } from '../../domain/solana-address.js';
import type { AuthRepository } from '../../repositories/auth-repository.js';
import { DuplicateUser, type User, type UserRepository } from '../../repositories/user-repository.js';
import { SIGNUP_COOKIE, setSessionCookie } from '../auth.js';

export interface PhantomAuthOptions {
  env: Env;
  users: UserRepository;
  auth: AuthRepository;
  secureCookie: boolean;
}

export const SIGNUP_TTL_SECONDS = 600;
const SKEW_MS = 60_000;
const SIGNUP_VALUE_RE = /^([1-9A-HJ-NP-Za-km-z]{32,44}):(\d{1,15})$/;
const CONTROL_CHARS_RE = /\p{C}/u;
const MAX_NAME_LENGTH = 40;
const MAX_HANDLE_ATTEMPTS = 50;

/** Trimmed display name, or null when empty, longer than 40 characters or containing control characters. */
function cleanDisplayName(input: unknown): string | null {
  if (typeof input !== 'string') return null;
  const name = input.trim();
  const len = [...name].length;
  if (len === 0 || len > MAX_NAME_LENGTH || CONTROL_CHARS_RE.test(name)) return null;
  return name;
}

/** Wallet of a validly signed, unexpired `mp_signup` cookie, or null. */
function readSignupWallet(req: FastifyRequest): string | null {
  const raw = req.cookies[SIGNUP_COOKIE];
  if (!raw) return null;
  const res = req.unsignCookie(raw);
  if (!res.valid || !res.value) return null;
  const m = SIGNUP_VALUE_RE.exec(res.value);
  if (!m) return null;
  const issuedAt = Number(m[2]);
  const now = Date.now();
  if (issuedAt > now + SKEW_MS || now - issuedAt >= SIGNUP_TTL_SECONDS * 1000) return null;
  return parseSolanaAddress(m[1]!);
}

/** Creates the visitor (`v_` + first 8 wallet chars, `_2`, `_3`... on handle collision); a lost race re-reads by wallet. */
async function createVisitor(users: UserRepository, wallet: string, displayName: string): Promise<User> {
  const base = `v_${wallet.slice(0, 8)}`;
  for (let i = 1; i <= MAX_HANDLE_ATTEMPTS; i++) {
    try {
      return await users.create({ handle: i === 1 ? base : `${base}_${i}`, displayName, walletAddress: wallet });
    } catch (e) {
      if (!(e instanceof DuplicateUser)) throw e;
      const existing = await users.findByWallet(wallet);
      if (existing) return existing;
    }
  }
  throw new DuplicateUser('no free handle');
}

const rateLimit = (max: number) => ({ rateLimit: { max, timeWindow: '1 minute' } });

/** Phantom challenge/verify and visitor signup (mounted under /api). */
export const phantomAuthRoutes: FastifyPluginAsync<PhantomAuthOptions> = async (app, opts) => {
  const { env, users, auth, secureCookie } = opts;

  const startVisitorSession = (reply: FastifyReply, user: User) =>
    setSessionCookie(reply, { role: 'visitor', userId: user.id.toLowerCase() }, secureCookie);

  app.addHook('onRequest', async (_req, reply) => {
    if (!env.VISITOR_SIGNIN_ENABLED) return reply.code(403).send({ error: 'signin_disabled' });
  });

  app.post<{ Body: { walletAddress: string } }>(
    '/auth/phantom/challenge',
    {
      config: rateLimit(20),
      schema: {
        body: { type: 'object', required: ['walletAddress'], properties: { walletAddress: { type: 'string', maxLength: 128 } } },
      },
    },
    async (req, reply) => {
      const wallet = parseSolanaAddress(req.body.walletAddress);
      if (wallet === null) return reply.code(400).send({ error: 'invalid_wallet_address' });
      const issuedAt = new Date();
      const expiresAt = new Date(issuedAt.getTime() + CHALLENGE_TTL_MS);
      await auth.deleteExpiredChallenges(issuedAt);
      let message = '';
      const nonce = await auth.createChallenge(
        wallet,
        (n) => (message = buildSignInMessage({ host: req.hostname, wallet, nonce: n, issuedAt, expiresAt })),
        expiresAt,
      );
      return reply.send({ nonce, message });
    },
  );

  app.post<{ Body: { walletAddress: string; nonce: string; signature: string } }>(
    '/auth/phantom/verify',
    {
      config: rateLimit(20),
      schema: {
        body: {
          type: 'object',
          required: ['walletAddress', 'nonce', 'signature'],
          properties: {
            walletAddress: { type: 'string', maxLength: 128 },
            nonce: { type: 'string', maxLength: 128 },
            signature: { type: 'string', maxLength: 256 },
          },
        },
      },
    },
    async (req, reply) => {
      const fail = () => reply.code(401).send({ error: 'invalid_signature' });
      const wallet = parseSolanaAddress(req.body.walletAddress);
      if (wallet === null) return fail();
      const now = new Date();
      const challenge = await auth.consumeChallenge(req.body.nonce, wallet, now);
      if (!challenge) return fail();
      // Only the stored message is verified, never client-supplied text.
      if (!verifySignature(challenge.message, req.body.signature, wallet)) return fail();
      const user = await users.findByWallet(wallet);
      if (user) {
        startVisitorSession(reply, user);
        return reply.send({ status: 'signed_in' });
      }
      reply.setCookie(SIGNUP_COOKIE, `${wallet}:${now.getTime()}`, {
        signed: true,
        httpOnly: true,
        secure: secureCookie,
        sameSite: 'lax',
        path: '/',
        maxAge: SIGNUP_TTL_SECONDS,
      });
      return reply.send({ status: 'needs_signup' });
    },
  );

  app.post<{ Body: { displayName: string } }>(
    '/auth/signup',
    {
      config: rateLimit(5),
      schema: { body: { type: 'object', required: ['displayName'], properties: { displayName: { type: 'string', maxLength: 500 } } } },
    },
    async (req, reply) => {
      const wallet = readSignupWallet(req);
      if (wallet === null) return reply.code(401).send({ error: 'signup_expired' });
      const displayName = cleanDisplayName(req.body.displayName);
      if (displayName === null) return reply.code(400).send({ error: 'invalid_display_name' });

      let user = await users.findByWallet(wallet);
      if (!user) {
        const day = new Date().toISOString().slice(0, 10);
        const ipHash = createHash('sha256').update(`${env.SESSION_SECRET}${req.ip}${day}`).digest('hex');
        if (!(await auth.incrementSignupCount(ipHash, day, env.VISITOR_SIGNUPS_PER_IP_PER_DAY))) {
          return reply.code(429).send({ error: 'rate_limited' });
        }
        user = await createVisitor(users, wallet, displayName);
      }
      reply.clearCookie(SIGNUP_COOKIE, { path: '/', httpOnly: true, secure: secureCookie, sameSite: 'lax' });
      startVisitorSession(reply, user);
      return reply.code(201).send({ status: 'signed_in' });
    },
  );
};
