import { describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { createTestDb } from '../helpers/test-db.js';
import { validEnv } from '../helpers/valid-env.js';
import { loadEnv } from '../../src/config/env.js';
import { paymentRefFor } from '../../src/domain/money.js';
import type { Payment } from '../../src/domain/payment.js';
import {
  MintRejectedError,
  TransientChainError,
  type TokenGateway,
  type TxOutcome,
} from '../../src/chain/token-gateway.js';
import {
  ProviderUnavailableError,
  type PaymentProvider,
  type ProviderPaymentState,
  type ProviderRegistry,
} from '../../src/providers/payment-provider.js';
import { createSimulatedProvider } from '../../src/providers/simulated-provider.js';
import { PaymentRepository } from '../../src/repositories/payment-repository.js';
import { UserRepository } from '../../src/repositories/user-repository.js';
import {
  createPaymentProcessor,
  ProviderNotEnabledError,
  RechargeLimitError,
  UnknownUserError,
} from '../../src/processing/payment-processor.js';

type Ref = `0x${string}`;
type SendBehavior = 'ok' | 'drop' | 'land-then-throw' | 'land-failed' | Error;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** In-memory stand-in for the on-chain program: receipts keyed by payment_ref, a block height, failure modes. */
class FakeChain implements TokenGateway {
  receipts = new Map<string, { signature: string; slot: bigint }>();
  txs = new Map<string, TxOutcome>();
  minted: { recipient: string; units: bigint; ref: string }[] = [];
  sendMintCalls = 0;
  sendQueue: SendBehavior[] = [];
  waitMode: 'auto' | 'timeout' | 'expired' | 'failed' = 'auto';
  hideMintTx = false;
  usedOverride: boolean[] = [];
  height = 1000n;
  nextSlot = 5000n;
  delayMs = 0;

  private land(recipient: string, units: bigint, ref: string): string {
    const signature = `sig_${this.sendMintCalls}`;
    const slot = this.nextSlot++;
    this.receipts.set(ref, { signature, slot });
    this.txs.set(signature, { status: 'confirmed', slot });
    this.minted.push({ recipient, units, ref });
    return signature;
  }

  async sendMint(recipient: string, units: bigint, ref: Ref) {
    this.sendMintCalls++;
    const n = this.sendMintCalls;
    if (this.delayMs) await sleep(this.delayMs);
    const b = this.sendQueue.shift() ?? 'ok';
    if (b instanceof Error) throw b;
    const lastValidBlockHeight = this.height + 150n;
    if (b === 'drop') return { signature: `sig_dropped_${n}`, lastValidBlockHeight };
    if (b === 'land-failed') {
      const signature = `sig_failed_${n}`;
      this.txs.set(signature, { status: 'failed', slot: this.nextSlot++, reason: 'UnknownProgramError' });
      return { signature, lastValidBlockHeight };
    }
    // Simulation catches a duplicate before anything is sent.
    if (this.receipts.has(ref)) throw new MintRejectedError('PaymentRefAlreadyUsed');
    const signature = this.land(recipient, units, ref);
    if (b === 'land-then-throw') throw new TransientChainError('chain operation failed (sendRawTransaction): rpc_timeout');
    return { signature, lastValidBlockHeight };
  }
  async getSignatureStatus(signature: string) {
    return this.txs.get(signature) ?? null;
  }
  async waitForConfirmation(signature: string, lastValidBlockHeight: bigint) {
    if (this.waitMode === 'timeout') return null;
    if (this.waitMode === 'expired') return 'expired' as const;
    if (this.waitMode === 'failed') return { status: 'failed' as const, slot: this.nextSlot++, reason: 'UnknownProgramError' };
    return this.txs.get(signature) ?? (this.height > lastValidBlockHeight ? ('expired' as const) : null);
  }
  async isBlockhashExpired(lastValidBlockHeight: bigint) {
    return this.height > lastValidBlockHeight;
  }
  async isPaymentRefUsed(ref: Ref) {
    const o = this.usedOverride.shift();
    return o !== undefined ? o : this.receipts.has(ref);
  }
  async findMintTx(ref: Ref) {
    return this.hideMintTx ? null : (this.receipts.get(ref) ?? null);
  }
  async balanceOf(owner: string) {
    return this.minted.filter((m) => m.recipient === owner).reduce((a, m) => a + m.units, 0n);
  }
  async minterNativeBalance() {
    return 10n ** 9n;
  }
  async isPaused() {
    return false;
  }
}

/** Configurable OZAV-like provider. */
class FakeProvider implements PaymentProvider {
  readonly name = 'ozav' as const;
  readonly env = 'sandbox' as const;
  states = new Map<string, ProviderPaymentState>();
  serverSide = new Map<string, string>(); // our payment id -> transfer id (what metadata search finds)
  createChargeCalls: string[] = [];
  createChargeError: Error | null = null;
  chargeLandedDespiteError = false;
  fetchErrors: Error[] = [];
  fetchCalls = 0;

  async createCharge({ paymentId }: { paymentId: string; amountCents: bigint }) {
    this.createChargeCalls.push(paymentId);
    const id = `tr_${this.createChargeCalls.length}`;
    if (this.createChargeError) {
      if (this.chargeLandedDespiteError) this.serverSide.set(paymentId, id);
      throw this.createChargeError;
    }
    this.serverSide.set(paymentId, id);
    this.states.set(id, { kind: 'pending' });
    return { providerPaymentId: id, pixBrCode: 'BRCODE', expiresAt: new Date(Date.now() + 3_600_000) };
  }
  async fetchPayment(id: string): Promise<ProviderPaymentState> {
    this.fetchCalls++;
    const e = this.fetchErrors.shift();
    if (e) throw e;
    return this.states.get(id) ?? { kind: 'review', reason: 'not_found' };
  }
  async findChargeByPaymentId(paymentId: string) {
    return this.serverSide.get(paymentId) ?? null;
  }
}

async function setup() {
  const db = await createTestDb();
  const users = new UserRepository(db);
  const payments = new PaymentRepository(db);
  const user = await users.create({
    handle: 'ana',
    displayName: 'Ana',
    walletAddress: Keypair.generate().publicKey.toBase58(),
  });
  const chain = new FakeChain();
  const ozav = new FakeProvider();
  const env = { ...loadEnv(validEnv), MAX_MINT_ATTEMPTS: 3, MINT_CONFIRM_TIMEOUT_MS: 10 };
  const logs: { level: string; obj: object; msg?: string }[] = [];
  const log = {
    info: (obj: object, msg?: string) => void logs.push({ level: 'info', obj, msg }),
    warn: (obj: object, msg?: string) => void logs.push({ level: 'warn', obj, msg }),
    error: (obj: object, msg?: string) => void logs.push({ level: 'error', obj, msg }),
  };
  const providers: ProviderRegistry = { ozav, simulated: createSimulatedProvider(db), mercadopago: undefined };
  const proc = createPaymentProcessor({ payments, users, providers, token: chain, env, log });
  const recharge = (cents = 2500n) => proc.createRecharge({ userId: user.id, amountCents: cents, provider: 'ozav' });
  /** Creates an OZAV recharge whose transfer the provider reports as approved. */
  const paid = async (opts: { cents?: bigint; received?: bigint; meta?: string | null } = {}) => {
    const p = await recharge(opts.cents ?? 2500n);
    ozav.states.set(p.providerPaymentId!, {
      kind: 'approved',
      receivedAmountCents: opts.received ?? opts.cents ?? 2500n,
      truncated: false,
      metadataPaymentId: opts.meta === undefined ? p.id : opts.meta,
    });
    return p;
  };
  const get = async (id: string) => (await payments.findById(id))!;
  const refOf = (p: Payment) => paymentRefFor('ozav', p.providerPaymentId!);
  return { db, users, payments, user, chain, ozav, env, logs, proc, recharge, paid, get, refOf };
}

describe('PaymentProcessor', () => {
  it('approved payment mints received amount and ends MINTED with txSignature and slot', async () => {
    const t = await setup();
    const p = await t.paid({ cents: 2500n });
    await t.proc.signal(p.id, 'webhook');
    const r = await t.get(p.id);
    const receipt = t.chain.receipts.get(t.refOf(p))!;
    expect(r.status).toBe('MINTED');
    expect(r.txSignature).toBe(receipt.signature);
    expect(r.slot).toBe(receipt.slot);
    expect(r.paymentRef).toBe(t.refOf(p));
    expect(r.mintAmountUnits).toBe('2500');
    expect(r.receivedAmountCents).toBe(2500n);
    expect(r.amountMismatch).toBe(false);
    expect(t.chain.minted).toEqual([{ recipient: t.user.walletAddress, units: 2500n, ref: t.refOf(p) }]);
    expect(t.chain.sendMintCalls).toBe(1);
  });

  it('rejected payment ends FAILED and never calls sendMint', async () => {
    const t = await setup();
    const p = await t.recharge();
    t.ozav.states.set(p.providerPaymentId!, { kind: 'rejected', reason: 'cancelled' });
    await t.proc.signal(p.id, 'webhook');
    const r = await t.get(p.id);
    expect(r.status).toBe('FAILED');
    expect(r.failureReason).toBe('provider_rejected:cancelled');
    expect(t.chain.sendMintCalls).toBe(0);
  });

  it('expired → FAILED pix_expired', async () => {
    const t = await setup();
    const p = await t.recharge();
    t.ozav.states.set(p.providerPaymentId!, { kind: 'expired' });
    await t.proc.signal(p.id, 'webhook');
    const r = await t.get(p.id);
    expect(r.status).toBe('FAILED');
    expect(r.failureReason).toBe('pix_expired');
    expect(t.chain.sendMintCalls).toBe(0);
  });

  it('pending provider status returns to AWAITING_PAYMENT', async () => {
    const t = await setup();
    const p = await t.recharge();
    await t.proc.signal(p.id, 'webhook');
    expect((await t.get(p.id)).status).toBe('AWAITING_PAYMENT');

    // Reconciler checks the provider first and does not transition while pending.
    const before = t.ozav.fetchCalls;
    await t.proc.signal(p.id, 'reconciler');
    expect(t.ozav.fetchCalls).toBe(before + 1);
    expect((await t.get(p.id)).status).toBe('AWAITING_PAYMENT');
    const { rows } = await t.db.query<{ n: number }>(
      `select count(*)::int as n from payment_events where payment_id = $1 and to_status = 'RECEIVED'`,
      [p.id],
    );
    expect(rows[0]!.n).toBe(1); // only the webhook one

    t.ozav.states.set(p.providerPaymentId!, {
      kind: 'approved',
      receivedAmountCents: 2500n,
      truncated: false,
      metadataPaymentId: p.id,
    });
    await t.proc.signal(p.id, 'reconciler');
    expect((await t.get(p.id)).status).toBe('MINTED');
  });

  it('review keeps VALIDATING with needsReview and no mint', async () => {
    const t = await setup();
    const p = await t.recharge();
    t.ozav.states.set(p.providerPaymentId!, { kind: 'review', reason: 'source_completed_but_failed' });
    await t.proc.signal(p.id, 'webhook');
    const r = await t.get(p.id);
    expect(r.status).toBe('VALIDATING');
    expect(r.needsReview).toBe(true);
    expect(r.lastError).toBe('source_completed_but_failed');
    expect(t.chain.sendMintCalls).toBe(0);
  });

  it('unknown wallet → FAILED wallet_not_found (invalid wallet address)', async () => {
    const t = await setup();
    const p = await t.paid();
    await t.db.query(`update users set wallet_address = 'not-a-solana-address' where id = $1`, [t.user.id]);
    await t.proc.signal(p.id, 'webhook');
    const r = await t.get(p.id);
    expect(r.status).toBe('FAILED');
    expect(r.failureReason).toBe('wallet_not_found');
    expect(t.chain.sendMintCalls).toBe(0);
  });

  it('unknown wallet → FAILED wallet_not_found (user removed)', async () => {
    const t = await setup();
    const p = await t.paid();
    await t.db.query('alter table payments drop constraint payments_user_id_fkey', []);
    await t.db.query('delete from users where id = $1', [t.user.id]);
    await t.proc.signal(p.id, 'webhook');
    const r = await t.get(p.id);
    expect(r.status).toBe('FAILED');
    expect(r.failureReason).toBe('wallet_not_found');
    expect(t.chain.sendMintCalls).toBe(0);
  });

  it('metadata of another payment → FAILED metadata_mismatch', async () => {
    const t = await setup();
    const p = await t.paid({ meta: '00000000-0000-4000-8000-000000000000' });
    await t.proc.signal(p.id, 'webhook');
    const r = await t.get(p.id);
    expect(r.status).toBe('FAILED');
    expect(r.failureReason).toBe('metadata_mismatch');
    expect(t.chain.sendMintCalls).toBe(0);
  });

  it('missing metadata (null) does not block the mint', async () => {
    const t = await setup();
    const p = await t.paid({ meta: null });
    await t.proc.signal(p.id, 'webhook');
    expect((await t.get(p.id)).status).toBe('MINTED');
  });

  it('received below minimum → FAILED amount_below_minimum', async () => {
    const t = await setup();
    const p = await t.paid({ cents: 2500n, received: 1099n });
    await t.proc.signal(p.id, 'webhook');
    const r = await t.get(p.id);
    expect(r.status).toBe('FAILED');
    expect(r.failureReason).toBe('amount_below_minimum');
    expect(t.chain.sendMintCalls).toBe(0);
  });

  it('received differs from requested → mints received, amountMismatch true', async () => {
    const t = await setup();
    const p = await t.paid({ cents: 2500n, received: 3000n });
    await t.proc.signal(p.id, 'webhook');
    const r = await t.get(p.id);
    expect(r.status).toBe('MINTED');
    expect(r.amountMismatch).toBe(true);
    expect(r.receivedAmountCents).toBe(3000n);
    expect(r.mintAmountUnits).toBe('3000');
    expect(t.chain.minted.map((m) => m.units)).toEqual([3000n]);
  });

  it('provider unavailable keeps VALIDATING and retries later to MINTED', async () => {
    const t = await setup();
    const p = await t.paid();
    t.ozav.fetchErrors.push(new ProviderUnavailableError('OZAV transfer lookup returned HTTP 503'));
    await t.proc.signal(p.id, 'webhook');
    let r = await t.get(p.id);
    expect(r.status).toBe('VALIDATING');
    expect(r.lastError).toBe('provider_unavailable');
    expect(r.attempts).toBe(1);
    r = await t.proc.process(p.id);
    expect(r.status).toBe('MINTED');
    expect(r.lastError).toBeNull();
  });

  it('RPC error on sendMint keeps APPROVED; retry mints exactly once', async () => {
    const t = await setup();
    const p = await t.paid();
    t.chain.sendQueue.push(new TransientChainError('chain operation failed (sendRawTransaction): rpc_unreachable'));
    await t.proc.signal(p.id, 'webhook');
    let r = await t.get(p.id);
    expect(r.status).toBe('APPROVED');
    expect(r.lastError).toBe('chain_transient:rpc_unreachable');
    expect(r.attempts).toBe(1);
    r = await t.proc.process(p.id);
    expect(r.status).toBe('MINTED');
    expect(t.chain.minted).toHaveLength(1);
    expect(t.chain.sendMintCalls).toBe(2);
  });

  it('sendMint landed but response lost (fake records ref, then throws TransientChainError) → retry sees isPaymentRefUsed and marks MINTED without a second sendMint', async () => {
    const t = await setup();
    const p = await t.paid();
    t.chain.sendQueue.push('land-then-throw');
    await t.proc.signal(p.id, 'webhook');
    expect((await t.get(p.id)).status).toBe('APPROVED');
    const r = await t.proc.process(p.id);
    expect(r.status).toBe('MINTED');
    expect(r.txSignature).toBe(t.chain.receipts.get(t.refOf(p))!.signature);
    expect(t.chain.sendMintCalls).toBe(1);
    expect(t.chain.minted).toHaveLength(1);
  });

  it('confirmation timeout keeps MINT_PENDING; later process marks MINTED', async () => {
    const t = await setup();
    const p = await t.paid();
    t.chain.waitMode = 'timeout';
    await t.proc.signal(p.id, 'webhook');
    let r = await t.get(p.id);
    expect(r.status).toBe('MINT_PENDING');
    expect(r.txSignature).toBe('sig_1'); // stored before waiting
    expect(r.lastValidBlockHeight).toBe(1150n);
    t.chain.waitMode = 'auto';
    r = await t.proc.process(p.id);
    expect(r.status).toBe('MINTED');
    expect(r.slot).toBe(t.chain.receipts.get(t.refOf(p))!.slot);
    expect(t.chain.sendMintCalls).toBe(1);
  });

  it('blockhash expired without receipt → back to APPROVED and resend once', async () => {
    const t = await setup();
    const p = await t.paid();
    t.chain.sendQueue.push('drop');
    t.chain.waitMode = 'timeout';
    await t.proc.signal(p.id, 'webhook');
    expect((await t.get(p.id)).status).toBe('MINT_PENDING');

    // Blockhash still valid: stays.
    expect((await t.proc.process(p.id)).status).toBe('MINT_PENDING');
    expect(t.chain.sendMintCalls).toBe(1);

    t.chain.height += 1000n;
    t.chain.waitMode = 'auto';
    let r = await t.proc.process(p.id);
    expect(r.status).toBe('APPROVED');
    expect(r.lastError).toBe('blockhash_expired');
    r = await t.proc.process(p.id);
    expect(r.status).toBe('MINTED');
    expect(t.chain.sendMintCalls).toBe(2);
    expect(t.chain.minted).toHaveLength(1);
  });

  it("waitForConfirmation 'expired' without receipt → APPROVED, resend is safe", async () => {
    const t = await setup();
    const p = await t.paid();
    t.chain.sendQueue.push('drop');
    t.chain.waitMode = 'expired';
    await t.proc.signal(p.id, 'webhook');
    expect((await t.get(p.id)).status).toBe('APPROVED');
    t.chain.waitMode = 'auto';
    expect((await t.proc.process(p.id)).status).toBe('MINTED');
    expect(t.chain.minted).toHaveLength(1);
  });

  it('MintRejectedError PaymentRefAlreadyUsed recovers signature via findMintTx', async () => {
    const t = await setup();
    const p = await t.paid();
    t.chain.receipts.set(t.refOf(p), { signature: 'sig_prev', slot: 77n });
    t.chain.usedOverride.push(false); // receipt appeared between the check and the send
    await t.proc.signal(p.id, 'webhook');
    const r = await t.get(p.id);
    expect(r.status).toBe('MINTED');
    expect(r.txSignature).toBe('sig_prev');
    expect(r.slot).toBe(77n);
    expect(t.chain.minted).toHaveLength(0);
  });

  it('paused program keeps APPROVED with lastError token_paused', async () => {
    const t = await setup();
    const p = await t.paid();
    t.chain.sendQueue.push(new MintRejectedError('Paused'));
    await t.proc.signal(p.id, 'webhook');
    const r = await t.get(p.id);
    expect(r.status).toBe('APPROVED');
    expect(r.lastError).toBe('token_paused');
    expect((await t.proc.process(p.id)).status).toBe('MINTED');
  });

  it('insufficient SOL (TransientChainError) keeps APPROVED with lastError', async () => {
    const t = await setup();
    const p = await t.paid();
    t.chain.sendQueue.push(new TransientChainError('chain transaction error: InsufficientFundsForRent'));
    await t.proc.signal(p.id, 'webhook');
    const r = await t.get(p.id);
    expect(r.status).toBe('APPROVED');
    expect(r.lastError).toBe('chain_transient:InsufficientFundsForRent');
    expect(r.failureReason).toBeNull();
  });

  it('double simulate / double reprocess / concurrent signal+process → sendMint called once', async () => {
    const t = await setup();
    t.chain.delayMs = 5;
    const s = await t.proc.createRecharge({ userId: t.user.id, amountCents: 1100n, provider: 'simulated' });
    await Promise.all([t.proc.simulate(s.id), t.proc.simulate(s.id)]);
    expect((await t.get(s.id)).status).toBe('MINTED');
    expect(t.chain.sendMintCalls).toBe(1);
    await Promise.all([t.proc.reprocess(s.id), t.proc.reprocess(s.id)]);
    expect(t.chain.sendMintCalls).toBe(1);

    const p = await t.paid();
    // A repeated process for the same id while one is pending joins the same promise.
    const a = t.proc.process(p.id);
    expect(t.proc.process(p.id)).toBe(a);
    await a;
    await Promise.all([
      t.proc.signal(p.id, 'webhook'),
      t.proc.process(p.id),
      t.proc.signal(p.id, 'operator'),
      t.proc.process(p.id),
      t.proc.reprocess(p.id),
      t.proc.signal(p.id, 'reconciler'),
    ]);
    expect((await t.get(p.id)).status).toBe('MINTED');
    expect(t.chain.sendMintCalls).toBe(2);
    expect(t.chain.minted).toHaveLength(2);

    // Race at APPROVED: only serialization prevents two sendMint calls (guarded transitions alone would not).
    const q = await t.paid();
    t.chain.sendQueue.push(new TransientChainError('chain operation failed (getLatestBlockhash): rpc_timeout'));
    await t.proc.signal(q.id, 'webhook');
    expect((await t.get(q.id)).status).toBe('APPROVED');
    const calls = t.chain.sendMintCalls;
    t.chain.delayMs = 20;
    await Promise.all([
      t.proc.reprocess(q.id),
      t.proc.reprocess(q.id),
      t.proc.process(q.id),
      t.proc.signal(q.id, 'operator'),
      t.proc.signal(q.id, 'reconciler'),
    ]);
    expect((await t.get(q.id)).status).toBe('MINTED');
    expect(t.chain.sendMintCalls).toBe(calls + 1);
  });

  it('createRecharge rejects amount outside limits with RechargeLimitError', async () => {
    const t = await setup();
    await expect(
      t.proc.createRecharge({ userId: t.user.id, amountCents: 1099n, provider: 'simulated' }),
    ).rejects.toBeInstanceOf(RechargeLimitError);
    await expect(t.recharge(2000001n)).rejects.toBeInstanceOf(RechargeLimitError);
    await expect(
      t.proc.createRecharge({ userId: '00000000-0000-4000-8000-000000000000', amountCents: 2500n, provider: 'ozav' }),
    ).rejects.toBeInstanceOf(UnknownUserError);
    await expect(
      t.proc.createRecharge({ userId: t.user.id, amountCents: 2500n, provider: 'mercadopago' }),
    ).rejects.toBeInstanceOf(ProviderNotEnabledError);
    expect(await t.payments.listAll()).toHaveLength(0);
    expect(t.ozav.createChargeCalls).toHaveLength(0);
  });

  it('createRecharge stores the charge and stays AWAITING_PAYMENT', async () => {
    const t = await setup();
    const p = await t.recharge(2500n);
    expect(p.status).toBe('AWAITING_PAYMENT');
    expect(p.providerPaymentId).toBe('tr_1');
    expect(p.pixBrCode).toBe('BRCODE');
    expect(p.providerEnv).toBe('sandbox');
    expect(t.ozav.createChargeCalls).toEqual([p.id]);
  });

  it('createRecharge on OZAV unavailable recovers existing transfer by metadata', async () => {
    const t = await setup();
    t.ozav.createChargeError = new ProviderUnavailableError('OZAV transfer returned HTTP 504');
    t.ozav.chargeLandedDespiteError = true;
    const p = await t.recharge(2500n);
    expect(p.status).toBe('AWAITING_PAYMENT');
    expect(p.providerPaymentId).toBe('tr_1');
    expect(t.ozav.createChargeCalls).toHaveLength(1); // never re-POSTs
  });

  it('createRecharge with no transfer found → FAILED charge_creation_failed and error propagates', async () => {
    const t = await setup();
    const err = new ProviderUnavailableError('OZAV transfer returned HTTP 504');
    t.ozav.createChargeError = err;
    await expect(t.recharge(2500n)).rejects.toBe(err);
    const [p] = await t.payments.listAll();
    expect(p!.status).toBe('FAILED');
    expect(p!.failureReason).toBe('charge_creation_failed');
    expect(t.ozav.createChargeCalls).toHaveLength(1);
  });

  describe('Ruling R7', () => {
    it('(a) landed tx failed with UnknownProgramError but receipt exists → MINTED via findMintTx', async () => {
      const t = await setup();
      const p = await t.paid();
      t.chain.receipts.set(t.refOf(p), { signature: 'sig_first', slot: 10n });
      t.chain.usedOverride.push(false);
      t.chain.sendQueue.push('land-failed');
      await t.proc.signal(p.id, 'webhook');
      const r = await t.get(p.id);
      expect(r.status).toBe('MINTED');
      expect(r.txSignature).toBe('sig_first');
      expect(r.slot).toBe(10n);
    });

    it('(a) MintRejectedError UnknownProgramError with receipt present → MINTED, not counted', async () => {
      const t = await setup();
      const p = await t.paid();
      t.chain.receipts.set(t.refOf(p), { signature: 'sig_first', slot: 10n });
      t.chain.usedOverride.push(false);
      t.chain.sendQueue.push(new MintRejectedError('UnknownProgramError'));
      await t.proc.signal(p.id, 'webhook');
      const r = await t.get(p.id);
      expect(r.status).toBe('MINTED');
      expect(r.txSignature).toBe('sig_first');
      expect(r.attempts).toBe(0);
    });

    it('(a) MINT_PENDING resume: failed status but receipt exists → MINTED; failed without receipt → APPROVED attempts+1', async () => {
      const t = await setup();
      const p = await t.paid();
      t.chain.sendQueue.push('drop');
      t.chain.waitMode = 'timeout';
      await t.proc.signal(p.id, 'webhook');
      const pending = await t.get(p.id);
      expect(pending.status).toBe('MINT_PENDING');
      t.chain.txs.set(pending.txSignature!, { status: 'failed', slot: 9n, reason: 'UnknownProgramError' });
      t.chain.receipts.set(t.refOf(p), { signature: 'sig_other', slot: 11n });
      const r = await t.proc.process(p.id);
      expect(r.status).toBe('MINTED');
      expect(r.txSignature).toBe('sig_other');

      const q = await t.paid();
      t.chain.sendQueue.push('drop');
      await t.proc.signal(q.id, 'webhook');
      const qp = await t.get(q.id);
      t.chain.txs.set(qp.txSignature!, { status: 'failed', slot: 12n, reason: 'CapExceeded' });
      const back = await t.proc.process(q.id);
      expect(back.status).toBe('APPROVED');
      expect(back.attempts).toBe(1);
      expect(back.lastError).toBe('mint_tx_failed:CapExceeded');
    });

    it('(a) waitForConfirmation failed without receipt → APPROVED (not FAILED)', async () => {
      const t = await setup();
      const p = await t.paid();
      t.chain.sendQueue.push('drop');
      t.chain.waitMode = 'failed';
      await t.proc.signal(p.id, 'webhook');
      const r = await t.get(p.id);
      expect(r.status).toBe('APPROVED');
      expect(r.attempts).toBe(1);
      expect(r.failureReason).toBeNull();
    });

    it('(a)/(c) other MintRejectedError reasons fail only after MAX_MINT_ATTEMPTS', async () => {
      const t = await setup();
      const p = await t.paid();
      t.chain.sendQueue.push(
        new MintRejectedError('CapExceeded'),
        new MintRejectedError('CapExceeded'),
        new MintRejectedError('CapExceeded'),
      );
      await t.proc.signal(p.id, 'webhook');
      let r = await t.get(p.id);
      expect(r.status).toBe('APPROVED');
      expect(r.attempts).toBe(1);
      expect(r.lastError).toBe('mint_rejected:CapExceeded');
      r = await t.proc.process(p.id);
      expect(r.status).toBe('APPROVED');
      r = await t.proc.process(p.id);
      expect(r.status).toBe('FAILED');
      expect(r.failureReason).toBe('mint_rejected:CapExceeded');
      expect(r.attempts).toBe(3);
    });

    it('(b) receipt exists but findMintTx returns null → stays, lastError mint_tx_not_found_yet, no MINTED without signature', async () => {
      const t = await setup();
      const p = await t.paid();
      t.chain.sendQueue.push('land-then-throw');
      t.chain.hideMintTx = true;
      await t.proc.signal(p.id, 'webhook');
      let r = await t.proc.process(p.id);
      expect(r.status).toBe('APPROVED');
      expect(r.lastError).toBe('mint_tx_not_found_yet');
      expect(r.txSignature).toBeNull();
      t.chain.hideMintTx = false;
      r = await t.proc.process(p.id);
      expect(r.status).toBe('MINTED');
      expect(r.txSignature).toBe(t.chain.receipts.get(t.refOf(p))!.signature);
      expect(t.chain.sendMintCalls).toBe(1);
    });

    it('(c) transient chain errors and provider outages never lead to FAILED', async () => {
      const t = await setup();
      const p = await t.paid();
      for (let i = 0; i < 6; i++) t.chain.sendQueue.push(new TransientChainError('chain operation failed (getLatestBlockhash): rpc_timeout'));
      await t.proc.signal(p.id, 'webhook');
      for (let i = 0; i < 5; i++) await t.proc.process(p.id);
      let r = await t.get(p.id);
      expect(r.status).toBe('APPROVED');
      expect(r.attempts).toBe(6);
      expect(r.lastError).toBe('chain_transient:rpc_timeout');

      const q = await t.paid();
      for (let i = 0; i < 6; i++) t.ozav.fetchErrors.push(new ProviderUnavailableError('OZAV transfer lookup failed (timeout)'));
      await t.proc.signal(q.id, 'webhook');
      for (let i = 0; i < 5; i++) await t.proc.process(q.id);
      r = await t.get(q.id);
      expect(r.status).toBe('VALIDATING');
      expect(r.attempts).toBe(6);
      expect(r.failureReason).toBeNull();
    });

    it('(d) never logs or stores raw chain/provider error messages or causes', async () => {
      const t = await setup();
      const secret = 'https://secret-rpc.example/?api-key=SECRET123';
      const p = await t.paid();
      t.ozav.fetchErrors.push(new ProviderUnavailableError(`provider down ${secret}`));
      t.chain.sendQueue.push(new TransientChainError(`rpc down ${secret}`, { cause: new Error(secret) }));
      await t.proc.signal(p.id, 'webhook');
      await t.proc.process(p.id);
      const r = await t.get(p.id);
      expect(r.status).toBe('APPROVED');
      expect(r.lastError).toBe('chain_transient');
      const dump = JSON.stringify(t.logs, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
      expect(dump).not.toContain('SECRET123');
      expect(dump).toContain('TransientChainError');
      const { rows } = await t.db.query<{ detail: unknown }>('select detail from payment_events where payment_id = $1', [p.id]);
      expect(JSON.stringify(rows)).not.toContain('SECRET123');
    });
  });
});
