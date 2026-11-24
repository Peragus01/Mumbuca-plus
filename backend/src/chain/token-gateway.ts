import {
  Connection,
  Keypair,
  PublicKey,
  SystemProgram,
  TransactionInstruction,
  TransactionMessage,
  VersionedTransaction,
  type TransactionError,
} from '@solana/web3.js';
import { base58 } from '@scure/base';
import idl from './idl/mumbuca_plus.json' with { type: 'json' };
import {
  ASSOCIATED_TOKEN_PROGRAM_ID,
  TOKEN_2022_PROGRAM_ID,
  configPda,
  mintPda,
  paymentRefBytes,
  receiptPda,
  token2022Ata,
} from './pdas.js';
import { decodeConfigAccount, type ConfigAccount } from './program-client.js';

export type MintRejectReason =
  | 'Unauthorized'
  | 'Paused'
  | 'InvalidAmount'
  | 'ExceedsMaxPerTx'
  | 'CapExceeded'
  | 'MathOverflow'
  | 'PaymentRefAlreadyUsed'
  | 'UnknownProgramError';

export type TxOutcome = { status: 'confirmed' | 'failed'; slot: bigint; reason?: string };

export interface TokenGateway {
  sendMint(recipient: string, amountUnits: bigint, paymentRef: `0x${string}`): Promise<{ signature: string; lastValidBlockHeight: bigint }>;
  getSignatureStatus(signature: string): Promise<TxOutcome | null>;
  waitForConfirmation(signature: string, lastValidBlockHeight: bigint, timeoutMs: number): Promise<TxOutcome | 'expired' | null>;
  isBlockhashExpired(lastValidBlockHeight: bigint): Promise<boolean>;
  isPaymentRefUsed(paymentRef: `0x${string}`): Promise<boolean>;
  findMintTx(paymentRef: `0x${string}`): Promise<{ signature: string; slot: bigint } | null>;
  balanceOf(owner: string): Promise<bigint>;
  minterNativeBalance(): Promise<bigint>;
  isPaused(): Promise<boolean>;
  /** On-chain Config account (minter, max_mint_per_tx, paused, ...). */
  programConfig(): Promise<ConfigAccount>;
}

/** Retryable: network/RPC failure, timeout, expired blockhash, missing SOL for fee/rent. Message never carries the RPC URL or keys. */
export class TransientChainError extends Error {
  override name = 'TransientChainError';
}

/** The program (or the receipt PDA `init`) rejected the mint; retrying the same request will not help. */
export class MintRejectedError extends Error {
  override name = 'MintRejectedError';
  constructor(readonly reason: MintRejectReason) {
    super(`mint rejected by program: ${reason}`);
  }
}

const PROGRAM_ERRORS = new Map<number, MintRejectReason>(
  idl.errors.map((e) => [e.code, e.name as MintRejectReason]),
);
const MINT_DISC = Buffer.from(idl.instructions.find((i) => i.name === 'mint_for_payment')!.discriminator);
const RECEIPT_DISC = Buffer.from(idl.accounts.find((a) => a.name === 'PaymentReceipt')!.discriminator);
const SYSTEM_ID = SystemProgram.programId.toBase58();

/** Innermost program that reported failure, from "Program <id> failed: ..." log lines. */
function failingProgram(logs: readonly string[]): string | null {
  for (const line of logs) {
    const m = /^Program (\w+) failed: /.exec(line);
    if (m) return m[1]!;
  }
  return null;
}

/** Fixed, URL-free code for a transaction-level error (e.g. "BlockhashNotFound"). */
function txErrorCode(err: unknown): string {
  if (typeof err === 'string') return /^\w{1,64}$/.test(err) ? err : 'TransactionError';
  if (err && typeof err === 'object') {
    const k = Object.keys(err)[0];
    if (k && /^\w{1,64}$/.test(k)) return k;
  }
  return 'TransactionError';
}

/**
 * Maps a failed simulation (or a failed landed transaction) to a typed error.
 * `ctx.receipt` is the receipt PDA of this mint: an "already in use" from the system program on
 * that address means the payment_ref was consumed before.
 */
export function classifySimulationFailure(
  err: TransactionError | string | object,
  logs: readonly string[] | null,
  ctx: { programId: PublicKey; receipt?: PublicKey },
): MintRejectedError | TransientChainError {
  const ie = (err as { InstructionError?: [number, unknown] }).InstructionError;
  if (!Array.isArray(ie)) return new TransientChainError(`chain transaction error: ${txErrorCode(err)}`);

  const inner = ie[1];
  const custom = inner && typeof inner === 'object' ? (inner as { Custom?: unknown }).Custom : undefined;
  const failing = logs ? failingProgram(logs) : null;
  const programId = ctx.programId.toBase58();

  if (failing === SYSTEM_ID && logs) {
    if (custom === 0 && ctx.receipt) {
      const r = ctx.receipt.toBase58();
      if (logs.some((l) => l.includes('already in use') && l.includes(r))) return new MintRejectedError('PaymentRefAlreadyUsed');
    }
    // Custom 1 = ResultWithNegativeLamports: the minter cannot pay rent for the receipt/ATA.
    if (custom === 1 || logs.some((l) => l.includes('insufficient lamports'))) {
      return new TransientChainError('chain transaction error: InsufficientFundsForRent');
    }
  }
  if (typeof custom === 'number' && PROGRAM_ERRORS.has(custom) && (failing === programId || failing === null)) {
    return new MintRejectedError(PROGRAM_ERRORS.get(custom)!);
  }
  return new MintRejectedError('UnknownProgramError');
}

/** Wraps anything thrown by web3.js/fetch without echoing its message (it may contain the RPC URL). */
export function classifyThrown(e: unknown, op: string): MintRejectedError | TransientChainError {
  if (e instanceof MintRejectedError || e instanceof TransientChainError) return e;
  const raw = e instanceof Error ? `${e.message} ${(e as { code?: unknown }).code ?? ''}` : '';
  let code = 'rpc_error';
  if (/429|too many requests/i.test(raw)) code = 'rate_limited';
  else if (/timed? ?out|timeout|ETIMEDOUT|aborted/i.test(raw)) code = 'rpc_timeout';
  else if (/fetch failed|ECONNREFUSED|ECONNRESET|ENOTFOUND|EAI_AGAIN|socket|network/i.test(raw)) code = 'rpc_unreachable';
  else if (/blockhash not found/i.test(raw)) code = 'BlockhashNotFound';
  return new TransientChainError(`chain operation failed (${op}): ${code}`);
}

function u64le(v: bigint): Buffer {
  if (v < 0n || v > 0xffffffffffffffffn) throw new RangeError('amountUnits must fit in a u64');
  const b = Buffer.alloc(8);
  b.writeBigUInt64LE(v);
  return b;
}

/** Instruction `mint_for_payment(payment_ref, amount)` with accounts in IDL order. */
export function buildMintForPaymentInstruction(
  programId: PublicKey,
  minter: PublicKey,
  recipient: PublicKey,
  amountUnits: bigint,
  paymentRef: `0x${string}`,
): TransactionInstruction {
  const ref = paymentRefBytes(paymentRef);
  const mint = mintPda(programId);
  return new TransactionInstruction({
    programId,
    keys: [
      { pubkey: minter, isSigner: true, isWritable: true },
      { pubkey: configPda(programId), isSigner: false, isWritable: true },
      { pubkey: receiptPda(programId, paymentRef), isSigner: false, isWritable: true },
      { pubkey: recipient, isSigner: false, isWritable: false },
      { pubkey: token2022Ata(recipient, mint), isSigner: false, isWritable: true },
      { pubkey: mint, isSigner: false, isWritable: true },
      { pubkey: TOKEN_2022_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: ASSOCIATED_TOKEN_PROGRAM_ID, isSigner: false, isWritable: false },
      { pubkey: SystemProgram.programId, isSigner: false, isWritable: false },
    ],
    data: Buffer.concat([MINT_DISC, Buffer.from(ref), u64le(amountUnits)]),
  });
}

export const DEFAULT_RPC_TIMEOUT_MS = 12_000;

/**
 * fetch with a per-request timeout (composed with any caller signal). web3.js would otherwise use
 * the runtime default (~300 s), and a stalled RPC call would hold the process-wide queue.
 * The abort surfaces as a "timeout"/"aborted" error, which classifyThrown maps to rpc_timeout.
 */
export function timeoutFetch(timeoutMs: number, base: typeof fetch = (input, init) => fetch(input, init)): typeof fetch {
  return ((input: Parameters<typeof fetch>[0], init?: RequestInit) => {
    const timeout = AbortSignal.timeout(timeoutMs);
    const signal = init?.signal ? AbortSignal.any([init.signal, timeout]) : timeout;
    return base(input, { ...init, signal });
  }) as typeof fetch;
}

const POLL_MS = 400;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

export function createSolanaTokenGateway(opts: {
  rpcUrl: string;
  programId: string;
  minterSecretKey: Uint8Array;
  commitment?: 'confirmed';
  /** Per-request RPC timeout (default DEFAULT_RPC_TIMEOUT_MS). */
  rpcTimeoutMs?: number;
  /** Underlying fetch (tests); always wrapped with the timeout. */
  fetch?: typeof fetch;
}): TokenGateway {
  const commitment = opts.commitment ?? 'confirmed';
  const connection = new Connection(opts.rpcUrl, {
    commitment,
    disableRetryOnRateLimit: true,
    fetch: timeoutFetch(opts.rpcTimeoutMs ?? DEFAULT_RPC_TIMEOUT_MS, opts.fetch),
  });
  const programId = new PublicKey(opts.programId);
  const minter = Keypair.fromSecretKey(opts.minterSecretKey);

  async function rpc<T>(op: string, fn: () => Promise<T>): Promise<T> {
    try {
      return await fn();
    } catch (e) {
      throw classifyThrown(e, op);
    }
  }

  async function failureReason(signature: string, err: unknown): Promise<string> {
    let logs: string[] | null = null;
    try {
      const tx = await connection.getTransaction(signature, { commitment, maxSupportedTransactionVersion: 0 });
      logs = tx?.meta?.logMessages ?? null;
    } catch {
      // Logs are best effort; classify from the error alone.
    }
    const c = classifySimulationFailure(err as TransactionError, logs, { programId });
    return c instanceof MintRejectedError ? c.reason : txErrorCode(err);
  }

  async function statusOf(signature: string, searchHistory: boolean): Promise<TxOutcome | null> {
    const res = await rpc('getSignatureStatuses', () =>
      connection.getSignatureStatuses([signature], { searchTransactionHistory: searchHistory }),
    );
    const st = res.value[0];
    if (!st) return null;
    if (st.err) return { status: 'failed', slot: BigInt(st.slot), reason: await failureReason(signature, st.err) };
    if (st.confirmationStatus === 'confirmed' || st.confirmationStatus === 'finalized') {
      return { status: 'confirmed', slot: BigInt(st.slot) };
    }
    return null; // processed only: not yet confirmed
  }

  async function readConfig(): Promise<ConfigAccount> {
    const info = await rpc('getAccountInfo', () => connection.getAccountInfo(configPda(programId), commitment));
    if (!info) throw new TransientChainError('program config account not found');
    try {
      return decodeConfigAccount(info.data);
    } catch {
      throw new TransientChainError('program config account invalid');
    }
  }

  async function blockHeight(): Promise<bigint> {
    return BigInt(await rpc('getBlockHeight', () => connection.getBlockHeight(commitment)));
  }

  return {
    async sendMint(recipient, amountUnits, paymentRef) {
      let recipientKey: PublicKey;
      try {
        recipientKey = new PublicKey(recipient);
      } catch {
        throw new TypeError('recipient is not a valid Solana address');
      }
      const ix = buildMintForPaymentInstruction(programId, minter.publicKey, recipientKey, amountUnits, paymentRef);
      const receipt = receiptPda(programId, paymentRef);

      const { blockhash, lastValidBlockHeight } = await rpc('getLatestBlockhash', () =>
        connection.getLatestBlockhash(commitment),
      );
      const tx = new VersionedTransaction(
        new TransactionMessage({ payerKey: minter.publicKey, recentBlockhash: blockhash, instructions: [ix] }).compileToLegacyMessage(),
      );
      tx.sign([minter]);

      const sim = await rpc('simulateTransaction', () =>
        connection.simulateTransaction(tx, { sigVerify: false, replaceRecentBlockhash: false, commitment }),
      );
      if (sim.value.err) throw classifySimulationFailure(sim.value.err, sim.value.logs, { programId, receipt });

      // Outcome of a failed send is uncertain: the caller checks the receipt PDA before retrying.
      await rpc('sendRawTransaction', () =>
        connection.sendRawTransaction(tx.serialize(), { skipPreflight: true, preflightCommitment: commitment }),
      );
      return { signature: base58.encode(tx.signatures[0]!), lastValidBlockHeight: BigInt(lastValidBlockHeight) };
    },

    getSignatureStatus(signature) {
      return statusOf(signature, true);
    },

    async waitForConfirmation(signature, lastValidBlockHeight, timeoutMs) {
      const deadline = Date.now() + timeoutMs;
      while (Date.now() < deadline) {
        try {
          const st = await statusOf(signature, false);
          if (st) return st;
          if ((await blockHeight()) > lastValidBlockHeight) {
            // Re-check with history so a status that landed just before expiry is not missed.
            const late = await statusOf(signature, true);
            return late ?? 'expired';
          }
        } catch (e) {
          if (!(e instanceof TransientChainError)) throw e;
          // Keep polling through transient RPC failures until the deadline.
        }
        await sleep(Math.min(POLL_MS, Math.max(0, deadline - Date.now())));
      }
      return null;
    },

    async isBlockhashExpired(lastValidBlockHeight) {
      return (await blockHeight()) > lastValidBlockHeight;
    },

    async isPaymentRefUsed(paymentRef) {
      const receipt = receiptPda(programId, paymentRef);
      const info = await rpc('getAccountInfo', () => connection.getAccountInfo(receipt, commitment));
      // Lamports sent to the PDA address create a system-owned account; only a program-owned
      // PaymentReceipt counts as "used".
      return !!info && info.owner.equals(programId) && Buffer.from(info.data.subarray(0, 8)).equals(RECEIPT_DISC);
    },

    async findMintTx(paymentRef) {
      const receipt = receiptPda(programId, paymentRef);
      const ok: { signature: string; slot: number }[] = [];
      let before: string | undefined;
      for (;;) {
        const page = await rpc('getSignaturesForAddress', () =>
          connection.getSignaturesForAddress(receipt, { before, limit: 1000 }, commitment),
        );
        for (const s of page) if (!s.err) ok.push({ signature: s.signature, slot: s.slot });
        if (page.length < 1000) break;
        before = page[page.length - 1]!.signature;
      }
      // Newest first → walk from the oldest; skip transactions that merely touched the address
      // (e.g. a lamport transfer) instead of calling mint_for_payment.
      for (let i = ok.length - 1; i >= 0; i--) {
        const cand = ok[i]!;
        const tx = await rpc('getTransaction', () =>
          connection.getTransaction(cand.signature, { commitment, maxSupportedTransactionVersion: 0 }),
        );
        if (!tx) continue;
        const keys = tx.transaction.message.staticAccountKeys;
        const isMint = tx.transaction.message.compiledInstructions.some(
          (ci) => keys[ci.programIdIndex]?.equals(programId) && Buffer.from(ci.data.subarray(0, 8)).equals(MINT_DISC),
        );
        if (isMint) return { signature: cand.signature, slot: BigInt(cand.slot) };
      }
      return null;
    },

    async balanceOf(owner) {
      const ata = token2022Ata(new PublicKey(owner), mintPda(programId));
      const info = await rpc('getAccountInfo', () => connection.getAccountInfo(ata, commitment));
      if (!info) return 0n;
      if (!info.owner.equals(TOKEN_2022_PROGRAM_ID) || info.data.length < 72) return 0n;
      return Buffer.from(info.data).readBigUInt64LE(64); // mint(32) | owner(32) | amount(u64)
    },

    async minterNativeBalance() {
      return BigInt(await rpc('getBalance', () => connection.getBalance(minter.publicKey, commitment)));
    },

    async isPaused() {
      return (await readConfig()).paused;
    },

    programConfig: readConfig,
  };
}
