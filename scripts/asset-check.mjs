#!/usr/bin/env node
// Asset catalog checker. Reads the real files listed in assets/manifest.json (pure Node, no dependencies) and measures
// format, dimensions, bytes and whether the file carries an alpha channel.
//
//   node scripts/asset-check.mjs            print a table (exit 1 when a recorded value differs from the file)
//   node scripts/asset-check.mjs --write    rewrite the measured fields in assets/manifest.json
//
// Measured fields: bytes, format, width, height, alphaPresent (and the "N bytes" figure inside `optimization`).
// Everything else in the manifest is human-written and is never touched.
// Alpha is read from the container header, not decoded: PNG color type 4/6 or a tRNS chunk; WebP VP8X alpha flag or the
// VP8L alpha hint bit (lossy VP8 has none); JPEG never; SVG is vector and counts as true.
import { readFileSync, existsSync, writeFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
export const MANIFEST = resolve(ROOT, 'assets/manifest.json');

function png(buf) {
  if (buf.length < 33 || buf.readUInt32BE(0) !== 0x89504e47) throw new Error('not a PNG');
  const width = buf.readUInt32BE(16);
  const height = buf.readUInt32BE(20);
  const colorType = buf[25];
  let alpha = colorType === 4 || colorType === 6;
  for (let p = 8; p + 8 <= buf.length; ) {
    const len = buf.readUInt32BE(p);
    const type = buf.toString('latin1', p + 4, p + 8);
    if (type === 'tRNS') alpha = true;
    if (type === 'IDAT' || type === 'IEND') break;
    p += 12 + len;
  }
  return { format: 'png', width, height, alphaPresent: alpha };
}

function webp(buf) {
  if (buf.length < 30 || buf.toString('latin1', 0, 4) !== 'RIFF' || buf.toString('latin1', 8, 12) !== 'WEBP') throw new Error('not a WebP');
  const kind = buf.toString('latin1', 12, 16);
  if (kind === 'VP8X') {
    return {
      format: 'webp',
      width: 1 + buf.readUIntLE(24, 3),
      height: 1 + buf.readUIntLE(27, 3),
      alphaPresent: (buf[20] & 0x10) !== 0,
    };
  }
  if (kind === 'VP8L') {
    if (buf[20] !== 0x2f) throw new Error('bad VP8L signature');
    const bits = buf.readUInt32LE(21);
    return { format: 'webp', width: (bits & 0x3fff) + 1, height: ((bits >>> 14) & 0x3fff) + 1, alphaPresent: ((bits >>> 28) & 1) === 1 };
  }
  if (kind === 'VP8 ') {
    if (buf[23] !== 0x9d || buf[24] !== 0x01 || buf[25] !== 0x2a) throw new Error('bad VP8 start code');
    return { format: 'webp', width: buf.readUInt16LE(26) & 0x3fff, height: buf.readUInt16LE(28) & 0x3fff, alphaPresent: false };
  }
  throw new Error(`unknown WebP chunk ${kind}`);
}

function jpeg(buf) {
  if (buf[0] !== 0xff || buf[1] !== 0xd8) throw new Error('not a JPEG');
  for (let p = 2; p + 9 < buf.length; ) {
    if (buf[p] !== 0xff) { p++; continue; }
    const marker = buf[p + 1];
    if (marker >= 0xc0 && marker <= 0xcf && ![0xc4, 0xc8, 0xcc].includes(marker)) {
      return { format: 'jpeg', width: buf.readUInt16BE(p + 7), height: buf.readUInt16BE(p + 5), alphaPresent: false };
    }
    p += 2 + buf.readUInt16BE(p + 2);
  }
  throw new Error('no JPEG frame header');
}

function svg(buf) {
  const text = buf.toString('utf8');
  const tag = /<svg\b[^>]*>/i.exec(text)?.[0];
  if (!tag) throw new Error('not an SVG');
  const vb = /viewBox\s*=\s*["']\s*[-\d.]+[ ,]+[-\d.]+[ ,]+([\d.]+)[ ,]+([\d.]+)\s*["']/i.exec(tag);
  const w = /\swidth\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(tag);
  const h = /\sheight\s*=\s*["']([\d.]+)(?:px)?["']/i.exec(tag);
  const width = Math.round(Number(vb ? vb[1] : w?.[1]));
  const height = Math.round(Number(vb ? vb[2] : h?.[1]));
  if (!width || !height) throw new Error('SVG has no viewBox or width/height');
  return { format: 'svg', width, height, alphaPresent: true };
}

/** Measure one file. Returns { bytes, format, width, height, alphaPresent }. */
export function measureFile(absPath) {
  const buf = readFileSync(absPath);
  const lower = absPath.toLowerCase();
  const info = lower.endsWith('.png') ? png(buf) : lower.endsWith('.webp') ? webp(buf) : /\.jpe?g$/.test(lower) ? jpeg(buf) : lower.endsWith('.svg') ? svg(buf) : null;
  if (!info) throw new Error(`unsupported file type: ${absPath}`);
  return { bytes: statSync(absPath).size, ...info };
}

export const readManifest = () => JSON.parse(readFileSync(MANIFEST, 'utf8'));

/** The same figure the human-written `optimization` text quotes ("... 34298 bytes"). */
const BYTES_IN_TEXT = /\b(\d+) bytes\b/;

export function compare(entry) {
  const abs = resolve(ROOT, entry.file);
  if (!existsSync(abs)) return { missing: true, diffs: [] };
  const m = measureFile(abs);
  const diffs = [];
  for (const k of ['bytes', 'format', 'width', 'height', 'alphaPresent']) if (entry[k] !== m[k]) diffs.push(`${k}: manifest ${JSON.stringify(entry[k])} file ${JSON.stringify(m[k])}`);
  const quoted = BYTES_IN_TEXT.exec(entry.optimization ?? '');
  if (quoted && Number(quoted[1]) !== m.bytes) diffs.push(`optimization text quotes ${quoted[1]} bytes, file has ${m.bytes}`);
  return { missing: false, measured: m, diffs };
}

function main() {
  const write = process.argv.includes('--write');
  const manifest = readManifest();
  const rows = [];
  let drift = 0;
  const out = manifest.map((entry) => {
    const r = compare(entry);
    if (r.missing) {
      rows.push([entry.id, entry.status, '-', '-', '-', '-', '-', entry.status === 'pending_manual' ? 'planned (no file)' : 'MISSING FILE']);
      if (entry.status !== 'pending_manual') drift++;
      return entry;
    }
    const m = r.measured;
    rows.push([entry.id, entry.status, m.format, `${m.width}x${m.height}`, String(m.bytes), `req ${entry.alphaRequired ? 'y' : 'n'} / has ${m.alphaPresent ? 'y' : 'n'}`, entry.anchor ?? '-', r.diffs.length ? `DRIFT: ${r.diffs.join('; ')}` : 'ok']);
    if (r.diffs.length) drift++;
    const next = { ...entry, bytes: m.bytes, format: m.format, width: m.width, height: m.height, alphaPresent: m.alphaPresent };
    if (next.optimization) next.optimization = next.optimization.replace(BYTES_IN_TEXT, `${m.bytes} bytes`);
    return next;
  });
  const head = ['id', 'status', 'fmt', 'size', 'bytes', 'alpha', 'anchor', 'check'];
  const widths = head.map((h, i) => Math.max(h.length, ...rows.map((r) => String(r[i]).length)));
  for (const r of [head, ...rows]) console.log(r.map((c, i) => String(c).padEnd(widths[i])).join('  ').trimEnd());
  if (write) {
    writeFileSync(MANIFEST, JSON.stringify(out, null, 2) + '\n');
    console.log(`\nmeasured fields written for ${out.length} entries (${drift} had drifted)`);
    return;
  }
  console.log(drift ? `\n${drift} entries differ from the files. Run with --write to record the measured values.` : '\nmanifest matches the files.');
  process.exitCode = drift ? 1 : 0;
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
