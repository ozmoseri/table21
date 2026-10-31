import { readdirSync, readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import pg from 'pg';

export type Row = Record<string, any>;
export interface Q {
  query<T extends Row = Row>(sql: string, params?: unknown[]): Promise<T[]>;
}
export interface Db extends Q {
  /** Runs `fn` in a transaction. Retries on serialization/deadlock failures. */
  tx<T>(fn: (q: Q) => Promise<T>): Promise<T>;
  close(): Promise<void>;
  kind: 'postgres' | 'embedded';
}

// bigint columns come back as strings by default; amounts here stay far below 2^53.
pg.types.setTypeParser(20, (v) => Number(v));

const RETRYABLE = new Set(['40001', '40P01']);

export function postgresDb(url: string): Db {
  const pool = new pg.Pool({ connectionString: url, max: 10 });
  return {
    kind: 'postgres',
    async query(sql, params) {
      return (await pool.query(sql, params as any[])).rows;
    },
    async tx(fn) {
      for (let attempt = 0; ; attempt++) {
        const client = await pool.connect();
        try {
          await client.query('begin');
          const q: Q = { query: async (sql, params) => (await client.query(sql, params as any[])).rows };
          const out = await fn(q);
          await client.query('commit');
          return out;
        } catch (e: any) {
          await client.query('rollback').catch(() => {});
          if (RETRYABLE.has(e?.code) && attempt < 4) continue;
          throw e;
        } finally {
          client.release();
        }
      }
    },
    close: () => pool.end(),
  };
}

/** Embedded Postgres (PGlite, WASM). Single connection, so transactions are serialized by a queue. */
export async function embeddedDb(dataDir: string): Promise<Db> {
  const { PGlite } = await import('@electric-sql/pglite');
  const db = new PGlite(dataDir);
  await db.waitReady;
  let chain: Promise<unknown> = Promise.resolve();
  const serial = <T>(fn: () => Promise<T>): Promise<T> => {
    const run = chain.then(fn, fn);
    chain = run.catch(() => {});
    return run;
  };
  const conv = (rows: any[]) => rows;
  return {
    kind: 'embedded',
    query: (sql, params) => serial(async () => conv((await db.query(sql, params as any[])).rows as any[])),
    tx: (fn) =>
      serial(() =>
        db.transaction(async (t) => fn({ query: async (sql, params) => conv((await t.query(sql, params as any[])).rows as any[]) })),
      ),
    close: async () => {
      await chain;
      await db.close();
    },
  };
}

const MIGRATIONS_DIR = join(dirname(fileURLToPath(import.meta.url)), '..', 'migrations');

export async function migrate(db: Db): Promise<string[]> {
  await db.query('create table if not exists schema_migrations (name text primary key, applied_at timestamptz not null default now())');
  const done = new Set((await db.query<{ name: string }>('select name from schema_migrations')).map((r) => r.name));
  const files = readdirSync(MIGRATIONS_DIR).filter((f) => f.endsWith('.sql')).sort();
  const applied: string[] = [];
  for (const f of files) {
    if (done.has(f)) continue;
    const sql = readFileSync(join(MIGRATIONS_DIR, f), 'utf8');
    await db.tx(async (q) => {
      for (const stmt of sql.split(/;\s*$/m).map((s) => s.trim()).filter(Boolean)) await q.query(stmt);
      await q.query('insert into schema_migrations(name) values ($1)', [f]);
    });
    applied.push(f);
  }
  return applied;
}
