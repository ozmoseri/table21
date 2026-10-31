import { useState } from 'react';
import { api, refreshMe, useMe } from '../api.ts';
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
  const [sheet, setSheet] = useState<null | 'casual' | 'match' | 'join'>(null);
  const user = me.status === 'ready' ? me.me : null;

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

      {user?.activeRoom && (
        <a className="resume" href={`#/r/${user.activeRoom.code}`}>
          {t('backToRoom')} <bdi dir="ltr">{user.activeRoom.code}</bdi>
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

      <section className="hero-table" aria-hidden="true">
        <div className="hero-felt">
          <span className="hero-card c1" />
          <span className="hero-card c2" />
          <span className="hero-arc" />
        </div>
      </section>

      <div className="play-list">
        <button className="play primary" onClick={() => setSheet('casual')} disabled={!user} data-testid="play-friends">
          <b>{t('playFriends')}</b>
          <span>{t('playFriendsSub')}</span>
        </button>
        <button className="play" onClick={() => setSheet('join')} disabled={!user} data-testid="open-join">
          <b>{t('joinRoom')}</b>
        </button>
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
      </div>
      <a className="link-row" href="#/rewards">
        {t('rewards')}
      </a>
      <p className="fine center">{t('coinsNote')}</p>

      <CreateRoomSheet open={sheet === 'casual' || sheet === 'match'} preset={sheet === 'match' ? 'match' : 'casual'} key={sheet ?? 'none'} onClose={() => setSheet(null)} />
      <JoinSheet open={sheet === 'join'} onClose={() => setSheet(null)} />
    </div>
  );
}
