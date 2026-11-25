import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync, FastifyReply, FastifyRequest } from 'fastify';
import { isUuid } from './errors.js';

export const SESSION_COOKIE = 'mp_session';
export const SESSION_TTL_SECONDS = 12 * 60 * 60;
/** Tolerated clock skew for a cookie "issued in the future". */
const SKEW_MS = 60_000;

const digest = (s: string) => createHash('sha256').update(s, 'utf8').digest();

/** Constant-time compare on equal-length SHA-256 digests (length of the input never leaks). */
export function passwordMatches(given: unknown, expected: string): boolean {
  if (typeof given !== 'string') return false;
  return timingSafeEqual(digest(given), digest(expected));
}

export type Session = { role: 'operator' } | { role: 'visitor'; userId: string };

declare module 'fastify' {
  interface FastifyRequest {
    session: Session | null;
  }
}

export const SIGNUP_COOKIE = 'mp_signup';
const V1_RE = /^v1:(\d{1,15})$/;
const V2_OP_RE = /^v2:op:(\d{1,15})$/;
const V2_VIS_RE = /^v2:vis:([0-9a-fA-F-]{36}):(\d{1,15})$/;

/** Cookie payload for a session (`v2:op:<ts>` / `v2:vis:<uuid>:<ts>`). */
export function sessionValue(session: Session, now = Date.now()): string {
  return session.role === 'operator' ? `v2:op:${now}` : `v2:vis:${session.userId}:${now}`;
}

/** Role of the request's validly signed, unexpired `mp_session` cookie, or null. Legacy `v1:<ts>` is an operator. */
export function readSession(req: FastifyRequest, now = Date.now()): Session | null {
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) return null;
  const res = req.unsignCookie(raw);
  if (!res.valid || !res.value) return null;
  let session: Session;
  let issuedAt: number;
  let m: RegExpExecArray | null;
  if ((m = V1_RE.exec(res.value))) {
    session = { role: 'operator' };
    issuedAt = Number(m[1]);
  } else if ((m = V2_OP_RE.exec(res.value))) {
    session = { role: 'operator' };
    issuedAt = Number(m[1]);
  } else if ((m = V2_VIS_RE.exec(res.value)) && isUuid(m[1])) {
    session = { role: 'visitor', userId: m[1] };
    issuedAt = Number(m[2]);
  } else {
    return null;
  }
  return issuedAt <= now + SKEW_MS && now - issuedAt < SESSION_TTL_SECONDS * 1000 ? session : null;
}

/** True when the request carries a valid session of any role. */
export const hasSession = (req: FastifyRequest, now = Date.now()): boolean => readSession(req, now) !== null;

/** Issues the signed session cookie (same options as the original login cookie). */
export function setSessionCookie(reply: FastifyReply, session: Session, secure: boolean): void {
  reply.setCookie(SESSION_COOKIE, sessionValue(session), {
    signed: true,
    httpOnly: true,
    secure,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL_SECONDS,
  });
}

/** Replies 403 to non-operators. Returns true when the route must stop (reply already sent). */
export function requireOperator(req: FastifyRequest, reply: FastifyReply): boolean {
  if (req.session?.role === 'operator') return false;
  void reply.code(403).send({ error: 'forbidden' });
  return true;
}

export interface AuthRoutesOptions {
  password: string;
  secureCookie: boolean;
}

/** /login, /logout, /session (mounted under /api). Login is rate limited to 10/min per IP. */
export const authRoutes: FastifyPluginAsync<AuthRoutesOptions> = async (app, opts) => {
  app.post<{ Body: { password: string } }>(
    '/login',
    {
      config: { rateLimit: { max: 10, timeWindow: '1 minute' } },
      schema: {
        body: {
          type: 'object',
          required: ['password'],
          properties: { password: { type: 'string', maxLength: 1024 } },
        },
      },
    },
    async (req, reply) => {
      if (!passwordMatches(req.body.password, opts.password)) {
        req.log.warn('login failed');
        return reply.code(401).send({ error: 'invalid_password' });
      }
      setSessionCookie(reply, { role: 'operator' }, opts.secureCookie);
      return reply.code(204).send();
    },
  );

  app.post('/logout', async (_req, reply) => {
    for (const name of [SESSION_COOKIE, SIGNUP_COOKIE]) {
      reply.clearCookie(name, { path: '/', httpOnly: true, secure: opts.secureCookie, sameSite: 'lax' });
    }
    return reply.code(204).send();
  });

  app.get('/session', async (req) => {
    const session = readSession(req);
    return { authenticated: session !== null, role: session?.role ?? null };
  });
};

/** Routes under /api that do not require a session. */
export const PUBLIC_API_ROUTES: ReadonlySet<string> = new Set([
  '/api/login',
  '/api/session',
  '/api/auth/phantom/challenge',
  '/api/auth/phantom/verify',
  '/api/auth/signup',
  '/api/public/status',
]);
