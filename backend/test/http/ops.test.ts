import { beforeAll, describe, expect, it } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { mintPda } from '../../src/chain/pdas.js';
import { setupApp, WARMUP_TIMEOUT_MS, warmup } from '../helpers/http-app.js';

describe('GET /api/ops/status', () => {
  beforeAll(warmup, WARMUP_TIMEOUT_MS);

  it('reports chain/provider status with lamports as string', async () => {
    const t = await setupApp();
    const res = await t.api('GET', '/api/ops/status');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toEqual({
      providerEnv: 'sandbox',
      programId: t.env.PROGRAM_ID,
      mintAddress: mintPda(t.env.PROGRAM_ID).toBase58(),
      cluster: 'devnet',
      paused: false,
      minterLamports: '1000000000',
      lowSol: false,
      configOk: true,
      configIssues: [],
    });
  });

  it('flags an on-chain config mismatch (configOk false + configIssues)', async () => {
    const t = await setupApp();
    t.chain.config = { ...t.chain.config, minter: Keypair.generate().publicKey, maxMintPerTx: 1000n };
    const res = await t.api('GET', '/api/ops/status');
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({
      configOk: false,
      configIssues: ['minter_mismatch', 'max_mint_per_tx_below_max_recharge'],
    });
  });

  it('lowSol true when minter balance below LOW_SOL_THRESHOLD_LAMPORTS', async () => {
    const t = await setupApp({ LOW_SOL_THRESHOLD_LAMPORTS: 100_000_000n });
    t.chain.minterNativeBalance = async () => 99_999_999n;
    const res = await t.api('GET', '/api/ops/status');
    expect(res.json()).toMatchObject({ minterLamports: '99999999', lowSol: true });
  });

  it('chain failure → 503 with a generic body', async () => {
    const t = await setupApp();
    t.chain.minterNativeBalance = async () => {
      throw new Error('https://rpc.example/?api-key=SECRET failed');
    };
    const res = await t.api('GET', '/api/ops/status');
    expect(res.statusCode).toBe(503);
    expect(res.body).not.toContain('SECRET');
  });

  it('requires a session', async () => {
    const t = await setupApp();
    expect((await t.app.inject({ method: 'GET', url: '/api/ops/status' })).statusCode).toBe(401);
  });
});
