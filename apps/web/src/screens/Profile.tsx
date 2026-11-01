import { useEffect, useState } from 'react';
import { AVATARS, type StatsResponse } from '@table21/protocol';
import { api, refreshMe, useMe } from '../api.ts';
import { getLocale, t } from '../i18n.ts';
import { Avatar, Coins, toast } from '../components/bits.tsx';
import { go } from '../App.tsx';

type HistoryRow = { roundId: string; hand: number; stakeUnits: number; returnUnits: number; netUnits: number; outcome: string; natural: boolean; mode: string; at: string; roomCode: string };

export function AccountCard({ kind }: { kind: 'guest' | 'saved' }) {
  return (
    <a className={`panel account-card ${kind}`} href="#/account" data-testid="account-card">
      <span className={`badge ${kind === 'saved' ? 'b-win' : 'b-push'}`}>{t(kind === 'saved' ? 'accountSaved' : 'accountGuest')}</span>
      <span className="fine">{t(kind === 'saved' ? 'accountSavedText' : 'accountGuestText')}</span>
      <b className="account-cta">{kind === 'saved' ? t('accountTitle') : t('saveAccount')}</b>
    </a>
  );
}

export function Profile() {
  const me = useMe();
  const [stats, setStats] = useState<StatsResponse | null>(null);
  const [hist, setHist] = useState<HistoryRow[] | null>(null);
  const [name, setName] = useState(me.status === 'ready' ? me.me.name : '');
  const [avatar, setAvatar] = useState(me.status === 'ready' ? me.me.avatar : 'amber');
  useEffect(() => {
    api<StatsResponse>('/api/stats').then(setStats).catch(() => {});
    api<HistoryRow[]>('/api/history').then(setHist).catch(() => setHist([]));
  }, []);
  if (me.status !== 'ready')
    return (
      <div className="pad stack">
        <p className="muted">{t('offlineOnboard')}</p>
        <button className="btn" onClick={() => go('onboard')}>
          {t('start')}
        </button>
      </div>
    );
  const u = me.me;
  const patch = async (body: Record<string, string>) => {
    try {
      await api('/api/me', { method: 'PATCH', body });
      await refreshMe();
      toast(t('save'));
    } catch {
      toast(t('error'));
    }
  };
  const pct = stats ? Math.min(100, Math.round((stats.hands / stats.nextLevelAt) * 100)) : 0;

  return (
    <div className="pad stack profile">
      <div className="row between">
        <span />
        <a className="btn ghost sm" href="#/settings" data-testid="open-settings">
          {t('navSettings')}
        </a>
      </div>
      <div className="profile-col">
        <div className="profile-head">
          <Avatar id={u.avatar} size={72} />
          <div>
            <h1 className="title">
              <bdi>{u.name}</bdi>
            </h1>
            <Coins units={u.wallet.availableUnits} />
            {stats && (
              <div className="level">
                <span>
                  {t('level')} <b className="num">{stats.level}</b>
                </span>
                <span className="bar">
                  <i style={{ width: `${pct}%` }} />
                </span>
              </div>
            )}
          </div>
        </div>
        {stats && (
          <dl className="stat-grid">
            {(
              [
                ['handsPlayed', stats.hands],
                ['wins', stats.wins],
                ['losses', stats.losses],
                ['pushes', stats.pushes],
                ['naturals', stats.naturals],
              ] as const
            ).map(([k, v]) => (
              <div key={k}>
                <dt>{t(k)}</dt>
                <dd className="num">{v}</dd>
              </div>
            ))}
          </dl>
        )}
        <AccountCard kind={u.account.kind} />
      </div>
      <div className="profile-col">
        <form className="panel form" onSubmit={(e) => (e.preventDefault(), patch({ name, avatar }))}>
          <input value={name} onChange={(e) => setName(e.target.value)} maxLength={20} dir="auto" aria-label={t('namePlaceholder')} />
          <div className="avatar-grid">
            {AVATARS.map((a) => (
              <button type="button" key={a} className={`avatar-pick ${avatar === a ? 'on' : ''}`} onClick={() => setAvatar(a)} aria-pressed={avatar === a}>
                <Avatar id={a} size={44} />
              </button>
            ))}
          </div>
          <button className="btn primary">{t('save')}</button>
        </form>
        {stats && (
          <section className="panel">
            <h2 className="title sm">{t('cosmetics')}</h2>
            <p className="fine">{t('cosmeticsNote')}</p>
            <div className="cosmetics">
              {stats.unlocks.map((c) => {
                const active = c.kind === 'card_back' ? u.cardBack === c.id : u.tableTheme === c.id;
                return (
                  <button
                    key={c.id}
                    className={`cosmetic ${active ? 'on' : ''}`}
                    disabled={!c.unlocked}
                    onClick={() => patch(c.kind === 'card_back' ? { cardBack: c.id } : { tableTheme: c.id })}
                    aria-pressed={active}
                  >
                    {c.kind === 'card_back' ? <img src={`/art/backs/${c.id}.svg`} alt="" width={40} height={56} /> : <span className={`swatch theme-${c.id}`} />}
                    <span className="small">{c.unlocked ? t(c.kind === 'card_back' ? 'cardBack' : 'tableTheme') : t('unlockAt', { n: c.requirement })}</span>
                  </button>
                );
              })}
            </div>
          </section>
        )}
        <section className="panel">
          <h2 className="title sm">{t('history')}</h2>
          {hist && hist.length === 0 && <p className="muted">{t('historyEmpty')}</p>}
          <ul className="history">
            {hist?.map((h) => (
              <li key={`${h.roundId}-${h.hand}`}>
                <span className={`badge b-${h.outcome}`}>{t(h.outcome as any)}</span>
                <span className="muted small">{new Date(h.at).toLocaleString(getLocale() === 'he' ? 'he-IL' : 'en-GB', { timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short' })}</span>
                <Coins units={h.stakeUnits} />
                <Coins units={h.netUnits} sign className={h.netUnits > 0 ? 'pos' : h.netUnits < 0 ? 'neg' : ''} />
              </li>
            ))}
          </ul>
        </section>
      </div>
    </div>
  );
}
