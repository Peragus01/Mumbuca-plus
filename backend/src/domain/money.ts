import { keccak_256 } from '@noble/hashes/sha3';
import { bytesToHex, utf8ToBytes } from '@noble/hashes/utils';
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

/** Token-2022 mint has 2 decimals, so 1 cent = 1 base unit. */
export function centsToUnits(cents: bigint): bigint {
  return cents;
}

/** Formats base units (2 decimals) as pt-BR, e.g. 1100n -> "11,00 Mum+". */
export function formatUnitsMum(units: bigint): string {
  const whole = (units / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  return `${whole},${(units % 100n).toString().padStart(2, '0')} Mum+`;
}

export function formatCentsBRL(cents: bigint): string {
  const reais = (cents / 100n).toString().replace(/\B(?=(\d{3})+(?!\d))/g, '.');
  const rest = (cents % 100n).toString().padStart(2, '0');
  return `R$ ${reais},${rest}`;
}

export function paymentRefFor(provider: ProviderName, providerPaymentId: string): `0x${string}` {
  return `0x${bytesToHex(keccak_256(utf8ToBytes(`${provider}:${providerPaymentId}`)))}`;
}
