import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Keypair, PublicKey } from '@solana/web3.js';
import {
  buildInitializeInstruction,
  buildPauserInstruction,
  buildSetMetadataUriInstruction,
  programConfigIssues,
  configMatches,
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

  it('configMatches detects a foreign admin/minter/pauser', () => {
    const [a, m, p, x] = [1, 2, 3, 4].map(() => Keypair.generate().publicKey);
    expect(configMatches({ admin: a, minter: m, pauser: p }, { admin: a, minter: m, pauser: p })).toBe(true);
    expect(configMatches({ admin: x, minter: m, pauser: p }, { admin: a, minter: m, pauser: p })).toBe(false);
    expect(configMatches({ admin: a, minter: x, pauser: p }, { admin: a, minter: m, pauser: p })).toBe(false);
    expect(configMatches({ admin: a, minter: m, pauser: x }, { admin: a, minter: m, pauser: p })).toBe(false);
  });

  it('builds pause/unpause with pauser signer and writable config', () => {
    const pauser = Keypair.generate().publicKey;
    const idl = JSON.parse(readFileSync(new URL('../../src/chain/idl/mumbuca_plus.json', import.meta.url), 'utf8')) as {
      instructions: { name: string; discriminator: number[] }[];
    };
    for (const name of ['pause', 'unpause'] as const) {
      const ix = buildPauserInstruction(programId, pauser, name);
      expect(ix.programId.equals(programId)).toBe(true);
      expect(ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable])).toEqual([
        [pauser.toBase58(), true, false],
        [findConfigPda(programId)[0].toBase58(), false, true],
      ]);
      expect([...ix.data]).toEqual(idl.instructions.find((i) => i.name === name)!.discriminator);
    }
  });

  it('programConfigIssues flags minter mismatch, low max_mint_per_tx and pause', () => {
    const minter = Keypair.generate().publicKey;
    const ok = { minter, maxMintPerTx: 2_000_000n, paused: false };
    expect(programConfigIssues(ok, { minter, maxRechargeCents: 2_000_000n })).toEqual([]);
    expect(
      programConfigIssues(
        { minter: Keypair.generate().publicKey, maxMintPerTx: 1_000n, paused: true },
        { minter, maxRechargeCents: 2_000_000n },
      ),
    ).toEqual(['minter_mismatch', 'max_mint_per_tx_below_max_recharge', 'program_paused']);
  });

  it("builds set_metadata_uri: admin signer+writable, config, writable mint, token-2022, system; borsh uri", () => {
    const admin = Keypair.generate().publicKey;
    const uri = "https://mumbuca-plus-production.up.railway.app/token/mum.json";
    const ix = buildSetMetadataUriInstruction(programId, admin, uri);
    const idl = JSON.parse(readFileSync(new URL("../../src/chain/idl/mumbuca_plus.json", import.meta.url), "utf8"));
    const disc = Buffer.from(idl.instructions.find((i: { name: string }) => i.name === "set_metadata_uri").discriminator);
    expect(ix.programId.equals(programId)).toBe(true);
    expect(ix.keys.map((k) => [k.pubkey.toBase58(), k.isSigner, k.isWritable])).toEqual([
      [admin.toBase58(), true, true],
      [findConfigPda(programId)[0].toBase58(), false, false],
      [findMintPda(programId)[0].toBase58(), false, true],
      [TOKEN_2022_PROGRAM_ID.toBase58(), false, false],
      ["11111111111111111111111111111111", false, false],
    ]);
    const len = Buffer.alloc(4);
    len.writeUInt32LE(Buffer.byteLength(uri));
    expect(Buffer.from(ix.data).equals(Buffer.concat([disc, len, Buffer.from(uri)]))).toBe(true);
    expect(() => buildSetMetadataUriInstruction(programId, admin, "x".repeat(201))).toThrow(/200/);
  });
});
