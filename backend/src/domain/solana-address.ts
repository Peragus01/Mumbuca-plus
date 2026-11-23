import { PublicKey } from '@solana/web3.js';
import { base58 } from '@scure/base';

/** Returns the canonical base58 form of a Solana address (32-byte ed25519 pubkey), or null if invalid. */
export function parseSolanaAddress(input: string): string | null {
  try {
    if (typeof input !== 'string' || input.length === 0) return null;
    if (base58.decode(input).length !== 32) return null;
    return new PublicKey(input).toBase58();
  } catch {
    return null;
  }
}
