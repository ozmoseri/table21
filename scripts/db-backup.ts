// TABLE21 database backup and restore, run from any computer that can reach the database.
//
//   pnpm db:backup export  <DATABASE_URL> <file.json.gz>   consistent snapshot of every table
//   pnpm db:backup restore <DATABASE_URL> <file.json.gz>   into an EMPTY database: migrates it, then loads the rows
//   pnpm db:backup verify  <DATABASE_URL> <file.json.gz>   compares row counts and coin totals with the file
//
// On Render the free database refuses outside connections by default (render.yaml ipAllowList: []). Either download
// the backup from the app (Settings, pilot card, operator only), or allow your own IP for a few minutes in the
// database's Access Control and use the External Database URL here. docs/DEPLOY.md "Backup and restore".
// The file contains every account (names, hashed tokens): keep it private, never commit it.
import { readFileSync, writeFileSync } from 'node:fs';
import { gunzipSync, gzipSync } from 'node:zlib';
import { migrate, postgresDb } from '../apps/server/src/db.ts';
import { exportDb, fingerprint, restoreDb, type Backup } from '../apps/server/src/backup.ts';

const [cmd, url, file] = process.argv.slice(2);
if (!['export', 'restore', 'verify'].includes(cmd ?? '') || !url || !file) {
  console.error('usage: pnpm db:backup export|restore|verify <DATABASE_URL> <file.json.gz>');
  process.exit(2);
}
const where = url.replace(/\/\/[^@]*@/, '//***@'); // never print the password
const db = postgresDb(url);
const read = (): Backup => JSON.parse((file.endsWith('.gz') ? gunzipSync(readFileSync(file)) : readFileSync(file)).toString());
const totals = (t: Record<string, number>) => Object.values(t).reduce((a, b) => a + b, 0);

try {
  if (cmd === 'export') {
    const b = await exportDb(db);
    const json = Buffer.from(JSON.stringify(b));
    writeFileSync(file, file.endsWith('.gz') ? gzipSync(json) : json);
    const rows = Object.fromEntries(Object.entries(b.tables).map(([k, v]) => [k, v.rows.length]));
    console.log(`exported ${totals(rows)} rows from ${Object.keys(rows).length} tables (${b.migrations.at(-1)}) from ${where} to ${file}`);
  } else if (cmd === 'restore') {
    const b = read();
    // Bring the empty database to the backup's schema, load the rows, then apply any newer migrations on top,
    // exactly as a running server would upgrade that data.
    const base = await migrate(db, b.migrations.at(-1));
    if (base.length) console.log(`schema as in the backup: ${base.join(', ')}`);
    const r = await restoreDb(db, b);
    console.log(`restored ${totals(r.tables)} rows into ${where}`);
    const newer = await migrate(db);
    if (newer.length) console.log(`upgraded after restore: ${newer.join(', ')}`);
  }
  if (cmd === 'restore' || cmd === 'verify') {
    const b = read();
    const fp = await fingerprint(db);
    const want = Object.fromEntries(Object.entries(b.tables).map(([k, v]) => [k, v.rows.length]));
    // Every table in the file must match exactly; tables added by newer migrations must still be empty.
    const diff = Object.keys({ ...want, ...fp.tables }).filter((t) => (want[t] ?? 0) !== (fp.tables[t] ?? 0));
    const walletUnits = Object.values(b.tables.wallets?.rows ?? []).reduce((s: number, w: any) => s + Number(w.available_units) + Number(w.reserved_units), 0);
    if (diff.length || walletUnits !== fp.walletUnits || fp.walletUnits !== fp.ledgerUnits) {
      console.error(`VERIFY FAILED: tables ${diff.join(', ') || 'ok'}; wallets file ${walletUnits} db ${fp.walletUnits}; ledger ${fp.ledgerUnits}`);
      process.exitCode = 1;
    } else console.log(`verify ok: ${totals(fp.tables)} rows match; wallets ${fp.walletUnits} units = ledger ${fp.ledgerUnits} units`);
  }
} catch (e: any) {
  console.error(`${cmd} failed: ${e?.message ?? e}`);
  process.exitCode = 1;
} finally {
  await db.close();
}
