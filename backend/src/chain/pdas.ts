import { PublicKey } from '@solana/web3.js';
import { findConfigPda, findMintPda, findReceiptPda } from './program-client.js';

export const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');
export const ASSOCIATED_TOKEN_PROGRAM_ID = new PublicKey('ATokenGPvbdGVxr1b2hvZbsiqW5xWH25efTNsLJA8knL');

type ProgramIdLike = PublicKey | string;
const pk = (p: ProgramIdLike) => (typeof p === 'string' ? new PublicKey(p) : p);

/** `0x` + 64 hex chars → 32 bytes. Throws on anything else. */
export function paymentRefBytes(paymentRef: `0x${string}`): Uint8Array {
  if (!/^0x[0-9a-fA-F]{64}$/.test(paymentRef)) throw new Error('paymentRef must be 0x followed by 64 hex characters');
  return Uint8Array.from(Buffer.from(paymentRef.slice(2), 'hex'));
}

export function configPda(programId: ProgramIdLike): PublicKey {
  return findConfigPda(pk(programId))[0];
}

export function mintPda(programId: ProgramIdLike): PublicKey {
  return findMintPda(pk(programId))[0];
}

export function receiptPda(programId: ProgramIdLike, paymentRef: `0x${string}`): PublicKey {
  return findReceiptPda(pk(programId), paymentRefBytes(paymentRef))[0];
}

/** Token-2022 associated token account of `owner` for `mint`. */
export function token2022Ata(owner: PublicKey, mint: PublicKey): PublicKey {
  return PublicKey.findProgramAddressSync(
    [owner.toBuffer(), TOKEN_2022_PROGRAM_ID.toBuffer(), mint.toBuffer()],
    ASSOCIATED_TOKEN_PROGRAM_ID,
  )[0];
}
