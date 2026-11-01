import { useEffect, useState } from 'react';
import type { LeaderboardRow } from '@table21/protocol';
import { api, serverConfig } from '../api.ts';
import { getLocale, t } from '../i18n.ts';
import { Avatar, Coins } from '../components/bits.tsx';
import { useGroups } from './Friends.tsx';

type Board = { kind: 'weekly' | 'balance'; since: string; minHands: number; rows: LeaderboardRow[] };

export function Leaderboard({ embedded }: { embedded?: boolean } = {}) {
  const { groups } = useGroups();
  const [groupId, setGroupId] = useState<string | null>(null);
  const [kind, setKind] = useState<'weekly' | 'balance' | 'session'>('weekly');
  const [board, setBoard] = useState<Board | null>(null);
  const gid = groupId ?? groups?.[0]?.id ?? null;

  useEffect(() => {
    if (!gid || kind === 'session') return;
    api<Board>(`/api/leaderboard?groupId=${encodeURIComponent(gid)}&kind=${kind}`)
      .then(setBoard)
      .catch(() => setBoard(null));
  }, [gid, kind]);

  const since = board ? new Date(board.since).toLocaleDateString(getLocale() === 'he' ? 'he-IL' : 'en-GB', { timeZone: 'Asia/Jerusalem', weekday: 'long', day: 'numeric', month: 'numeric' }) : '';

  return (
    <div className="pad stack">
      {!embedded && <h1 className="title">{t('navBoard')}</h1>}
      {groups && groups.length === 0 && <p className="muted">{t('pickGroup')}</p>}
      {groups && groups.length > 1 && (
        <select value={gid ?? ''} onChange={(e) => setGroupId(e.target.value)}>
          {groups.map((g) => (
            <option key={g.id} value={g.id}>
              {g.name}
            </option>
          ))}
        </select>
      )}
      <div className="segmented" role="tablist">
        {(['weekly', 'balance', 'session'] as const).map((k) => (
          <button key={k} role="tab" aria-selected={kind === k} className={kind === k ? 'on' : ''} onClick={() => setKind(k)}>
            {t(k === 'weekly' ? 'boardWeekly' : k === 'balance' ? 'boardBalance' : 'boardSession')}
          </button>
        ))}
      </div>
      <p className="note">
        {kind === 'weekly' ? t('weeklyExplain', { min: board?.minHands ?? serverConfig.leaderboardMinHands }) : kind === 'balance' ? t('balanceExplain') : t('sessionExplain')}
      </p>
      {kind === 'weekly' && board && (
        <p className="muted small">
          {t('period')}: {since} 00:00
        </p>
      )}
      {kind !== 'session' && board && gid && (
        <ol className="standings">
          {board.rows.map((r) => (
            <li key={r.userId} className={r.eligible ? '' : 'dim'}>
              <span className="rank num">{r.rank ?? '-'}</span>
              <Avatar id={r.avatar} size={32} />
              <bdi className="nm">{r.name}</bdi>
              <span className="hands-n num">
                {r.hands} {t('hands')}
              </span>
              {r.eligible ? <Coins units={r.value} sign={kind === 'weekly'} className={kind === 'weekly' ? (r.value > 0 ? 'pos' : r.value < 0 ? 'neg' : '') : ''} /> : <span className="muted small">{t('notEligible')}</span>}
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}
