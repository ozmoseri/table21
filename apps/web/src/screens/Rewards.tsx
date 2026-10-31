import { api, refreshMe, useMe } from '../api.ts';
import { errorText, getLocale, t } from '../i18n.ts';
import { toast } from '../components/bits.tsx';

export function Rewards() {
  const me = useMe();
  if (me.status !== 'ready') return <p className="pad muted">{t('offlineOnboard')}</p>;
  const g = me.me.grants;
  const fmt = (iso: string | null) =>
    iso ? new Date(iso).toLocaleTimeString(getLocale() === 'he' ? 'he-IL' : 'en-GB', { timeZone: 'Asia/Jerusalem', hour: '2-digit', minute: '2-digit', weekday: 'short' }) : '';
  const claim = async (kind: 'daily' | 'rescue') => {
    try {
      const r = await api<{ ok: boolean; reason?: string }>(`/api/grants/${kind}`, { method: 'POST' });
      toast(r.ok ? t('claimed') : errorText(r.reason));
      await refreshMe();
    } catch {
      toast(t('error'));
    }
  };
  return (
    <div className="pad stack">
      <h1 className="title">{t('rewards')}</h1>
      <div className="panel reward done">
        <b>{t('welcomeGrant')}</b>
        <span className="pill">{t('claimed')}</span>
      </div>
      <div className="panel reward">
        <b>{t('dailyGrant')}</b>
        {g.dailyAvailable ? (
          <button className="btn gold sm" onClick={() => claim('daily')}>
            {t('claim')}
          </button>
        ) : (
          <span className="muted small">{t('nextAt', { t: fmt(g.nextDailyAt) })}</span>
        )}
      </div>
      <div className="panel reward">
        <b>{t('rescueGrant')}</b>
        {g.rescueAvailable ? (
          <button className="btn gold sm" onClick={() => claim('rescue')}>
            {t('claim')}
          </button>
        ) : g.nextRescueAt ? (
          <span className="muted small">{t('nextAt', { t: fmt(g.nextRescueAt) })}</span>
        ) : null}
      </div>
      <div className="panel reward off" aria-disabled="true">
        <b>{t('adsTitle')}</b>
        <span className="muted small">{t('adsOff')}</span>
      </div>
      <p className="fine">{t('coinsNote')}</p>
    </div>
  );
}
