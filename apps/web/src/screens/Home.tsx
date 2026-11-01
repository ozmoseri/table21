import { useEffect, useState } from 'react';
import { api, isWaking, refreshMe, useMe } from '../api.ts';
import { errorText, t } from '../i18n.ts';
import { Avatar, Coins, Sheet, toast } from '../components/bits.tsx';
import { go } from '../App.tsx';
import { Brand } from './Onboarding.tsx';

export function CreateRoomSheet({ open, onClose, preset }: { open: boolean; onClose: () => void; preset: 'casual' | 'match' }) {
  const [mode, setMode] = useState<'casual' | 'match'>(preset);
  const [dealerMode, setDealerMode] = useState<'auto' | 'human'>('auto');
  const [turnSeconds, setTurn] = useState(25);
  const [rotate, setRotate] = useState(false);
  const [stack, setStack] = useState(1000);
  const [busy, setBusy] = useState(false);
  const create = async () => {
    setBusy(true);
    try {
      const r = await api<{ code: string }>('/api/rooms', {
        method: 'POST',
        body: { mode, settings: { dealerMode, turnSeconds, rotateDealerEvery: rotate ? 5 : 0 }, matchStackCoins: stack, matchRounds: 10 },
      });
      onClose();
      go(`r/${r.code}`);
    } catch {
      toast(t('error'));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('createRoom')}>
      <div className="choice-list" role="radiogroup">
        {(['casual', 'match'] as const).map((m) => (
          <button key={m} role="radio" aria-checked={mode === m} className={`choice ${mode === m ? 'on' : ''}`} onClick={() => setMode(m)}>
            <b>{t(m === 'casual' ? 'casualRoom' : 'matchRoom')}</b>
            <span>{t(m === 'casual' ? 'casualRoomSub' : 'matchRoomSub')}</span>
          </button>
        ))}
      </div>
      {mode === 'match' && (
        <label className="field">
          <span>{t('matchStack')}</span>
          <select value={stack} onChange={(e) => setStack(Number(e.target.value))}>
            {[500, 1000, 2000].map((v) => (
              <option key={v} value={v}>
                {v.toLocaleString()}
              </option>
            ))}
          </select>
        </label>
      )}
      <h3 className="sub">{t('dealerMode')}</h3>
      <div className="choice-list" role="radiogroup">
        {(['auto', 'human'] as const).map((d) => (
          <button key={d} role="radio" aria-checked={dealerMode === d} className={`choice ${dealerMode === d ? 'on' : ''}`} onClick={() => setDealerMode(d)}>
            <b>{t(d === 'auto' ? 'dealerAuto' : 'dealerHuman')}</b>
            <span>{t(d === 'auto' ? 'dealerAutoSub' : 'dealerHumanSub')}</span>
          </button>
        ))}
      </div>
      {dealerMode === 'human' && (
        <label className="check">
          <input type="checkbox" checked={rotate} onChange={(e) => setRotate(e.target.checked)} />
          <span>{t('rotate')}</span>
        </label>
      )}
      <label className="field">
        <span>{t('turnTime')}</span>
        <select value={turnSeconds} onChange={(e) => setTurn(Number(e.target.value))}>
          {[15, 25, 40, 60].map((v) => (
            <option key={v} value={v}>
              {v} {t('seconds')}
            </option>
          ))}
        </select>
      </label>
      <button className="btn primary wide" disabled={busy} onClick={create} data-testid="create-room">
        {t('open')}
      </button>
    </Sheet>
  );
}

export function JoinSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const [code, setCode] = useState('');
  return (
    <Sheet open={open} onClose={onClose} title={t('joinRoom')}>
      <form
        className="form"
        onSubmit={(e) => {
          e.preventDefault();
          const c = code.toUpperCase().replace(/[^0-9A-Z]/g, '');
          if (c.length >= 4) {
            onClose();
            go(`r/${c}`);
          }
        }}
      >
        <label className="field">
          <span>{t('roomCode')}</span>
          <input className="code-input" dir="ltr" value={code} onChange={(e) => setCode(e.target.value)} maxLength={8} autoCapitalize="characters" autoComplete="off" inputMode="text" data-testid="join-code" />
        </label>
        <button className="btn primary wide">{t('join')}</button>
      </form>
    </Sheet>
  );
}

export function Home() {
  const me = useMe();
  const [sheet, setSheet] = useState<null | 'casual' | 'match'>(null);
  const [code, setCode] = useState('');
  const [online, setOnline] = useState<{ userId: string; avatar: string }[]>([]);
  const user = me.status === 'ready' ? me.me : null;
  useEffect(() => {
    if (!user) return;
    api<{ userId: string; avatar: string; online: boolean }[]>('/api/friends')
      .then((f) => setOnline(f.filter((x) => x.online)))
      .catch(() => {});
  }, [!!user]);

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
    <div className="home">
      <header className="home-head">
        <Brand />
        {user && (
          <a href="#/profile" className="me-chip">
            <Avatar id={user.avatar} size={36} />
            <span>
              <bdi className="me-name">{user.name}</bdi>
              <Coins units={user.wallet.availableUnits} className="me-coins" />
            </span>
          </a>
        )}
      </header>

      {me.status === 'offline' && (
        <p className="note" data-testid="offline-note">
          {t('offlineOnboard')}
          {isWaking() ? ` ${t('serverWaking')}` : ''}
        </p>
      )}

      <div className="home-col home-main">
        {user?.activeRoom && (
          <a className="resume" href={`#/r/${user.activeRoom.code}`}>
            {t('backToRoom')} <bdi dir="ltr">{user.activeRoom.code}</bdi>
          </a>
        )}
        <section className="hero-table" aria-hidden="true">
          <div className="hero-felt">
            <span className="hero-card c1" />
            <span className="hero-card c2" />
            <span className="hero-arc" />
          </div>
        </section>

        <button className="play primary" onClick={() => setSheet('casual')} disabled={!user} data-testid="play-friends">
          <b>{t('playFriends')}</b>
          <span>{t('playFriendsSub')}</span>
        </button>

        <form
          className="join-row"
          onSubmit={(e) => {
            e.preventDefault();
            const c = code.toUpperCase().replace(/[^0-9A-Z]/g, '');
            if (c.length >= 4) go(`r/${c}`);
          }}
        >
          <input
            className="code-input sm"
            dir="ltr"
            value={code}
            onChange={(e) => setCode(e.target.value)}
            maxLength={8}
            placeholder={t('roomCode')}
            aria-label={t('roomCode')}
            autoCapitalize="characters"
            autoComplete="off"
            data-testid="join-code"
          />
          <button className="btn" disabled={!user || code.replace(/[^0-9A-Za-z]/g, '').length < 4} data-testid="join-go">
            {t('join')}
          </button>
        </form>
      </div>
      <div className="home-col home-side">
        {user?.account.kind === 'guest' && (
          <a className="home-save" href="#/account" data-testid="home-save">
            {t('saveAccount')}
          </a>
        )}
        {user && (user.grants.dailyAvailable || user.grants.rescueAvailable) && (
          <div className="grant-strip">
            <span>{user.grants.rescueAvailable ? t('rescueReady') : t('dailyReady')}</span>
            <button className="btn sm gold" onClick={() => claim(user.grants.rescueAvailable ? 'rescue' : 'daily')} data-testid="claim-grant">
              {t('claim')}
            </button>
          </div>
        )}
        {online.length > 0 && (
          <a className="online-strip" href="#/friends" aria-label={t('online')}>
            <span className="dot on" aria-hidden="true" />
            <span className="small">{t('friendsOnline', { n: online.length })}</span>
            <span className="online-avatars">
              {online.slice(0, 5).map((f) => (
                <Avatar key={f.userId} id={f.avatar} size={28} />
              ))}
            </span>
          </a>
        )}

        <div className="play-list">
          <button className="play" onClick={() => setSheet('match')} disabled={!user}>
            <b>{t('friendsNight')}</b>
            <span>{t('friendsNightSub')}</span>
          </button>
          <a className="play" href="#/practice" data-testid="practice">
            <b>{t('practice')}</b>
            <span>{t('practiceSub')}</span>
          </a>
          <a className="play" href="#/pass">
            <b>{t('passPlay')}</b>
            <span>{t('passPlaySub')}</span>
          </a>
          <a className="play club-tile" href="#/rewards">
            <b>{t('rewards')}</b>
            <span>{t('rewardsSub')}</span>
          </a>
        </div>
        <p className="fine center">{t('coinsNote')}</p>
      </div>

      <CreateRoomSheet open={sheet === 'casual' || sheet === 'match'} preset={sheet === 'match' ? 'match' : 'casual'} key={sheet ?? 'none'} onClose={() => setSheet(null)} />
    </div>
  );
}
