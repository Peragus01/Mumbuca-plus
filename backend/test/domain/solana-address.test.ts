import { describe, it, expect } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { parseSolanaAddress } from '../../src/domain/solana-address.js';

describe('parseSolanaAddress', () => {
  const pk = Keypair.generate().publicKey.toBase58();
  it('accepts a valid pubkey and returns canonical base58', () => {
    expect(parseSolanaAddress(pk)).toBe(pk);
    expect(parseSolanaAddress('11111111111111111111111111111111')).toBe('11111111111111111111111111111111');
  });
  it('rejects EVM addresses, short base58, empty and garbage', () => {
    expect(parseSolanaAddress('0x52908400098527886E0F7030069857D2E4169EE7')).toBeNull();
    expect(parseSolanaAddress('abc')).toBeNull();
    expect(parseSolanaAddress('')).toBeNull();
    expect(parseSolanaAddress('0OIl' + pk.slice(4))).toBeNull();
    expect(parseSolanaAddress(pk + pk)).toBeNull();
  });
});
