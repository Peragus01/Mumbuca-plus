import { createHash, timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync, FastifyRequest } from 'fastify';

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

/** True when the request carries a validly signed, unexpired `mp_session` cookie. */
export function hasSession(req: FastifyRequest, now = Date.now()): boolean {
  const raw = req.cookies[SESSION_COOKIE];
  if (!raw) return false;
  const res = req.unsignCookie(raw);
  if (!res.valid || !res.value) return false;
  const m = /^v1:(\d{1,15})$/.exec(res.value);
  if (!m) return false;
  const issuedAt = Number(m[1]);
  return issuedAt <= now + SKEW_MS && now - issuedAt < SESSION_TTL_SECONDS * 1000;
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
      reply.setCookie(SESSION_COOKIE, `v1:${Date.now()}`, {
        signed: true,
        httpOnly: true,
        secure: opts.secureCookie,
        sameSite: 'lax',
        path: '/',
        maxAge: SESSION_TTL_SECONDS,
      });
      return reply.code(204).send();
    },
  );

  app.post('/logout', async (_req, reply) => {
    reply.clearCookie(SESSION_COOKIE, { path: '/', httpOnly: true, secure: opts.secureCookie, sameSite: 'lax' });
    return reply.code(204).send();
  });

  app.get('/session', async (req) => ({ authenticated: hasSession(req) }));
};

/** Routes under /api that do not require a session. */
export const PUBLIC_API_ROUTES: ReadonlySet<string> = new Set(['/api/login', '/api/session']);
