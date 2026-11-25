import type { FastifyPluginAsync, FastifyRequest } from 'fastify';
import type { Env } from '../../config/env.js';
import type { Payment, ProviderName } from '../../domain/payment.js';
import {
  ProviderNotEnabledError,
  RechargeLimitError,
  UnknownUserError,
  type PaymentProcessor,
} from '../../processing/payment-processor.js';
import { ProviderUnavailableError, type ProviderRegistry } from '../../providers/payment-provider.js';
import type { VisitorPolicy } from '../../processing/visitor-policy.js';
import type { PaymentRepository } from '../../repositories/payment-repository.js';
import { requireOperator } from '../auth.js';
import { errorClass, isUuid } from '../errors.js';

export interface PaymentRoutesOptions {
  env: Env;
  payments: PaymentRepository;
  processor: PaymentProcessor;
  providers: ProviderRegistry;
  policy: VisitorPolicy;
}

export type PaymentOrigin = 'OZAV live' | 'OZAV sandbox' | 'SIMULADO';

export function explorerUrl(signature: string, cluster: Env['SOLANA_CLUSTER']): string {
  return `https://explorer.solana.com/tx/${signature}?cluster=${cluster === 'localnet' ? 'custom' : cluster}`;
}

function originOf(p: Payment): PaymentOrigin {
  if (p.provider === 'ozav') return p.providerEnv === 'live' ? 'OZAV live' : 'OZAV sandbox';
  return 'SIMULADO';
}

const str = (v: bigint | null) => (v === null ? null : v.toString());

export function toPaymentDto(p: Payment, cluster: Env['SOLANA_CLUSTER']) {
  return {
    id: p.id,
    userId: p.userId,
    provider: p.provider,
    providerEnv: p.providerEnv,
    origin: originOf(p),
    status: p.status,
    requestedAmountCents: p.requestedAmountCents.toString(),
    receivedAmountCents: str(p.receivedAmountCents),
    mintAmountUnits: p.mintAmountUnits,
    pixBrCode: p.pixBrCode,
    pixExpiresAt: p.pixExpiresAt ? p.pixExpiresAt.toISOString() : null,
    txSignature: p.txSignature,
    explorerUrl: p.txSignature ? explorerUrl(p.txSignature, cluster) : null,
    slot: str(p.slot),
    needsReview: p.needsReview,
    amountMismatch: p.amountMismatch,
    failureReason: p.failureReason,
    lastError: p.lastError,
    createdAt: p.createdAt.toISOString(),
    updatedAt: p.updatedAt.toISOString(),
  };
}

export type PaymentDTO = ReturnType<typeof toPaymentDto>;

export const paymentRoutes: FastifyPluginAsync<PaymentRoutesOptions> = async (app, opts) => {
  const { env, payments, processor, providers, policy } = opts;
  const dto = (p: Payment) => toPaymentDto(p, env.SOLANA_CLUSTER);
  const find = (id: string) => (isUuid(id) ? payments.findById(id) : Promise.resolve(null));
  /** Own payment for a visitor (someone else's is "not found"); any payment for the operator. */
  const findScoped = async (req: FastifyRequest, id: string) => {
    const p = await find(id);
    if (!p) return null;
    const s = req.session;
    if (s?.role === 'visitor' && p.userId.toLowerCase() !== s.userId.toLowerCase()) return null;
    return p;
  };

  app.post<{ Body: { userId: string; amountCents: string; provider: ProviderName } }>(
    '/payments',
    {
      schema: {
        body: {
          type: 'object',
          required: ['userId', 'amountCents', 'provider'],
          properties: {
            userId: { type: 'string', maxLength: 64 },
            amountCents: { type: 'string', pattern: '^[0-9]{1,15}$' },
            provider: { type: 'string', enum: ['ozav', 'simulated', 'mercadopago'] },
          },
        },
      },
      // 5/min per IP for visitors; operators are exempt (req.session is set by the /api onRequest hook).
      config: {
        rateLimit: {
          max: 5,
          timeWindow: '1 minute',
          allowList: (req: FastifyRequest) => req.session?.role === 'operator',
        },
      },
    },
    async (req, reply) => {
      const { amountCents, provider } = req.body;
      const visitor = req.session?.role === 'visitor' ? req.session : null;
      if (visitor && provider !== 'simulated') return reply.code(422).send({ error: 'provider_not_enabled' });
      const userId = visitor ? visitor.userId : req.body.userId;
      if (!isUuid(userId)) return reply.code(404).send({ error: 'user_not_found' });
      if (visitor) {
        const r = await policy.checkCreate(userId, BigInt(amountCents));
        if (!r.ok) {
          if (r.error === 'amount_out_of_range') {
            return reply
              .code(422)
              .send({ error: r.error, minCents: r.minCents?.toString(), maxCents: r.maxCents?.toString() });
          }
          return reply.code(r.error === 'daily_limit' ? 429 : 409).send({ error: r.error });
        }
      }
      try {
        const p = await processor.createRecharge({
          userId,
          amountCents: BigInt(amountCents),
          provider,
          ...(visitor ? { createdVia: 'visitor' as const } : {}),
        });
        return reply.code(201).send(dto(p));
      } catch (e) {
        if (e instanceof RechargeLimitError) {
          return reply
            .code(422)
            .send({ error: 'amount_out_of_range', minCents: e.minCents.toString(), maxCents: e.maxCents.toString() });
        }
        if (e instanceof ProviderNotEnabledError) return reply.code(422).send({ error: 'provider_not_enabled' });
        if (e instanceof UnknownUserError) return reply.code(404).send({ error: 'user_not_found' });
        if (e instanceof ProviderUnavailableError) {
          req.log.warn({ userId, provider, error: errorClass(e) }, 'charge creation failed');
          return reply.code(502).send({ error: 'provider_unavailable' });
        }
        throw e;
      }
    },
  );

  app.get<{ Querystring: { userId?: string } }>(
    '/payments',
    { schema: { querystring: { type: 'object', properties: { userId: { type: 'string', maxLength: 64 } } } } },
    async (req) => {
      if (req.session?.role === 'visitor') return (await payments.listByUser(req.session.userId)).map(dto);
      const { userId } = req.query;
      if (userId === undefined) return (await payments.listAll()).map(dto);
      if (!isUuid(userId)) return [];
      return (await payments.listByUser(userId)).map(dto);
    },
  );

  app.get<{ Params: { id: string } }>('/payments/:id', async (req, reply) => {
    const p = await findScoped(req, req.params.id);
    if (!p) return reply.code(404).send({ error: 'payment_not_found' });
    return dto(p);
  });

  /**
   * Marks the charge as paid at the provider (awaited), then kicks off processing in the
   * background (signal can take up to MINT_CONFIRM_TIMEOUT_MS) and returns the current DTO.
   */
  app.post<{ Params: { id: string } }>('/payments/:id/simulate', async (req, reply) => {
    const p = await findScoped(req, req.params.id);
    if (!p) return reply.code(404).send({ error: 'payment_not_found' });
    if (req.session?.role === 'visitor' && !(await policy.checkPay()).ok) {
      return reply.code(409).send({ error: 'purchases_closed' });
    }
    const provider = providers[p.provider];
    if (!provider?.simulatePayment || provider.env === 'live') {
      return reply.code(409).send({ error: 'simulation_not_supported' });
    }
    if (p.status !== 'AWAITING_PAYMENT' || !p.providerPaymentId) {
      return reply.code(409).send({ error: 'not_awaiting_payment' });
    }
    try {
      await provider.simulatePayment(p.providerPaymentId);
    } catch (e) {
      req.log.warn({ paymentId: p.id, error: errorClass(e) }, 'simulate failed');
      return reply.code(502).send({ error: 'provider_unavailable' });
    }
    app.runInBackground('simulate', p.id, () => processor.signal(p.id, 'operator'));
    return dto((await payments.findById(p.id)) ?? p);
  });

  /** Operator retry: processing runs in the background; responds with the current DTO. */
  app.post<{ Params: { id: string } }>('/payments/:id/reprocess', async (req, reply) => {
    if (requireOperator(req, reply)) return reply;
    const p = await find(req.params.id);
    if (!p) return reply.code(404).send({ error: 'payment_not_found' });
    app.runInBackground('reprocess', p.id, () => processor.reprocess(p.id));
    return dto(p);
  });
};
