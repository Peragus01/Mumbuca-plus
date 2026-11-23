import { describe, expect, it } from 'vitest';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  buildInitializeInstruction,
  decodeConfigAccount,
  encodeInitializeData,
  findConfigPda,
  findMintPda,
  findReceiptPda,
  TOKEN_2022_PROGRAM_ID,
} from '../../src/chain/program-client.js';

const programId = new PublicKey('HfFamsTJgSXssGkCgBqtNsDLD694peLYBbAzs4kuYzZm');

describe('program-client', () => {
  it('derives PDAs like findProgramAddressSync', () => {
    expect(findConfigPda(programId)[0].equals(PublicKey.findProgramAddressSync([Buffer.from('config')], programId)[0])).toBe(true);
    expect(findMintPda(programId)[0].equals(PublicKey.findProgramAddressSync([Buffer.from('mint')], programId)[0])).toBe(true);
    const ref = new Uint8Array(32).fill(7);
    expect(findReceiptPda(programId, ref)[0].equals(PublicKey.findProgramAddressSync([Buffer.from('receipt'), Buffer.from(ref)], programId)[0])).toBe(true);
    expect(() => findReceiptPda(programId, new Uint8Array(31))).toThrow();
  });

  it('encodes initialize data: discriminator + borsh args', () => {
    const minter = Keypair.generate().publicKey;
    const pauser = Keypair.generate().publicKey;
    const data = encodeInitializeData({ cap: 1_000_000_000n, maxMintPerTx: 2_000_000n, minter, pauser, uri: 'abc' });
    expect([...data.subarray(0, 8)]).toEqual([175, 175, 109, 31, 13, 152, 155, 237]);
    expect(data.readBigUInt64LE(8)).toBe(1_000_000_000n);
    expect(data.readBigUInt64LE(16)).toBe(2_000_000n);
    expect(new PublicKey(data.subarray(24, 56)).equals(minter)).toBe(true);
    expect(new PublicKey(data.subarray(56, 88)).equals(pauser)).toBe(true);
    expect(data.readUInt32LE(88)).toBe(3);
    expect(data.subarray(92).toString('utf8')).toBe('abc');
    expect(data.length).toBe(95);
  });

  it('encodes an empty uri as zero length', () => {
    const k = Keypair.generate().publicKey;
    const data = encodeInitializeData({ cap: 1n, maxMintPerTx: 1n, minter: k, pauser: k, uri: '' });
    expect(data.length).toBe(92);
    expect(data.readUInt32LE(88)).toBe(0);
  });

  it('builds the instruction with IDL account order and flags', () => {
    const admin = Keypair.generate().publicKey;
    const k = Keypair.generate().publicKey;
    const ix = buildInitializeInstruction(programId, admin, { cap: 1n, maxMintPerTx: 1n, minter: k, pauser: k, uri: '' });
    expect(ix.programId.equals(programId)).toBe(true);
    expect(ix.keys.map((x) => x.pubkey.toBase58())).toEqual([
      admin.toBase58(),
      findConfigPda(programId)[0].toBase58(),
      findMintPda(programId)[0].toBase58(),
      TOKEN_2022_PROGRAM_ID.toBase58(),
      '11111111111111111111111111111111',
    ]);
    expect(ix.keys.map((x) => [x.isSigner, x.isWritable])).toEqual([
      [true, true],
      [false, true],
      [false, true],
      [false, false],
      [false, false],
    ]);
  });

  it('decodes a Config account', () => {
    const [a, m, p, mint] = [1, 2, 3, 4].map(() => Keypair.generate().publicKey);
    const buf = Buffer.alloc(8 + 128 + 24 + 3);
    Buffer.from([155, 12, 170, 224, 30, 250, 204, 130]).copy(buf, 0);
    [a, m, p, mint].forEach((k, i) => k.toBuffer().copy(buf, 8 + i * 32));
    buf.writeBigUInt64LE(10n, 136);
    buf.writeBigUInt64LE(20n, 144);
    buf.writeBigUInt64LE(30n, 152);
    buf[160] = 1;
    const c = decodeConfigAccount(buf);
    expect(c.admin.equals(a) && c.minter.equals(m) && c.pauser.equals(p) && c.mint.equals(mint)).toBe(true);
    expect([c.cap, c.maxMintPerTx, c.totalMinted, c.paused]).toEqual([10n, 20n, 30n, true]);
    expect(() => decodeConfigAccount(Buffer.alloc(200))).toThrow();
  });
});
