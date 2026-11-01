import type { Db, Q } from './db.ts';

/**
 * Logical backup of every table as JSON (lossless through Postgres' own jsonb conversion), taken in one read-only
 * repeatable-read transaction so wallets, ledger and settlements are consistent with each other.
 * Restore goes into an empty database that has the same migrations applied; rows are inserted parent tables first.
 * The file holds every account (names, hashed session and recovery tokens): keep it private.
 */
export const BACKUP_FORMAT = 'table21-backup';
export const BACKUP_VERSION = 1;

export interface Backup {
  format: typeof BACKUP_FORMAT;
  version: number;
  createdAt: string;
  migrations: string[];
  tables: Record<string, { rows: unknown[] }>;
}

async function tables(q: Q): Promise<string[]> {
  const rows = await q.query<{ t: string }>(
    `select table_name as t from information_schema.tables where table_schema = 'public' and table_type = 'BASE TABLE' and table_name <> 'schema_migrations' order by 1`,
  );
  return rows.map((r) => r.t);
}

/** Parents before children, from the foreign keys in the live schema. */
async function ordered(q: Q): Promise<string[]> {
  const names = await tables(q);
  const fks = await q.query<{ child: string; parent: string }>(
    `select tc.table_name as child, ccu.table_name as parent
       from information_schema.table_constraints tc
       join information_schema.constraint_column_usage ccu on ccu.constraint_name = tc.constraint_name and ccu.table_schema = tc.table_schema
      where tc.constraint_type = 'FOREIGN KEY' and tc.table_schema = 'public'`,
  );
  const deps = new Map(names.map((n) => [n, new Set<string>()]));
  for (const f of fks) if (f.child !== f.parent) deps.get(f.child)?.add(f.parent);
  const out: string[] = [];
  const seen = new Set<string>();
  const visit = (n: string, path: Set<string>) => {
    if (seen.has(n)) return;
    if (path.has(n)) throw new Error(`foreign key cycle at ${n}`);
    path.add(n);
    for (const p of deps.get(n) ?? []) visit(p, path);
    path.delete(n);
    seen.add(n);
    out.push(n);
  };
  for (const n of names) visit(n, new Set());
  return out;
}

const ident = (n: string) => {
  if (!/^[a-z_][a-z0-9_]*$/.test(n)) throw new Error(`unexpected table name ${n}`);
  return `"${n}"`;
};

export async function exportDb(db: Db, now = Date.now): Promise<Backup> {
  return db.tx(async (q) => {
    await q.query('set transaction isolation level repeatable read, read only');
    const migrations = (await q.query<{ name: string }>('select name from schema_migrations order by name')).map((r) => r.name);
    const out: Backup = { format: BACKUP_FORMAT, version: BACKUP_VERSION, createdAt: new Date(now()).toISOString(), migrations, tables: {} };
    for (const t of await ordered(q)) {
      const rows = await q.query<{ r: unknown }>(`select to_jsonb(x) as r from ${ident(t)} x`);
      out.tables[t] = { rows: rows.map((r) => r.r) };
    }
    return out;
  });
}

export interface RestoreReport {
  tables: Record<string, number>;
}

/** Restores into an empty database with the same migrations. Refuses anything else, so nothing is ever overwritten. */
export async function restoreDb(db: Db, backup: Backup): Promise<RestoreReport> {
  if (backup?.format !== BACKUP_FORMAT || backup.version !== BACKUP_VERSION) throw new Error('not a TABLE21 backup (or a newer format)');
  return db.tx(async (q) => {
    const have = (await q.query<{ name: string }>('select name from schema_migrations order by name')).map((r) => r.name);
    if (have.join(',') !== backup.migrations.join(',')) {
      throw new Error(`schema mismatch: backup has [${backup.migrations.join(', ')}], target has [${have.join(', ')}]. Run the matching migrations first.`);
    }
    const order = await ordered(q);
    for (const t of order) {
      const n = (await q.query<{ n: number }>(`select count(*)::int as n from ${ident(t)}`))[0].n;
      if (n > 0) throw new Error(`target is not empty (${t} has ${n} rows). Restore only into a fresh database.`);
    }
    const report: RestoreReport = { tables: {} };
    for (const t of order) {
      const rows = backup.tables[t]?.rows ?? [];
      for (let i = 0; i < rows.length; i += 500) {
        const chunk = rows.slice(i, i + 500);
        await q.query(`insert into ${ident(t)} select * from jsonb_populate_recordset(null::${ident(t)}, $1::jsonb)`, [JSON.stringify(chunk)]);
      }
      report.tables[t] = rows.length;
    }
    // bigserial counters continue after the restored ids
    const serials = await q.query<{ t: string; c: string; s: string }>(
      `select table_name as t, column_name as c, pg_get_serial_sequence(quote_ident(table_name), column_name) as s
         from information_schema.columns where table_schema = 'public' and column_default like 'nextval(%'`,
    );
    for (const s of serials) {
      if (!s.s) continue;
      await q.query(`select setval($1, coalesce((select max(${ident(s.c)}) from ${ident(s.t)}), 0) + 1, false)`, [s.s]);
    }
    return report;
  });
}

/** Totals used to verify a restore: rows per table and the coin sums that must match exactly. */
export async function fingerprint(db: Db): Promise<{ tables: Record<string, number>; walletUnits: number; ledgerUnits: number }> {
  const out: Record<string, number> = {};
  for (const t of await tables(db)) out[t] = (await db.query<{ n: number }>(`select count(*)::int as n from ${ident(t)}`))[0].n;
  const w = await db.query<{ n: string }>('select coalesce(sum(available_units + reserved_units), 0)::bigint as n from wallets');
  const l = await db.query<{ n: string }>('select coalesce(sum(delta_available + delta_reserved), 0)::bigint as n from ledger');
  return { tables: out, walletUnits: Number(w[0].n), ledgerUnits: Number(l[0].n) };
}
