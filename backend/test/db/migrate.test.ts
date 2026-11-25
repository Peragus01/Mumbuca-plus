import { describe, it, expect } from 'vitest';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createTestDb } from '../helpers/test-db.js';
import { migrate } from '../../src/db/db.js';

const dir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

describe('migrate', () => {
  it('creates the tables', async () => {
    const db = await createTestDb();
    const { rows } = await db.query<{ table_name: string }>(
      "select table_name from information_schema.tables where table_schema='public' order by table_name",
    );
    expect(rows.map((r) => r.table_name)).toEqual([
      'auth_challenges',
      'payment_events',
      'payments',
      'schema_migrations',
      'signup_ip_counts',
      'simulated_charges',
      'users',
    ]);
  });
  it('is idempotent', async () => {
    const db = await createTestDb();
    await expect(migrate(db, dir)).resolves.toBeUndefined();
    const { rows } = await db.query('select * from schema_migrations');
    expect(rows).toHaveLength(2);
  });
});
