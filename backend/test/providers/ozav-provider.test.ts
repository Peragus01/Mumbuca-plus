import { describe, expect, it } from 'vitest';
import { ProviderUnavailableError } from '../../src/providers/payment-provider.js';
import { createOzavProvider } from '../../src/providers/ozav/ozav-provider.js';

type Call = { url: string; method: string; headers: Record<string, string>; body: any };
type Reply = { status: number; body?: unknown } | Error;

const KEY = 'ozav_sk_test_SECRETKEY123';

function fakeFetch(replies: Reply[]) {
  const calls: Call[] = [];
  const fetchImpl = async (url: string, init?: RequestInit) => {
    calls.push({
      url,
      method: init?.method ?? 'GET',
      headers: init?.headers as Record<string, string>,
      body: init?.body ? JSON.parse(init.body as string) : undefined,
    });
    const r = replies.shift();
    if (!r) throw new Error('no more replies');
    if (r instanceof Error) throw r;
    return new Response(r.body === undefined ? '' : JSON.stringify(r.body), { status: r.status });
  };
  return { calls, fetchImpl };
}

function make(replies: Reply[], over: Partial<Parameters<typeof createOzavProvider>[0]> = {}) {
  const f = fakeFetch(replies);
  const provider = createOzavProvider({
    baseUrl: 'https://ozav.test/v2',
    apiKey: KEY,
    customerId: 'ozav_cus_1',
    walletId: 'ozav_wal_1',
    targetCurrency: 'BRS',
    targetChain: 'solana',
    env: 'sandbox',
    fetchImpl: f.fetchImpl,
    ...over,
  });
  return { provider, calls: f.calls };
}

const transfer = (status: string, extra: Record<string, unknown> = {}) => ({
  status: 200,
  body: {
    id: 'ozav_tr_1',
    object: 'transfer',
    status,
    amounts: { source: { amount: '11.00', currency: 'BRL' }, target: { amount: '11.00', currency: 'BRS' } },
    metadata: { mumbuca_payment_id: 'pay-1' },
    ...extra,
  },
});

describe('ozav provider: createCharge', () => {
  it('posts quote then transfer with Idempotency-Key and metadata.mumbuca_payment_id', async () => {
    const { provider, calls } = make([
      { status: 201, body: { id: 'ozav_q_1', object: 'quote' } },
      {
        status: 201,
        body: {
          id: 'ozav_tr_1',
          source: { payment_instructions: { rail: 'pix', br_code: '000201BRCODE', expires_at: '2026-11-23T13:00:00Z' } },
        },
      },
    ]);
    const out = await provider.createCharge({ paymentId: 'pay-1', amountCents: 1100n });
    expect(out).toEqual({
      providerPaymentId: 'ozav_tr_1',
      pixBrCode: '000201BRCODE',
      expiresAt: new Date('2026-11-23T13:00:00Z'),
    });
    expect(calls).toHaveLength(2);
    expect(calls[0]!.url).toBe('https://ozav.test/v2/quotes');
    expect(calls[0]!.method).toBe('POST');
    expect(calls[0]!.headers['Idempotency-Key']).toBe('pay-1:quote');
    expect(calls[0]!.headers['X-API-Key']).toBe(KEY);
    expect(calls[0]!.body).toEqual({
      customer_id: 'ozav_cus_1',
      source: { currency: 'BRL', amount: '11.00' },
      target: { currency: 'BRS', chain: 'solana' },
      source_rail: 'pix',
      spread_bps: 0,
    });
    expect(calls[1]!.url).toBe('https://ozav.test/v2/transfers');
    expect(calls[1]!.headers['Idempotency-Key']).toBe('pay-1');
    expect(calls[1]!.body).toEqual({
      customer_id: 'ozav_cus_1',
      quote_id: 'ozav_q_1',
      source: { type: 'fiat_payment', currency: 'BRL', rail: 'pix' },
      destination: { type: 'wallet', wallet_id: 'ozav_wal_1', chain: 'solana' },
      metadata: { mumbuca_payment_id: 'pay-1' },
    });
  });

  it('formats amounts with two decimals', async () => {
    const { provider, calls } = make([{ status: 201, body: { id: 'ozav_q_1' } }, { status: 500 }]);
    await provider.createCharge({ paymentId: 'p', amountCents: 123405n }).catch(() => {});
    expect(calls[0]!.body.source.amount).toBe('1234.05');
  });

  it('non-201 transfer -> ProviderUnavailableError (without leaking the key)', async () => {
    const { provider } = make([
      { status: 201, body: { id: 'ozav_q_1' } },
      { status: 200, body: { id: 'ozav_tr_1', status: 'needs_review' } },
    ]);
    const err = await provider.createCharge({ paymentId: 'pay-1', amountCents: 1100n }).catch((e) => e);
    expect(err).toBeInstanceOf(ProviderUnavailableError);
    expect(String(err.message)).not.toContain(KEY);
  });

  it('quote failure -> ProviderUnavailableError', async () => {
    const { provider } = make([{ status: 400, body: { error: { code: 'AMOUNT_BELOW_MINIMUM' } } }]);
    await expect(provider.createCharge({ paymentId: 'p', amountCents: 100n })).rejects.toBeInstanceOf(
      ProviderUnavailableError,
    );
  });
});

describe('ozav provider: fetchPayment', () => {
  it('payment_confirmed with amounts.source {"11.00","BRL"} -> approved 1100n', async () => {
    const { provider, calls } = make([transfer('payment_confirmed')]);
    expect(await provider.fetchPayment('ozav_tr_1')).toEqual({
      kind: 'approved',
      receivedAmountCents: 1100n,
      truncated: false,
      metadataPaymentId: 'pay-1',
    });
    expect(calls[0]!.url).toBe('https://ozav.test/v2/transfers/ozav_tr_1');
  });

  it('completed with amount "11.005" -> approved 1100n truncated true', async () => {
    const { provider } = make([
      transfer('completed', {
        amounts: { source: { amount: '11.005', currency: 'BRL' }, target: { amount: '11', currency: 'BRS' } },
      }),
    ]);
    expect(await provider.fetchPayment('t')).toMatchObject({
      kind: 'approved',
      receivedAmountCents: 1100n,
      truncated: true,
    });
  });

  it('source leg completed counts as paid even while status is awaiting_payment', async () => {
    const { provider } = make([transfer('awaiting_payment', { source_leg: { status: 'completed' } })]);
    expect((await provider.fetchPayment('t')).kind).toBe('approved');
  });

  it('amount "abc" -> review; currency USD -> review', async () => {
    const bad = (amount: string, currency: string) =>
      transfer('completed', { amounts: { source: { amount, currency }, target: { amount: '1', currency: 'BRS' } } });
    const { provider } = make([bad('abc', 'BRL'), bad('11.00', 'USD'), transfer('completed', { amounts: {} })]);
    expect((await provider.fetchPayment('t')).kind).toBe('review');
    expect((await provider.fetchPayment('t')).kind).toBe('review');
    expect((await provider.fetchPayment('t')).kind).toBe('review');
  });

  it('maps awaiting_payment/expired/cancelled/failed/needs_review/unknown', async () => {
    const { provider } = make([
      transfer('awaiting_payment'),
      transfer('expired'),
      transfer('cancelled'),
      transfer('failed'),
      transfer('needs_review'),
      transfer('something_new'),
    ]);
    expect(await provider.fetchPayment('t')).toEqual({ kind: 'pending' });
    expect(await provider.fetchPayment('t')).toEqual({ kind: 'expired' });
    expect((await provider.fetchPayment('t')).kind).toBe('rejected');
    expect((await provider.fetchPayment('t')).kind).toBe('rejected');
    expect((await provider.fetchPayment('t')).kind).toBe('review');
    expect((await provider.fetchPayment('t')).kind).toBe('review');
  });

  it('HTTP 503 or network error -> ProviderUnavailableError', async () => {
    const { provider } = make([{ status: 503 }, new TypeError('fetch failed: ' + KEY)]);
    await expect(provider.fetchPayment('t')).rejects.toBeInstanceOf(ProviderUnavailableError);
    const err = await provider.fetchPayment('t').catch((e) => e);
    expect(err).toBeInstanceOf(ProviderUnavailableError);
    expect(String(err.message)).not.toContain(KEY);
  });
});

describe('ozav provider: findChargeByPaymentId', () => {
  it('pages through transfers and filters by metadata', async () => {
    const { provider, calls } = make([
      { status: 200, body: { data: [{ id: 'ozav_tr_a', metadata: { mumbuca_payment_id: 'x' } }], has_more: true, next_cursor: 'c1' } },
      { status: 200, body: { data: [{ id: 'ozav_tr_b', metadata: { mumbuca_payment_id: 'pay-1' } }], has_more: false } },
    ]);
    expect(await provider.findChargeByPaymentId!('pay-1')).toBe('ozav_tr_b');
    expect(calls[0]!.url).toContain('customer_id=ozav_cus_1');
    expect(calls[1]!.url).toContain('starting_after=c1');
  });

  it('returns null when absent', async () => {
    const { provider } = make([{ status: 200, body: { data: [], has_more: false } }]);
    expect(await provider.findChargeByPaymentId!('nope')).toBeNull();
  });
});

describe('ozav provider: simulate and factory', () => {
  it('simulatePayment posts to /simulate in sandbox', async () => {
    const { provider, calls } = make([{ status: 200, body: {} }]);
    await provider.simulatePayment!('ozav_tr_1');
    expect(calls[0]!.url).toBe('https://ozav.test/v2/transfers/ozav_tr_1/simulate');
  });

  it('simulatePayment throws when env is live', async () => {
    const { provider, calls } = make([], { env: 'live', apiKey: 'ozav_sk_live_abc' });
    await expect(provider.simulatePayment!('ozav_tr_1')).rejects.toThrow(/sandbox/);
    expect(calls).toHaveLength(0);
  });

  it('factory rejects live key in sandbox env (and test key in live)', () => {
    expect(() => make([], { env: 'sandbox', apiKey: 'ozav_sk_live_abc' })).toThrow(/ozav_sk_test_/);
    expect(() => make([], { env: 'live', apiKey: 'ozav_sk_test_abc' })).toThrow(/ozav_sk_live_/);
    try {
      make([], { env: 'sandbox', apiKey: 'ozav_sk_live_VERYSECRET' });
    } catch (e) {
      expect(String((e as Error).message)).not.toContain('VERYSECRET');
    }
  });

  it('verifyWebhook without secret rejects', () => {
    const { provider } = make([]);
    expect(provider.verifyWebhook!(Buffer.from('{}'), {}, new Date())).toEqual({ ok: false, reason: 'bad_signature' });
  });
});
