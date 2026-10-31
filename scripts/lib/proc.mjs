// Cross-platform process helpers. We never spawn `pnpm`/`npx` (on Windows those are .cmd shims that need a
// shell). Instead every tool runs through the current Node binary with an argument array, so paths with
// spaces work on Windows, macOS and Linux without any shell quoting.
import { spawn, spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const root = resolve(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const webDir = join(root, 'apps', 'web');
export const serverDir = join(root, 'apps', 'server');

export function fail(msg) {
  console.error(`\n[TABLE21] ${msg}\n`);
  process.exit(1);
}

export function checkNode() {
  const [maj, min] = process.versions.node.split('.').map(Number);
  if (maj < 22 || (maj === 22 && min < 12)) fail(`Node.js ${process.versions.node} is too old. Install Node.js 22.12 or newer (LTS) from https://nodejs.org.`);
}

/** Absolute path of a file inside an installed package, resolved from a workspace package. */
export function pkgFile(fromDir, pkg, file) {
  try {
    const req = createRequire(join(fromDir, 'package.json'));
    const p = join(dirname(req.resolve(`${pkg}/package.json`)), file);
    if (existsSync(p)) return p;
  } catch {}
  fail(`Dependency "${pkg}" is missing. Run "pnpm install" in ${root} first.`);
}

/** Runs node with args and waits. Exits with a clear message on failure. */
export function runNodeSync(args, { cwd, env, label }) {
  const r = spawnSync(process.execPath, args, { cwd, env, stdio: 'inherit', windowsHide: true });
  if (r.error) fail(`${label} could not start: ${r.error.message}`);
  if (r.status !== 0) fail(`${label} failed (exit code ${r.status}). See the messages above.`);
}

/** Starts node with args in the background and forwards termination signals. */
export function runNode(args, { cwd, env, label, stdio = 'inherit' }) {
  const child = spawn(process.execPath, args, { cwd, env, stdio, windowsHide: true });
  child.on('error', (e) => fail(`${label} could not start: ${e.message}`));
  const stop = () => {
    if (!child.killed) child.kill('SIGTERM');
  };
  process.on('SIGINT', stop);
  process.on('SIGTERM', stop);
  process.on('exit', stop);
  return child;
}
