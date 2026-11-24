import { beforeAll, describe, expect, it } from 'vitest';
import type { Db } from '../../src/db/db.js';
import { createSimulatedProvider } from '../../src/providers/simulated-provider.js';
import { createTestDb } from '../helpers/test-db.js';

describe('simulated provider', () => {
  let db: Db;
  beforeAll(async () => {
    db = await createTestDb();
  }, 60_000);

  it('createCharge then fetchPayment is pending', async () => {
    const p = createSimulatedProvider(db);
    const charge = await p.createCharge({ paymentId: 'pay-1', amountCents: 1100n });
    expect(charge).toEqual({ providerPaymentId: 'sim_pay-1', pixBrCode: null, expiresAt: null });
    expect(await p.fetchPayment('sim_pay-1')).toEqual({ kind: 'pending' });
    expect(p.env).toBe('local');
    expect(p.name).toBe('simulated');
  });

  it('simulatePayment then approved with exact amount', async () => {
    const p = createSimulatedProvider(db);
    await p.createCharge({ paymentId: 'pay-2', amountCents: 123456n });
    await p.simulatePayment!('sim_pay-2');
    expect(await p.fetchPayment('sim_pay-2')).toEqual({
      kind: 'approved',
      receivedAmountCents: 123456n,
      truncated: false,
      metadataPaymentId: 'pay-2',
    });
  });

  it('simulatePayment twice is harmless', async () => {
    const p = createSimulatedProvider(db);
    await p.createCharge({ paymentId: 'pay-3', amountCents: 2000n });
    await p.simulatePayment!('sim_pay-3');
    await p.simulatePayment!('sim_pay-3');
    const state = await p.fetchPayment('sim_pay-3');
    expect(state.kind).toBe('approved');
    // a repeated createCharge does not reset an approved charge
    await p.createCharge({ paymentId: 'pay-3', amountCents: 2000n });
    expect((await p.fetchPayment('sim_pay-3')).kind).toBe('approved');
  });
});
