import type { Env } from '../config/env.js';
import { centsToUnits, paymentRefFor } from '../domain/money.js';
import { rechargeLimits, type Payment, type PaymentStatus, type ProviderName } from '../domain/payment.js';
import { parseSolanaAddress } from '../domain/solana-address.js';
import { MintRejectedError, TransientChainError, type TokenGateway, type TxOutcome } from '../chain/token-gateway.js';
import { ProviderUnavailableError, type ProviderRegistry } from '../providers/payment-provider.js';
import type { PaymentPatch, PaymentRepository } from '../repositories/payment-repository.js';
import type { UserRepository } from '../repositories/user-repository.js';

/** Minimal pino-compatible logger (Fastify's logger fits). */
export interface ProcessorLog {
  info(obj: object, msg?: string): void;
  warn(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

export interface PaymentProcessorDeps {
  payments: PaymentRepository;
  users: UserRepository;
  providers: ProviderRegistry;
  token: TokenGateway;
  env: Env;
  log: ProcessorLog;
}

export type SignalSource = 'webhook' | 'reconciler' | 'operator';

export interface PaymentProcessor {
  createRecharge(input: { userId: string; amountCents: bigint; provider: ProviderName }): Promise<Payment>;
  signal(paymentId: string, source: SignalSource): Promise<void>;
  /** Advances the payment as far as possible; serialized process-wide. */
  process(paymentId: string): Promise<Payment>;
  /** provider.simulatePayment + signal. */
  simulate(paymentId: string): Promise<Payment>;
  /** Operator: clears lastError and processes. */
  reprocess(paymentId: string): Promise<Payment>;
}

export class RechargeLimitError extends Error {
  override name = 'RechargeLimitError';
  constructor(
    readonly minCents: bigint,
    readonly maxCents: bigint,
  ) {
    super(`Recharge amount must be between ${minCents} and ${maxCents} cents`);
  }
}

export class UnknownUserError extends Error {
  override name = 'UnknownUserError';
  constructor(readonly userId: string) {
    super('Unknown user');
  }
}

export class ProviderNotEnabledError extends Error {
  override name = 'ProviderNotEnabledError';
  constructor(readonly provider: string) {
    super(`Payment provider not enabled: ${provider}`);
  }
}

type Ref = `0x${string}`;
type Step = 'continue' | 'stop';

/** Upper bound on state steps per run (the happy path needs 4). */
const MAX_STEPS = 12;
const OPEN: readonly PaymentStatus[] = ['AWAITING_PAYMENT', 'RECEIVED', 'VALIDATING', 'APPROVED', 'MINT_PENDING'];

/**
 * Stable code for an error: class + reason/code only. Chain/provider messages and causes may
 * embed the RPC URL (with key) and are never logged or stored.
 */
function errorCode(e: unknown): string {
  if (e instanceof MintRejectedError) return `mint_rejected:${e.reason}`;
  if (e instanceof TransientChainError) {
    const m = /:\s*(\w{1,64})$/.exec(e.message);
    return m ? `chain_transient:${m[1]}` : 'chain_transient';
  }
  if (e instanceof ProviderUnavailableError) return 'provider_unavailable';
  const name = e instanceof Error && /^\w{1,64}$/.test(e.name) ? e.name : 'Error';
  return `unexpected:${name}`;
}

function errorClass(e: unknown): string {
  return e instanceof Error && /^\w{1,64}$/.test(e.name) ? e.name : 'Error';
}

function safeToken(r: string | undefined): string {
  return r && /^\w{1,64}$/.test(r) ? r : 'unknown';
}

export function createPaymentProcessor(deps: PaymentProcessorDeps): PaymentProcessor {
  const { payments, users, providers, token, env, log } = deps;

  // ---- serialization: one job at a time process-wide; repeated process(id) joins ----
  let tail: Promise<unknown> = Promise.resolve();
  const inflight = new Map<string, Promise<Payment>>();

  function enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = tail.then(job);
    tail = run.catch(() => undefined);
    return run;
  }

  async function mustFind(id: string): Promise<Payment> {
    const p = await payments.findById(id);
    if (!p) throw new Error('Payment not found');
    return p;
  }

  async function walletOf(userId: string): Promise<string | null> {
    const user = await users.findById(userId);
    return user ? parseSolanaAddress(user.walletAddress) : null;
  }

  async function move(p: Payment, to: PaymentStatus, patch?: PaymentPatch, detail?: object): Promise<Payment | null> {
    const r = await payments.transition(p.id, [p.status], to, patch, detail);
    if (r) log.info({ paymentId: p.id, from: p.status, to }, 'payment transition');
    else log.warn({ paymentId: p.id, from: p.status, to }, 'payment transition skipped: state changed');
    return r;
  }

  async function fail(p: Payment, failureReason: string, patch: PaymentPatch = {}): Promise<Step> {
    await move(p, 'FAILED', { ...patch, failureReason }, { failureReason });
    return 'stop';
  }

  /** Transient problem: stay in the current state, bump attempts, record the code. Never FAILED. */
  async function bump(p: Payment, e: unknown): Promise<Step> {
    const code = errorCode(e);
    log.warn({ paymentId: p.id, status: p.status, error: errorClass(e), code }, 'payment step failed; will retry');
    await payments.patch(p.id, { lastError: code, attempts: p.attempts + 1 });
    return 'stop';
  }

  // ---- VALIDATING ----
  async function validate(p: Payment): Promise<Step> {
    const provider = providers[p.provider];
    if (!provider) {
      await payments.patch(p.id, { lastError: 'provider_not_enabled' });
      return 'stop';
    }
    if (!p.providerPaymentId) {
      await payments.patch(p.id, { lastError: 'no_provider_payment_id' });
      return 'stop';
    }
    let st;
    try {
      st = await provider.fetchPayment(p.providerPaymentId);
    } catch (e) {
      return bump(p, e);
    }
    switch (st.kind) {
      case 'pending':
        await move(p, 'AWAITING_PAYMENT', { lastError: null });
        return 'stop';
      case 'rejected':
        return fail(p, `provider_rejected:${st.reason}`);
      case 'expired':
        return fail(p, 'pix_expired');
      case 'review':
        log.warn({ paymentId: p.id }, 'payment needs review');
        await payments.patch(p.id, { needsReview: true, lastError: st.reason });
        return 'stop';
      case 'approved': {
        const received = st.receivedAmountCents;
        if (st.metadataPaymentId !== null && st.metadataPaymentId !== p.id) return fail(p, 'metadata_mismatch');
        if (received < rechargeLimits(p.provider, env).minCents) {
          return fail(p, 'amount_below_minimum', { receivedAmountCents: received });
        }
        if ((await walletOf(p.userId)) === null) return fail(p, 'wallet_not_found', { receivedAmountCents: received });
        const amountMismatch = received !== p.requestedAmountCents;
        if (amountMismatch) log.warn({ paymentId: p.id }, 'received amount differs from requested');
        const ok = await move(p, 'APPROVED', {
          receivedAmountCents: received,
          amountMismatch,
          paymentRef: paymentRefFor(p.provider, p.providerPaymentId),
          mintAmountUnits: centsToUnits(received).toString(),
          lastError: null,
        });
        return ok ? 'continue' : 'stop';
      }
    }
  }

  // ---- mint helpers ----
  /** The receipt PDA exists: record the original mint tx. Never MINTED without a signature. */
  async function recover(p: Payment, ref: Ref): Promise<Step> {
    const tx = await token.findMintTx(ref);
    if (!tx) {
      log.warn({ paymentId: p.id, status: p.status }, 'receipt exists but mint tx not found yet');
      await payments.patch(p.id, { lastError: 'mint_tx_not_found_yet' });
      return 'stop';
    }
    await move(p, 'MINTED', { txSignature: tx.signature, slot: tx.slot, lastError: null }, { recovered: true });
    return 'stop';
  }

  /** Back to APPROVED (resend is safe), unless the receipt shows the mint landed. */
  async function backToApproved(p: Payment, ref: Ref, lastError: string, countAttempt: boolean): Promise<Step> {
    if (await token.isPaymentRefUsed(ref)) return recover(p, ref);
    await move(p, 'APPROVED', countAttempt ? { lastError, attempts: p.attempts + 1 } : { lastError });
    return 'stop';
  }

  async function settle(p: Payment, ref: Ref, out: TxOutcome | 'expired' | null): Promise<Step> {
    if (out === null) return 'stop';
    if (out === 'expired') return backToApproved(p, ref, 'blockhash_expired', false);
    if (out.status === 'confirmed') {
      await move(p, 'MINTED', { slot: out.slot, lastError: null });
      return 'stop';
    }
    return backToApproved(p, ref, `mint_tx_failed:${safeToken(out.reason)}`, true);
  }

  async function onMintError(id: string, ref: Ref, e: unknown): Promise<Step> {
    const p = await mustFind(id);
    try {
      if (e instanceof MintRejectedError) {
        if (e.reason === 'PaymentRefAlreadyUsed') return await recover(p, ref);
        if (e.reason === 'Paused') {
          log.warn({ paymentId: p.id, error: 'MintRejectedError', reason: e.reason }, 'token paused; will retry');
          await payments.patch(p.id, { lastError: 'token_paused' });
          return 'stop';
        }
        // A rejection may still hide a duplicate: the receipt is the source of truth.
        if (await token.isPaymentRefUsed(ref)) return await recover(p, ref);
        // Counted apart from `attempts` (transient streak), so an outage never brings a paid payment closer to FAILED.
        const mintRejections = p.mintRejections + 1;
        const code = errorCode(e);
        log.warn({ paymentId: p.id, error: 'MintRejectedError', reason: e.reason, mintRejections }, 'mint rejected');
        if (mintRejections >= env.MAX_MINT_ATTEMPTS) return await fail(p, code, { mintRejections, lastError: code });
        await payments.patch(p.id, { mintRejections, lastError: code });
        return 'stop';
      }
      return await bump(p, e);
    } catch (inner) {
      return bump(p, inner);
    }
  }

  // ---- APPROVED ----
  async function mint(p: Payment): Promise<Step> {
    if (!p.paymentRef || p.mintAmountUnits === null) {
      await payments.patch(p.id, { lastError: 'missing_mint_data' });
      return 'stop';
    }
    const ref = p.paymentRef as Ref;
    try {
      if (await token.isPaymentRefUsed(ref)) return await recover(p, ref);
      const wallet = await walletOf(p.userId);
      if (!wallet) return await fail(p, 'wallet_not_found');
      const sent = await token.sendMint(wallet, BigInt(p.mintAmountUnits), ref);
      const pending = await move(p, 'MINT_PENDING', {
        txSignature: sent.signature,
        lastValidBlockHeight: sent.lastValidBlockHeight,
        lastError: null,
      });
      if (!pending) return 'stop';
      const out = await token.waitForConfirmation(sent.signature, sent.lastValidBlockHeight, env.MINT_CONFIRM_TIMEOUT_MS);
      if (out === null) {
        await payments.patch(p.id, { lastError: 'confirmation_timeout' });
        return 'stop';
      }
      return await settle(pending, ref, out);
    } catch (e) {
      return onMintError(p.id, ref, e);
    }
  }

  // ---- MINT_PENDING (resume) ----
  async function resume(p: Payment): Promise<Step> {
    if (!p.paymentRef) {
      await payments.patch(p.id, { lastError: 'missing_mint_data' });
      return 'stop';
    }
    const ref = p.paymentRef as Ref;
    try {
      const st = p.txSignature ? await token.getSignatureStatus(p.txSignature) : null;
      if (st) return await settle(p, ref, st);
      if (await token.isPaymentRefUsed(ref)) return await recover(p, ref);
      if (p.lastValidBlockHeight === null || (await token.isBlockhashExpired(p.lastValidBlockHeight))) {
        await move(p, 'APPROVED', { lastError: 'blockhash_expired' });
      }
      return 'stop';
    } catch (e) {
      return onMintError(p.id, ref, e);
    }
  }

  async function step(p: Payment): Promise<Step> {
    switch (p.status) {
      case 'RECEIVED':
        return (await move(p, 'VALIDATING')) ? 'continue' : 'stop';
      case 'VALIDATING':
        return validate(p);
      case 'APPROVED':
        return mint(p);
      case 'MINT_PENDING':
        return resume(p);
      default:
        return 'stop'; // AWAITING_PAYMENT waits for a signal; MINTED/FAILED are terminal
    }
  }

  /** Must only run inside the queue. */
  async function advance(id: string): Promise<Payment> {
    for (let i = 0; i < MAX_STEPS; i++) {
      if ((await step(await mustFind(id))) === 'stop') break;
    }
    return mustFind(id);
  }

  function process(id: string): Promise<Payment> {
    const existing = inflight.get(id);
    if (existing) return existing;
    const run = enqueue(() => advance(id)).finally(() => {
      if (inflight.get(id) === run) inflight.delete(id);
    });
    inflight.set(id, run);
    return run;
  }

  async function signal(id: string, source: SignalSource): Promise<void> {
    // Runs as its own queued job (not joined) so the AWAITING → RECEIVED check and the advance
    // happen atomically with respect to any other processing.
    await enqueue(async () => {
      const p = await mustFind(id);
      if (p.status === 'AWAITING_PAYMENT') {
        if (!p.providerPaymentId) {
          log.warn({ paymentId: id, source }, 'signal ignored: payment has no provider charge');
          return;
        }
        if (source === 'reconciler') {
          const provider = providers[p.provider];
          if (!provider) return;
          try {
            const st = await provider.fetchPayment(p.providerPaymentId);
            if (st.kind === 'pending') return;
          } catch (e) {
            log.warn({ paymentId: id, error: errorClass(e), code: errorCode(e) }, 'reconciler fetch failed');
            return;
          }
        }
        await move(p, 'RECEIVED', undefined, { source });
      }
      await advance(id);
    });
  }

  return {
    async createRecharge({ userId, amountCents, provider: providerName }) {
      const user = await users.findById(userId);
      if (!user) throw new UnknownUserError(userId);
      const provider = providers[providerName];
      if (!provider) throw new ProviderNotEnabledError(providerName);
      const { minCents, maxCents } = rechargeLimits(providerName, env);
      if (amountCents < minCents || amountCents > maxCents) throw new RechargeLimitError(minCents, maxCents);

      const payment = await payments.create({
        userId,
        provider: providerName,
        providerEnv: provider.env,
        requestedAmountCents: amountCents,
      });

      let charge: { providerPaymentId: string; pixBrCode: string | null; pixExpiresAt: Date | null };
      try {
        const c = await provider.createCharge({ paymentId: payment.id, amountCents });
        charge = { providerPaymentId: c.providerPaymentId, pixBrCode: c.pixBrCode, pixExpiresAt: c.expiresAt };
      } catch (e) {
        let recovered: string | null = null;
        if (e instanceof ProviderUnavailableError && provider.findChargeByPaymentId) {
          // The POST may have landed: look it up by our payment id. Never re-POST with another id.
          try {
            recovered = await provider.findChargeByPaymentId(payment.id);
          } catch (inner) {
            log.warn({ paymentId: payment.id, error: errorClass(inner), code: errorCode(inner) }, 'charge recovery failed');
          }
        }
        if (!recovered) {
          log.warn({ paymentId: payment.id, error: errorClass(e), code: errorCode(e) }, 'charge creation failed');
          await move(payment, 'FAILED', { failureReason: 'charge_creation_failed', lastError: errorCode(e) });
          throw e;
        }
        log.info({ paymentId: payment.id }, 'charge recovered after uncertain create');
        charge = { providerPaymentId: recovered, pixBrCode: null, pixExpiresAt: null };
      }
      return payments.attachCharge(payment.id, charge);
    },

    signal,
    process,

    async simulate(id) {
      const p = await mustFind(id);
      const provider = providers[p.provider];
      if (!provider?.simulatePayment) throw new ProviderNotEnabledError(p.provider);
      if (!p.providerPaymentId) throw new Error('Payment has no provider charge');
      await provider.simulatePayment(p.providerPaymentId);
      await signal(id, 'operator');
      return mustFind(id);
    },

    reprocess(id) {
      return enqueue(async () => {
        const p = await mustFind(id);
        if (OPEN.includes(p.status) && p.lastError !== null) await payments.patch(id, { lastError: null });
        return advance(id);
      });
    },
  };
}
