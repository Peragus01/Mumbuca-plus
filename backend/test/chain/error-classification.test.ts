import { describe, expect, it } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  MintRejectedError,
  TransientChainError,
  classifySimulationFailure,
  classifyThrown,
  createSolanaTokenGateway,
  timeoutFetch,
} from '../../src/chain/token-gateway.js';
import { configPda, mintPda, receiptPda } from '../../src/chain/pdas.js';

const PROGRAM = 'HfFamsTJgSXssGkCgBqtNsDLD694peLYBbAzs4kuYzZm';
const programId = new PublicKey(PROGRAM);
const REF = `0x${'ab'.repeat(32)}` as const;
const receipt = receiptPda(programId, REF);
const SYSTEM = '11111111111111111111111111111111';

/** Logs shaped like a real Anchor 1.x failure of mint_for_payment. */
function anchorLogs(name: string, code: number): string[] {
  return [
    `Program ${PROGRAM} invoke [1]`,
    'Program log: Instruction: MintForPayment',
    `Program log: AnchorError caused by account: config. Error Code: ${name}. Error Number: ${code}. Error Message: x.`,
    `Program ${PROGRAM} consumed 9000 of 200000 compute units`,
    `Program ${PROGRAM} failed: custom program error: 0x${code.toString(16)}`,
  ];
}

const ctx = { programId, receipt };

describe('classifySimulationFailure', () => {
  it.each([
    ['Unauthorized', 6000],
    ['Paused', 6001],
    ['InvalidAmount', 6002],
    ['ExceedsMaxPerTx', 6003],
    ['CapExceeded', 6004],
    ['MathOverflow', 6005],
  ])('maps custom error %s (%i) from our program to MintRejectedError', (name, code) => {
    const e = classifySimulationFailure({ InstructionError: [0, { Custom: code }] }, anchorLogs(name, code), ctx);
    expect(e).toBeInstanceOf(MintRejectedError);
    expect((e as MintRejectedError).reason).toBe(name);
  });

  it('maps "already in use" on the receipt account to PaymentRefAlreadyUsed', () => {
    const logs = [
      `Program ${PROGRAM} invoke [1]`,
      'Program log: Instruction: MintForPayment',
      `Program ${SYSTEM} invoke [2]`,
      `Allocate: account Address { address: ${receipt.toBase58()}, base: None } already in use`,
      `Program ${SYSTEM} failed: custom program error: 0x0`,
      `Program ${PROGRAM} consumed 7000 of 200000 compute units`,
      `Program ${PROGRAM} failed: custom program error: 0x0`,
    ];
    const e = classifySimulationFailure({ InstructionError: [0, { Custom: 0 }] }, logs, ctx);
    expect(e).toBeInstanceOf(MintRejectedError);
    expect((e as MintRejectedError).reason).toBe('PaymentRefAlreadyUsed');
  });

  it('"already in use" on another account is UnknownProgramError', () => {
    const other = Keypair.generate().publicKey.toBase58();
    const logs = [
      `Program ${PROGRAM} invoke [1]`,
      `Program ${SYSTEM} invoke [2]`,
      `Create Account: account Address { address: ${other}, base: None } already in use`,
      `Program ${SYSTEM} failed: custom program error: 0x0`,
      `Program ${PROGRAM} failed: custom program error: 0x0`,
    ];
    const e = classifySimulationFailure({ InstructionError: [0, { Custom: 0 }] }, logs, ctx);
    expect((e as MintRejectedError).reason).toBe('UnknownProgramError');
  });

  it('maps an unknown custom code (e.g. an Anchor framework error) to UnknownProgramError', () => {
    const e = classifySimulationFailure({ InstructionError: [0, { Custom: 2006 }] }, anchorLogs('ConstraintSeeds', 2006), ctx);
    expect(e).toBeInstanceOf(MintRejectedError);
    expect((e as MintRejectedError).reason).toBe('UnknownProgramError');
  });

  it('maps a non-custom instruction error from our program to UnknownProgramError', () => {
    const logs = [`Program ${PROGRAM} invoke [1]`, `Program ${PROGRAM} failed: Program failed to complete`];
    const e = classifySimulationFailure({ InstructionError: [0, 'ProgramFailedToComplete'] }, logs, ctx);
    expect((e as MintRejectedError).reason).toBe('UnknownProgramError');
  });

  it('a custom code in our range raised by another program (CPI) is UnknownProgramError, not a Mumbuca name', () => {
    const TOKEN = 'TokenzQdBNbLqP5VEhdkAS6EPFLC1PHnBqCXEpPxuEb';
    const logs = [
      `Program ${PROGRAM} invoke [1]`,
      `Program ${TOKEN} invoke [2]`,
      `Program ${TOKEN} failed: custom program error: 0x1771`,
      `Program ${PROGRAM} failed: custom program error: 0x1771`,
    ];
    const e = classifySimulationFailure({ InstructionError: [0, { Custom: 6001 }] }, logs, ctx);
    expect((e as MintRejectedError).reason).toBe('UnknownProgramError');
  });

  it.each([
    ['BlockhashNotFound', 'BlockhashNotFound'],
    ['InsufficientFundsForFee', 'InsufficientFundsForFee'],
    ['AccountNotFound', 'AccountNotFound'],
    ['InsufficientFundsForRent', { InsufficientFundsForRent: { account_index: 0 } }],
  ])('maps transaction-level %s to TransientChainError', (_label, err) => {
    const e = classifySimulationFailure(err, [], ctx);
    expect(e).toBeInstanceOf(TransientChainError);
  });

  it('maps a system transfer with insufficient lamports (rent payment by the minter) to TransientChainError', () => {
    const logs = [
      `Program ${PROGRAM} invoke [1]`,
      `Program ${SYSTEM} invoke [2]`,
      'Transfer: insufficient lamports 1000, need 1500000',
      `Program ${SYSTEM} failed: custom program error: 0x1`,
      `Program ${PROGRAM} failed: custom program error: 0x1`,
    ];
    const e = classifySimulationFailure({ InstructionError: [0, { Custom: 1 }] }, logs, ctx);
    expect(e).toBeInstanceOf(TransientChainError);
  });
});

describe('classifyThrown', () => {
  it('wraps network errors as TransientChainError without leaking the original message', () => {
    const url = 'https://rpc.example.com/?api-key=SECRET123';
    const e = classifyThrown(new Error(`failed to get recent blockhash: fetch failed (${url})`), 'getLatestBlockhash');
    expect(e).toBeInstanceOf(TransientChainError);
    expect(e.message).not.toContain('rpc.example.com');
    expect(e.message).not.toContain('SECRET123');
  });

  it('passes MintRejectedError and TransientChainError through unchanged', () => {
    const r = new MintRejectedError('Paused');
    const t = new TransientChainError('x');
    expect(classifyThrown(r, 'op')).toBe(r);
    expect(classifyThrown(t, 'op')).toBe(t);
  });
});

describe('gateway against an unreachable RPC', () => {
  const rpcUrl = 'http://127.0.0.1:1/path-with-SECRET-token';
  const minter = Keypair.generate();
  const gw = createSolanaTokenGateway({ rpcUrl, programId: PROGRAM, minterSecretKey: minter.secretKey });

  it('sendMint throws TransientChainError whose message has no RPC URL or key material', async () => {
    const err = await gw.sendMint(Keypair.generate().publicKey.toBase58(), 100n, REF).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransientChainError);
    const msg = (err as Error).message;
    expect(msg).not.toContain('127.0.0.1');
    expect(msg).not.toContain('SECRET');
    expect(msg).not.toContain(Buffer.from(minter.secretKey).toString('hex').slice(0, 16));
  });

  it.each([
    ['isPaymentRefUsed', () => gw.isPaymentRefUsed(REF)],
    ['balanceOf', () => gw.balanceOf(Keypair.generate().publicKey.toBase58())],
    ['minterNativeBalance', () => gw.minterNativeBalance()],
    ['isPaused', () => gw.isPaused()],
    ['getSignatureStatus', () => gw.getSignatureStatus('1'.repeat(64))],
  ])('%s throws TransientChainError', async (_name, call) => {
    const err = await call().catch((e: unknown) => e);
    expect(err).toBeInstanceOf(TransientChainError);
    expect((err as Error).message).not.toContain('127.0.0.1');
  });
});

describe('pdas', () => {
  it('derives config/mint/receipt PDAs with the program seeds', () => {
    expect(configPda(programId).equals(PublicKey.findProgramAddressSync([Buffer.from('config')], programId)[0])).toBe(true);
    expect(mintPda(PROGRAM).equals(PublicKey.findProgramAddressSync([Buffer.from('mint')], programId)[0])).toBe(true);
    expect(
      receipt.equals(PublicKey.findProgramAddressSync([Buffer.from('receipt'), Buffer.alloc(32, 0xab)], programId)[0]),
    ).toBe(true);
  });

  it('rejects a malformed paymentRef', () => {
    expect(() => receiptPda(programId, '0x1234' as `0x${string}`)).toThrow();
    expect(() => receiptPda(programId, `0x${'zz'.repeat(32)}` as `0x${string}`)).toThrow();
  });
});

describe('RPC timeout (Important 1)', () => {
  it('a hung RPC call is aborted after rpcTimeoutMs and surfaces as transient rpc_timeout', async () => {
    let calls = 0;
    const hanging = ((_url: unknown, init?: RequestInit) => {
      calls++;
      return new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => reject(init.signal!.reason));
      });
    }) as typeof fetch;
    const gw = createSolanaTokenGateway({
      rpcUrl: 'http://127.0.0.1:1/path-with-SECRET-token',
      programId: PROGRAM,
      minterSecretKey: Keypair.generate().secretKey,
      rpcTimeoutMs: 100,
      fetch: hanging,
    });
    const started = Date.now();
    const err = await gw.isPaused().catch((e: unknown) => e);
    expect(Date.now() - started).toBeLessThan(3000);
    expect(err).toBeInstanceOf(TransientChainError);
    expect((err as Error).message).toMatch(/rpc_timeout/);
    expect((err as Error).message).not.toContain('SECRET');
    expect(calls).toBe(1);
  }, 10_000);

  it('timeoutFetch keeps a caller abort signal working', async () => {
    const seen: (AbortSignal | null | undefined)[] = [];
    const base = ((_u: unknown, init?: RequestInit) => {
      seen.push(init?.signal);
      return new Promise((_r, reject) => init?.signal?.addEventListener('abort', () => reject(init.signal!.reason)));
    }) as typeof fetch;
    const f = timeoutFetch(60_000, base);
    const ctrl = new AbortController();
    const p = f('http://x', { method: 'POST', signal: ctrl.signal });
    ctrl.abort(new Error('caller abort'));
    await expect(p).rejects.toThrow('caller abort');
    expect(seen[0]).toBeDefined();
  });
});
