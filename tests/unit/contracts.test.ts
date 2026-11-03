// Contracts: every shared id and asset has one source of truth and no broken references (docs/TEAM_PLAYBOOK.md section 3).
// Hand-written checks only. Asset measurements come from scripts/asset-check.mjs, which reads the real files.
import { describe, expect, it } from 'vitest';
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createRequire } from 'node:module';
import { AVATARS, GIFTS, REACTIONS } from '../../packages/protocol/src/index.ts';
import { REACTION_TEXT } from '../../apps/web/src/i18n.ts';
import { GIFT_LABEL, REACTION_GLYPH, GiftIcon } from '../../apps/web/src/components/gifts.tsx';
// @ts-expect-error plain .mjs script without types
import { ROOT, compare, measureFile, readManifest } from '../../scripts/asset-check.mjs';

const root: string = ROOT ?? resolve(dirname(fileURLToPath(import.meta.url)), '../..');
const read = (p: string) => readFileSync(join(root, p), 'utf8');
const LOCALES = ['he', 'en'] as const;
const nonEmpty = (s: unknown) => typeof s === 'string' && s.trim().length > 0;

/* ---------------------------------------------------------------- handoffs */

type Schema = {
  type?: string | string[];
  enum?: unknown[];
  pattern?: string;
  required?: string[];
  properties?: Record<string, Schema>;
  additionalProperties?: boolean;
  items?: Schema;
};

/** Validator for the subset of JSON Schema used by handoff.schema.json. Returns a list of problems. */
function validate(value: unknown, schema: Schema, path = '$'): string[] {
  const errs: string[] = [];
  const kind = (v: unknown) => (v === null ? 'null' : Array.isArray(v) ? 'array' : typeof v);
  if (schema.type) {
    const allowed = Array.isArray(schema.type) ? schema.type : [schema.type];
    if (!allowed.includes(kind(value))) return [`${path}: expected ${allowed.join('|')}, got ${kind(value)}`];
  }
  if (schema.enum && !schema.enum.includes(value)) errs.push(`${path}: ${JSON.stringify(value)} not in enum ${JSON.stringify(schema.enum)}`);
  if (schema.pattern && typeof value === 'string' && !new RegExp(schema.pattern).test(value)) errs.push(`${path}: "${value}" does not match ${schema.pattern}`);
  if (kind(value) === 'object') {
    const obj = value as Record<string, unknown>;
    for (const k of schema.required ?? []) if (!(k in obj)) errs.push(`${path}: missing required key "${k}"`);
    for (const [k, v] of Object.entries(obj)) {
      const sub = schema.properties?.[k];
      if (sub) errs.push(...validate(v, sub, `${path}.${k}`));
      else if (schema.additionalProperties === false) errs.push(`${path}: extra key "${k}"`);
    }
  }
  if (kind(value) === 'array' && schema.items) (value as unknown[]).forEach((v, i) => errs.push(...validate(v, schema.items!, `${path}[${i}]`)));
  return errs;
}

describe('handoffs', () => {
  const schema = JSON.parse(read('docs/handoffs/handoff.schema.json')) as Schema;
  const files = readdirSync(join(root, 'docs/handoffs')).filter((f) => f.endsWith('.json') && f !== 'handoff.schema.json');

  it('the validator itself rejects a missing key, a bad enum, a bad pattern and an extra key', () => {
    const good = { task_id: 'T01-x', owner: 'asset-processor', status: 'planned', base_commit: 'abcdef1', result_commit: null, contract_version: 'protocol 1', changed_files: [], tests_run: [], evidence: [], known_gaps: [], next_action: 'go' };
    expect(validate(good, schema)).toEqual([]);
    const { next_action: _omit, ...missing } = good;
    expect(validate(missing, schema).join()).toMatch(/missing required key "next_action"/);
    expect(validate({ ...good, status: 'done' }, schema).join()).toMatch(/not in enum/);
    expect(validate({ ...good, base_commit: 'XYZ' }, schema).join()).toMatch(/does not match/);
    expect(validate({ ...good, extra: 1 }, schema).join()).toMatch(/extra key "extra"/);
    expect(validate({ ...good, changed_files: [1] }, schema).join()).toMatch(/expected string/);
  });

  it.each(files)('%s is valid and named after its task_id', (f) => {
    const data = JSON.parse(read(`docs/handoffs/${f}`));
    expect(validate(data, schema)).toEqual([]);
    expect(`${data.task_id}.json`).toBe(f);
  });
});

/* ------------------------------------------------------- reactions and gifts */

describe('reactions', () => {
  it('every id has non-empty he and en text, and no text exists for an unknown id', () => {
    for (const id of REACTIONS) for (const l of LOCALES) expect(nonEmpty(REACTION_TEXT[id]?.[l]), `REACTION_TEXT.${id}.${l}`).toBe(true);
    expect(Object.keys(REACTION_TEXT).sort()).toEqual([...REACTIONS].sort());
  });

  it('every id has a glyph and no glyph exists for an unknown id', () => {
    for (const id of REACTIONS) expect(nonEmpty(REACTION_GLYPH[id]), `REACTION_GLYPH.${id}`).toBe(true);
    expect(Object.keys(REACTION_GLYPH).sort()).toEqual([...REACTIONS].sort());
  });
});

describe('gifts', () => {
  it('every id has non-empty he and en text (GIFT_LABEL), and no label exists for an unknown id', () => {
    for (const id of GIFTS) for (const l of LOCALES) expect(nonEmpty(GIFT_LABEL[id]?.[l]), `GIFT_LABEL.${id}.${l}`).toBe(true);
    expect(Object.keys(GIFT_LABEL).sort()).toEqual([...GIFTS].sort());
  });

  it('every id renders art: a vector icon with shapes, or a raster that is in the manifest', async () => {
    // react is a dependency of apps/web only, so resolve it from there (the same copy gifts.tsx uses).
    const webRequire = createRequire(join(root, 'apps/web/package.json'));
    const { createElement } = webRequire('react');
    const { renderToStaticMarkup } = webRequire('react-dom/server');
    const urls = new Set((readManifest() as { file: string }[]).map((e) => '/' + e.file.replace('apps/web/public/', '')));
    for (const id of GIFTS) {
      const html: string = renderToStaticMarkup(createElement(GiftIcon, { id, size: 28 }));
      const img = /<img[^>]*\ssrc="([^"]+)"/.exec(html)?.[1];
      if (img) expect(urls.has(img), `${id} raster ${img} is not in the manifest`).toBe(true);
      else expect(html, `${id} renders no art`).toMatch(/<svg[^>]*>.*<(path|circle|rect)\b/s);
    }
  });

  it('the manifest holds no gift or reaction asset for an unknown id', () => {
    const ids = (readManifest() as { id: string }[]).map((e) => e.id);
    expect(ids.filter((i) => i.startsWith('gift.')).map((i) => i.slice(5)).filter((g) => !(GIFTS as readonly string[]).includes(g))).toEqual([]);
    expect(ids.filter((i) => i.startsWith('reaction.')).map((i) => i.slice(9)).filter((r) => !(REACTIONS as readonly string[]).includes(r))).toEqual([]);
  });
});

/* -------------------------------------------------------------- avatars, backs */

type Entry = {
  id: string; file: string; version: number; status: string; role: string; source: string; license: string;
  bytes: number | null; format: string; width: number; height: number; alphaRequired: boolean; alphaPresent: boolean | null; anchor: string;
  optimization?: string;
};
const manifest = readManifest() as Entry[];
const byId = new Map(manifest.map((e) => [e.id, e]));
const urlOf = (e: Entry) => '/' + e.file.replace('apps/web/public/', '');

describe('avatars and card backs', () => {
  it('every protocol avatar has an active avatar asset that exists, and there are no extra avatar assets', () => {
    for (const a of AVATARS) {
      const e = byId.get(`avatar.${a}`);
      expect(e, `manifest avatar.${a}`).toBeTruthy();
      expect(e!.status).toBe('active');
      expect(existsSync(join(root, e!.file))).toBe(true);
      expect(urlOf(e!)).toBe(`/art/avatars/${a}.svg`);
    }
    const extra = manifest.filter((e) => e.id.startsWith('avatar.')).map((e) => e.id.slice(7)).filter((a) => !(AVATARS as readonly string[]).includes(a));
    expect(extra).toEqual([]);
  });

  it('every card back the server can unlock (UNLOCKS in apps/server/src/social.ts) has an active svg asset', () => {
    // Read as text: importing the server module would pull in the database layer.
    const backs = [...read('apps/server/src/social.ts').matchAll(/id: '(\w+)', kind: 'card_back'/g)].map((m) => m[1]);
    expect(backs.length).toBeGreaterThan(0);
    for (const b of backs) {
      const e = byId.get(`back.${b}`);
      expect(e, `manifest back.${b}`).toBeTruthy();
      expect(e!.status).toBe('active');
      expect(urlOf(e!)).toBe(`/art/backs/${b}.svg`);
    }
    expect(manifest.filter((e) => e.id.startsWith('back.')).map((e) => e.id.slice(5)).sort()).toEqual([...backs].sort());
  });

  it('AD-8: gifts use their original SVGs, the glossy coffee raster is retired in the manifest and no source references it', () => {
    expect(byId.get('club.coffee')?.status).toBe('retired');
    const src = readFileSync(join(root, 'apps/web/src/components/gifts.tsx'), 'utf8');
    expect(src).toMatch(/const GIFT_ART[^=]*= \{\};/);
    expect(src).not.toContain('coffee.webp');
    expect(byId.get('club.rail-near')?.status).toBe('active');
    expect(byId.get('club.rail-near')?.alphaRequired).toBe(false);
  });

  it('the dealer portrait exists', () => {
    expect(byId.get('dealer.portrait')?.status).toBe('active');
  });
});

/* ------------------------------------------------------------------- manifest */

const STATUS = ['active', 'pending_manual', 'deprecated', 'retired'];
const ANCHORS = ['center', 'top-center', 'bottom-center', 'top-left', 'top-right', 'bottom-left', 'bottom-right', 'left-center', 'right-center'];
const FORMATS = ['svg', 'png', 'webp', 'jpeg'];

describe('asset manifest', () => {
  it('ids and files are unique and ids are well formed', () => {
    const dup = (xs: string[]) => xs.filter((x, i) => xs.indexOf(x) !== i);
    expect(dup(manifest.map((e) => e.id))).toEqual([]);
    expect(dup(manifest.map((e) => e.file))).toEqual([]);
    for (const e of manifest) expect(e.id, e.id).toMatch(/^[a-z0-9]+(\.[a-z0-9-]+)+$/);
  });

  it('every entry has the catalog fields with valid values', () => {
    for (const e of manifest) {
      const at = `${e.id}`;
      expect(STATUS, `${at} status`).toContain(e.status);
      expect(Number.isInteger(e.version) && e.version >= 1, `${at} version`).toBe(true);
      expect(nonEmpty(e.license), `${at} license`).toBe(true);
      expect(nonEmpty(e.source), `${at} source`).toBe(true);
      expect(nonEmpty(e.role), `${at} role`).toBe(true);
      expect(FORMATS, `${at} format`).toContain(e.format);
      expect(ANCHORS, `${at} anchor`).toContain(e.anchor);
      expect(typeof e.alphaRequired, `${at} alphaRequired`).toBe('boolean');
      expect(Number.isInteger(e.width) && Number.isInteger(e.height) && e.width > 0 && e.height > 0, `${at} size`).toBe(true);
    }
  });

  it('every active entry points at a real file whose bytes, format, dimensions and alpha match the manifest', () => {
    for (const e of manifest.filter((x) => x.status !== 'pending_manual')) {
      expect(existsSync(join(root, e.file)), `${e.id}: ${e.file} is missing`).toBe(true);
      const r = compare(e);
      expect(r.diffs, `${e.id} differs from its file (run: node scripts/asset-check.mjs --write)`).toEqual([]);
    }
  });

  it('a planned entry has no file yet and no measured bytes or alpha', () => {
    for (const e of manifest.filter((x) => x.status === 'pending_manual')) {
      expect(existsSync(join(root, e.file)), `${e.id}: file exists, so set status active and measure it`).toBe(false);
      expect(e.bytes).toBeNull();
      expect(e.alphaPresent).toBeNull();
    }
  });

  it('alpha is present wherever the role requires it', () => {
    for (const e of manifest.filter((x) => x.status === 'active' && x.alphaRequired)) expect(e.alphaPresent, `${e.id} needs alpha but the file has none`).toBe(true);
  });

  it('the measurement is read from the file, not trusted from the manifest', () => {
    // coffee.webp is a keyed-out icon: the header must report an alpha channel.
    expect(measureFile(join(root, 'apps/web/public/art/club/coffee.webp')).alphaPresent).toBe(true);
    // the room background is opaque.
    expect(measureFile(join(root, 'apps/web/public/art/club/room-portrait.webp')).alphaPresent).toBe(false);
    // an SVG is vector and measured from its viewBox.
    expect(measureFile(join(root, 'apps/web/public/art/avatars/amber.svg'))).toMatchObject({ format: 'svg', width: 128, height: 128, alphaPresent: true });
  });

  it('no image under apps/web/public is missing from the manifest (no orphans)', () => {
    const pub = join(root, 'apps/web/public');
    const files: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(svg|png|webp|jpe?g|gif|avif|ico)$/i.test(n)) files.push(relative(root, p).split('\\').join('/'));
      }
    };
    walk(pub);
    expect(files.length).toBeGreaterThan(20);
    const known = new Set(manifest.map((e) => e.file));
    expect(files.filter((f) => !known.has(f))).toEqual([]);
  });

  it('every image path referenced from apps/web is in the manifest', () => {
    const backs = [...read('apps/server/src/social.ts').matchAll(/id: '(\w+)', kind: 'card_back'/g)].map((m) => m[1]);
    const clubDir = /CLUB_ART = '([^']+)'/.exec(read('apps/web/src/art.ts'))![1];
    const sources: string[] = [];
    const walk = (d: string) => {
      for (const n of readdirSync(d)) {
        const p = join(d, n);
        if (statSync(p).isDirectory()) walk(p);
        else if (/\.(tsx?|css)$/.test(n)) sources.push(p);
      }
    };
    walk(join(root, 'apps/web/src'));
    sources.push(join(root, 'apps/web/index.html'), join(root, 'apps/web/public/boot.js'), join(root, 'apps/web/public/manifest.webmanifest'));

    const refs = new Map<string, string>(); // url -> first file that uses it
    const add = (url: string, from: string) => refs.has(url) || refs.set(url, relative(root, from));
    const RE = /\/(?:art|icons)\/(?:[\w.\-/]|\$\{[^}]*\})+\.(?:svg|webp|png|jpe?g)|\/favicon\.svg|\$\{CLUB_ART\}\/[\w.\-]+\.(?:svg|webp|png)/g;
    for (const f of sources) {
      for (const m of read(relative(root, f)).matchAll(RE)) {
        let url = m[0].replace('${CLUB_ART}', clubDir);
        if (url.includes('${')) {
          // template string: expand from the id list that feeds it
          if (url.startsWith('/art/avatars/')) for (const a of AVATARS) add(url.replace(/\$\{[^}]*\}/, a), f);
          else if (url.startsWith('/art/backs/')) for (const b of backs) add(url.replace(/\$\{[^}]*\}/, b), f);
          else throw new Error(`unexpanded template in ${relative(root, f)}: ${url}`);
        } else add(url, f);
      }
    }
    expect(refs.size).toBeGreaterThan(15);
    const known = new Set(manifest.filter((e) => e.status !== 'pending_manual').map(urlOf));
    const broken = [...refs].filter(([u]) => !known.has(u)).map(([u, f]) => `${u} (in ${f})`);
    expect(broken).toEqual([]);
  });
});
