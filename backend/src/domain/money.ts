import { keccak256, toBytes } from 'viem';
import type { ProviderName } from './payment.js';

const BRL_RE = /^(0|[1-9]\d{0,14})(\.\d{1,6})?$/;

/** Parses a decimal BRL string into integer cents. Extra decimals are truncated, never rounded. */
export function parseBrlToCents(amount: string): { cents: bigint; truncated: boolean } | null {
  if (!BRL_RE.test(amount)) return null;
  const [int, frac = ''] = amount.split('.');
  const cents = BigInt(int) * 100n + BigInt(frac.slice(0, 2).padEnd(2, '0'));
  const truncated = /[1-9]/.test(frac.slice(2));
  return { cents, truncated };
}

/** 1 cent = 0.01 token = 10^16 wei (18 decimals). */
export function centsToWei(cents: bigint): bigint {
  return cents * 10n ** 16n;
}

export function formatCentsBRL(cents: bigint): string {
  const reais = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const rest = (cents % 100n).toString().padStart(2, '0');
  return `R$ ${reais},${rest}`;
}

export function paymentRefFor(provider: ProviderName, providerPaymentId: string): `0x${string}` {
  return keccak256(toBytes(`${provider}:${providerPaymentId}`));
}
