import { useEffect, useState } from 'react';
import { lastDeployment, retryNow, useNet } from '../api.ts';
import { t } from '../i18n.ts';
import { Brand } from './Onboarding.tsx';

/**
 * Shown while the app is loaded but the server does not answer. This is a different state from the splash in
 * index.html (which is about the app's own files, before any of this code runs). What we say depends on the kind of
 * server this device last used: a host computer ('lan'), the free cloud pilot ('online', which sleeps after 15 idle
 * minutes and wakes in about a minute) or unknown. There is no percentage: nothing here knows how long it will take,
 * so the bar is indeterminate and the only number is the seconds that actually passed. The app retries by itself;
 * offline practice stays one tap away. Nothing here creates anything, so a retry can never duplicate an account, a
 * room or a charge.
 */
export function Waking() {
  const n = useNet();
  const [now, setNow] = useState(Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const secs = Math.max(0, Math.round((now - (n.since || now)) / 1000));
  const kind = lastDeployment();
  const copy =
    kind === 'lan'
      ? { title: t('wakingHostTitle'), body: t('wakingHostBody') }
      : kind === 'online'
        ? { title: t('wakingTitle'), body: t('wakingBody') }
        : { title: t('wakingUnknownTitle'), body: t('wakingUnknownBody') };
  return (
    <div className="waking" data-testid="waking" data-kind={kind} role="status" aria-live="polite">
      <Brand />
      <div className="waking-card">
        <div className="waking-chips" aria-hidden="true">
          <i className="chip t1" />
          <i className="chip t2" />
          <i className="chip t3" />
        </div>
        <h1 data-testid="waking-title">{copy.title}</h1>
        <p className="small muted" data-testid="waking-app-loaded">
          {t('wakingAppLoaded')}
        </p>
        <p data-testid="waking-body">{copy.body}</p>
        {/* Indeterminate on purpose: no aria-valuenow, no width that pretends to know how far along it is. */}
        <div className="waking-bar indeterminate" role="progressbar" aria-label={copy.title}>
          <i />
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
