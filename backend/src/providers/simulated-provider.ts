import type { Db } from '../db/db.js';
import type { PaymentProvider, ProviderPaymentState } from './payment-provider.js';

export function createSimulatedProvider(db: Db): PaymentProvider {
  return {
    name: 'simulated',
    env: 'local',
    async createCharge({ paymentId, amountCents }) {
      const id = `sim_${paymentId}`;
      await db.query(
        `insert into simulated_charges(id, amount_cents, status) values ($1, $2, 'pending')
         on conflict (id) do nothing`,
        [id, amountCents.toString()],
      );
      return { providerPaymentId: id, pixBrCode: null, expiresAt: null };
    },
    async fetchPayment(providerPaymentId): Promise<ProviderPaymentState> {
      const { rows } = await db.query<{ amount_cents: string | number | bigint; status: string }>(
        'select amount_cents, status from simulated_charges where id = $1',
        [providerPaymentId],
      );
      const row = rows[0];
      if (!row) return { kind: 'review', reason: 'simulated charge not found' };
      if (row.status === 'approved') {
        return {
          kind: 'approved',
          receivedAmountCents: BigInt(row.amount_cents),
          truncated: false,
          metadataPaymentId: providerPaymentId.startsWith('sim_') ? providerPaymentId.slice(4) : null,
        };
      }
      return { kind: 'pending' };
    },
    async simulatePayment(providerPaymentId) {
      await db.query(`update simulated_charges set status = 'approved' where id = $1`, [providerPaymentId]);
    },
    async findChargeByPaymentId(paymentId) {
      const { rows } = await db.query<{ id: string }>('select id from simulated_charges where id = $1', [
        `sim_${paymentId}`,
      ]);
      return rows[0]?.id ?? null;
    },
  };
}
