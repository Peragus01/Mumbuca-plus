import { randomBytes } from 'node:crypto';
import type { Db } from '../db/db.js';

export class AuthRepository {
  constructor(private readonly db: Db) {}

  /** Stores a one-time challenge and returns its nonce (128 random bits, hex). */
  async createChallenge(wallet: string, message: string | ((nonce: string) => string), expiresAt: Date): Promise<string> {
    const nonce = randomBytes(16).toString('hex');
    const text = typeof message === 'function' ? message(nonce) : message;
    await this.db.query('insert into auth_challenges (nonce, wallet_address, message, expires_at) values ($1, $2, $3, $4)', [
      nonce,
      wallet,
      text,
      expiresAt,
    ]);
    return nonce;
  }

  /** Atomically marks the challenge used; null when unknown, used, expired or issued to another wallet. */
  async consumeChallenge(nonce: string, wallet: string, now: Date): Promise<{ message: string } | null> {
    const { rows } = await this.db.query<{ message: string }>(
      'update auth_challenges set used_at = now() where nonce = $1 and wallet_address = $2 and used_at is null and expires_at > $3 returning message',
      [nonce, wallet, now],
    );
    return rows[0] ? { message: rows[0].message } : null;
  }

  async deleteExpiredChallenges(now: Date): Promise<void> {
    await this.db.query('delete from auth_challenges where expires_at <= $1', [now]);
  }

  /** Counts one signup for (ipHash, day); false once the daily limit is exceeded. */
  async incrementSignupCount(ipHash: string, day: string, limit: number): Promise<boolean> {
    const { rows } = await this.db.query<{ count: number }>(
      'insert into signup_ip_counts (ip_hash, day, count) values ($1, $2, 1) on conflict (ip_hash, day) do update set count = signup_ip_counts.count + 1 returning count',
      [ipHash, day],
    );
    return Number(rows[0]!.count) <= limit;
  }
}
