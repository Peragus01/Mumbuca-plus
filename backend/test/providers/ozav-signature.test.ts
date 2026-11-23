import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { verifyOzavWebhook } from '../../src/providers/ozav/ozav-signature.js';

const SECRET = 'ozav_whsec_test';
const NOW = new Date('2026-11-23T12:00:00Z');
const nowSec = Math.floor(NOW.getTime() / 1000);

function sign(raw: Buffer, t: number, secret = SECRET): string {
  const v1 = createHmac('sha256', secret).update(`${t}.`).update(raw).digest('hex');
  return `t=${t},v1=${v1}`;
}

function deliver(event: object, opts: { t?: number; eventIdHeader?: string } = {}) {
  const raw = Buffer.from(JSON.stringify(event));
  const id = (event as { id: string }).id;
  return {
    raw,
    headers: {
      'x-ozav-signature': sign(raw, opts.t ?? nowSec),
      'x-ozav-event-id': opts.eventIdHeader ?? id,
    },
  };
}

const transferEvent = (metadata?: Record<string, string>) => ({
  id: 'ozav_evt_1',
  object: 'event',
  type: 'transfer.updated',
  created_at: '2026-11-23T12:00:00Z',
  livemode: false,
  data: { id: 'ozav_tr_9', object: 'transfer', status: 'payment_confirmed', ...(metadata ? { metadata } : {}) },
});

describe('verifyOzavWebhook', () => {
  it('valid signature accepted', () => {
    const { raw, headers } = deliver(transferEvent({ mumbuca_payment_id: 'pay-1' }));
    expect(verifyOzavWebhook(raw, headers, SECRET, NOW)).toEqual({
      ok: true,
      providerEventId: 'ozav_evt_1',
      providerPaymentId: 'ozav_tr_9',
      metadataPaymentId: 'pay-1',
    });
  });

  it('tampered body -> bad_signature', () => {
    const { raw, headers } = deliver(transferEvent({ mumbuca_payment_id: 'pay-1' }));
    const tampered = Buffer.from(raw.toString().replace('pay-1', 'pay-2'));
    expect(verifyOzavWebhook(tampered, headers, SECRET, NOW)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('wrong secret or missing secret -> bad_signature', () => {
    const { raw, headers } = deliver(transferEvent());
    expect(verifyOzavWebhook(raw, headers, 'ozav_whsec_other', NOW)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyOzavWebhook(raw, headers, undefined, NOW)).toEqual({ ok: false, reason: 'bad_signature' });
    expect(verifyOzavWebhook(raw, {}, SECRET, NOW)).toEqual({ ok: false, reason: 'bad_signature' });
  });

  it('t older than 300 s -> stale', () => {
    const { raw, headers } = deliver(transferEvent(), { t: nowSec - 301 });
    expect(verifyOzavWebhook(raw, headers, SECRET, NOW)).toEqual({ ok: false, reason: 'stale' });
    const ok = deliver(transferEvent(), { t: nowSec - 299 });
    expect(verifyOzavWebhook(ok.raw, ok.headers, SECRET, NOW).ok).toBe(true);
  });

  it('event id header mismatch -> malformed', () => {
    const { raw, headers } = deliver(transferEvent(), { eventIdHeader: 'ozav_evt_other' });
    expect(verifyOzavWebhook(raw, headers, SECRET, NOW)).toEqual({ ok: false, reason: 'malformed' });
  });

  it('customer.updated -> ignored', () => {
    const { raw, headers } = deliver({ ...transferEvent(), id: 'ozav_evt_2', type: 'customer.updated' });
    expect(verifyOzavWebhook(raw, headers, SECRET, NOW)).toEqual({
      ok: true,
      ignored: true,
      providerEventId: 'ozav_evt_2',
    });
  });

  it('transfer.updated without metadata -> ok with metadataPaymentId null', () => {
    const { raw, headers } = deliver(transferEvent());
    expect(verifyOzavWebhook(raw, headers, SECRET, NOW)).toEqual({
      ok: true,
      providerEventId: 'ozav_evt_1',
      providerPaymentId: 'ozav_tr_9',
      metadataPaymentId: null,
    });
  });
});
