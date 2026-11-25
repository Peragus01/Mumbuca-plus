import { base58 } from '@scure/base';
import { ed25519 } from '@noble/curves/ed25519';

export const CHALLENGE_TTL_MS = 5 * 60_000;

/** Human-readable sign-in message shown by Phantom. It is stored server-side and is the only thing verified. */
export function buildSignInMessage(p: { host: string; wallet: string; nonce: string; issuedAt: Date; expiresAt: Date }): string {
  return [
    `${p.host} quer que você entre no Mumbuca+ com a carteira:`,
    p.wallet,
    '',
    'Isso não autoriza nenhuma transação.',
    '',
    `Nonce: ${p.nonce}`,
    `Emitida em: ${p.issuedAt.toISOString()}`,
    `Expira em: ${p.expiresAt.toISOString()}`,
  ].join('\n');
}

/** ed25519 verification of a base58 signature over the UTF-8 message. Never throws: malformed input is `false`. */
export function verifySignature(message: string, signatureB58: string, walletB58: string): boolean {
  try {
    const sig = base58.decode(signatureB58);
    const pub = base58.decode(walletB58);
    if (sig.length !== 64 || pub.length !== 32) return false;
    return ed25519.verify(sig, new TextEncoder().encode(message), pub);
  } catch {
    return false;
  }
}
