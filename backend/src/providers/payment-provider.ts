import type { ProviderEnv, ProviderName } from '../domain/payment.js';

export type ProviderPaymentState =
  | { kind: 'pending' }
  | { kind: 'approved'; receivedAmountCents: bigint; truncated: boolean; metadataPaymentId: string | null }
  | { kind: 'rejected'; reason: string } // failed / cancelled
  | { kind: 'expired' }
  | { kind: 'review'; reason: string }; // needs_review or unexpected format

export type WebhookResult =
  | { ok: true; providerEventId: string; providerPaymentId: string; metadataPaymentId: string | null }
  | { ok: true; ignored: true; providerEventId: string } // event without a transfer (e.g. customer.updated)
  | { ok: false; reason: 'bad_signature' | 'stale' | 'malformed' };

export interface PaymentProvider {
  readonly name: ProviderName;
  readonly env: ProviderEnv;
  createCharge(input: {
    paymentId: string;
    amountCents: bigint;
  }): Promise<{ providerPaymentId: string; pixBrCode: string | null; expiresAt: Date | null }>;
  fetchPayment(providerPaymentId: string): Promise<ProviderPaymentState>;
  verifyWebhook?(rawBody: Buffer, headers: Record<string, string | undefined>, now: Date): WebhookResult;
  simulatePayment?(providerPaymentId: string): Promise<void>;
  /** Recovery after an uncertain POST: finds a charge by our payment id. */
  findChargeByPaymentId?(paymentId: string): Promise<string | null>;
}

/** 5xx, timeout, network failure: transient, the caller may retry/recover. Never carries secrets. */
export class ProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ProviderUnavailableError';
  }
}

export type ProviderRegistry = Record<ProviderName, PaymentProvider | undefined>;
