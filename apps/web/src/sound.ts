import { getPrefs } from './prefs.ts';
import { haptic } from './haptics.ts';

/**
 * Original synthesized sound set (WebAudio). Nothing is fetched, so offline modes keep audio and the first sound after
 * the unlock has no decode latency. (The brief's Kenney CC0 samples could not be downloaded from the build workspace;
 * the synthesized set follows the same event map. docs/SOUND_SPEC.md, public/CREDITS.txt.)
 *
 * Mix (DECISIONS 10):
 * - Two buses under one master: effects and ambience. Ambience (a quiet room tone) is OFF by default.
 * - At most 3 voices at once. A win or blackjack stinger may take the oldest voice (it fades in 30 ms); anything else
 *   that would be a fourth voice is dropped.
 * - Card sounds only get a random variant and a pitch of +-2%; everything else plays exactly the same every time.
 * - The stinger ducks the other effects and the ambience by 4 dB while it plays.
 * - One card sound per card, timed to the moment it lands (presentation.ts), not to when it leaves the shoe.
 * - No alarm or punishing sound for a loss; a push is a plain chip sound, never a celebration.
 * - Audio starts only after a user gesture (browser rule). iOS: the audio session is "ambient", so the silent switch
 *   mutes the game like any other ambient app.
 */
export type Sfx = 'tap' | 'chip' | 'bet' | 'deal' | 'flip' | 'turn' | 'payout' | 'win' | 'blackjack' | 'lose' | 'gift' | 'reward';
export const SFX: Sfx[] = ['tap', 'chip', 'bet', 'deal', 'flip', 'turn', 'payout', 'win', 'blackjack', 'lose', 'gift', 'reward'];

/** Minimum seconds between two plays of the same sound, and approximate length (for the voice budget). */
const GAP: Record<Sfx, number> = { tap: 0.03, chip: 0.04, bet: 0.12, deal: 0.05, flip: 0.15, turn: 0.4, payout: 0.3, win: 0.6, blackjack: 0.8, lose: 0.5, gift: 0.5, reward: 0.6 };
const LEN: Record<Sfx, number> = { tap: 0.04, chip: 0.1, bet: 0.16, deal: 0.09, flip: 0.12, turn: 0.13, payout: 0.36, win: 0.36, blackjack: 0.62, lose: 0.24, gift: 0.5, reward: 0.55 };
export const MAX_VOICES = 3;
/** Stingers that may take the oldest voice and that duck the rest of the mix. */
const STINGER = new Set<Sfx>(['win', 'blackjack']);
/** Only card sounds vary: three variants and a pitch between 0.98 and 1.02. */
const CARD = new Set<Sfx>(['deal', 'flip']);
export const PITCH_RANGE = 0.02;
export const DUCK_DB = 4;
const DUCK = Math.pow(10, -DUCK_DB / 20);

let ctx: AudioContext | null = null;
let master: GainNode | null = null;
let fxBus: GainNode | null = null;
let ambBus: GainNode | null = null;
let ambSrc: AudioBufferSourceNode | null = null;
const last = new Map<Sfx, number>();
interface Voice {
  s: Sfx;
  end: number;
  gain: GainNode;
}
let voices: Voice[] = [];
/** Highest number of voices ever sounding at once in this page (tests read it; it must never pass MAX_VOICES). */
export const soundStats = { maxVoices: 0, played: 0, dropped: 0 };
if (import.meta.env?.VITE_LAB === '1') (globalThis as Record<string, unknown>).__t21sound = soundStats;

function live(): { c: AudioContext; fx: GainNode } | null {
  if (!ctx) {
    try {
      // iOS 16.4+: an ambient session follows the silent switch and mixes with the user's music.
      const nav = navigator as Navigator & { audioSession?: { type: string } };
      if (nav.audioSession) nav.audioSession.type = 'ambient';
      ctx = new AudioContext({ latencyHint: 'interactive' });
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume().catch(() => {});
  if (!master) {
    master = ctx.createGain();
    master.gain.value = 2.4;
    master.connect(ctx.destination);
    fxBus = ctx.createGain();
    fxBus.connect(master);
    ambBus = ctx.createGain();
    ambBus.gain.value = 0.5;
    ambBus.connect(master);
  }
  return { c: ctx, fx: fxBus! };
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

/** Random pitch for card sounds only (0.98 to 1.02) and one of three variants. */
export const cardPitch = () => 1 - PITCH_RANGE + Math.random() * 2 * PITCH_RANGE;

/** Schedules one sound at absolute time t0 on any context (live or offline render). */
export function synth(c: BaseAudioContext, out: AudioNode, s: Sfx, t0: number, pitch = 1, variant = 0) {
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
    case 'deal': {
      // a card landing on cloth: a short slide tail into a soft place; three variants
      const v = [
        [2400, 0.09, 900],
        [2150, 0.1, 820],
        [2650, 0.08, 980],
      ][variant % 3];
      noise(c, out, t0, v[1], v[0] * pitch, 0.24);
      noise(c, out, t0 + v[1] * 0.45, 0.05, v[2] * pitch, 0.16, 1.1); // the place layer starts within 45 ms: one sound
      break;
    }
    case 'flip': // hole card turned
      noise(c, out, t0, 0.06, (variant % 2 ? 3000 : 3200) * pitch, 0.26);
      noise(c, out, t0 + 0.05, 0.05, 1800 * pitch, 0.18);
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

/**
 * The voice rule, shared by live play and the offline render: returns which running voice a new sound replaces
 * (-1 none needed, -2 drop the new sound).
 */
export function admit(active: { s: Sfx; end: number }[], s: Sfx): number {
  if (active.length < MAX_VOICES) return -1;
  if (!STINGER.has(s)) return -2;
  // A stinger takes the oldest voice that is not itself a stinger.
  const i = active.findIndex((v) => !STINGER.has(v.s));
  return i >= 0 ? i : -2;
}

/** Plays a sound now (or `at` seconds later) unless muted, too soon after the same sound, or over the voice budget. */
export function play(s: Sfx, at = 0) {
  if (!getPrefs().sound) return;
  const l = live();
  if (!l) return;
  const c = l.c;
  const t = c.currentTime + at;
  if (t - (last.get(s) ?? -1) < GAP[s]) return;
  voices = voices.filter((v) => v.end > t);
  const k = admit(voices, s);
  if (k === -2) {
    soundStats.dropped++;
    return;
  }
  if (k >= 0) {
    const old = voices[k];
    old.gain.gain.setTargetAtTime(0, t, 0.01);
    voices.splice(k, 1);
  }
  last.set(s, t);
  const g = c.createGain();
  g.connect(l.fx);
  voices.push({ s, end: t + LEN[s], gain: g });
  soundStats.played++;
  soundStats.maxVoices = Math.max(soundStats.maxVoices, voices.filter((v) => v.end > t).length);
  if (STINGER.has(s)) duck(t, LEN[s]);
  synth(c, g, s, t, CARD.has(s) ? cardPitch() : 1, CARD.has(s) ? Math.floor(Math.random() * 3) : 0);
}

/** -4 dB on every other voice and on the ambience while the stinger plays. */
function duck(t: number, len: number) {
  if (!ctx || !ambBus) return;
  for (const v of voices) if (!STINGER.has(v.s)) v.gain.gain.setTargetAtTime(DUCK, t, 0.015);
  const base = ambBus.gain.value || 0.5;
  ambBus.gain.setTargetAtTime(base * DUCK, t, 0.02);
  ambBus.gain.setTargetAtTime(base, t + len, 0.08);
}

/** Silences everything already scheduled (resync, background, leaving the table, new round). */
export function stopAll() {
  if (!ctx || !master) return;
  try {
    master.gain.cancelScheduledValues(ctx.currentTime);
    master.disconnect();
  } catch {}
  master = null;
  fxBus = null;
  ambBus = null;
  ambSrc = null;
  voices = [];
  last.clear();
}

/**
 * Room tone on the ambience bus: brown noise through a low-pass, very quiet. Off by default (prefs.ambience).
 * Started by the table screens and stopped when they close or the page is hidden.
 */
export function ambience(on: boolean) {
  if (!on || !getPrefs().sound || !getPrefs().ambience) {
    try {
      ambSrc?.stop();
    } catch {}
    ambSrc = null;
    return;
  }
  const l = live();
  if (!l || ambSrc || !ambBus) return;
  const c = l.c;
  const len = c.sampleRate * 4;
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  let lastV = 0;
  for (let i = 0; i < len; i++) {
    lastV = (lastV + 0.02 * (Math.random() * 2 - 1)) / 1.02;
    d[i] = lastV * 3;
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  src.loop = true;
  const f = c.createBiquadFilter();
  f.type = 'lowpass';
  f.frequency.value = 420;
  const g = c.createGain();
  g.gain.value = 0.05;
  src.connect(f).connect(g).connect(ambBus);
  src.start();
  ambSrc = src;
}

if (typeof document !== 'undefined')
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') stopAll();
  });

/** Kept for older call sites: a selection tick. New code calls haptic() with a named pattern. */
export function buzz(_ms = 12) {
  haptic('selection');
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
  let v: { s: Sfx; end: number }[] = [];
  const played: { s: Sfx; t: number }[] = [];
  for (const e of [...events].sort((a, b) => a.t - b.t)) {
    if (e.t - (lastAt.get(e.s) ?? -1) < GAP[e.s]) continue;
    v = v.filter((x) => x.end > e.t);
    const k = admit(v, e.s);
    if (k === -2) continue;
    if (k >= 0) v.splice(k, 1);
    lastAt.set(e.s, e.t);
    v.push({ s: e.s, end: e.t + LEN[e.s] });
    played.push(e);
    synth(c, out, e.s, e.t, CARD.has(e.s) ? cardPitch() : 1);
  }
  return { buffer: await c.startRendering(), played };
}
