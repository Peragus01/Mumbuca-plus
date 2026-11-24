import { describe, it, expect } from 'vitest';
import { base58 } from '@scure/base';
import { readFileSync } from 'node:fs';
import { loadEnv, ENV_KEYS } from '../../src/config/env.js';
import { validEnv, validMinter } from '../helpers/valid-env.js';

function errorOf(source: NodeJS.ProcessEnv): string {
  try {
    loadEnv(source);
  } catch (e) {
    return (e as Error).message;
  }
  throw new Error('expected loadEnv to throw');
}

describe('.env.example', () => {
  it('lists exactly the keys of the Env schema', () => {
    const text = readFileSync(new URL('../../.env.example', import.meta.url), 'utf8');
    const keys = text.split(String.fromCharCode(10)).map((x) => x.trim()).filter((x) => /^[A-Z_]+=/.test(x)).map((x) => x.split("=")[0]!);
    expect([...keys].sort()).toEqual([...ENV_KEYS].sort());
    for (const k of ['SOLANA_RPC_URL', 'SOLANA_CLUSTER', 'PROGRAM_ID', 'MINTER_SECRET_KEY']) expect(keys).toContain(k);
    for (const k of ['AMOY_RPC_URL', 'CHAIN_ID', 'TOKEN_ADDRESS', 'TOKEN_DEPLOY_BLOCK', 'MINTER_PRIVATE_KEY']) expect(keys).not.toContain(k);
  });
});

describe('loadEnv', () => {
  it('loads a valid env with defaults', () => {
    const env = loadEnv(validEnv);
    expect(env.SOLANA_CLUSTER).toBe('devnet');
    expect(env.PORT).toBe(3000);
    expect(env.DATABASE_SSL).toBe(false);
    expect(env.OZAV_TARGET_CURRENCY).toBe('BRS');
    expect(env.OZAV_TARGET_CHAIN).toBe('solana');
    expect(env.OZAV_BASE_URL).toBe('https://developers.ozav.io/v2');
    expect(env.MAX_MINT_ATTEMPTS).toBe(5);
    expect(env.LOW_SOL_THRESHOLD_LAMPORTS).toBe(100000000n);
    expect(env.MINT_CONFIRM_TIMEOUT_MS).toBe(60000);
    expect(env.RPC_TIMEOUT_MS).toBe(12000);
    expect(env.MIN_RECHARGE_CENTS).toBe(1100n);
    expect(env.PROGRAM_ID).toBe(validEnv.PROGRAM_ID);
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
  it('accepts devnet and localnet, rejects mainnet', () => {
    expect(loadEnv({ ...validEnv, SOLANA_CLUSTER: 'localnet' }).SOLANA_CLUSTER).toBe('localnet');
    expect(() => loadEnv({ ...validEnv, SOLANA_CLUSTER: 'mainnet' })).toThrow(/SOLANA_CLUSTER/);
  });
  it('rejects invalid SOLANA_RPC_URL and PROGRAM_ID', () => {
    expect(() => loadEnv({ ...validEnv, SOLANA_RPC_URL: 'nope' })).toThrow(/SOLANA_RPC_URL/);
    expect(() => loadEnv({ ...validEnv, PROGRAM_ID: '0x' + 'a'.repeat(40) })).toThrow(/PROGRAM_ID/);
    expect(() => loadEnv({ ...validEnv, PROGRAM_ID: 'abc' })).toThrow(/PROGRAM_ID/);
  });
  it('accepts MINTER_SECRET_KEY as JSON array and exposes decoded bytes', () => {
    const env = loadEnv(validEnv);
    expect(env.minterSecretKey).toBeInstanceOf(Uint8Array);
    expect(Array.from(env.minterSecretKey)).toEqual(Array.from(validMinter.secretKey));
  });
  it('accepts MINTER_SECRET_KEY as base58', () => {
    const env = loadEnv({ ...validEnv, MINTER_SECRET_KEY: base58.encode(validMinter.secretKey) });
    expect(Array.from(env.minterSecretKey)).toEqual(Array.from(validMinter.secretKey));
  });
  it('rejects 63-byte MINTER_SECRET_KEY without echoing the value', () => {
    const short = Array.from(validMinter.secretKey).slice(0, 63);
    for (const raw of [JSON.stringify(short), base58.encode(Uint8Array.from(short))]) {
      const msg = errorOf({ ...validEnv, MINTER_SECRET_KEY: raw });
      expect(msg).toMatch(/MINTER_SECRET_KEY/);
      expect(msg).not.toContain(raw);
      expect(msg).not.toContain(short.slice(0, 5).join(','));
    }
  });
  it('rejects out-of-range numbers, garbage, and an inconsistent keypair', () => {
    const arr = Array.from(validMinter.secretKey);
    expect(() => loadEnv({ ...validEnv, MINTER_SECRET_KEY: JSON.stringify([...arr.slice(0, 63), 256]) })).toThrow(/MINTER_SECRET_KEY/);
    expect(() => loadEnv({ ...validEnv, MINTER_SECRET_KEY: 'not a key!!' })).toThrow(/MINTER_SECRET_KEY/);
    const bad = [...arr.slice(0, 32), ...arr.slice(32).map((b) => b ^ 1)];
    expect(() => loadEnv({ ...validEnv, MINTER_SECRET_KEY: JSON.stringify(bad) })).toThrow(/MINTER_SECRET_KEY/);
  });
  it('rejects other target currency', () => {
    expect(() => loadEnv({ ...validEnv, OZAV_TARGET_CURRENCY: 'USDC' })).toThrow(/OZAV_TARGET_CURRENCY/);
  });
});
