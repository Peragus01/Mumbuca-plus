import { PublicKey, SystemProgram, TransactionInstruction } from '@solana/web3.js';
import idl from './idl/mumbuca_plus.json' with { type: 'json' };

export const TOKEN_2022_PROGRAM_ID = new PublicKey('TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb');

const text = (s: string) => Buffer.from(s, 'utf8');

export function findConfigPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([text('config')], programId);
}

export function findMintPda(programId: PublicKey): [PublicKey, number] {
  return PublicKey.findProgramAddressSync([text('mint')], programId);
}

/** payment_ref is the 32-byte reference used as the receipt PDA seed. */
export function findReceiptPda(programId: PublicKey, paymentRef: Uint8Array): [PublicKey, number] {
  if (paymentRef.length !== 32) throw new Error('payment_ref must be 32 bytes');
  return PublicKey.findProgramAddressSync([text('receipt'), Buffer.from(paymentRef)], programId);
}

function ixDiscriminator(name: string): Buffer {
  const ix = idl.instructions.find((i) => i.name === name);
  if (!ix) throw new Error(`instruction ${name} not found in IDL`);
  return Buffer.from(ix.discriminator);
}

function u64le(v: bigint): Buffer {
  if (v < 0n || v > 0xffffffffffffffffn) throw new Error('u64 out of range');
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}

export interface InitializeArgs {
  cap: bigint;
  maxMintPerTx: bigint;
  minter: PublicKey;
  pauser: PublicKey;
  uri: string;
}

/** Borsh layout: discriminator | cap u64 | max_mint_per_tx u64 | minter 32B | pauser 32B | uri (u32 len + utf8). */
export function encodeInitializeData(args: InitializeArgs): Buffer {
  const uri = Buffer.from(args.uri, 'utf8');
  const len = Buffer.alloc(4);
  len.writeUInt32LE(uri.length);
  return Buffer.concat([
    ixDiscriminator('initialize'),
    u64le(args.cap),
    u64le(args.maxMintPerTx),
    args.minter.toBuffer(),
    args.pauser.toBuffer(),
    len,
    uri,
  ]);
}

export function buildInitializeInstruction(
  programId: PublicKey,
  admin: PublicKey,
  args: InitializeArgs,
): TransactionInstruction {
  const [config] = findConfigPda(programId);
  const [mint] = findMintPda(programId);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: admin, isSigner: true, isWritable: true },
      { pubkey: config, isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: encodeInitializeData(args),
  });
}

export interface ConfigAccount {
  admin: PublicKey;
  minter: PublicKey;
  pauser: PublicKey;
  mint: PublicKey;
  cap: bigint;
  maxMintPerTx: bigint;
  totalMinted: bigint;
  paused: boolean;
}

/** Decodes the Config account (8-byte discriminator + fields per IDL). */
export function decodeConfigAccount(data: Uint8Array): ConfigAccount {
  const b = Buffer.from(data);
  const disc = Buffer.from(idl.accounts.find((a) => a.name === 'Config')!.discriminator);
  if (b.length < 8 + 32 * 4 + 8 * 3 + 1 || !b.subarray(0, 8).equals(disc)) {
    throw new Error('not a Config account');
  }
  let o = 8;
  const pk = () => new PublicKey(b.subarray(o, (o += 32)));
  const admin = pk();
  const minter = pk();
  const pauser = pk();
  const mint = pk();
  const cap = b.readBigUInt64LE(o);
  o += 8;
  const maxMintPerTx = b.readBigUInt64LE(o);
  o += 8;
  const totalMinted = b.readBigUInt64LE(o);
  o += 8;
  const paused = b[o] === 1;
  return { admin, minter, pauser, mint, cap, maxMintPerTx, totalMinted, paused };
}

/** True when the on-chain config has exactly the expected admin/minter/pauser (front-run check). */
export function configMatches(
  cfg: Pick<ConfigAccount, 'admin' | 'minter' | 'pauser'>,
  expected: Pick<ConfigAccount, 'admin' | 'minter' | 'pauser'>,
): boolean {
  return cfg.admin.equals(expected.admin) && cfg.minter.equals(expected.minter) && cfg.pauser.equals(expected.pauser);
}

/** `pause` / `unpause` (accounts: pauser signer, config). Used by tests and ops tooling. */
export function buildPauserInstruction(
  programId: PublicKey,
  pauser: PublicKey,
  name: 'pause' | 'unpause',
): TransactionInstruction {
  const [config] = findConfigPda(programId);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: pauser, isSigner: true, isWritable: false },
      { pubkey: config, isSigner: false, isWritable: true },
    ],
    data: ixDiscriminator(name),
  });
}
