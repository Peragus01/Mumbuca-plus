import { randomUUID } from 'node:crypto';
import type { Db } from '../db/db.js';
import type { CreatedVia, Payment, PaymentStatus, ProviderEnv, ProviderName } from '../domain/payment.js';

export type PaymentPatch = Partial<
  Pick<
    Payment,
    | 'receivedAmountCents'
    | 'paymentRef'
    | 'mintAmountUnits'
    | 'txSignature'
    | 'slot'
    | 'lastValidBlockHeight'
    | 'needsReview'
    | 'amountMismatch'
    | 'failureReason'
    | 'lastError'
    | 'attempts'
    | 'mintRejections'
  >
>;

interface PaymentRow {
  id: string;
  user_id: string;
  provider: ProviderName;
  provider_env: ProviderEnv;
  provider_payment_id: string | null;
  requested_amount_cents: string | number | bigint;
  received_amount_cents: string | number | bigint | null;
  status: PaymentStatus;
  pix_br_code: string | null;
  pix_expires_at: Date | null;
  payment_ref: string | null;
  mint_amount_units: string | null;
  tx_signature: string | null;
  slot: string | number | bigint | null;
  last_valid_block_height: string | number | bigint | null;
  needs_review: boolean;
  amount_mismatch: boolean;
  failure_reason: string | null;
  last_error: string | null;
  attempts: string | number | bigint;
  mint_rejections: string | number | bigint;
  created_via: CreatedVia;
  created_at: Date;
  updated_at: Date;
}

const big = (v: string | number | bigint | null): bigint | null => (v === null || v === undefined ? null : BigInt(v));

function mapPayment(r: PaymentRow): Payment {
  return {
    id: r.id,
    userId: r.user_id,
    provider: r.provider,
    providerEnv: r.provider_env,
    providerPaymentId: r.provider_payment_id,
    requestedAmountCents: BigInt(r.requested_amount_cents),
    receivedAmountCents: big(r.received_amount_cents),
    status: r.status,
    pixBrCode: r.pix_br_code,
    pixExpiresAt: r.pix_expires_at,
    paymentRef: r.payment_ref,
    mintAmountUnits: r.mint_amount_units,
    txSignature: r.tx_signature,
    slot: big(r.slot),
    lastValidBlockHeight: big(r.last_valid_block_height),
    needsReview: r.needs_review,
    amountMismatch: r.amount_mismatch,
    failureReason: r.failure_reason,
    lastError: r.last_error,
    attempts: Number(r.attempts),
    mintRejections: Number(r.mint_rejections),
    createdVia: r.created_via,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
  };
}

const PATCH_COLUMNS: Record<keyof PaymentPatch, string> = {
  receivedAmountCents: 'received_amount_cents',
  paymentRef: 'payment_ref',
  mintAmountUnits: 'mint_amount_units',
  txSignature: 'tx_signature',
  slot: 'slot',
  lastValidBlockHeight: 'last_valid_block_height',
  needsReview: 'needs_review',
  amountMismatch: 'amount_mismatch',
  failureReason: 'failure_reason',
  lastError: 'last_error',
  attempts: 'attempts',
  mintRejections: 'mint_rejections',
};

/** Builds "col = $n" fragments (starting at $start) and the matching params; bigint -> string for node-pg. */
function buildPatch(patch: PaymentPatch | undefined, start: number): { sets: string[]; params: unknown[] } {
  const sets: string[] = [];
  const params: unknown[] = [];
  for (const key of Object.keys(PATCH_COLUMNS) as (keyof PaymentPatch)[]) {
    const value = patch?.[key];
    if (value === undefined) continue;
    params.push(typeof value === 'bigint' ? value.toString() : value);
    sets.push(`${PATCH_COLUMNS[key]} = $${start + params.length - 1}`);
  }
  return { sets, params };
}

const OPEN_SQL = `(status in ('RECEIVED','VALIDATING','APPROVED','MINT_PENDING')
  or (status = 'AWAITING_PAYMENT' and provider_payment_id is not null))`;

export class PaymentRepository {
  constructor(private readonly db: Db) {}

  async create(input: {
    userId: string;
    provider: ProviderName;
    providerEnv: ProviderEnv;
    requestedAmountCents: bigint;
    createdVia?: CreatedVia;
  }): Promise<Payment> {
    const { rows } = await this.db.query<PaymentRow>(
      `insert into payments (id, user_id, provider, provider_env, requested_amount_cents, status, created_via)
       values ($1, $2, $3, $4, $5, 'AWAITING_PAYMENT', $6) returning *`,
      [
        randomUUID(),
        input.userId,
        input.provider,
        input.providerEnv,
        input.requestedAmountCents.toString(),
        input.createdVia ?? 'operator',
      ],
    );
    return mapPayment(rows[0]!);
  }

  async attachCharge(
    id: string,
    charge: { providerPaymentId: string; pixBrCode: string | null; pixExpiresAt: Date | null },
  ): Promise<Payment> {
    const { rows } = await this.db.query<PaymentRow>(
      `update payments set provider_payment_id = $2, pix_br_code = $3, pix_expires_at = $4, updated_at = now()
       where id = $1 returning *`,
      [id, charge.providerPaymentId, charge.pixBrCode, charge.pixExpiresAt],
    );
    if (!rows[0]) throw new Error(`Payment not found: ${id}`);
    return mapPayment(rows[0]);
  }

  async findById(id: string): Promise<Payment | null> {
    const { rows } = await this.db.query<PaymentRow>('select * from payments where id = $1', [id]);
    return rows[0] ? mapPayment(rows[0]) : null;
  }

  async findByProviderPaymentId(provider: ProviderName, providerPaymentId: string): Promise<Payment | null> {
    const { rows } = await this.db.query<PaymentRow>(
      'select * from payments where provider = $1 and provider_payment_id = $2',
      [provider, providerPaymentId],
    );
    return rows[0] ? mapPayment(rows[0]) : null;
  }

  async listByUser(userId: string): Promise<Payment[]> {
    const { rows } = await this.db.query<PaymentRow>(
      'select * from payments where user_id = $1 order by created_at desc, id',
      [userId],
    );
    return rows.map(mapPayment);
  }

  async listAll(): Promise<Payment[]> {
    const { rows } = await this.db.query<PaymentRow>('select * from payments order by created_at desc, id', []);
    return rows.map(mapPayment);
  }

  async listOpen(): Promise<Payment[]> {
    const { rows } = await this.db.query<PaymentRow>(
      `select * from payments where ${OPEN_SQL} order by created_at desc, id`,
      [],
    );
    return rows.map(mapPayment);
  }

  /**
   * Visitor purchase total since `since`. Excludes FAILED and AWAITING_PAYMENT older than
   * `staleBefore` (abandoned charges), and anything not created by a visitor.
   */
  async visitorTotals(since: Date, staleBefore: Date): Promise<{ cents: bigint }> {
    const { rows } = await this.db.query<{ cents: string | number | bigint }>(
      `select coalesce(sum(requested_amount_cents), 0) as cents from payments
       where created_via = 'visitor' and created_at >= $1 and status <> 'FAILED'
         and not (status = 'AWAITING_PAYMENT' and created_at < $2)`,
      [since, staleBefore],
    );
    return { cents: BigInt(rows[0]?.cents ?? 0) };
  }

  /** Same filter as visitorTotals, for one wallet; `openAwaiting` = recent AWAITING_PAYMENT. */
  async visitorUserStats(
    userId: string,
    since: Date,
    staleBefore: Date,
  ): Promise<{ count: number; openAwaiting: number }> {
    const { rows } = await this.db.query<{ count: string | number | bigint; open_awaiting: string | number | bigint }>(
      `select count(*) as count,
              count(*) filter (where status = 'AWAITING_PAYMENT' and created_at >= $3) as open_awaiting
       from payments
       where created_via = 'visitor' and user_id = $1 and created_at >= $2 and status <> 'FAILED'
         and not (status = 'AWAITING_PAYMENT' and created_at < $3)`,
      [userId, since, staleBefore],
    );
    return { count: Number(rows[0]?.count ?? 0), openAwaiting: Number(rows[0]?.open_awaiting ?? 0) };
  }

  /**
   * Atomic guarded transition (single statement). The row is locked with FOR UPDATE and
   * re-checked against `from`, so of N concurrent callers exactly one gets the payment back;
   * the rest get null and write no event.
   */
  async transition(
    id: string,
    from: PaymentStatus[],
    to: PaymentStatus,
    patch?: PaymentPatch,
    detail?: object,
  ): Promise<Payment | null> {
    const { sets, params } = buildPatch(patch, 5);
    const setSql = ['status = $3', 'updated_at = now()', ...sets].join(', ');
    const { rows } = await this.db.query<PaymentRow>(
      `with old as (
         select id, status from payments where id = $1 and status = any($2::text[]) for update
       ), upd as (
         update payments p set ${setSql} from old where p.id = old.id
         returning p.*, old.status as prev_status
       ), ev as (
         insert into payment_events (payment_id, kind, from_status, to_status, detail)
         select id, 'transition', prev_status, status, $4::jsonb from upd
       )
       select * from upd`,
      [id, from, to, detail === undefined ? null : JSON.stringify(detail), ...params],
    );
    return rows[0] ? mapPayment(rows[0]) : null;
  }

  /** Updates non-state fields and records a 'note' event. */
  async patch(id: string, patch: PaymentPatch): Promise<Payment> {
    const { sets, params } = buildPatch(patch, 3);
    const setSql = ['updated_at = now()', ...sets].join(', ');
    const detail = JSON.stringify(patch, (_k, v) => (typeof v === 'bigint' ? v.toString() : v));
    const { rows } = await this.db.query<PaymentRow>(
      `with upd as (
         update payments set ${setSql} where id = $1 returning *
       ), ev as (
         insert into payment_events (payment_id, kind, detail) select id, 'note', $2::jsonb from upd
       )
       select * from upd`,
      [id, detail, ...params],
    );
    if (!rows[0]) throw new Error(`Payment not found: ${id}`);
    return mapPayment(rows[0]);
  }

  /** Idempotent provider-event log. Returns false if provider_event_id was already recorded. */
  async recordProviderEvent(input: {
    paymentId: string | null;
    providerEventId: string;
    detail: object;
  }): Promise<boolean> {
    const { rows } = await this.db.query<{ id: string }>(
      `insert into payment_events (payment_id, kind, provider_event_id, detail)
       values ($1, 'provider_event', $2, $3::jsonb)
       on conflict (provider_event_id) where provider_event_id is not null do nothing
       returning id`,
      [input.paymentId, input.providerEventId, JSON.stringify(input.detail)],
    );
    return rows.length > 0;
  }
}
