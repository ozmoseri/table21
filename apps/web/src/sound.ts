import { getPrefs } from './prefs.ts';

/** All sounds are synthesized locally with WebAudio, so nothing is fetched and offline modes keep audio. */
let ctx: AudioContext | null = null;
const ac = () => {
  if (!ctx) {
    try {
      ctx = new AudioContext();
    } catch {
      return null;
    }
  }
  if (ctx.state === 'suspended') void ctx.resume();
  return ctx;
};

function noise(c: AudioContext, dur: number, freq: number, gain: number, at = 0) {
  const len = Math.floor(c.sampleRate * dur);
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 3);
  const src = c.createBufferSource();
  src.buffer = buf;
  const f = c.createBiquadFilter();
  f.type = 'bandpass';
  f.frequency.value = freq;
  f.Q.value = 0.8;
  const g = c.createGain();
  g.gain.value = gain;
  src.connect(f).connect(g).connect(c.destination);
  src.start(c.currentTime + at);
}

function tone(c: AudioContext, freq: number, dur: number, gain: number, at = 0, type: OscillatorType = 'sine') {
  const o = c.createOscillator();
  o.type = type;
  o.frequency.value = freq;
  const g = c.createGain();
  const t0 = c.currentTime + at;
  g.gain.setValueAtTime(0, t0);
  g.gain.linearRampToValueAtTime(gain, t0 + 0.008);
  g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
  o.connect(g).connect(c.destination);
  o.start(t0);
  o.stop(t0 + dur + 0.02);
}

export type Sfx = 'deal' | 'flip' | 'chip' | 'win' | 'blackjack' | 'lose' | 'tap' | 'turn';

export function play(s: Sfx, at = 0) {
  if (!getPrefs().sound) return;
  const c = ac();
  if (!c) return;
  switch (s) {
    case 'deal':
      noise(c, 0.09, 2400, 0.35, at);
      break;
    case 'flip':
      noise(c, 0.06, 3200, 0.3, at);
      noise(c, 0.05, 1800, 0.2, at + 0.05);
      break;
    case 'chip':
      tone(c, 2100, 0.07, 0.08, at, 'triangle');
      tone(c, 2900, 0.06, 0.05, at + 0.04, 'triangle');
      break;
    case 'win':
      tone(c, 660, 0.18, 0.07, at);
      tone(c, 880, 0.25, 0.06, at + 0.09);
      break;
    case 'blackjack':
      [523, 659, 784, 1047].forEach((f, i) => tone(c, f, 0.3, 0.06, at + i * 0.08));
      break;
    case 'lose':
      tone(c, 330, 0.22, 0.05, at, 'triangle');
      break;
    case 'tap':
      tone(c, 1200, 0.03, 0.03, at);
      break;
    case 'turn':
      tone(c, 990, 0.12, 0.05, at);
      break;
  }
}

export function buzz(ms = 12) {
  if (getPrefs().haptics) navigator.vibrate?.(ms);
}
