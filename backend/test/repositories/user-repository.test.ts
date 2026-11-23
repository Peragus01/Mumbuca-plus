import { describe, it, expect } from 'vitest';
import { createTestDb } from '../helpers/test-db.js';
import { UserRepository, InvalidWalletAddress, DuplicateUser } from '../../src/repositories/user-repository.js';

const LOWER = '0x52908400098527886e0f7030069857d2e4169ee7';
const CHECKSUM = '0x52908400098527886E0F7030069857D2E4169EE7';

describe('UserRepository', () => {
  it('create user normalizes wallet to checksum', async () => {
    const repo = new UserRepository(await createTestDb());
    const u = await repo.create({ handle: 'ana', displayName: 'Ana', walletAddress: LOWER });
    expect(u.walletAddress).toBe(CHECKSUM);
    expect((await repo.findById(u.id))?.handle).toBe('ana');
    expect(await repo.findById('00000000-0000-4000-8000-000000000000')).toBeNull();
    expect((await repo.list()).map((x) => x.handle)).toEqual(['ana']);
  });

  it('rejects invalid address', async () => {
    const repo = new UserRepository(await createTestDb());
    await expect(repo.create({ handle: 'x', displayName: 'X', walletAddress: '0x123' })).rejects.toBeInstanceOf(InvalidWalletAddress);
  });

  it('rejects duplicate handle', async () => {
    const repo = new UserRepository(await createTestDb());
    await repo.create({ handle: 'ana', displayName: 'Ana', walletAddress: LOWER });
    await expect(
      repo.create({ handle: 'ana', displayName: 'Ana2', walletAddress: '0x0000000000000000000000000000000000000001' }),
    ).rejects.toBeInstanceOf(DuplicateUser);
  });
});
