import type { FastifyPluginAsync } from 'fastify';
import type { PaymentProcessor } from '../../processing/payment-processor.js';
import type { ProviderRegistry, WebhookResult } from '../../providers/payment-provider.js';
import type { PaymentRepository } from '../../repositories/payment-repository.js';
import { errorClass, isUuid } from '../errors.js';

export interface WebhookRoutesOptions {
  payments: PaymentRepository;
  processor: PaymentProcessor;
  providers: ProviderRegistry;
  now?: () => Date;
}

const BODY_LIMIT = 256 * 1024;

function flatHeaders(h: Record<string, string | string[] | undefined>): Record<string, string | undefined> {
  const out: Record<string, string | undefined> = {};
  // A repeated header is ambiguous: drop it so verification fails closed.
  for (const [k, v] of Object.entries(h)) out[k] = typeof v === 'string' ? v : undefined;
  return out;
}

/**
 * POST /webhooks/payments (no session). Raw body is kept as a Buffer for the HMAC check.
 * Only OZAV signs webhooks today: the provider is chosen by the `x-ozav-signature` header.
 * The mint is never awaited: the processor runs in the background and the response is immediate.
 */
export const webhookRoutes: FastifyPluginAsync<WebhookRoutesOptions> = async (app, opts) => {
  const { payments, processor, providers } = opts;
  const now = opts.now ?? (() => new Date());

  app.removeContentTypeParser('application/json');
  app.addContentTypeParser('application/json', { parseAs: 'buffer', bodyLimit: BODY_LIMIT }, (_req, body, done) =>
    done(null, body),
  );

  app.post('/webhooks/payments', async (req, reply) => {
    const raw = req.body;
    const headers = flatHeaders(req.headers);
    if (!Buffer.isBuffer(raw) || !headers['x-ozav-signature']) {
      return reply.code(401).send({ error: 'unauthorized' });
    }
    const provider = providers.ozav;
    if (!provider?.verifyWebhook) {
      req.log.warn('webhook received but OZAV webhook verification is not configured');
      return reply.code(401).send({ error: 'unauthorized' });
    }

    let result: WebhookResult;
    try {
      result = provider.verifyWebhook(raw, headers, now());
    } catch (e) {
      req.log.warn({ error: errorClass(e) }, 'webhook verification threw');
      return reply.code(401).send({ error: 'unauthorized' });
    }
    if (!result.ok) {
      req.log.warn({ reason: result.reason }, 'webhook rejected');
      return reply.code(401).send({ error: 'unauthorized' });
    }
    if ('ignored' in result) return { ignored: true };

    const mid = result.metadataPaymentId;
    const payment = isUuid(mid) ? await payments.findById(mid) : null;
    if (!payment || payment.provider !== 'ozav' || payment.providerPaymentId !== result.providerPaymentId) {
      req.log.info({ hasMetadata: mid !== null, found: payment !== null }, 'webhook ignored: no matching payment');
      return { ignored: true };
    }

    const fresh = await payments.recordProviderEvent({
      paymentId: payment.id,
      providerEventId: `ozav:${result.providerEventId}`,
      detail: { provider: 'ozav', providerPaymentId: result.providerPaymentId },
    });
    if (!fresh) return { duplicate: true };

    app.runInBackground('webhook', payment.id, () => processor.signal(payment.id, 'webhook'));
    return { received: true };
  });
};
