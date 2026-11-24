import { beforeAll, describe, expect, it } from 'vitest';
import { AUDIT_BODY_MAX_BYTES, auditBody } from '../../src/http/routes/webhooks.js';
import { setupApp, signedWebhook, transferEvent, WARMUP_TIMEOUT_MS, warmup } from '../helpers/http-app.js';

async function withPaidCharge() {
  const t = await setupApp();
  const user = await t.newUser();
  const p = await t.processor.createRecharge({ userId: user.id, amountCents: 2500n, provider: 'ozav' });
  t.ozav.states.set(p.providerPaymentId!, {
    kind: 'approved',
    receivedAmountCents: 2500n,
    truncated: false,
    metadataPaymentId: p.id,
  });
  const snapshot = async () => (await t.db.query('select * from payments order by id')).rows;
  const eventCount = async () => (await t.db.query('select count(*)::int as n from payment_events')).rows[0].n as number;
  const post = (w: { payload: Buffer; headers: Record<string, string> }) =>
    t.app.inject({ method: 'POST', url: '/webhooks/payments', payload: w.payload, headers: w.headers });
  return { ...t, user, p, snapshot, eventCount, post };
}

describe('POST /webhooks/payments', () => {
  beforeAll(warmup, WARMUP_TIMEOUT_MS);

  it('valid OZAV webhook for known payment → 200 and payment reaches RECEIVED or beyond', async () => {
    const t = await withPaidCharge();
    const res = await t.post(signedWebhook(transferEvent('evt_1', t.p.providerPaymentId!, { mumbuca_payment_id: t.p.id })));
    expect(res.statusCode).toBe(200);
    await t.app.idle();
    const r = (await t.payments.findById(t.p.id))!;
    expect(r.status).toBe('MINTED');
    expect(t.chain.sendMintCalls).toBe(1);
  });

  it('responds before the mint finishes (does not await processing)', async () => {
    const t = await withPaidCharge();
    t.chain.delayMs = 1500;
    const started = Date.now();
    const res = await t.post(signedWebhook(transferEvent('evt_1', t.p.providerPaymentId!, { mumbuca_payment_id: t.p.id })));
    expect(res.statusCode).toBe(200);
    expect(Date.now() - started).toBeLessThan(1200);
    await t.app.idle();
    expect((await t.payments.findById(t.p.id))!.status).toBe('MINTED');
  });

  it('bad signature → 401 and nothing changes', async () => {
    const t = await withPaidCharge();
    const before = await t.snapshot();
    const events = await t.eventCount();
    const w = signedWebhook(transferEvent('evt_1', t.p.providerPaymentId!, { mumbuca_payment_id: t.p.id }), {
      secret: 'wrong-secret',
    });
    const res = await t.post(w);
    expect(res.statusCode).toBe(401);
    await t.app.idle();
    expect(await t.snapshot()).toEqual(before);
    expect(await t.eventCount()).toBe(events);
    expect(t.chain.sendMintCalls).toBe(0);
  });

  it('missing signature header → 401', async () => {
    const t = await withPaidCharge();
    const w = signedWebhook(transferEvent('evt_1', t.p.providerPaymentId!, { mumbuca_payment_id: t.p.id }));
    const { ['x-ozav-signature']: _drop, ...headers } = w.headers;
    const res = await t.post({ payload: w.payload, headers });
    expect(res.statusCode).toBe(401);
  });

  it('same event twice → second returns duplicate:true and sendMint called once', async () => {
    const t = await withPaidCharge();
    const ev = transferEvent('evt_dup', t.p.providerPaymentId!, { mumbuca_payment_id: t.p.id });
    const first = await t.post(signedWebhook(ev));
    expect(first.statusCode).toBe(200);
    const second = await t.post(signedWebhook(ev));
    expect(second.statusCode).toBe(200);
    expect(second.json()).toEqual({ duplicate: true });
    await t.app.idle();
    expect(t.chain.sendMintCalls).toBe(1);
  });

  it('transfer without mumbuca_payment_id → 200 ignored, payments table unchanged', async () => {
    const t = await withPaidCharge();
    const before = await t.snapshot();
    const events = await t.eventCount();
    const res = await t.post(signedWebhook(transferEvent('evt_nometa', t.p.providerPaymentId!)));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ignored: true });
    await t.app.idle();
    expect(await t.snapshot()).toEqual(before);
    expect(await t.eventCount()).toBe(events);
    expect(t.chain.sendMintCalls).toBe(0);
  });

  it('metadata for unknown payment id → 200 ignored', async () => {
    const t = await withPaidCharge();
    const before = await t.snapshot();
    for (const mid of ['00000000-0000-4000-8000-000000000000', 'not-a-uuid']) {
      const res = await t.post(signedWebhook(transferEvent(`evt_${mid}`, 'tr_other', { mumbuca_payment_id: mid })));
      expect(res.statusCode).toBe(200);
      expect(res.json()).toEqual({ ignored: true });
    }
    await t.app.idle();
    expect(await t.snapshot()).toEqual(before);
  });

  it('non-transfer event → 200 ignored', async () => {
    const t = await withPaidCharge();
    const res = await t.post(signedWebhook({ id: 'evt_cust', object: 'event', type: 'customer.updated', data: {} }));
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ ignored: true });
  });

  it('stores the verified raw body (no headers/signature) in payment_events.detail for audit', async () => {
    const t = await withPaidCharge();
    const w = signedWebhook(transferEvent('evt_audit_1', t.p.providerPaymentId!, { mumbuca_payment_id: t.p.id }));
    expect((await t.post(w)).statusCode).toBe(200);
    await t.app.idle();
    const { rows } = await t.db.query<{ detail: Record<string, unknown> }>(
      `select detail from payment_events where provider_event_id = 'ozav:evt_audit_1'`,
    );
    expect(rows).toHaveLength(1);
    const detail = JSON.stringify(rows[0]!.detail);
    expect(detail).toContain('evt_audit_1');
    expect(detail).not.toContain(w.headers['x-ozav-signature']);
    expect(detail).not.toContain('x-ozav-signature');
  });
});

describe('auditBody', () => {
  it('caps the stored body and strips NUL characters', () => {
    const small = auditBody(Buffer.from('{"id":"evt_1"}'));
    expect(small).toEqual({ rawBody: '{"id":"evt_1"}', rawBodyBytes: 14, truncated: false });
    const big = auditBody(Buffer.from('x'.repeat(100)), 10);
    expect(big).toEqual({ rawBody: 'x'.repeat(10), rawBodyBytes: 100, truncated: true });
    expect(auditBody(Buffer.from([0x61, 0x00, 0x62])).rawBody).toBe('ab');
    expect(AUDIT_BODY_MAX_BYTES).toBe(256 * 1024);
  });
});
