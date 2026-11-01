import { useEffect, useState } from 'react';
import { retryNow, useNet } from '../api.ts';
import { t } from '../i18n.ts';
import { Brand } from './Onboarding.tsx';

/**
 * Shown while a sleeping free server starts (Render free spins down after 15 idle minutes; waking takes about a
 * minute). The app retries by itself; offline practice stays one tap away. Nothing here creates anything, so a
 * retry can never duplicate an account, a room or a charge.
 */
export function Waking() {
  const n = useNet();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secs = Math.max(0, Math.round((now - (n.since || now)) / 1000));
  const pct = Math.min(96, Math.round((secs / 60) * 100));
  return (
    <div className="waking" data-testid="waking" role="status" aria-live="polite">
      <Brand />
      <div className="waking-card">
        <div className="waking-chips" aria-hidden="true">
          <i className="chip t1" />
          <i className="chip t2" />
          <i className="chip t3" />
        </div>
        <h1>{t('wakingTitle')}</h1>
        <p>{t('wakingBody')}</p>
        <div className="waking-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={pct} aria-label={t('wakingTitle')}>
          <i style={{ width: `${pct}%` }} />
        </div>
        <p className="small muted" data-testid="waking-elapsed">
          {secs >= 75 ? t('wakingLong') : secs < 2 ? t('wakingJustNow') : t('wakingElapsed', { n: secs })}
        </p>
        <div className="waking-actions">
          <button className="btn primary" onClick={retryNow} data-testid="waking-retry">
            {t('wakingRetry')}
          </button>
          <a className="btn ghost" href="#/practice" data-testid="waking-practice">
            {t('wakingPractice')}
          </a>
        </div>
        <p className="small muted">{t('wakingSafe')}</p>
      </div>
    </div>
  );
}
