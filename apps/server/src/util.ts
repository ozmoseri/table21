import { randomBytes, randomInt, createHash } from 'node:crypto';

export const newId = (prefix: string): string => `${prefix}_${randomBytes(12).toString('base64url')}`;

const CODE_ALPHABET = '23456789ABCDEFGHJKMNPQRSTUVWXYZ';
export const newCode = (len = 6): string => Array.from({ length: len }, () => CODE_ALPHABET[randomInt(CODE_ALPHABET.length)]).join('');
export const normalizeCode = (s: string): string => s.toUpperCase().replace(/[^0-9A-Z]/g, '').slice(0, 8);

export const sha256 = (s: string): string => createHash('sha256').update(s).digest('hex');
export const newToken = (): string => randomBytes(32).toString('base64url');

export const TZ = 'Asia/Jerusalem';

/** Local calendar date (YYYY-MM-DD) in Asia/Jerusalem for a UTC instant. */
export function jerusalemDate(t: number): string {
  return new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date(t));
}

function tzOffsetMs(t: number): number {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hourCycle: 'h23',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
  }).formatToParts(new Date(t));
  const g = (k: string) => Number(parts.find((p) => p.type === k)!.value);
  return Date.UTC(g('year'), g('month') - 1, g('day'), g('hour'), g('minute'), g('second')) - Math.floor(t / 1000) * 1000;
}

/** UTC instant of local midnight (Asia/Jerusalem) for the given local date string. */
export function jerusalemMidnightUtc(date: string): number {
  const [y, m, d] = date.split('-').map(Number);
  const guess = Date.UTC(y, m - 1, d);
  let t = guess - tzOffsetMs(guess);
  t = guess - tzOffsetMs(t);
  return t;
}

/** Start (UTC ms) of the current week, Monday 00:00 Asia/Jerusalem. */
export function jerusalemWeekStart(t: number): number {
  const date = jerusalemDate(t);
  const [y, m, d] = date.split('-').map(Number);
  const dow = new Date(Date.UTC(y, m - 1, d)).getUTCDay(); // 0 = Sunday
  const back = (dow + 6) % 7;
  const monday = new Date(Date.UTC(y, m - 1, d - back)).toISOString().slice(0, 10);
  return jerusalemMidnightUtc(monday);
}

export function nextJerusalemMidnight(t: number): number {
  const [y, m, d] = jerusalemDate(t).split('-').map(Number);
  return jerusalemMidnightUtc(new Date(Date.UTC(y, m - 1, d + 1)).toISOString().slice(0, 10));
}

/** Simple per-key token bucket. */
export class RateLimiter {
  private buckets = new Map<string, { tokens: number; at: number }>();
  constructor(private capacity: number, private refillPerSec: number) {}
  take(key: string, now = Date.now()): boolean {
    const b = this.buckets.get(key) ?? { tokens: this.capacity, at: now };
    b.tokens = Math.min(this.capacity, b.tokens + ((now - b.at) / 1000) * this.refillPerSec);
    b.at = now;
    if (b.tokens < 1) {
      this.buckets.set(key, b);
      return false;
    }
    b.tokens -= 1;
    this.buckets.set(key, b);
    if (this.buckets.size > 50_000) this.buckets.clear();
    return true;
  }
}
