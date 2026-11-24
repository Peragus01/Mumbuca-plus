import { beforeAll, describe, expect, it } from 'vitest';
import { ProviderUnavailableError } from '../../src/providers/payment-provider.js';
import { setupApp, WARMUP_TIMEOUT_MS, warmup } from '../helpers/http-app.js';

describe('payments API', () => {
  beforeAll(warmup, WARMUP_TIMEOUT_MS);

  it("POST creates OZAV charge and returns pixBrCode and origin 'OZAV sandbox'", async () => {
    const t = await setupApp();
    const u = await t.newUser();
    const res = await t.api('POST', '/api/payments', { userId: u.id, amountCents: '2500', provider: 'ozav' });
    expect(res.statusCode).toBe(201);
    const dto = res.json();
    expect(dto).toMatchObject({
      userId: u.id,
      provider: 'ozav',
      providerEnv: 'sandbox',
      origin: 'OZAV sandbox',
      status: 'AWAITING_PAYMENT',
      requestedAmountCents: '2500',
      pixBrCode: 'BRCODE',
      txSignature: null,
      explorerUrl: null,
    });
    expect(typeof dto.pixExpiresAt).toBe('string');
    expect(t.ozav.createChargeCalls).toEqual([dto.id]);
  });

  it('amount below min → 422 with minCents', async () => {
    const t = await setupApp();
    const u = await t.newUser();
    const res = await t.api('POST', '/api/payments', { userId: u.id, amountCents: '1099', provider: 'ozav' });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'amount_out_of_range', minCents: '1100', maxCents: '2000000' });
  });

  it('provider not enabled → 422', async () => {
    const t = await setupApp();
    const u = await t.newUser();
    const res = await t.api('POST', '/api/payments', { userId: u.id, amountCents: '2500', provider: 'mercadopago' });
    expect(res.statusCode).toBe(422);
    expect(res.json()).toEqual({ error: 'provider_not_enabled' });
  });

  it('invalid body → 400; unknown user → 404', async () => {
    const t = await setupApp();
    const u = await t.newUser();
    expect((await t.api('POST', '/api/payments', { userId: u.id, amountCents: 2500, provider: 'ozav' })).statusCode).toBe(400);
    expect((await t.api('POST', '/api/payments', { userId: u.id, amountCents: '25.00', provider: 'ozav' })).statusCode).toBe(400);
    const unknown = await t.api('POST', '/api/payments', {
      userId: '00000000-0000-4000-8000-000000000000',
      amountCents: '2500',
      provider: 'ozav',
    });
    expect(unknown.statusCode).toBe(404);
  });

  it('provider failure → 502 with a generic body', async () => {
    const t = await setupApp();
    const u = await t.newUser();
    t.ozav.createChargeError = new ProviderUnavailableError('OZAV transfer returned HTTP 503 SECRET-DETAIL');
    const res = await t.api('POST', '/api/payments', { userId: u.id, amountCents: '2500', provider: 'ozav' });
    expect(res.statusCode).toBe(502);
    expect(res.json()).toEqual({ error: 'provider_unavailable' });
    expect(res.body).not.toContain('SECRET');
  });

  it('simulated flow: create → simulate → GET shows MINTED with explorerUrl ?cluster=devnet', async () => {
    const t = await setupApp();
    const u = await t.newUser();
    const created = await t.api('POST', '/api/payments', { userId: u.id, amountCents: '1500', provider: 'simulated' });
    expect(created.statusCode).toBe(201);
    const id = created.json().id;
    expect(created.json().origin).toBe('SIMULADO');

    const sim = await t.api('POST', `/api/payments/${id}/simulate`);
    expect(sim.statusCode).toBe(200);
    expect(sim.json().id).toBe(id);
    await t.app.idle();

    const got = await t.api('GET', `/api/payments/${id}`);
    expect(got.statusCode).toBe(200);
    const dto = got.json();
    expect(dto.status).toBe('MINTED');
    expect(dto.txSignature).toMatch(/^sig_/);
    expect(dto.explorerUrl).toBe(`https://explorer.solana.com/tx/${dto.txSignature}?cluster=devnet`);
    expect(dto.mintAmountUnits).toBe('1500');
    expect(dto.receivedAmountCents).toBe('1500');
  });

  it('localnet explorer link uses ?cluster=custom', async () => {
    const t = await setupApp({ SOLANA_CLUSTER: 'localnet' });
    const u = await t.newUser();
    const id = (await t.api('POST', '/api/payments', { userId: u.id, amountCents: '1500', provider: 'simulated' })).json().id;
    await t.api('POST', `/api/payments/${id}/simulate`);
    await t.app.idle();
    const dto = (await t.api('GET', `/api/payments/${id}`)).json();
    expect(dto.explorerUrl).toBe(`https://explorer.solana.com/tx/${dto.txSignature}?cluster=custom`);
  });

  it('simulate → 409 when the provider cannot simulate (OZAV live)', async () => {
    const t = await setupApp();
    const u = await t.newUser();
    const id = (await t.api('POST', '/api/payments', { userId: u.id, amountCents: '2500', provider: 'ozav' })).json().id;
    // FakeProvider has no simulatePayment, like a provider that cannot simulate.
    expect((await t.api('POST', `/api/payments/${id}/simulate`)).statusCode).toBe(409);
    Object.assign(t.ozav, { env: 'live', simulatePayment: async () => {} });
    expect((await t.api('POST', `/api/payments/${id}/simulate`)).statusCode).toBe(409);
  });

  it('reprocess kicks off processing and returns the DTO', async () => {
    const t = await setupApp();
    const u = await t.newUser();
    const p = await t.processor.createRecharge({ userId: u.id, amountCents: 2500n, provider: 'ozav' });
    t.ozav.states.set(p.providerPaymentId!, { kind: 'approved', receivedAmountCents: 2500n, truncated: false, metadataPaymentId: p.id });
    await t.payments.transition(p.id, ['AWAITING_PAYMENT'], 'RECEIVED');
    const res = await t.api('POST', `/api/payments/${p.id}/reprocess`);
    expect(res.statusCode).toBe(200);
    expect(res.json().id).toBe(p.id);
    await t.app.idle();
    expect((await t.api('GET', `/api/payments/${p.id}`)).json().status).toBe('MINTED');
  });

  it('GET list by user, unknown id → 404, malformed id → 404', async () => {
    const t = await setupApp();
    const a = await t.newUser('ana');
    const b = await t.newUser('bia');
    await t.api('POST', '/api/payments', { userId: a.id, amountCents: '2500', provider: 'ozav' });
    await t.api('POST', '/api/payments', { userId: b.id, amountCents: '3000', provider: 'ozav' });
    const list = (await t.api('GET', `/api/payments?userId=${a.id}`)).json();
    expect(list).toHaveLength(1);
    expect(list[0].userId).toBe(a.id);
    expect((await t.api('GET', '/api/payments')).json()).toHaveLength(2);
    expect((await t.api('GET', '/api/payments/00000000-0000-4000-8000-000000000000')).statusCode).toBe(404);
    expect((await t.api('GET', '/api/payments/nope')).statusCode).toBe(404);
  });

  it('amounts serialized as strings', async () => {
    const t = await setupApp();
    const u = await t.newUser();
    const id = (await t.api('POST', '/api/payments', { userId: u.id, amountCents: '1500', provider: 'simulated' })).json().id;
    await t.api('POST', `/api/payments/${id}/simulate`);
    await t.app.idle();
    const dto = (await t.api('GET', `/api/payments/${id}`)).json();
    for (const k of ['requestedAmountCents', 'receivedAmountCents', 'mintAmountUnits', 'slot']) {
      expect(typeof dto[k]).toBe('string');
    }
    expect(Number.isNaN(Date.parse(dto.createdAt))).toBe(false);
    expect(dto.createdAt).toBe(new Date(dto.createdAt).toISOString());
    expect(Object.keys(dto).sort()).toEqual(
      [
        'id', 'userId', 'provider', 'providerEnv', 'origin', 'status', 'requestedAmountCents', 'receivedAmountCents',
        'mintAmountUnits', 'pixBrCode', 'pixExpiresAt', 'txSignature', 'explorerUrl', 'slot', 'needsReview',
        'amountMismatch', 'failureReason', 'lastError', 'createdAt', 'updatedAt',
      ].sort(),
    );
  });
});
