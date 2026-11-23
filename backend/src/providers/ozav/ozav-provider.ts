import { parseBrlToCents } from '../../domain/money.js';
import type { PaymentProvider, ProviderPaymentState } from '../payment-provider.js';
import { ProviderUnavailableError } from '../payment-provider.js';
import { createOzavClient, type FetchLike } from './ozav-client.js';
import { verifyOzavWebhook } from './ozav-signature.js';

export interface OzavProviderOptions {
  baseUrl: string;
  apiKey: string;
  customerId: string;
  walletId: string;
  targetCurrency: string;
  targetChain: string;
  env: 'sandbox' | 'live';
  webhookSecret?: string;
  fetchImpl?: FetchLike;
}

/** Same reading as Peragus brs-progression.ts: these statuses mean the Pix was paid. */
const PAID_STATUSES = new Set(['payment_confirmed', 'converting', 'payout_initiated', 'completed']);
const MAX_LIST_PAGES = 20;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

function formatReais(cents: bigint): string {
  return `${cents / 100n}.${(cents % 100n).toString().padStart(2, '0')}`;
}

function unavailable(what: string, status: number): ProviderUnavailableError {
  return new ProviderUnavailableError(`OZAV ${what} returned HTTP ${status}`);
}

export function createOzavProvider(opts: OzavProviderOptions): PaymentProvider {
  const expectedPrefix = opts.env === 'live' ? 'ozav_sk_live_' : 'ozav_sk_test_';
  if (!opts.apiKey.startsWith(expectedPrefix)) {
    throw new Error(`OZAV API key must start with "${expectedPrefix}" when env is ${opts.env}`);
  }
  const client = createOzavClient({ baseUrl: opts.baseUrl, apiKey: opts.apiKey, fetchImpl: opts.fetchImpl });
  const target = { currency: opts.targetCurrency, chain: opts.targetChain };

  return {
    name: 'ozav',
    env: opts.env,

    async createCharge({ paymentId, amountCents }) {
      const quote = await client.post(
        '/quotes',
        {
          customer_id: opts.customerId,
          source: { currency: 'BRL', amount: formatReais(amountCents) },
          target,
          source_rail: 'pix',
          spread_bps: 0,
        },
        `${paymentId}:quote`,
      );
      const quoteId = isObj(quote.body) ? quote.body.id : undefined;
      if (quote.status < 200 || quote.status >= 300 || typeof quoteId !== 'string') {
        throw unavailable('quote', quote.status);
      }

      const res = await client.post(
        '/transfers',
        {
          customer_id: opts.customerId,
          quote_id: quoteId,
          source: { type: 'fiat_payment', currency: 'BRL', rail: 'pix' },
          destination: { type: 'wallet', wallet_id: opts.walletId, chain: opts.targetChain },
          metadata: { mumbuca_payment_id: paymentId },
        },
        paymentId,
      );
      // Only 201 is success; anything else is ambiguous and is recovered by metadata (findChargeByPaymentId).
      if (res.status !== 201 || !isObj(res.body) || typeof res.body.id !== 'string') {
        throw unavailable('transfer', res.status);
      }
      const source = isObj(res.body.source) ? res.body.source : {};
      const instr = isObj(source.payment_instructions) ? source.payment_instructions : {};
      const brCode = typeof instr.br_code === 'string' ? instr.br_code : null;
      const exp = instr.expires_at ?? res.body.expires_at;
      const expiresAt = typeof exp === 'string' && !Number.isNaN(Date.parse(exp)) ? new Date(exp) : null;
      return { providerPaymentId: res.body.id, pixBrCode: brCode, expiresAt };
    },

    async fetchPayment(providerPaymentId): Promise<ProviderPaymentState> {
      const res = await client.get(`/transfers/${encodeURIComponent(providerPaymentId)}`);
      if (res.status !== 200) throw unavailable('transfer lookup', res.status);
      const t = res.body;
      if (!isObj(t) || typeof t.status !== 'string') return { kind: 'review', reason: 'unexpected transfer format' };
      const status = t.status;
      const sourceLeg = isObj(t.source_leg) ? t.source_leg.status : undefined;

      if (sourceLeg === 'completed' || PAID_STATUSES.has(status)) {
        const amounts = isObj(t.amounts) ? t.amounts : {};
        const src = isObj(amounts.source) ? amounts.source : {};
        if (src.currency !== 'BRL' || typeof src.amount !== 'string') {
          return { kind: 'review', reason: 'paid transfer with unexpected source amount/currency' };
        }
        const parsed = parseBrlToCents(src.amount);
        if (!parsed) return { kind: 'review', reason: 'paid transfer with unparseable source amount' };
        const metadata = isObj(t.metadata) ? t.metadata : {};
        const mid = metadata.mumbuca_payment_id;
        return {
          kind: 'approved',
          receivedAmountCents: parsed.cents,
          truncated: parsed.truncated,
          metadataPaymentId: typeof mid === 'string' && mid !== '' ? mid : null,
        };
      }
      switch (status) {
        case 'awaiting_payment':
          return { kind: 'pending' };
        case 'failed':
        case 'cancelled':
          return { kind: 'rejected', reason: `transfer ${status}` };
        case 'expired':
          return { kind: 'expired' };
        case 'needs_review':
          return { kind: 'review', reason: 'transfer needs_review' };
        default:
          return { kind: 'review', reason: `unknown transfer status "${status.slice(0, 40)}"` };
      }
    },

    verifyWebhook(rawBody, headers, now) {
      return verifyOzavWebhook(rawBody, headers, opts.webhookSecret, now);
    },

    async simulatePayment(providerPaymentId) {
      if (opts.env !== 'sandbox') throw new Error('simulatePayment is only available in the sandbox environment');
      const res = await client.post(`/transfers/${encodeURIComponent(providerPaymentId)}/simulate`, {});
      if (res.status !== 200 && res.status !== 202) throw unavailable('simulate', res.status);
    },

    async findChargeByPaymentId(paymentId) {
      const found = new Set<string>();
      let cursor: string | undefined;
      for (let page = 0; page < MAX_LIST_PAGES; page++) {
        const q = new URLSearchParams({ customer_id: opts.customerId, limit: '100' });
        if (cursor) q.set('starting_after', cursor);
        const res = await client.get(`/transfers?${q}`);
        if (res.status !== 200 || !isObj(res.body) || !Array.isArray(res.body.data)) {
          throw unavailable('transfer listing', res.status);
        }
        for (const item of res.body.data) {
          if (
            isObj(item) &&
            typeof item.id === 'string' &&
            isObj(item.metadata) &&
            item.metadata.mumbuca_payment_id === paymentId
          ) {
            found.add(item.id);
          }
        }
        if (res.body.has_more !== true) {
          if (found.size > 1) throw new Error('Ambiguous OZAV recovery: several transfers share the same payment id');
          return [...found][0] ?? null;
        }
        const next = res.body.next_cursor;
        if (typeof next !== 'string' || next === '' || next === cursor) throw unavailable('transfer listing', res.status);
        cursor = next;
      }
      throw new ProviderUnavailableError('OZAV transfer listing incomplete after 20 pages');
    },
  };
}
