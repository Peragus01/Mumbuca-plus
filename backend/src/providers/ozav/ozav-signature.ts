import { createHmac, timingSafeEqual } from 'node:crypto';
import type { WebhookResult } from '../payment-provider.js';

const WINDOW_SECONDS = 300;
const TRANSFER_EVENTS = new Set(['transfer.updated', 'transfer.completed', 'transfer.failed']);

type SignatureCheck = 'ok' | 'bad_signature' | 'stale';

/**
 * Adapted from Peragus customer-event.ts. Header `t=<unix>,v1=<hex>[,v1=<hex>]`; HMAC-SHA256 keyed with the
 * complete endpoint secret over `${t}.` + raw bytes; constant-time compare; +-300 s delivery window.
 * The signature is checked before the window so a forged timestamp never reports "stale".
 */
export function checkOzavSignature(raw: Buffer, header: string | undefined, secret: string, now: Date): SignatureCheck {
  if (typeof header !== 'string' || header.length > 1024 || secret.length === 0) return 'bad_signature';
  const fields = header.split(',').map((f) => f.trim());
  const times = fields.filter((f) => f.startsWith('t='));
  const sigs = fields.filter((f) => f.startsWith('v1='));
  if (times.length !== 1 || sigs.length < 1 || sigs.length > 4 || fields.length !== times.length + sigs.length) {
    return 'bad_signature';
  }
  const timestamp = times[0]!.slice(2);
  if (!/^[0-9]{1,12}$/.test(timestamp)) return 'bad_signature';
  const expected = createHmac('sha256', secret).update(`${timestamp}.`).update(raw).digest();
  const matches = sigs.some((f) => {
    const v = f.slice(3);
    return /^[0-9a-f]{64}$/.test(v) && timingSafeEqual(expected, Buffer.from(v, 'hex'));
  });
  if (!matches) return 'bad_signature';
  if (Math.abs(now.getTime() / 1000 - Number(timestamp)) > WINDOW_SECONDS) return 'stale';
  return 'ok';
}

function header(headers: Record<string, string | undefined>, name: string): string | undefined {
  for (const [k, v] of Object.entries(headers)) if (k.toLowerCase() === name) return v;
  return undefined;
}

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

export function verifyOzavWebhook(
  rawBody: Buffer,
  headers: Record<string, string | undefined>,
  secret: string | undefined,
  now: Date,
): WebhookResult {
  if (!secret) return { ok: false, reason: 'bad_signature' };
  const check = checkOzavSignature(rawBody, header(headers, 'x-ozav-signature'), secret, now);
  if (check !== 'ok') return { ok: false, reason: check };

  let event: unknown;
  try {
    event = JSON.parse(rawBody.toString('utf8'));
  } catch {
    return { ok: false, reason: 'malformed' };
  }
  if (!isObj(event) || typeof event.id !== 'string' || event.id === '' || typeof event.type !== 'string') {
    return { ok: false, reason: 'malformed' };
  }
  if (header(headers, 'x-ozav-event-id') !== event.id) return { ok: false, reason: 'malformed' };
  if (!TRANSFER_EVENTS.has(event.type)) return { ok: true, ignored: true, providerEventId: event.id };

  // The transfer may be the `data` object itself or nested under `data.transfer`.
  const data = event.data;
  const transfer = isObj(data) ? (isObj(data.transfer) ? data.transfer : data) : null;
  if (!transfer || typeof transfer.id !== 'string' || transfer.id === '') return { ok: false, reason: 'malformed' };
  const metadata = isObj(transfer.metadata) ? transfer.metadata : null;
  const mid = metadata?.mumbuca_payment_id;
  return {
    ok: true,
    providerEventId: event.id,
    providerPaymentId: transfer.id,
    metadataPaymentId: typeof mid === 'string' && mid !== '' ? mid : null,
  };
}
