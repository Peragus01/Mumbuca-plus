import { beforeAll, describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { setupApp, WARMUP_TIMEOUT_MS, warmup } from '../helpers/http-app.js';

describe('users API', () => {
  beforeAll(warmup, WARMUP_TIMEOUT_MS);

  it('create, list, invalid address 400, duplicate 409', async () => {
    const t = await setupApp();
    const wallet = Keypair.generate().publicKey.toBase58();
    const res = await t.api('POST', '/api/users', { handle: 'ana', displayName: 'Ana', walletAddress: wallet });
    expect(res.statusCode).toBe(201);
    const u = res.json();
    expect(u).toMatchObject({ handle: 'ana', displayName: 'Ana', walletAddress: wallet });
    expect(typeof u.id).toBe('string');
    expect(u.createdAt).toBe(new Date(u.createdAt).toISOString());

    const list = await t.api('GET', '/api/users');
    expect(list.json()).toEqual([u]);

    const bad = await t.api('POST', '/api/users', { handle: 'bia', displayName: 'Bia', walletAddress: '0x1234' });
    expect(bad.statusCode).toBe(400);

    const dup = await t.api('POST', '/api/users', { handle: 'ana', displayName: 'Ana 2', walletAddress: Keypair.generate().publicKey.toBase58() });
    expect(dup.statusCode).toBe(409);
  });

  it('invalid Solana address 400', async () => {
    const t = await setupApp();
    for (const walletAddress of ['', 'not-base58-0OIl', '1111', `0x${'ab'.repeat(20)}`]) {
      const res = await t.api('POST', '/api/users', { handle: 'x', displayName: 'X', walletAddress });
      expect(res.statusCode).toBe(400);
    }
    expect((await t.api('POST', '/api/users', { handle: 'x' })).statusCode).toBe(400);
  });

  it('balance returns string units', async () => {
    const t = await setupApp();
    const u = await t.newUser();
    t.chain.minted.push({ recipient: u.walletAddress, units: 12345n, ref: '0x00' });
    const res = await t.api('GET', `/api/users/${u.id}/balance`);
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({ balanceUnits: '12345' });
    expect((await t.api('GET', '/api/users/00000000-0000-4000-8000-000000000000/balance')).statusCode).toBe(404);
  });
});
