/** Phantom wallet helpers: provider lookup, connect + signMessage, base58 encoding. */

export interface PhantomProvider {
  isPhantom?: boolean;
  connect(): Promise<{ publicKey: { toString(): string } }>;
  signMessage(message: Uint8Array, display?: 'utf8' | 'hex'): Promise<{ signature: Uint8Array }>;
}

declare global {
  interface Window {
    phantom?: { solana?: PhantomProvider };
  }
}

export function getPhantom(): PhantomProvider | null {
  const p = typeof window === 'undefined' ? undefined : window.phantom?.solana;
  return p && p.isPhantom ? p : null;
}

const ALPHABET = '123456789ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz';

export function base58Encode(bytes: Uint8Array): string {
  let zeros = 0;
  while (zeros < bytes.length && bytes[zeros] === 0) zeros++;
  const digits: number[] = []; // base58 digits, least significant first
  for (let i = zeros; i < bytes.length; i++) {
    let carry = bytes[i]!;
    for (let j = 0; j < digits.length; j++) {
      carry += digits[j]! << 8;
      digits[j] = carry % 58;
      carry = Math.floor(carry / 58);
    }
    while (carry > 0) {
      digits.push(carry % 58);
      carry = Math.floor(carry / 58);
    }
  }
  let out = '1'.repeat(zeros);
  for (let k = digits.length - 1; k >= 0; k--) out += ALPHABET[digits[k]!];
  return out;
}

export function isUserRejection(e: unknown): boolean {
  return typeof e === 'object' && e !== null && (e as { code?: unknown }).code === 4001;
}

/** Connects to Phantom, asks the backend for the message to sign, and signs it. */
export async function connectAndSign(
  message: (wallet: string) => Promise<string>,
): Promise<{ wallet: string; signatureB58: string }> {
  const provider = getPhantom();
  if (!provider) throw new Error('phantom_not_found');
  const { publicKey } = await provider.connect();
  const wallet = publicKey.toString();
  const text = await message(wallet);
  const { signature } = await provider.signMessage(new TextEncoder().encode(text), 'utf8');
  return { wallet, signatureB58: base58Encode(signature) };
}
