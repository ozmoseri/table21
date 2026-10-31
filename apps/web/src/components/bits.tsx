import { useEffect, useState, type ReactNode } from 'react';
import { unitsLabel } from '@table21/protocol';
import { t } from '../i18n.ts';

export function Avatar({ id, size = 40, dealer, ring }: { id?: string; size?: number; dealer?: boolean; ring?: boolean }) {
  return (
    <img
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
