import { MintRejectedError, TransientChainError, type TokenGateway, type TxOutcome } from '../../src/chain/token-gateway.js';
import type { PaymentProvider, ProviderPaymentState } from '../../src/providers/payment-provider.js';

export type Ref = `0x${string}`;
export type SendBehavior = 'ok' | 'drop' | 'land-then-throw' | 'land-failed' | Error;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** In-memory stand-in for the on-chain program: receipts keyed by payment_ref, a block height, failure modes. */
export class FakeChain implements TokenGateway {
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
export class FakeProvider implements PaymentProvider {
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
