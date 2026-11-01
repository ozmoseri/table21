import { api } from '../api.ts';
import { getLocale, setLocale, t, tl } from '../i18n.ts';
import { setPrefs, usePrefs } from '../prefs.ts';

export function Settings() {
  const p = usePrefs();
  const toggle = (k: 'sound' | 'haptics') => setPrefs({ [k]: !p[k] });
  return (
    <div className="pad stack">
      <h1 className="title">{t('settings')}</h1>
      <div className="panel settings">
        <label className="check">
          <input type="checkbox" checked={p.sound} onChange={() => toggle('sound')} />
          <span>{t('sound')}</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={p.haptics} onChange={() => toggle('haptics')} />
          <span>{t('haptics')}</span>
        </label>
        <div className="row between">
          <span>{t('motion')}</span>
          <div className="segmented">
            {(['system', 'full', 'reduced'] as const).map((m) => (
              <button key={m} className={p.motion === m ? 'on' : ''} onClick={() => setPrefs({ motion: m })} aria-pressed={p.motion === m}>
                {t(m === 'system' ? 'motionSystem' : m === 'full' ? 'motionFull' : 'motionReduced')}
              </button>
            ))}
          </div>
        </div>
        <div className="row between">
          <span>{t('language')}</span>
          <div className="segmented">
            {(['he', 'en'] as const).map((l) => (
              <button
                key={l}
                className={getLocale() === l ? 'on' : ''}
                onClick={() => {
                  setLocale(l);
                  setPrefs({ locale: l });
                  api('/api/me', { method: 'PATCH', body: { locale: l } }).catch(() => {});
                }}
              >
                {l === 'he' ? 'עברית' : 'English'}
              </button>
            ))}
          </div>
        </div>
      </div>
      <section className="panel">
        <h2 className="title sm">{t('rules')}</h2>
        <ul className="rules">
          {tl('rulesText').map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ul>
        <p className="fine">{t('coinsNote')}</p>
      </section>
      <section className="panel">
        <h2 className="title sm">{t('install')}</h2>
        <p>{t('installIos')}</p>
        <p>{t('installAndroid')}</p>
        <p className="fine">{t('installSecure')}</p>
      </section>
      <section className="panel">
        <h2 className="title sm">{t('connection')}</h2>
        <p>{t('connHelp')}</p>
        <a className="link-row" href="#/lan">
          {t('lanHost')}
        </a>
      </section>
      <section className="panel">
        <h2 className="title sm">{t('account')}</h2>
        <p className="fine">{t('recoveryOff')}</p>
      </section>
    </div>
  );
}
