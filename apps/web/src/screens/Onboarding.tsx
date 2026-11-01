import { useState } from 'react';
import { AVATARS } from '@table21/protocol';
import { api, refreshMe, useMe } from '../api.ts';
import { errorText, setLocale, t, getLocale } from '../i18n.ts';
import { setPrefs, saveLocal, getLocal } from '../prefs.ts';
import { Avatar, toast } from '../components/bits.tsx';
import { go } from '../App.tsx';

export function Brand() {
  return (
    <div className="brand" dir="ltr">
      <span className="brand-mark" aria-hidden="true">
        <i />
        <i />
      </span>
      <span className="brand-word">
        TABLE<b>21</b>
      </span>
    </div>
  );
}

export function Onboarding() {
  const me = useMe();
  const [name, setName] = useState(me.status === 'ready' ? me.me.name : getLocal().name);
  const [avatar, setAvatar] = useState<string>(me.status === 'ready' ? me.me.avatar : getLocal().avatar || 'amber');
  const [busy, setBusy] = useState(false);
  const [, force] = useState(0);
  const offline = me.status === 'offline';

  const submit = async () => {
    if (!name.trim()) return;
    setBusy(true);
    saveLocal({ name: name.trim(), avatar });
    try {
      await api('/api/session', { method: 'POST', body: { name: name.trim(), avatar, locale: getLocale() } });
      await refreshMe();
      // Keep deep links (room link, invite) that brought the visitor here.
      let pending: string | null = null;
      try {
        pending = sessionStorage.getItem('t21:pending-route');
        sessionStorage.removeItem('t21:pending-route');
      } catch {}
      scrollTo(0, 0);
      if (pending) go(pending);
      else if (/^#\/(onboard)?$/.test(location.hash) || !location.hash) go('home');
    } catch (e: any) {
      toast(errorText(e?.code));
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="onboard">
      <Brand />
      <p className="lede">{t('tagline')}</p>
      <div className="lang-switch" role="group" aria-label={t('language')}>
        {(['he', 'en'] as const).map((l) => (
          <button
            key={l}
            className={`pill ${getLocale() === l ? 'on' : ''}`}
            onClick={() => {
              setLocale(l);
              setPrefs({ locale: l });
              force((x) => x + 1);
            }}
          >
            {l === 'he' ? 'עברית' : 'English'}
          </button>
        ))}
      </div>
      <form
        className="panel form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <label className="field">
          <span>{t('chooseName')}</span>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} placeholder={t('namePlaceholder')} autoComplete="nickname" required dir="auto" />
        </label>
        <fieldset className="field">
          <legend>{t('chooseAvatar')}</legend>
          <div className="avatar-grid">
            {AVATARS.map((a) => (
              <button type="button" key={a} className={`avatar-pick ${avatar === a ? 'on' : ''}`} onClick={() => setAvatar(a)} aria-pressed={avatar === a} aria-label={a}>
                <Avatar id={a} size={56} />
              </button>
            ))}
          </div>
        </fieldset>
        {offline ? (
          <>
            <p className="note">{t('offlineOnboard')}</p>
            <div className="row">
              <button type="button" className="btn primary" onClick={() => (saveLocal({ name: name.trim() || 'אני', avatar }), go('practice'))}>
                {t('practice')}
              </button>
              <button type="button" className="btn" onClick={() => go('pass')}>
                {t('passPlay')}
              </button>
            </div>
          </>
        ) : (
          <button className="btn primary wide" disabled={busy || !name.trim()}>
            {t('start')}
          </button>
        )}
        <p className="fine">{t('guestNote')}</p>
        {!offline && (
          <a className="btn ghost wide" href="#/signin" data-testid="have-account">
            {t('haveAccount')}
          </a>
        )}
        <p className="fine">{t('coinsNote')}</p>
      </form>
    </div>
  );
}
