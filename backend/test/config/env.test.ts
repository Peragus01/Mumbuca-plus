import { describe, it, expect } from 'vitest';
import { loadEnv } from '../../src/config/env.js';
import { validEnv } from '../helpers/valid-env.js';

describe('loadEnv', () => {
  it('loads a valid env with defaults', () => {
    const env = loadEnv(validEnv);
    expect(env.CHAIN_ID).toBe(80002);
    expect(env.PORT).toBe(3000);
    expect(env.DATABASE_SSL).toBe(false);
    expect(env.OZAV_TARGET_CURRENCY).toBe('BRS');
    expect(env.OZAV_TARGET_CHAIN).toBe('solana');
    expect(env.OZAV_BASE_URL).toBe('https://developers.ozav.io/v2');
    expect(env.MAX_MINT_ATTEMPTS).toBe(5);
    expect(env.LOW_POL_THRESHOLD_WEI).toBe(100000000000000000n);
    expect(env.MIN_RECHARGE_CENTS).toBe(1100n);
    expect(env.TOKEN_DEPLOY_BLOCK).toBe(0n);
  });
  it('parses TOKEN_DEPLOY_BLOCK and rejects invalid values', () => {
    expect(loadEnv({ ...validEnv, TOKEN_DEPLOY_BLOCK: '1234567' }).TOKEN_DEPLOY_BLOCK).toBe(1234567n);
    expect(() => loadEnv({ ...validEnv, TOKEN_DEPLOY_BLOCK: '-1' })).toThrow(/TOKEN_DEPLOY_BLOCK/);
  });
  it('rejects live env with test key', () => {
    expect(() => loadEnv({ ...validEnv, PROVIDER_ENV: 'live' })).toThrow(/OZAV_API_KEY/);
  });
  it('rejects sandbox env with live key', () => {
    expect(() => loadEnv({ ...validEnv, OZAV_API_KEY: 'ozav_sk_live_x' })).toThrow(/OZAV_API_KEY/);
  });
  it('accepts live with live key', () => {
    expect(loadEnv({ ...validEnv, PROVIDER_ENV: 'live', OZAV_API_KEY: 'ozav_sk_live_x' }).PROVIDER_ENV).toBe('live');
  });
  it('rejects wrong chain id', () => {
    expect(() => loadEnv({ ...validEnv, CHAIN_ID: '137' })).toThrow(/CHAIN_ID/);
  });
  it('rejects short private key', () => {
    expect(() => loadEnv({ ...validEnv, MINTER_PRIVATE_KEY: '0x1234' })).toThrow(/MINTER_PRIVATE_KEY/);
  });
  it('rejects other target currency', () => {
    expect(() => loadEnv({ ...validEnv, OZAV_TARGET_CURRENCY: 'USDC' })).toThrow(/OZAV_TARGET_CURRENCY/);
  });
});
