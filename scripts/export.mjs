#!/usr/bin/env node
// Creates a portable, sanitized source checkpoint: exports/table21-<label>-<sha>.tar.gz (+ .bundle with history).
// Only git-tracked files are included, so node_modules, caches, .env files and live database data are excluded.
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve, dirname } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const label = (process.argv[2] ?? 'checkpoint').replace(/[^a-z0-9-]/gi, '');
const git = (...a) => execFileSync('git', a, { cwd: root, encoding: 'utf8' }).trim();

const dirty = git('status', '--porcelain');
if (dirty) {
  console.error('Working tree has uncommitted changes. Commit first so the archive matches a commit.\n' + dirty);
  process.exit(1);
}

// Refuse to export anything that looks like a secret.
const files = git('ls-files').split('\n').filter(Boolean);
const forbiddenNames = files.filter((f) => /(^|\/)\.env($|\.(?!example$))|\.pem$|id_rsa|\.key$/.test(f));
const patterns = [/-----BEGIN [A-Z ]*PRIVATE KEY-----/, /\bghp_[A-Za-z0-9]{20,}/, /\bsk-[A-Za-z0-9]{20,}/, /\bAKIA[0-9A-Z]{16}\b/, /\bxox[bap]-[A-Za-z0-9-]{10,}/];
const hits = [];
for (const f of files) {
  if (/\.(png|jpg|webp|woff2?|ico)$/.test(f)) continue;
  const text = readFileSync(join(root, f), 'utf8');
  if (patterns.some((p) => p.test(text))) hits.push(f);
}
if (forbiddenNames.length || hits.length) {
  console.error('Possible secrets found, export aborted:', [...forbiddenNames, ...hits]);
  process.exit(1);
}

const required = ['package.json', 'pnpm-lock.yaml', 'RESTORE.md', 'docs/NEXT_STEPS.md', 'apps/server/migrations/001_init.sql', 'packages/game-engine/src/round.ts'];
const missing = required.filter((f) => !files.includes(f));
if (missing.length) {
  console.error('Required files missing from the commit:', missing);
  process.exit(1);
}

const sha = git('rev-parse', '--short=10', 'HEAD');
const out = join(root, 'exports');
mkdirSync(out, { recursive: true });
const base = `table21-${label}-${sha}`;
const tar = join(out, `${base}.tar.gz`);
git('archive', '--format=tar.gz', `--prefix=table21/`, '-o', tar, 'HEAD');
const bundle = join(out, `${base}.bundle`);
git('bundle', 'create', bundle, 'HEAD', 'main');

// Verify: list and extract into a temp dir, check required files exist.
const listing = execFileSync('tar', ['-tzf', tar], { encoding: 'utf8' }).split('\n');
for (const f of required) if (!listing.includes(`table21/${f}`)) throw new Error(`archive missing ${f}`);
const tmp = mkdtempSync(join(tmpdir(), 't21x-'));
execFileSync('tar', ['-xzf', tar, '-C', tmp]);
rmSync(tmp, { recursive: true, force: true });
git('bundle', 'verify', bundle);

const hash = (p) => createHash('sha256').update(readFileSync(p)).digest('hex');
const info = {
  label,
  commit: git('rev-parse', 'HEAD'),
  createdAt: new Date().toISOString(),
  files: listing.filter((l) => l && !l.endsWith('/')).length,
  archive: { path: tar, sha256: hash(tar) },
  bundle: { path: bundle, sha256: hash(bundle) },
};
writeFileSync(join(out, `${base}.json`), JSON.stringify(info, null, 2));
console.log(JSON.stringify(info, null, 2));
