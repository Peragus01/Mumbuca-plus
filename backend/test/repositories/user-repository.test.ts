import { describe, it, expect } from 'vitest';
import { Keypair } from '@solana/web3.js';
import { createTestDb } from '../helpers/test-db.js';
import { UserRepository, InvalidWalletAddress, DuplicateUser } from '../../src/repositories/user-repository.js';

const EVM = '0x52908400098527886E0F7030069857D2E4169EE7';
const wallet = () => Keypair.generate().publicKey.toBase58();

describe('UserRepository', () => {
  it('create user stores the canonical Solana address', async () => {
    const repo = new UserRepository(await createTestDb());
    const w = wallet();
    const u = await repo.create({ handle: 'ana', displayName: 'Ana', walletAddress: w });
    expect(u.walletAddress).toBe(w);
    expect((await repo.findById(u.id))?.handle).toBe('ana');
    expect(await repo.findById('00000000-0000-4000-8000-000000000000')).toBeNull();
    expect((await repo.list()).map((x) => x.handle)).toEqual(['ana']);
  });

  it('rejects EVM and malformed addresses', async () => {
    const repo = new UserRepository(await createTestDb());
    await expect(repo.create({ handle: 'x', displayName: 'X', walletAddress: EVM })).rejects.toBeInstanceOf(InvalidWalletAddress);
    await expect(repo.create({ handle: 'x', displayName: 'X', walletAddress: 'abc' })).rejects.toBeInstanceOf(InvalidWalletAddress);
    await expect(repo.create({ handle: 'x', displayName: 'X', walletAddress: '' })).rejects.toBeInstanceOf(InvalidWalletAddress);
  });

  it('rejects duplicate handle', async () => {
    const repo = new UserRepository(await createTestDb());
    await repo.create({ handle: 'ana', displayName: 'Ana', walletAddress: wallet() });
    await expect(
      repo.create({ handle: 'ana', displayName: 'Ana2', walletAddress: wallet() }),
    ).rejects.toBeInstanceOf(DuplicateUser);
  });
});
