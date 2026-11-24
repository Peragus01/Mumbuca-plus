import { PGlite } from '@electric-sql/pglite';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { migrate, type Db } from '../../src/db/db.js';

const migrationsDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../migrations');

export async function createTestDb(): Promise<Db> {
  const pg = new PGlite();
  const db: Db = {
    async query<T = any>(text: string, params?: unknown[]) {
      if (params === undefined) {
        // Like pg's simple-query protocol: allows multi-statement SQL (migrations).
        const results = await pg.exec(text);
        return { rows: ((results[results.length - 1]?.rows ?? []) as unknown) as T[] };
      }
      const res = await pg.query<T>(text, params as any[] | undefined);
      return { rows: res.rows };
    },
  };
  await migrate(db, migrationsDir);
  return db;
}
