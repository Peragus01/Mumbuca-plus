import { randomBytes } from 'node:crypto';
import { base58 } from '@scure/base';
import { beforeAll, describe, expect, inject, it } from 'vitest';
import { Connection, Keypair, PublicKey, Transaction, sendAndConfirmTransaction } from '@solana/web3.js';
import { buildPauserInstruction } from '../../src/chain/program-client.js';
import {
  MintRejectedError,
  createSolanaTokenGateway,
  type TokenGateway,
} from '../../src/chain/token-gateway.js';

const newRef = (): `0x${string}` => `0x${randomBytes(32).toString('hex')}`;

describe('SolanaTokenGateway (local validator)', () => {
  let gw: TokenGateway;
  let conn: Connection;
  let programId: PublicKey;
  let pauser: Keypair;
  const recipient = Keypair.generate().publicKey.toBase58();
  const firstRef = newRef();
  let firstSig = '';

  beforeAll(() => {
    const rpcUrl = inject('chainRpcUrl');
    conn = new Connection(rpcUrl, 'confirmed');
    programId = new PublicKey(inject('chainProgramId'));
    pauser = Keypair.fromSecretKey(Uint8Array.from(inject('chainAdminSecret')));
    gw = createSolanaTokenGateway({
      rpcUrl,
      programId: programId.toBase58(),
      minterSecretKey: Uint8Array.from(inject('chainMinterSecret')),
      commitment: 'confirmed',
    });
  });

  it('sendMint then waitForConfirmation yields confirmed and balanceOf increases by amount', async () => {
    expect(await gw.balanceOf(recipient)).toBe(0n);
    const { signature, lastValidBlockHeight } = await gw.sendMint(recipient, 12_345n, firstRef);
    firstSig = signature;
    expect(typeof lastValidBlockHeight).toBe('bigint');
    const res = await gw.waitForConfirmation(signature, lastValidBlockHeight, 30_000);
    expect(res).not.toBeNull();
    expect(res).not.toBe('expired');
    expect(res).toMatchObject({ status: 'confirmed' });
    expect(await gw.balanceOf(recipient)).toBe(12_345n);

    const st = await gw.getSignatureStatus(signature);
    expect(st?.status).toBe('confirmed');
    expect(typeof st?.slot).toBe('bigint');
    expect(await gw.isBlockhashExpired(lastValidBlockHeight)).toBe(false);
    expect(await gw.minterNativeBalance()).toBeGreaterThan(0n);
  });

  it('isPaymentRefUsed true after mint; findMintTx returns the same signature', async () => {
    expect(await gw.isPaymentRefUsed(firstRef)).toBe(true);
    expect(await gw.isPaymentRefUsed(newRef())).toBe(false);
    const found = await gw.findMintTx(firstRef);
    expect(found?.signature).toBe(firstSig);
    expect(typeof found?.slot).toBe('bigint');
    expect(await gw.findMintTx(newRef())).toBeNull();
  });

  it('second sendMint with same ref throws MintRejectedError PaymentRefAlreadyUsed', async () => {
    const err = await gw.sendMint(recipient, 1n, firstRef).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(MintRejectedError);
    expect((err as MintRejectedError).reason).toBe('PaymentRefAlreadyUsed');
  });

  it('paused program → MintRejectedError Paused; isPaused true', async () => {
    expect(await gw.isPaused()).toBe(false);
    await sendAndConfirmTransaction(conn, new Transaction().add(buildPauserInstruction(programId, pauser.publicKey, 'pause')), [pauser]);
    try {
      expect(await gw.isPaused()).toBe(true);
      const err = await gw.sendMint(recipient, 10n, newRef()).catch((e: unknown) => e);
      expect(err).toBeInstanceOf(MintRejectedError);
      expect((err as MintRejectedError).reason).toBe('Paused');
    } finally {
      await sendAndConfirmTransaction(conn, new Transaction().add(buildPauserInstruction(programId, pauser.publicKey, 'unpause')), [pauser]);
    }
    expect(await gw.isPaused()).toBe(false);
  });

  it('getSignatureStatus of unknown signature is null', async () => {
    expect(await gw.getSignatureStatus(base58.encode(randomBytes(64)))).toBeNull();
  });
});
