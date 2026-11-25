import { Keypair } from '@solana/web3.js';
import { base58 } from '@scure/base';
import { ed25519 } from '@noble/curves/ed25519';
import { describe, expect, it } from 'vitest';
import { buildSignInMessage, verifySignature } from '../../src/auth/phantom-challenge.js';

const kp = Keypair.generate();
const wallet = kp.publicKey.toBase58();
const sign = (msg: string, k = kp) => base58.encode(ed25519.sign(new TextEncoder().encode(msg), k.secretKey.slice(0, 32)));
const message = () =>
  buildSignInMessage({
    host: 'mumbuca.example',
    wallet,
    nonce: 'abc123',
    issuedAt: new Date('2026-11-25T10:00:00Z'),
    expiresAt: new Date('2026-11-25T10:05:00Z'),
  });

describe('phantom challenge', () => {
  it('message carries host, wallet, nonce and the no-transaction notice', () => {
    const m = message();
    expect(m).toContain('mumbuca.example');
    expect(m).toContain(wallet);
    expect(m).toContain('Nonce: abc123');
    expect(m).toContain('Isso não autoriza nenhuma transação.');
  });

  it('accepts a valid signature', () => {
    const m = message();
    expect(verifySignature(m, sign(m), wallet)).toBe(true);
  });

  it('rejects altered message, other wallet and malformed base58', () => {
    const m = message();
    const sig = sign(m);
    expect(verifySignature(m + ' ', sig, wallet)).toBe(false);
    expect(verifySignature(m, sig, Keypair.generate().publicKey.toBase58())).toBe(false);
    expect(verifySignature(m, '0OIl-not-base58!', wallet)).toBe(false);
    expect(verifySignature(m, sig, 'not-a-wallet')).toBe(false);
    expect(verifySignature(m, '', wallet)).toBe(false);
  });
});
