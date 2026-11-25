import { randomUUID } from 'node:crypto';
import type { Db } from '../db/db.js';
import { parseSolanaAddress } from '../domain/solana-address.js';

export interface User {
  id: string;
  handle: string;
  displayName: string;
  walletAddress: string;
  createdAt: Date;
}

export class InvalidWalletAddress extends Error {
  constructor(address: string) {
    super(`Invalid wallet address: ${address}`);
    this.name = 'InvalidWalletAddress';
  }
}

export class DuplicateUser extends Error {
  constructor(message = 'User handle or wallet already exists') {
    super(message);
    this.name = 'DuplicateUser';
  }
}

interface UserRow {
  id: string;
  handle: string;
  display_name: string;
  wallet_address: string;
  created_at: Date;
}

function mapUser(r: UserRow): User {
  return {
    id: r.id,
    handle: r.handle,
    displayName: r.display_name,
    walletAddress: r.wallet_address,
    createdAt: r.created_at,
  };
}

export class UserRepository {
  constructor(private readonly db: Db) {}

  async create(input: { handle: string; displayName: string; walletAddress: string }): Promise<User> {
    const wallet = parseSolanaAddress(input.walletAddress);
    if (wallet === null) throw new InvalidWalletAddress(input.walletAddress);
    try {
      const { rows } = await this.db.query<UserRow>(
        'insert into users (id, handle, display_name, wallet_address) values ($1, $2, $3, $4) returning *',
        [randomUUID(), input.handle, input.displayName, wallet],
      );
      return mapUser(rows[0]!);
    } catch (err) {
      if ((err as { code?: string }).code === '23505') throw new DuplicateUser();
      throw err;
    }
  }

  async findById(id: string): Promise<User | null> {
    const { rows } = await this.db.query<UserRow>('select * from users where id = $1', [id]);
    return rows[0] ? mapUser(rows[0]) : null;
  }

  async findByWallet(wallet: string): Promise<User | null> {
    const { rows } = await this.db.query<UserRow>('select * from users where wallet_address = $1', [wallet]);
    return rows[0] ? mapUser(rows[0]) : null;
  }

  async list(): Promise<User[]> {
    const { rows } = await this.db.query<UserRow>('select * from users order by created_at desc, id', []);
    return rows.map(mapUser);
  }
}
