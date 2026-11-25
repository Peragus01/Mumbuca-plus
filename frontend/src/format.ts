import type { PaymentDTO, PaymentStatus } from './api';

/** "1234567" -> "1.234.567" (integer part only, BigInt-exact). */
function groupThousands(int: string): string {
  return int.replace(/\B(?=(\d{3})+(?!\d))/g, '.');
}

/** Base-10 integer string with 2 implied decimals -> "1.000,00" (exact, via BigInt). */
function fixed2(value: string): string {
  let n: bigint;
  try {
    n = BigInt(value);
  } catch {
    return '—';
  }
  const neg = n < 0n;
  if (neg) n = -n;
  const int = (n / 100n).toString();
  const frac = (n % 100n).toString().padStart(2, '0');
  return `${neg ? '-' : ''}${groupThousands(int)},${frac}`;
}

/** Cents (string) -> "R$ 11,00". */
export function formatBRL(cents: string): string {
  return `R$ ${fixed2(cents)}`;
}

/** Mum+ base units (2 decimals) -> "11,00 Mum+". */
export function formatMum(units: string): string {
  return `${fixed2(units)} Mum+`;
}

/** Base58 address -> "7xKX…9fQa". */
export function shortAddress(addr: string): string {
  return addr.length <= 10 ? addr : `${addr.slice(0, 4)}…${addr.slice(-4)}`;
}

const STATUS_LABELS: Record<PaymentStatus, string> = {
  AWAITING_PAYMENT: 'Aguardando Pix',
  RECEIVED: 'Pagamento confirmado',
  VALIDATING: 'Confirmando pagamento',
  APPROVED: 'Emitindo',
  MINT_PENDING: 'Emitindo',
  MINTED: 'Emitido',
  FAILED: 'Falhou',
};

export function statusLabel(status: PaymentStatus): string {
  return STATUS_LABELS[status] ?? status;
}

export const TERMINAL_STATUSES: ReadonlySet<PaymentStatus> = new Set(['MINTED', 'FAILED']);
export const isTerminal = (s: PaymentStatus) => TERMINAL_STATUSES.has(s);

/** A visitor charge stops counting (and can no longer be paid) after 30 min, as on the backend. */
export const OPEN_PAYMENT_WINDOW_MS = 30 * 60 * 1000;

/** True for an AWAITING_PAYMENT simulated charge created less than 30 min ago (still payable by a visitor). */
export function isResumable(p: PaymentDTO, now = Date.now()): boolean {
  return (
    p.status === 'AWAITING_PAYMENT' &&
    p.provider === 'simulated' &&
    now - new Date(p.createdAt).getTime() < OPEN_PAYMENT_WINDOW_MS
  );
}

/**
 * User-typed reais -> cents string, or null when invalid / not positive.
 * Accepts "50", "50,5", "1.000,25", "R$ 1.000,25" and "11.50" (dot as decimal when there is no comma).
 */
export function parseReaisToCents(input: string): string | null {
  const s = input.replace(/R\$/i, '').replace(/\s/g, '');
  let int: string;
  let frac = '';
  let m: RegExpExecArray | null;
  if ((m = /^(\d{1,3}(?:\.\d{3})+|\d+)(?:,(\d{1,2}))?$/.exec(s))) {
    int = m[1]!.replace(/\./g, '');
    frac = m[2] ?? '';
  } else if ((m = /^(\d+)\.(\d{1,2})$/.exec(s))) {
    int = m[1]!;
    frac = m[2]!;
  } else {
    return null;
  }
  const cents = BigInt(int) * 100n + BigInt(frac.padEnd(2, '0') || '0');
  return cents > 0n ? cents.toString() : null;
}

/** ISO timestamp -> "24/11/2026 12:00". */
export function formatDateTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '—';
  return d.toLocaleString('pt-BR', { dateStyle: 'short', timeStyle: 'short' });
}

/** Lamports (string) -> "0,4213 SOL". */
export function formatSol(lamports: string): string {
  let n: bigint;
  try {
    n = BigInt(lamports);
  } catch {
    return '—';
  }
  const int = (n / 1_000_000_000n).toString();
  const frac = (n % 1_000_000_000n).toString().padStart(9, '0').slice(0, 4);
  return `${groupThousands(int)},${frac} SOL`;
}
