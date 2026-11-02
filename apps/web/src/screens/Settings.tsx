import { AccountCard } from './Profile.tsx';
import { DealSettings } from '../components/DealSettings.tsx';
import { canFullscreen, enterFullscreen } from '../fullscreen.ts';
import { PilotCard } from '../components/PilotCard.tsx';
import { api, useMe } from '../api.ts';
import { getLocale, setLocale, t, tl } from '../i18n.ts';
import { setPrefs, usePrefs } from '../prefs.ts';
import { SFX, play } from '../sound.ts';
import { About, isDevMode } from '../components/About.tsx';

export function Settings() {
  const p = usePrefs();
  const me = useMe();
  const toggle = (k: 'sound' | 'haptics' | 'ambience' | 'coachPractice' | 'coachRooms' | 'coachAuto') => setPrefs({ [k]: !p[k] });
  return (
    <div className="pad stack">
      <h1 className="title">{t('settings')}</h1>
      {me.status === 'ready' && me.me.admin && <PilotCard />}
      <div className="panel settings">
        <label className="check">
          <input type="checkbox" checked={p.sound} onChange={() => toggle('sound')} />
          <span>{t('sound')}</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={p.haptics} onChange={() => toggle('haptics')} />
          <span>{t('haptics')}</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={p.ambience} onChange={() => toggle('ambience')} data-testid="ambience" />
          <span>{t('ambience')}</span>
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
{isDevMode() && (
      <section className="panel" data-testid="sound-test">
        <h2 className="title sm">{t('soundTest')}</h2>
        <p className="fine">{t('soundTestNote')}</p>
        <div className="sound-grid" dir="ltr">
          {SFX.map((s) => (
            <button key={s} className="btn sm" disabled={!p.sound} onClick={() => play(s)}>
              {s}
            </button>
          ))}
        </div>
      </section>
      )}
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
      <section className="panel settings" data-testid="coach-settings">
        <h2 className="title sm">{t('coachSection')}</h2>
        <label className="check">
          <input type="checkbox" checked={p.coachPractice} onChange={() => toggle('coachPractice')} data-testid="coach-practice" />
          <span>{t('coachPractice')}</span>
        </label>
        <label className="check">
          <input type="checkbox" checked={p.coachRooms} onChange={() => toggle('coachRooms')} data-testid="coach-rooms" />
          <span>{t('coachRooms')}</span>
        </label>
        <p className="fine">{t('coachRoomsNote')}</p>
        <label className="check">
          <input type="checkbox" checked={p.coachAuto} onChange={() => toggle('coachAuto')} data-testid="coach-auto" />
          <span>{t('coachAuto')}</span>
        </label>
        <a className="link-row" href="#/guide" data-testid="guide-link">
          {t('coachGuideLink')}
        </a>
      </section>
      <section className="panel" data-testid="table-settings">
        <h2 className="title sm">{t('dealSpeed')}</h2>
        <DealSettings />
        {canFullscreen() && (
          <div className="row wrap">
            <button className="btn sm" onClick={() => void enterFullscreen()}>
              {t('fullScreen')}
            </button>
            <button className="btn sm ghost" onClick={() => void enterFullscreen(true)} data-testid="lock-landscape">
              {t('lockLandscape')}
            </button>
          </div>
        )}
        {canFullscreen() && <p className="fine">{t('lockLandscapeNote')}</p>}
      </section>
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
        {me.status === 'ready' ? <AccountCard kind={me.me.account.kind} /> : <p className="fine">{t('guestNote')}</p>}
      </section>
      <About />
    </div>
  );
}
