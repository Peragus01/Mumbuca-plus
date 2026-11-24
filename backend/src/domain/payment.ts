import type { Env } from '../config/env.js';

export type ProviderName = 'ozav' | 'simulated' | 'mercadopago';
export type ProviderEnv = 'sandbox' | 'live' | 'local';

export type PaymentStatus =
  | 'AWAITING_PAYMENT'
  | 'RECEIVED'
  | 'VALIDATING'
  | 'APPROVED'
  | 'MINT_PENDING'
  | 'MINTED'
  | 'FAILED';

/** Statuses from which a payment can still progress. */
export const OPEN_STATUSES: readonly PaymentStatus[] = [
  'AWAITING_PAYMENT',
  'RECEIVED',
  'VALIDATING',
  'APPROVED',
  'MINT_PENDING',
];

export interface Payment {
  id: string;
  userId: string;
  provider: ProviderName;
  providerEnv: ProviderEnv;
  providerPaymentId: string | null;
  requestedAmountCents: bigint;
  receivedAmountCents: bigint | null;
  status: PaymentStatus;
  pixBrCode: string | null;
  pixExpiresAt: Date | null;
  paymentRef: string | null;
  mintAmountUnits: string | null;
  txSignature: string | null;
  slot: bigint | null;
  lastValidBlockHeight: bigint | null;
  needsReview: boolean;
  amountMismatch: boolean;
  failureReason: string | null;
  lastError: string | null;
  attempts: number;
  /** Definitive program rejections (counted apart from transient attempts); FAILED at MAX_MINT_ATTEMPTS. */
  mintRejections: number;
  createdAt: Date;
  updatedAt: Date;
}

export function rechargeLimits(provider: ProviderName, env: Env): { minCents: bigint; maxCents: bigint } {
  if (provider === 'simulated') return { minCents: 1100n, maxCents: 2000000n };
  return { minCents: env.MIN_RECHARGE_CENTS, maxCents: env.MAX_RECHARGE_CENTS };
}
