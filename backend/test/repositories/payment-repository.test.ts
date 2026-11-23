import { describe, it, expect } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { createTestDb } from '../helpers/test-db.js';
import type { Db } from '../../src/db/db.js';
import { UserRepository } from '../../src/repositories/user-repository.js';
import { PaymentRepository } from '../../src/repositories/payment-repository.js';

async function setup() {
  const db = await createTestDb();
  const user = await new UserRepository(db).create({
    handle: 'ana', displayName: 'Ana', walletAddress: Keypair.generate().publicKey.toBase58(),
  });
  const repo = new PaymentRepository(db);
  const mk = (cents = 2500n) =>
    repo.create({ userId: user.id, provider: 'simulated', providerEnv: 'local', requestedAmountCents: cents });
  return { db, user, repo, mk };
}
const events = async (db: Db, id: string) =>
  (await db.query('select * from payment_events where payment_id=$1 order by id', [id])).rows;

describe('PaymentRepository', () => {
  it('create payment starts AWAITING_PAYMENT', async () => {
    const { repo, mk } = await setup();
    const p = await mk();
    expect(p.status).toBe('AWAITING_PAYMENT');
    expect(p.id).toMatch(/^[0-9a-f-]{36}$/);
    expect(p.attempts).toBe(0);
    expect(p.providerPaymentId).toBeNull();
    expect((await repo.findById(p.id))?.id).toBe(p.id);
    expect(await repo.findById('00000000-0000-4000-8000-000000000000')).toBeNull();
  });

  it('attachCharge stores pix fields', async () => {
    const { repo, mk } = await setup();
    const p = await mk();
    const exp = new Date('2030-01-01T00:00:00Z');
    const a = await repo.attachCharge(p.id, { providerPaymentId: 'ch_1', pixBrCode: 'BR', pixExpiresAt: exp });
    expect(a.providerPaymentId).toBe('ch_1');
    expect(a.pixBrCode).toBe('BR');
    expect(a.pixExpiresAt?.getTime()).toBe(exp.getTime());
    expect((await repo.findByProviderPaymentId('simulated', 'ch_1'))?.id).toBe(p.id);
    expect(await repo.findByProviderPaymentId('ozav', 'ch_1')).toBeNull();
  });

  it('transition moves only from allowed status and logs event', async () => {
    const { db, repo, mk } = await setup();
    const p = await mk();
    const t = await repo.transition(p.id, ['AWAITING_PAYMENT'], 'RECEIVED', { receivedAmountCents: 2500n }, { src: 'webhook' });
    expect(t?.status).toBe('RECEIVED');
    expect(t?.receivedAmountCents).toBe(2500n);
    expect(t!.updatedAt.getTime()).toBeGreaterThanOrEqual(p.updatedAt.getTime());
    expect(await repo.transition(p.id, ['AWAITING_PAYMENT'], 'RECEIVED')).toBeNull();
    const ev = (await events(db, p.id)).filter((e) => e.kind === 'transition');
    expect(ev).toHaveLength(1);
    expect(ev[0]).toMatchObject({ from_status: 'AWAITING_PAYMENT', to_status: 'RECEIVED', detail: { src: 'webhook' } });
  });

  it('concurrent transitions: only one wins', async () => {
    const { db, repo, mk } = await setup();
    const p = await mk();
    await repo.transition(p.id, ['AWAITING_PAYMENT'], 'RECEIVED');
    const res = await Promise.all([
      repo.transition(p.id, ['RECEIVED'], 'VALIDATING'),
      repo.transition(p.id, ['RECEIVED'], 'VALIDATING'),
    ]);
    expect(res.filter((r) => r !== null)).toHaveLength(1);
    const ev = (await events(db, p.id)).filter((e) => e.to_status === 'VALIDATING');
    expect(ev).toHaveLength(1);
  });

  it('patch updates non-state fields and logs a note', async () => {
    const { db, repo, mk } = await setup();
    const p = await mk();
    const u = await repo.patch(p.id, { lastError: 'boom', attempts: 2, needsReview: true });
    expect(u).toMatchObject({ lastError: 'boom', attempts: 2, needsReview: true, status: 'AWAITING_PAYMENT' });
    expect((await events(db, p.id)).filter((e) => e.kind === 'note')).toHaveLength(1);
  });

  it('recordProviderEvent returns false on duplicate event id', async () => {
    const { repo, mk } = await setup();
    const p = await mk();
    expect(await repo.recordProviderEvent({ paymentId: p.id, providerEventId: 'e1', detail: { a: 1 } })).toBe(true);
    expect(await repo.recordProviderEvent({ paymentId: p.id, providerEventId: 'e1', detail: { a: 1 } })).toBe(false);
    expect(await repo.recordProviderEvent({ paymentId: null, providerEventId: 'e2', detail: {} })).toBe(true);
  });

  it('listOpen excludes MINTED, FAILED and AWAITING_PAYMENT without charge', async () => {
    const { repo, mk } = await setup();
    const noCharge = await mk();
    const withCharge = await mk();
    await repo.attachCharge(withCharge.id, { providerPaymentId: 'c', pixBrCode: 'x', pixExpiresAt: new Date() });
    const minted = await mk();
    await repo.transition(minted.id, ['AWAITING_PAYMENT'], 'MINTED');
    const failed = await mk();
    await repo.transition(failed.id, ['AWAITING_PAYMENT'], 'FAILED');
    const recv = await mk();
    await repo.transition(recv.id, ['AWAITING_PAYMENT'], 'RECEIVED');
    const ids = (await repo.listOpen()).map((p) => p.id);
    expect(ids).toHaveLength(2);
    expect(ids).toEqual(expect.arrayContaining([withCharge.id, recv.id]));
    expect(ids).not.toContain(noCharge.id);
    expect((await repo.listAll()).length).toBe(5);
  });

  it('listByUser returns only that user payments', async () => {
    const { repo, user, mk } = await setup();
    await mk();
    expect(await repo.listByUser(user.id)).toHaveLength(1);
    expect(await repo.listByUser('00000000-0000-4000-8000-000000000000')).toHaveLength(0);
  });

  it('bigint cents round-trip (mapper types)', async () => {
    const { repo, mk } = await setup();
    const p = await mk(9007199254740993n);
    expect(typeof p.requestedAmountCents).toBe('bigint');
    expect(p.requestedAmountCents).toBe(9007199254740993n);
    expect(p.receivedAmountCents).toBeNull();
    const t = await repo.transition(p.id, ['AWAITING_PAYMENT'], 'MINTED', {
      receivedAmountCents: 5n, slot: 77n, lastValidBlockHeight: 9007199254740993n, txSignature: 'sig1', mintAmountUnits: '500',
    });
    expect(typeof t!.receivedAmountCents).toBe('bigint');
    expect(typeof t!.slot).toBe('bigint');
    expect(typeof t!.lastValidBlockHeight).toBe('bigint');
    expect(t!.txSignature).toBe('sig1');
    expect(t!.mintAmountUnits).toBe('500');
    expect(typeof t!.attempts).toBe('number');
    const f = await repo.findById(p.id);
    expect(typeof f!.requestedAmountCents).toBe('bigint');
    expect(f!.slot).toBe(77n);
    expect(f!.lastValidBlockHeight).toBe(9007199254740993n);
    expect(typeof f!.lastValidBlockHeight).toBe('bigint');
    expect(f!.txSignature).toBe('sig1');
    expect(p.slot).toBeNull();
    expect(p.lastValidBlockHeight).toBeNull();
  });
});
