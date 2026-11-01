import { getPrefs } from './prefs.ts';

/**
 * Original synthesized sound set (WebAudio). Nothing is fetched, so offline modes keep audio.
 *
 * Rules (docs/SOUND_SPEC.md):
 * - Every sound goes through one master gain, so stopAll() can silence queued sounds on resync, background or round change.
 * - A per-sound minimum gap and a small voice budget stop piles of overlapping sounds.
 * - No alarm or punishing sound for a loss; a push is a plain chip sound, never a celebration.
 * - Audio starts only after a user gesture (browser rule); before that, calls are ignored.
 */
export type Sfx = 'tap' | 'chip' | 'bet' | 'deal' | 'flip' | 'turn' | 'payout' | 'win' | 'blackjack' | 'lose' | 'gift' | 'reward';
export const SFX: Sfx[] = ['tap', 'chip', 'bet', 'deal', 'flip', 'turn', 'payout', 'win', 'blackjack', 'lose', 'gift', 'reward'];

/** Minimum seconds between two plays of the same sound, and approximate length (for the voice budget). */
const GAP: Record<Sfx, number> = { tap: 0.03, chip: 0.04, bet: 0.12, deal: 0.05, flip: 0.15, turn: 0.4, payout: 0.3, win: 0.6, blackjack: 0.8, lose: 0.5, gift: 0.5, reward: 0.6 };
const LEN: Record<Sfx, number> = { tap: 0.04, chip: 0.1, bet: 0.16, deal: 0.09, flip: 0.12, turn: 0.13, payout: 0.36, win: 0.36, blackjack: 0.62, lose: 0.24, gift: 0.5, reward: 0.55 };
const MAX_VOICES = 4;

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
const last = new Map<Sfx, number>();
let voices: number[] = [];

function live(): { c: AudioContext; out: GainNode } | null {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  if (!master) {
    master = ctx.createGain();
    master.gain.value = 2.4;
    master.connect(ctx.destination);
  }
  return { c: ctx, out: master };
}

function noise(c: BaseAudioContext, out: AudioNode, t0: number, dur: number, freq: number, gain: number, q = 0.8) {
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = q;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(out);
  src.start(t0);
}

function tone(c: BaseAudioContext, out: AudioNode, t0: number, freq: number, dur: number, gain: number, type: OscillatorType = 'sine') {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const g = c.createGain();
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(out);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

/** Schedules one sound at absolute time t0 on any context (live or offline render). */
export function synth(c: BaseAudioContext, out: AudioNode, s: Sfx, t0: number) {
  switch (s) {
    case 'tap':
      tone(c, out, t0, 1200, 0.03, 0.025);
      break;
    case 'chip': // one chip picked: short ceramic click
      tone(c, out, t0, 2100, 0.07, 0.07, 'triangle');
      tone(c, out, t0 + 0.035, 2900, 0.06, 0.045, 'triangle');
      break;
    case 'bet': // a stack set down on the felt: two soft clacks, lower
      noise(c, out, t0, 0.05, 1500, 0.22, 1.4);
      noise(c, out, t0 + 0.07, 0.06, 1100, 0.18, 1.4);
      break;
    case 'deal': // card slide
      noise(c, out, t0, 0.09, 2400, 0.3);
      break;
    case 'flip': // hole card turned
      noise(c, out, t0, 0.06, 3200, 0.26);
      noise(c, out, t0 + 0.05, 0.05, 1800, 0.18);
      break;
    case 'turn': // gentle chime, once per turn
      tone(c, out, t0, 990, 0.12, 0.045);
      break;
    case 'payout': // chips counted back: three quick clicks
      [0, 0.09, 0.18].forEach((d, i) => tone(c, out, t0 + d, 2300 + i * 180, 0.07, 0.05, 'triangle'));
      break;
    case 'win':
      [0, 0.09, 0.18].forEach((d, i) => tone(c, out, t0 + d, 2300 + i * 180, 0.07, 0.045, 'triangle'));
      tone(c, out, t0 + 0.1, 660, 0.18, 0.06);
      tone(c, out, t0 + 0.19, 880, 0.24, 0.05);
      break;
    case 'blackjack':
      [523, 659, 784, 1047].forEach((f, i) => tone(c, out, t0 + i * 0.08, f, 0.3, 0.055));
      break;
    case 'lose': // neutral, low and short; never an alarm
      noise(c, out, t0, 0.12, 600, 0.12, 0.7);
      break;
    case 'gift': // soft bell
      tone(c, out, t0, 1318, 0.45, 0.04);
      tone(c, out, t0 + 0.06, 1976, 0.35, 0.025);
      break;
    case 'reward':
      [784, 988, 1175].forEach((f, i) => tone(c, out, t0 + i * 0.09, f, 0.32, 0.045));
      break;
  }
}

/** Plays a sound now (or `at` seconds later) unless muted, too soon after the same sound, or over the voice budget. */
export function play(s: Sfx, at = 0) {
  if (!getPrefs().sound) return;
  const l = live();
  if (!l) return;
  const t = l.c.currentTime + at;
  if (t - (last.get(s) ?? -1) < GAP[s]) return;
  voices = voices.filter((end) => end > t);
  if (voices.length >= MAX_VOICES && s !== 'blackjack' && s !== 'win') return;
  last.set(s, t);
  voices.push(t + LEN[s]);
  synth(l.c, l.out, s, t);
}

/** Silences everything already scheduled (resync, background, leaving the table, new round). */
export function stopAll() {
  if (!ctx || !master) return;
  try {
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.disconnect();
  } catch {}
  master = null;
  voices = [];
  last.clear();
}

if (typeof document !== 'undefined')
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stopAll();
  });

/** Vibration only where the device supports it (iPhone Safari does not); never promised in the UI. */
export function buzz(ms = 12) {
  if (getPrefs().haptics) navigator.vibrate?.(ms);
}

/**
 * Renders a list of timed sounds offline (for the demo file and for measuring overlap without listening).
 * Uses the same gap and voice rules as live play.
 */
export async function renderTimeline(events: { s: Sfx; t: number }[], seconds: number, sampleRate = 44100): Promise<{ buffer: AudioBuffer; played: { s: Sfx; t: number }[] }> {
  const c = new OfflineAudioContext(1, Math.ceil(seconds * sampleRate), sampleRate);
  const out = c.createGain();
  out.gain.value = 2.4;
  out.connect(c.destination);
  const lastAt = new Map<Sfx, number>();
  let v: number[] = [];
  const played: { s: Sfx; t: number }[] = [];
  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    if (e.t - (lastAt.get(e.s) ?? -1) < GAP[e.s]) continue;
    v = v.filter((end) => end > e.t);
    if (v.length >= MAX_VOICES && e.s !== 'blackjack' && e.s !== 'win') continue;
    lastAt.set(e.s, e.t);
    v.push(e.t + LEN[e.s]);
    played.push(e);
    synth(c, out, e.s, e.t);
  }
  return { buffer: await c.startRendering(), played };
}
