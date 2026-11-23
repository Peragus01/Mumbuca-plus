import { readdir, readFile } from 'node:fs/promises';
import path from 'node:path';
import pg from 'pg';

export type Db = {
  query<T = any>(text: string, params?: unknown[]): Promise<{ rows: T[] }>;
};

export function createPgDb(url: string, ssl: boolean): Db & { end(): Promise<void> } {
  const pool = new pg.Pool({
    connectionString: url,
    ssl: ssl ? { rejectUnauthorized: false } : undefined,
  });
  return {
    async query<T = any>(text: string, params?: unknown[]) {
      const res = await pool.query(text, params as any[] | undefined);
      return { rows: res.rows as T[] };
    },
    end: () => pool.end(),
  };
}

export async function migrate(db: Db, dir: string): Promise<void> {
  await db.query(
    'create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())',
  );
  const files = (await readdir(dir)).filter((f) => f.endsWith('.sql')).sort();
  const { rows } = await db.query<{ name: string }>('select name from schema_migrations');
  const applied = new Set(rows.map((r) => r.name));
  for (const file of files) {
    if (applied.has(file)) continue;
    const sql = await readFile(path.join(dir, file), 'utf8');
    await db.query(sql);
    await db.query('insert into schema_migrations (name) values ($1)', [file]);
  }
}
