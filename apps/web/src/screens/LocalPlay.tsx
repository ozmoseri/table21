import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { AVATARS, type AvatarId } from '@table21/protocol';
import { LocalGame, type LocalPlayer } from '../local.ts';
import { getLocal, saveLocal } from '../prefs.ts';
import { t } from '../i18n.ts';
import { ActionButtons, BetConfirm, ResultPanel, StakePicker, Table, myTurnText } from '../components/Table.tsx';
import { DealSettings } from '../components/DealSettings.tsx';
import { Avatar, Coins, Sheet, RollingCoins } from '../components/bits.tsx';
import { go } from '../App.tsx';
import { useMe } from '../api.ts';
import { useHandBusy } from '../update.ts';
import { useTableTimeline } from '../anim/useTimeline.ts';

function Game({ game, onExit }: { game: LocalGame; onExit: () => void }) {
  const raw = useSyncExternalStore(game.subscribe, game.getView);
  // The local game decides instantly; the table plays it in the dealer's rhythm (anim/timeline.ts).
  const { view, pending, skip, presentation } = useTableTimeline(raw, game.sessionId, game.players[0]?.id ?? 'local');
  const snap = view ?? raw;
  useEffect(() => () => game.destroy(), [game]);
  const me = useMe();
  const back = me.status === 'ready' ? me.me.cardBack : 'classic';
  const theme = me.status === 'ready' ? me.me.tableTheme : 'emerald';
  const solo = game.mode === 'solo';
  const viewer = snap.you.userId;
  const [menu, setMenu] = useState(false);
  const handoffPlayer = game.handoff && !pending ? game.players.find((p) => p.id === game.handoff) : null;
  const anyBet = game.players.some((p) => p.betUnits > 0);
  // A local hand lives only in this page: an update must never reload it away. Busy from the first bet to the result.
  useHandBusy('local', (snap.phase === 'betting' && anyBet) || snap.phase === 'player_turns' || snap.phase === 'dealer_turn');
  const turnName = snap.round?.turn ? game.players.find((p) => p.id === snap.round!.seats[snap.round!.turn!.seat].playerId)?.name : '';

  return (
    <div className="room local" data-phase={snap.phase} data-testid="local-game">
      <header className="room-head hud">
        <button className="hud-btn hud-back" onClick={onExit} aria-label={t('back')} data-testid="local-back">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M15 5l-7 7 7 7" />
          </svg>
        </button>
        {solo && (
          <span className="wallet hud-balance">
            <RollingCoins units={snap.you.availableUnits} />
          </span>
        )}
        <span className="hud-spacer" />
        <span className="code-chip static hud-mode">{solo ? t('practice') : t('passPlay')}</span>
        <button className="hud-btn" onClick={() => setMenu(true)} aria-label={t('menu')} data-testid="room-menu">
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h16" />
          </svg>
        </button>
      </header>
      <div className="status-line">
        <span className="phase-text" data-testid="status">
          {pending && snap.phase === 'player_turns' && !snap.round?.turn ? t('dealing') : snap.phase === 'player_turns' ? (solo ? myTurnText(snap, viewer) : t('turnOf', { name: turnName ?? '' })) : snap.phase === 'dealer_turn' ? t('dealerTurn') : snap.phase === 'betting' ? t('waitingBets') : ''}
        </span>
      </div>
      <Table
        snap={snap}
        meId={viewer}
        back={back}
        theme={theme}
        offset={0}
        dealer={{ name: t('autoDealer'), presenter: false }}
        sessionKey={game.sessionId}
        presentation={presentation}
        pending={pending}
        onSkip={skip}
        overlay={
          handoffPlayer ? (
            <div className="handoff" role="dialog" aria-modal="true" data-testid="handoff">
              <Avatar id={handoffPlayer.avatar} size={72} />
              <h2>{t('passTo', { name: handoffPlayer.name })}</h2>
              <button className="btn primary big" onClick={() => game.confirmHandoff()}>
                {t('imReady', { name: handoffPlayer.name })}
              </button>
            </div>
          ) : null
        }
      />
      <div className="controls">
        {snap.phase === 'betting' && (
          <div className="stack">
            {game.players.map((p) => (
              <div key={p.id} className={`bet-row ${solo ? 'bet-bar' : ''}`}>
                {!solo && (
                  <span className="bet-who">
                    <Avatar id={p.avatar} size={28} />
                    <bdi>{p.name}</bdi>
                    <Coins units={p.units} />
                  </span>
                )}
                <StakePicker stakes={game.stakes} available={p.units} current={p.betUnits} onPick={(c) => game.setBet(p.id, c)} onClear={() => game.clearBet(p.id)} />
                {p.units + p.betUnits < 20 && (
                  <button className="btn sm gold" onClick={() => game.refill(p.id)}>
                    {t('refill')}
                  </button>
                )}
              </div>
            ))}
            <BetConfirm units={game.players.reduce((a, p) => a + p.betUnits, 0)} label={t('deal')} testId="deal" disabled={!anyBet} onConfirm={() => game.deal()} />
          </div>
        )}
        {snap.phase === 'player_turns' && !handoffPlayer && <ActionButtons legal={snap.you.legalActions} onAction={(a) => game.act(a)} />}
        {snap.phase === 'results' && (
          <div className="stack">
            {solo ? (
              <ResultPanel snap={snap} meId={game.players[0].id} />
            ) : (
              <ul className="local-results">
                {snap.round?.seats.map((s) => {
                  const p = game.players.find((x) => x.id === s.playerId)!;
                  const net = s.hands.reduce((a, h) => a + (h.returnedUnits ?? 0) - h.stakeUnits, 0);
                  return (
                    <li key={s.playerId}>
                      <Avatar id={p.avatar} size={28} />
                      <bdi>{p.name}</bdi>
                      {s.hands.map((h, i) => (
                        <span key={i} className={`badge b-${h.outcome}`}>
                          {t(h.outcome ?? 'push')}
                        </span>
                      ))}
                      <Coins units={net} sign className={net > 0 ? 'pos' : net < 0 ? 'neg' : ''} />
                    </li>
                  );
                })}
              </ul>
            )}
            <button className="btn primary wide" onClick={() => game.nextRound()} data-testid="next-round">
              {t('nextRound')}
            </button>
          </div>
        )}
      </div>
      <p className="fine center">{t('practiceNote')}</p>
      <Sheet open={menu} onClose={() => setMenu(false)} title={t('menu')}>
        <div className="stack">
          <DealSettings />
          <button className="btn ghost wide" onClick={onExit}>
            {t('back')}
          </button>
          <p className="fine">{t('practiceNote')}</p>
          <p className="menu-footer" data-testid="menu-footer">
            {t('footerNote')}
          </p>
        </div>
      </Sheet>
    </div>
  );
}

export function LocalPlay({ mode }: { mode: 'solo' | 'pass' }) {
  const me = useMe();
  const local = getLocal();
  const baseName = me.status === 'ready' ? me.me.name : local.name || t('you');
  const baseAvatar = (me.status === 'ready' ? me.me.avatar : local.avatar) as AvatarId;
  const [players, setPlayers] = useState<{ name: string; avatar: AvatarId }[]>(
    local.passPlayers.length >= 2 ? (local.passPlayers as any) : [{ name: baseName, avatar: baseAvatar }, { name: '', avatar: 'cobalt' }],
  );
  const [started, setStarted] = useState(mode === 'solo');

  const game = useMemo(() => {
    if (!started) return null;
    if (mode === 'solo') {
      const p: LocalPlayer = { id: 'p0', name: baseName, avatar: baseAvatar, units: local.practiceUnits, betUnits: 0 };
      return new LocalGame('solo', [p]);
    }
    saveLocal({ passPlayers: players });
    return new LocalGame(
      'pass',
      players.map((p, i) => ({ id: `p${i}`, name: p.name.trim(), avatar: p.avatar, units: 2000, betUnits: 0 })),
    );
  }, [started]);

  if (game) return <Game game={game} onExit={() => go('home')} />;

  const valid = players.length >= 2 && players.every((p) => p.name.trim());
  return (
    <div className="pad stack setup">
      <header className="room-head">
        <button className="btn ghost sm" onClick={() => go('home')}>
          {t('back')}
        </button>
        <h1 className="title">{t('passPlay')}</h1>
      </header>
      <p className="muted">{t('passPlaySub')}. {t('practiceNote')}</p>
      {players.map((p, i) => (
        <div key={i} className="panel player-row">
          <button
            className="avatar-pick on"
            onClick={() => setPlayers(players.map((x, j) => (j === i ? { ...x, avatar: AVATARS[(AVATARS.indexOf(x.avatar) + 1) % AVATARS.length] } : x)))}
            aria-label={t('chooseAvatar')}
          >
            <Avatar id={p.avatar} size={44} />
          </button>
          <input
            value={p.name}
            maxLength={20}
            dir="auto"
            placeholder={t('playerName')}
            onChange={(e) => setPlayers(players.map((x, j) => (j === i ? { ...x, name: e.target.value } : x)))}
            data-testid={`pp-name-${i}`}
          />
          {players.length > 2 && (
            <button className="btn ghost sm" onClick={() => setPlayers(players.filter((_, j) => j !== i))}>
              {t('remove')}
            </button>
          )}
        </div>
      ))}
      {players.length < 6 && (
        <button className="btn wide" onClick={() => setPlayers([...players, { name: '', avatar: AVATARS[players.length % AVATARS.length] }])}>
          {t('addPlayer')}
        </button>
      )}
      <button className="btn primary wide big" disabled={!valid} onClick={() => setStarted(true)} data-testid="pp-start">
        {t('startGame')}
      </button>
    </div>
  );
}
