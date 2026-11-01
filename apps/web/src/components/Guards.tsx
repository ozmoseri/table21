import { useEffect, useState } from 'react';
import { t } from '../i18n.ts';
import { useUpdate } from '../update.ts';

/**
 * Ethics guardrails (DESIGN_BIBLE 9, DECISIONS 9): the 18+ gate and the 60-minute session reminder.
 * Both are local to the device and never block a hand in progress.
 */

const AGE_KEY = 't21:age-ok';
const read = (k: string, store: Storage | undefined) => {
  try {
    return store?.getItem(k) ?? null;
  } catch {
    return null;
  }
};
const write = (k: string, v: string, store: Storage | undefined) => {
  try {
    store?.setItem(k, v);
  } catch {}
};
const local = typeof localStorage !== 'undefined' ? localStorage : undefined;
const session = typeof sessionStorage !== 'undefined' ? sessionStorage : undefined;

export const ageConfirmed = () => read(AGE_KEY, local) === '1';

/** First launch on a device: TABLE21 is for adults; coins have no cash value. "Under 18" ends there. */
export function AgeGate({ onConfirm }: { onConfirm: () => void }) {
  const [under, setUnder] = useState(false);
  return (
    <section className="age-gate" role="dialog" aria-modal="true" aria-labelledby="age-title" data-testid="age-gate">
      <span className="age-badge num" aria-hidden="true">
        18+
      </span>
      <h1 id="age-title" className="title">
        {t('ageTitle')}
      </h1>
      {under ? (
        <p className="age-blocked" role="status" data-testid="age-blocked">
          {t('ageBlocked')}
        </p>
      ) : (
        <>
          <p className="age-body">{t('ageBody')}</p>
          <button
            className="btn confirm wide"
            onClick={() => {
              write(AGE_KEY, '1', local);
              onConfirm();
            }}
            data-testid="age-confirm"
          >
            {t('ageYes')}
          </button>
          <button className="btn ghost wide" onClick={() => setUnder(true)} data-testid="age-under">
            {t('ageNo')}
          </button>
        </>
      )}
    </section>
  );
}

/** Minutes of visible play in this browser session (sessionStorage, so closing the app starts over). */
const ACTIVE_KEY = 't21:active-ms';
const SHOWN_KEY = 't21:reminded-at';
export const REMIND_EVERY_MS = 60 * 60_000;

/**
 * After every 60 minutes of visible use, a quiet strip suggests a break. It waits for a safe point (never in the
 * middle of a hand: the same busy marker that holds back updates), never blocks play and closes with one tap.
 */
export function SessionReminder() {
  const busy = useUpdate().busy;
  const [due, setDue] = useState<number | null>(null);
  useEffect(() => {
    let lastTick = performance.now();
    const tick = () => {
      const now = performance.now();
      const visible = document.visibilityState === 'visible';
      const active = Number(read(ACTIVE_KEY, session) ?? 0) + (visible ? Math.min(now - lastTick, 10_000) : 0);
      lastTick = now;
      write(ACTIVE_KEY, String(Math.round(active)), session);
      const shownAt = Number(read(SHOWN_KEY, session) ?? 0);
      if (active - shownAt >= REMIND_EVERY_MS) setDue(Math.floor(active / 60_000));
    };
    tick();
    const id = setInterval(tick, 2000);
    return () => clearInterval(id);
  }, []);
  if (due === null || busy) return null;
  const close = () => {
    write(SHOWN_KEY, String(Number(read(ACTIVE_KEY, session) ?? 0)), session);
    setDue(null);
  };
  return (
    <aside className="session-reminder" role="status" data-testid="session-reminder">
      <span>
        <b>{t('sessionTitle', { n: due })}</b> {t('sessionBody')}
      </span>
      <button className="btn sm" onClick={close} data-testid="session-ok">
        {t('sessionOk')}
      </button>
    </aside>
  );
}
