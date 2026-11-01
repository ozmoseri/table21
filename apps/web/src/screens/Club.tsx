import { useEffect, useState } from 'react';
import { backThumb, backThumbFallback } from '../art.ts';
import type { StatsResponse } from '@table21/protocol';
import { api, refreshMe, useMe } from '../api.ts';
import { t } from '../i18n.ts';
import { toast } from '../components/bits.tsx';
import { Leaderboard } from './Leaderboard.tsx';
import { Rewards } from './Rewards.tsx';

type Tab = 'rank' | 'rewards' | 'collection';

/** The club: ranking, free rewards and the collection unlocked by play. */
export function Club({ initial = 'rank' }: { initial?: Tab }) {
  const [tab, setTab] = useState<Tab>(initial);
  return (
    <div className="club">
      <div className="pad club-head">
        <h1 className="title">{t('club')}</h1>
        <div className="segmented" role="tablist">
          {(
            [
              ['rank', 'navBoard'],
              ['rewards', 'rewards'],
              ['collection', 'collection'],
            ] as const
          ).map(([k, label]) => (
            <button key={k} role="tab" aria-selected={tab === k} className={tab === k ? 'on' : ''} onClick={() => setTab(k)}>
              {t(label)}
            </button>
          ))}
        </div>
      </div>
      {tab === 'rank' && <Leaderboard embedded />}
      {tab === 'rewards' && <Rewards embedded />}
      {tab === 'collection' && <Collection />}
    </div>
  );
}

function Collection() {
  const me = useMe();
  const [stats, setStats] = useState<StatsResponse | null>(null);
  useEffect(() => {
    api<StatsResponse>('/api/stats').then(setStats).catch(() => {});
  }, []);
  if (me.status !== 'ready') return <p className="pad muted">{t('offlineOnboard')}</p>;
  const u = me.me;
  const pick = async (body: Record<string, string>) => {
    try {
      await api('/api/me', { method: 'PATCH', body });
      await refreshMe();
    } catch {
      toast(t('error'));
    }
  };
  return (
    <div className="pad stack">
      <p className="fine">{t('cosmeticsNote')}</p>
      <div className="cosmetics">
        {stats?.unlocks.map((c) => {
          const active = c.kind === 'card_back' ? u.cardBack === c.id : u.tableTheme === c.id;
          return (
            <button key={c.id} className={`cosmetic ${active ? 'on' : ''}`} disabled={!c.unlocked} onClick={() => pick(c.kind === 'card_back' ? { cardBack: c.id } : { tableTheme: c.id })} aria-pressed={active}>
              {c.kind === 'card_back' ? <img src={backThumb(c.id)} onError={(e) => { if (!e.currentTarget.src.endsWith('.svg')) e.currentTarget.src = backThumbFallback(c.id); }} alt="" width={40} height={56} /> : <span className={`swatch theme-${c.id}`} />}
              <span className="small">{c.unlocked ? t(c.kind === 'card_back' ? 'cardBack' : 'tableTheme') : t('unlockAt', { n: c.requirement })}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
