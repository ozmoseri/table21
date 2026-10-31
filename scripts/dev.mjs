#!/usr/bin/env node
// Development: server (tsx watch, :3021) + Vite dev server (:5173, proxies /api and /socket.io).
// Runs both tools through the current Node binary (no pnpm/.cmd shims), so it works on Windows too.
import { join } from 'node:path';
import { checkNode, pkgFile, runNode, serverDir, webDir } from './lib/proc.mjs';

checkNode();
const server = runNode([pkgFile(serverDir, 'tsx', 'dist/cli.mjs'), 'watch', join('src', 'main.ts')], { cwd: serverDir, env: process.env, label: 'Server' });
const web = runNode([pkgFile(webDir, 'vite', 'bin/vite.js')], { cwd: webDir, env: process.env, label: 'Vite' });
for (const p of [server, web]) {
  p.on('exit', (code) => {
    if (code) {
      server.kill('SIGTERM');
      web.kill('SIGTERM');
      process.exit(code);
    }
  });
}
