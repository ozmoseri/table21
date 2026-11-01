import { useEffect, useState } from 'react';
import { canFullscreen, enterFullscreen, isIOS, isStandalone } from '../fullscreen.ts';
import { getPrefs, setPrefs, usePrefs } from '../prefs.ts';
import { t } from '../i18n.ts';

/** One-time card in a browser tab (not installed): how to get the game in full screen. Closed for good on "close". */
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
    <section className="panel install-hint" data-testid="install-hint">
      <b>{t('installTitle')}</b>
      <p className="small">{isIOS() ? t('installIosFull') : t('installAndroidHint')}</p>
      <div className="row">
        {canFullscreen() && (
          <button className="btn sm" onClick={() => void enterFullscreen()} data-testid="go-fullscreen">
            {t('fullScreen')}
          </button>
        )}
        <button className="btn ghost sm" onClick={() => setPrefs({ installHintClosed: true })} data-testid="install-hint-close">
          {t('close')}
        </button>
      </div>
    </section>
  );
}
