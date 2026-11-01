import { useEffect, useState } from 'react';
import { canFullscreen, enterFullscreen, isIOS, isStandalone } from '../fullscreen.ts';
import { getPrefs, setPrefs, usePrefs } from '../prefs.ts';
import { t } from '../i18n.ts';

/** One-time strip (56-64 px) in a browser tab (not installed): how to get the game in full screen. Closed for good on X. */
export function InstallHint() {
  usePrefs();
  const [standalone, setStandalone] = useState(isStandalone());
  useEffect(() => {
    const mq = matchMedia('(display-mode: standalone)');
    const f = () => setStandalone(isStandalone());
    mq.addEventListener?.('change', f);
    return () => mq.removeEventListener?.('change', f);
  }, []);
  if (standalone || getPrefs().installHintClosed) return null;
  return (
    <section className="install-strip" data-testid="install-hint" aria-label={t('installTitle')}>
      <span className="install-text">{isIOS() ? t('installStripIos') : t('installStripOther')}</span>
      {canFullscreen() && (
        <button className="btn sm" onClick={() => void enterFullscreen()} data-testid="go-fullscreen">
          {t('fullScreen')}
        </button>
      )}
      <button className="install-close" onClick={() => setPrefs({ installHintClosed: true })} aria-label={t('close')} data-testid="install-hint-close">
        <svg viewBox="0 0 24 24" aria-hidden="true">
          <path d="M6 6l12 12M18 6L6 18" />
        </svg>
      </button>
    </section>
  );
}
