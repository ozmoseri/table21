import { useEffect, useRef, useState, type ReactNode } from 'react';
import { unitsLabel } from '@table21/protocol';
import { t } from '../i18n.ts';
import { reducedMotion } from '../prefs.ts';
import { play } from '../sound.ts';

/** Inline fallback (no network): a neutral figure on the panel colour, used when an avatar file cannot load. */
const AVATAR_FALLBACK =
  'data:image/svg+xml,' +
  encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64"><circle cx="32" cy="32" r="31" fill="#16222C" stroke="#C9A24B" stroke-width="2"/><circle cx="32" cy="25" r="10" fill="#A6B5B0"/><path d="M14 52c3-10 10-14 18-14s15 4 18 14" fill="#A6B5B0"/></svg>',
  );

export function Avatar({ id, size = 40, dealer, ring }: { id?: string; size?: number; dealer?: boolean; ring?: boolean }) {
  return (
    <img
      onError={(e) => {
        const img = e.currentTarget;
        if (img.src !== AVATAR_FALLBACK) img.src = AVATAR_FALLBACK;
      }}
      className={`avatar ${ring ? 'ring' : ''}`}
      src={dealer ? '/art/dealer.svg' : `/art/avatars/${id ?? 'amber'}.svg`}
      width={size}
      height={size}
      alt=""
      draggable={false}
    />
  );
}

/** Coin amount from half-coin units, always LTR with tabular numerals. */
export function Coins({ units, sign, className }: { units: number; sign?: boolean; className?: string }) {
  const s = sign && units > 0 ? '+' : sign && units < 0 ? '−' : '';
  return (
    <bdi className={`coins num ${className ?? ''}`} dir="ltr">
      <span className="coin-dot" aria-hidden="true" />
      {s}
      {unitsLabel(Math.abs(units))}
    </bdi>
  );
}

/**
 * Balance that rolls up when it grows (a payout lands), 600 ms ease-out; drops and reduced motion show at once.
 * The number it ends on is always the snapshot's: the roll is presentation only.
 */
export function RollingCoins({ units, className }: { units: number; className?: string }) {
  const [shown, setShown] = useState(units);
  const prev = useRef(units);
  useEffect(() => {
    const from = prev.current;
    prev.current = units;
    if (units <= from || reducedMotion()) {
      setShown(units);
      return;
    }
    const t0 = performance.now();
    let raf = 0;
    const step = (now: number) => {
      const k = Math.min(1, (now - t0) / 600);
      // whole coins while rolling (2 units = 1 coin), the exact value at the end
      setShown(k >= 1 ? units : Math.round((from + (units - from) * (1 - Math.pow(1 - k, 3))) / 2) * 2);
      if (k < 1) raf = requestAnimationFrame(step);
    };
    raf = requestAnimationFrame(step);
    return () => {
      cancelAnimationFrame(raf);
      setShown(units);
    };
  }, [units]);
  return <Coins units={shown} className={`${className ?? ''} ${shown !== units ? 'is-rolling' : ''}`} />;
}

export function ChipStack({ units, small }: { units: number; small?: boolean }) {
  if (units <= 0) return null;
  const coins = units / 2;
  const n = Math.min(5, Math.max(1, Math.ceil(Math.log10(coins + 1) * 2)));
  const tier = coins >= 250 ? 't5' : coins >= 100 ? 't4' : coins >= 50 ? 't3' : coins >= 25 ? 't2' : 't1';
  return (
    <span className={`chips ${small ? 'chips-sm' : ''}`} aria-label={`${unitsLabel(units)}`}>
      <span className="chip-pile" aria-hidden="true">
        {Array.from({ length: n }, (_, i) => (
          <i key={i} className={`chip ${tier}`} style={{ ['--i' as string]: i }} />
        ))}
      </span>
      <Coins units={units} />
    </span>
  );
}

export function useNow(ms = 250) {
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(id);
  }, [ms]);
  return now;
}

/** Circular countdown ring around a seat. */
export function TimerRing({ deadline, total, offset }: { deadline: number; total: number; offset: number }) {
  const now = useNow(200) + offset;
  const left = Math.max(0, deadline - now);
  const frac = total > 0 ? Math.min(1, left / total) : 0;
  const c = 2 * Math.PI * 22;
  return (
    <svg className={`timer-ring ${left < 6000 ? 'low' : ''}`} viewBox="0 0 48 48" aria-hidden="true">
      <circle cx="24" cy="24" r="22" className="track" />
      <circle cx="24" cy="24" r="22" className="bar" strokeDasharray={c} strokeDashoffset={c * (1 - frac)} />
    </svg>
  );
}

export function Seconds({ deadline, offset }: { deadline: number; offset: number }) {
  const now = useNow(500) + offset;
  const s = Math.max(0, Math.ceil((deadline - now) / 1000));
  return <span className="num">{s}</span>;
}

export function Sheet({ open, onClose, title, children }: { open: boolean; onClose: () => void; title?: string; children: ReactNode }) {
  useEffect(() => {
    if (!open) return;
    const k = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    addEventListener('keydown', k);
    return () => removeEventListener('keydown', k);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="sheet" role="dialog" aria-modal="true" aria-label={title} onClick={(e) => e.stopPropagation()}>
        <div className="sheet-head">
          {title && <h2>{title}</h2>}
          <button className="btn ghost sm" onClick={onClose}>
            {t('close')}
          </button>
        </div>
        {children}
      </div>
    </div>
  );
}

let toastSet: ((s: string | null) => void) | null = null;
export function toast(msg: string) {
  toastSet?.(msg);
}
export function Toaster() {
  const [msg, setMsg] = useState<string | null>(null);
  useEffect(() => {
    toastSet = setMsg;
    return () => {
      toastSet = null;
    };
  }, []);
  useEffect(() => {
    if (!msg) return;
    const id = setTimeout(() => setMsg(null), 3200);
    return () => clearTimeout(id);
  }, [msg]);
  return (
    <div className="toast-wrap" aria-live="assertive">
      {msg && <div className="toast">{msg}</div>}
    </div>
  );
}

/** Screen-reader announcements for turns and results, without narrating every animation. */
let announceSet: ((s: string) => void) | null = null;
export const announce = (s: string) => announceSet?.(s);
export function Announcer() {
  const [s, setS] = useState('');
  useEffect(() => {
    announceSet = setS;
  }, []);
  return (
    <div className="sr-only" aria-live="polite">
      {s}
    </div>
  );
}

/**
 * Bet feedback: a chip flies from the picked stake chip to the bet spot on the felt, then the "bet" sound plays when it
 * lands. Purely visual; the bet itself is already sent. Skipped in reduced motion (the stack still updates in place).
 */
export function flyChip(from: HTMLElement, tier: string) {
  const to = document.querySelector('[data-bet-spot]');
  if (!to || reducedMotion()) {
    play('bet', 0.05);
    return;
  }
  const a = from.getBoundingClientRect();
  const b = to.getBoundingClientRect();
  const el = document.createElement('i');
  el.className = `chip fly-chip ${tier}`;
  el.setAttribute('aria-hidden', 'true');
  el.style.left = `${a.left + a.width / 2 - 14}px`;
  el.style.top = `${a.top + a.height / 2 - 14}px`;
  document.body.appendChild(el);
  const dx = b.left + b.width / 2 - (a.left + a.width / 2);
  const dy = b.top + b.height / 2 - (a.top + a.height / 2);
  const anim = el.animate(
    [
      { transform: 'translate(0, 0) scale(1)' },
      { transform: `translate(${dx * 0.5}px, ${dy * 0.5 - 28}px) scale(1.12)`, offset: 0.5 },
      { transform: `translate(${dx}px, ${dy}px) scale(0.92)` },
    ],
    { duration: 280, easing: 'cubic-bezier(.2,.75,.25,1)' },
  );
  const done = () => el.remove();
  anim.finished.then(() => (done(), play('bet')), done);
  setTimeout(done, 700);
}
