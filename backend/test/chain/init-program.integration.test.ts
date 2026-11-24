import { describe, expect, inject, it } from 'vitest';
import { Connection, Keypair, PublicKey } from '@solana/web3.js';
import { decodeConfigAccount } from '../../src/chain/program-client.js';
import { configPda, mintPda } from '../../src/chain/pdas.js';

// The globalSetup (test/chain/setup/local-validator.ts) ran scripts/init-program.ts against the
// local validator; here we read the resulting Config back.
describe('init-program (integration)', () => {
  it('initializes the program on a local validator and reads back config.admin/minter/pauser', async () => {
    const conn = new Connection(inject('chainRpcUrl'), 'confirmed');
    const programId = new PublicKey(inject('chainProgramId'));
    const admin = Keypair.fromSecretKey(Uint8Array.from(inject('chainAdminSecret')));
    const minter = Keypair.fromSecretKey(Uint8Array.from(inject('chainMinterSecret')));

    const info = await conn.getAccountInfo(configPda(programId));
    expect(info).not.toBeNull();
    const cfg = decodeConfigAccount(info!.data);
    expect(cfg.admin.equals(admin.publicKey)).toBe(true);
    expect(cfg.minter.equals(minter.publicKey)).toBe(true);
    expect(cfg.pauser.equals(admin.publicKey)).toBe(true);
    expect(cfg.mint.equals(mintPda(programId))).toBe(true);
    expect(cfg.paused).toBe(false);
  });
});
