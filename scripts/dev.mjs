#!/usr/bin/env node
// Development: server (tsx watch, :3021) + Vite dev server (:5173, proxies /api and /socket.io).
import { spawn } from 'node:child_process';
const procs = [
  spawn('pnpm', ['--filter', '@table21/server', 'dev'], { stdio: 'inherit', env: process.env }),
  spawn('pnpm', ['--filter', '@table21/web', 'dev'], { stdio: 'inherit', env: process.env }),
];
const stop = () => procs.forEach((p) => p.kill('SIGTERM'));
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
procs.forEach((p) => p.on('exit', (code) => { if (code) { stop(); process.exit(code); } }));
