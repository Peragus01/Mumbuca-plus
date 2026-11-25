import { checkProgramConfig, expectedProgramConfig } from '../chain/config-check.js';
import type { TokenGateway } from '../chain/token-gateway.js';
import type { Env } from '../config/env.js';
import { rechargeLimits } from '../domain/payment.js';
import type { PaymentRepository } from '../repositories/payment-repository.js';

export type PolicyResult =
  | { ok: true }
  | {
      ok: false;
      error: 'amount_out_of_range' | 'purchases_closed' | 'daily_limit' | 'open_payment';
      minCents?: bigint;
      maxCents?: bigint;
    };

export interface VisitorPolicy {
  checkCreate(userId: string, amountCents: bigint): Promise<PolicyResult>;
  /** Chain / sign-in gate only (the daily cap was already enforced when the charge was created). */
  checkPay(): Promise<PolicyResult>;
  purchasesOpen(): Promise<boolean>;
}

const DAY_MS = 24 * 60 * 60 * 1000;
/** An AWAITING_PAYMENT older than this is abandoned: it neither blocks a new purchase nor counts. */
const STALE_MS = 30 * 60 * 1000;
const CHAIN_CACHE_MS = 30_000;
const OK: PolicyResult = { ok: true };
const CLOSED: PolicyResult = { ok: false, error: 'purchases_closed' };

export function createVisitorPolicy(deps: {
  env: Env;
  payments: PaymentRepository;
  token: TokenGateway;
  now?: () => number;
}): VisitorPolicy {
  const { env, payments, token } = deps;
  const now = deps.now ?? Date.now;
  const expected = expectedProgramConfig(env);
  const limits = rechargeLimits('simulated', env);
  const minCents = limits.minCents > env.VISITOR_MIN_CENTS ? limits.minCents : env.VISITOR_MIN_CENTS;
  const maxCents = limits.maxCents < env.VISITOR_MAX_CENTS ? limits.maxCents : env.VISITOR_MAX_CENTS;

  let chain: { open: boolean; at: number } | null = null;
  async function chainOpen(): Promise<boolean> {
    if (chain && now() - chain.at < CHAIN_CACHE_MS) return chain.open;
    let open: boolean;
    try {
      const [{ paused, configIssues }, lamports] = await Promise.all([
        checkProgramConfig(token, expected),
        token.minterNativeBalance(),
      ]);
      open = !paused && configIssues.length === 0 && lamports >= env.LOW_SOL_THRESHOLD_LAMPORTS;
    } catch {
      open = false;
    }
    chain = { open, at: now() };
    return open;
  }

  const windows = () => {
    const t = now();
    return { since: new Date(t - DAY_MS), staleBefore: new Date(t - STALE_MS) };
  };

  async function gate(): Promise<boolean> {
    return env.VISITOR_SIGNIN_ENABLED && (await chainOpen());
  }

  return {
    async checkCreate(userId, amountCents) {
      if (amountCents < minCents || amountCents > maxCents) {
        return { ok: false, error: 'amount_out_of_range', minCents, maxCents };
      }
      if (!(await gate())) return CLOSED;
      const { since, staleBefore } = windows();
      const stats = await payments.visitorUserStats(userId, since, staleBefore);
      if (stats.openAwaiting > 0) return { ok: false, error: 'open_payment' };
      if (stats.count >= env.VISITOR_MAX_PURCHASES_PER_DAY) return { ok: false, error: 'daily_limit' };
      const { cents } = await payments.visitorTotals(since, staleBefore);
      if (cents + amountCents > env.VISITOR_DAILY_CAP_CENTS) return { ok: false, error: 'daily_limit' };
      return OK;
    },
    async checkPay() {
      return (await gate()) ? OK : CLOSED;
    },
    async purchasesOpen() {
      if (!(await gate())) return false;
      const { since, staleBefore } = windows();
      const { cents } = await payments.visitorTotals(since, staleBefore);
      return cents < env.VISITOR_DAILY_CAP_CENTS;
    },
  };
}
