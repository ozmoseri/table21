import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react';
import QRCode from 'qrcode';
import { GIFTS, REACTIONS, type AvatarId, type GiftId, type MeResponse, type RoomSnapshot } from '@table21/protocol';
import { GIFT_LABEL, GiftIcon } from '../components/gifts.tsx';
import type { PlayerAction } from '@table21/game-engine';
import { RoomClient, type Intent } from '../net.ts';
import { api, refreshMe } from '../api.ts';
import { REACTION_TEXT, errorText, getLocale, t } from '../i18n.ts';
import { ActionButtons, ResultPanel, StakePicker, Table, totalLabel, type DealerInfo } from '../components/Table.tsx';
import { Avatar, Coins, Seconds, Sheet, toast } from '../components/bits.tsx';
import { go } from '../App.tsx';

function nextDealerStepLabel(s: RoomSnapshot) {
  const d = s.round?.dealer;
  if (!d) return t('dealerStep');
  if (!d.revealed) return t('dealerStepReveal');
  const live = s.round!.seats.some((x) => x.hands.some((h) => h.status === 'stood'));
  return live && (d.total ?? 0) < 17 ? t('dealerStepDraw') : t('dealerStepSettle');
}

function ShareSheet({ snap, open, onClose }: { snap: RoomSnapshot; open: boolean; onClose: () => void }) {
  const url = `${location.origin}/#/r/${snap.code}`;
  const [qr, setQr] = useState('');
  useEffect(() => {
    if (open) QRCode.toDataURL(url, { margin: 1, width: 220, color: { dark: '#080F14', light: '#F5F2EA' } }).then(setQr).catch(() => {});
  }, [open, url]);
  const share = async () => {
    try {
      if (navigator.share) await navigator.share({ title: 'TABLE21', text: t('tagline'), url });
      else {
        await navigator.clipboard.writeText(url);
        toast(t('copied'));
      }
    } catch {}
  };
  const rotate = async () => {
    try {
      const r = await api<{ code: string }>(`/api/rooms/${snap.roomId}/rotate-code`, { method: 'POST' });
      onClose();
      go(`r/${r.code}`);
    } catch {
      toast(t('error'));
    }
  };
  return (
    <Sheet open={open} onClose={onClose} title={t('share')}>
      <div className="share-box">
        <bdi className="big-code" dir="ltr" data-testid="room-code">
          {snap.code}
        </bdi>
        {qr && <img className="qr" src={qr} alt={url} width={180} height={180} />}
        <bdi className="url" dir="ltr">
          {url}
        </bdi>
        <button className="btn primary wide" onClick={share}>
          {t('share')}
        </button>
        {snap.you.isOwner && (
          <button className="btn ghost wide" onClick={rotate}>
            {t('newCode')} <small>{t('newCodeHint')}</small>
          </button>
        )}
      </div>
    </Sheet>
  );
}

function MatchStandings({ snap, meId }: { snap: RoomSnapshot; meId: string }) {
  const m = snap.match!;
  return (
    <ol className="standings" data-testid="standings">
      {m.standings.map((s) => (
        <li key={s.userId} className={s.userId === meId ? 'me' : ''}>
          <span className="rank num">{s.rank}</span>
          <Avatar id={s.avatar} size={32} />
          <bdi className="nm">{s.name}</bdi>
          <span className="hands-n num">
            {s.hands} {t('hands')}
          </span>
          <Coins units={s.netUnits} sign className={s.netUnits > 0 ? 'pos' : s.netUnits < 0 ? 'neg' : ''} />
        </li>
      ))}
    </ol>
  );
}

export function Room({ code, me }: { code: string; me: MeResponse }) {
  const client = useMemo(() => new RoomClient(code), [code]);
  useEffect(() => () => client.close(), [client]);
  const st = useSyncExternalStore(client.subscribe, client.getState);
  const snap = st.snapshot;
  const offsetRef = useRef(0);
  const [sheet, setSheet] = useState<null | 'share' | 'members' | 'more' | 'settings'>(null);
  const [detail, setDetail] = useState<{ userId: string; name: string; avatar: AvatarId; betUnits?: number } | null>(null);
  const [muted, setMuted] = useState<Set<string>>(() => new Set());
  const toggleMute = (uid: string) =>
    setMuted((m) => {
      const n = new Set(m);
      if (n.has(uid)) n.delete(uid);
      else n.add(uid);
      return n;
    });
  const giveGift = async (to: string, giftId: GiftId) => {
    const r = await client.sendGift(to, giftId);
    if (!r.ok) toast(errorText(r.error));
    else setDetail(null);
  };

  const offset = useMemo(() => {
    if (snap) offsetRef.current = snap.serverTime - Date.now();
    return offsetRef.current;
  }, [snap?.version, snap?.serverTime]);

  useEffect(() => {
    if (snap?.phase === 'results' || snap?.phase === 'waiting') void refreshMe();
  }, [snap?.phase]);

  const send = async (intent: Intent) => {
    const r = await client.send(intent);
    if (!r.ok && r.error) toast(errorText(r.error));
    return r;
  };

  if (st.error && !snap)
    return (
      <div className="pad center stack">
        <h1 className="title">{t('joinRoom')}</h1>
        <p>{t('roomNotFound')}</p>
        <button className="btn primary" onClick={() => go('home')}>
          {t('back')}
        </button>
      </div>
    );
  if (!snap) return <p className="muted center pad">{t('loading')}</p>;

  const meId = me.userId;
  const mySeat = snap.seats.find((s) => s.userId === meId) ?? null;
  const round = snap.round;
  const inRound = !!round?.seats.some((s) => s.playerId === meId);
  const roundLive = snap.phase === 'player_turns' || snap.phase === 'dealer_turn';
  const dealerMember = snap.dealerUserId ? snap.members.find((m) => m.userId === snap.dealerUserId) : null;
  const dealer: DealerInfo = dealerMember
    ? { name: dealerMember.name, avatar: dealerMember.avatar, presenter: true, offline: !dealerMember.connected, userId: dealerMember.userId }
    : { name: t('autoDealer'), presenter: false };
  const turnPlayer = round?.turn ? round.seats[round.turn.seat]?.playerId : null;
  const turnName = snap.members.find((m) => m.userId === turnPlayer)?.name ?? '';
  const myTurn = turnPlayer === meId;
  const match = snap.match;
  const matchRunning = match?.status === 'running';
  const isEntrant = !!match?.standings.some((s) => s.userId === meId);
  const full = snap.seats.length >= snap.settings.maxSeats;
  const between = snap.phase === 'waiting' || snap.phase === 'betting' || snap.phase === 'results';
  const betters = snap.seats.filter((s) => s.betUnits > 0).length;
  const canDeal =
    snap.phase === 'betting' && betters > 0 && (snap.settings.dealerMode === 'human' && snap.dealerUserId ? snap.you.isDealer : snap.you.isOwner);
  const spectators = snap.members.filter((m) => m.role === 'spectator');

  const banners: string[] = [];
  if (st.connection === 'reconnecting') banners.push(t('reconnecting'));
  if (st.restored) banners.push(t('serverBack'));
  if (st.dupTab) banners.push(t('dupTab'));
  if (dealer.presenter && dealer.offline) banners.push(t('dealerOffline'));
  if (roundLive && !inRound && !snap.you.isDealer) banners.push(t('midRound'));
  if (!mySeat && full && !snap.you.isDealer) banners.push(t('seatFull'));
  if (matchRunning && !isEntrant) banners.push(t('lateJoin'));
  if (!snap.seats.length && !snap.dealerUserId) banners.push(t('emptyRoom'));

  let status = '';
  if (snap.phase === 'waiting') status = t('waitingBets');
  else if (snap.phase === 'betting') status = t('dealingSoon');
  else if (snap.phase === 'player_turns') status = myTurn ? t('yourTurn') : t('turnOf', { name: turnName });
  else if (snap.phase === 'dealer_turn') status = t('dealerTurn');

  const controls = () => {
    if (match?.status === 'finished' && between) {
      return (
        <div className="session-end" data-testid="session-end">
          <h2>{t('matchOver')}</h2>
          <MatchStandings snap={snap} meId={meId} />
          {snap.you.isOwner && snap.phase === 'waiting' && (
            <button className="btn primary wide" onClick={() => send({ type: 'start_match' })}>
              {t('playAgain')}
            </button>
          )}
        </div>
      );
    }
    if (snap.phase === 'results') {
      return (
        <>
          <ResultPanel snap={snap} meId={meId} />
          <p className="muted small center">
            {t('nextRound')} {snap.deadline && <Seconds deadline={snap.deadline} offset={offset} />}
          </p>
        </>
      );
    }
    if (snap.phase === 'player_turns') {
      if (myTurn) return <ActionButtons legal={snap.you.legalActions} disabled={st.pending} onAction={(a: PlayerAction) => send({ type: 'action', action: a })} />;
      return null;
    }
    if (snap.phase === 'dealer_turn') {
      if (snap.you.canDealerStep)
        return (
          <button className="btn primary wide big" disabled={st.pending} onClick={() => send({ type: 'dealer_step' })} data-testid="dealer-step">
            {nextDealerStepLabel(snap)}
          </button>
        );
      return null;
    }
    // waiting / betting
    if (snap.mode === 'match' && match?.status === 'lobby') {
      return (
        <div className="stack">
          <p className="note">{t('matchNote')}</p>
          {!mySeat && !snap.you.isDealer && (
            <button className="btn wide" onClick={() => send({ type: 'sit' })} disabled={full}>
              {t('sit')}
            </button>
          )}
          {snap.you.isOwner && (
            <button className="btn primary wide" onClick={() => send({ type: 'start_match' })} disabled={!snap.seats.length} data-testid="start-match">
              {t('startMatch')}
            </button>
          )}
        </div>
      );
    }
    if (!mySeat) {
      return (
        <div className="stack">
          {!snap.you.isDealer && !(matchRunning && !isEntrant) && (
            <button className="btn primary wide" onClick={() => send({ type: 'sit' })} disabled={full} data-testid="sit">
              {t('sit')}
            </button>
          )}
          {snap.settings.dealerMode === 'human' && between && (!snap.dealerUserId || dealer.offline) && snap.phase !== 'betting' && (
            <button className="btn wide" onClick={() => send({ type: 'claim_dealer' })} data-testid="claim-dealer">
              {t('claimDealer')}
            </button>
          )}
          {snap.you.isDealer && (
            <>
              {canDeal && (
                <button className="btn primary wide big" onClick={() => send({ type: 'deal' })} data-testid="deal">
                  {t('deal')}
                </button>
              )}
              <button className="btn ghost wide" onClick={() => send({ type: 'release_dealer' })}>
                {t('releaseDealer')}
              </button>
            </>
          )}
        </div>
      );
    }
    return (
      <div className="stack">
        <StakePicker stakes={snap.settings.stakes} available={snap.you.availableUnits} current={mySeat.betUnits} onPick={(c) => send({ type: 'bet', coins: c })} disabled={st.pending} />
        <div className="row">
          {mySeat.betUnits > 0 && (
            <button className="btn ghost" onClick={() => send({ type: 'clear_bet' })}>
              {t('clearBet')}
            </button>
          )}
          {canDeal && (
            <button className="btn primary grow" onClick={() => send({ type: 'deal' })} data-testid="deal">
              {t('deal')}
            </button>
          )}
        </div>
      </div>
    );
  };

  const detailRound = detail ? round?.seats.find((s) => s.playerId === detail.userId) : undefined;

  return (
    <div className="room" data-phase={snap.phase} data-testid="room">
      <header className="room-head">
        <button className="btn ghost sm" onClick={() => (client.close(), go('home'))} aria-label={t('back')}>
          {t('back')}
        </button>
        <button className="code-chip" onClick={() => setSheet('share')} data-testid="share">
          <bdi dir="ltr">{snap.code}</bdi>
          <span>{t('share')}</span>
        </button>
        <button className="btn ghost sm" onClick={() => setSheet('members')}>
          <span className="num">{snap.members.filter((m) => m.connected).length}</span>
          <svg viewBox="0 0 24 24" width="18" height="18" aria-hidden="true" className="ico"><path d="M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7 0a3 3 0 1 0 0-6M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6m1-6c2.8 0 5 2.2 5 5" /></svg>
        </button>
        <button className="btn ghost sm" onClick={() => setSheet('more')} aria-label="more">
          ⋯
        </button>
      </header>

      <div className="status-line" aria-live="polite">
        <span className="phase-text" data-testid="status">
          {status}
        </span>
        {matchRunning && match && <span className="pill">{t('matchRoundOf', { n: Math.min(match.roundsPlayed + 1, match.roundsTotal), total: match.roundsTotal })}</span>}
        {snap.phase === 'player_turns' && snap.deadline && (
          <span className="pill num" dir="ltr">
            <Seconds deadline={snap.deadline} offset={offset} />s
          </span>
        )}
        {(snap.phase === 'betting' && snap.deadline) ? (
          <span className="pill num" dir="ltr">
            <Seconds deadline={snap.deadline} offset={offset} />s
          </span>
        ) : null}
        <span className="wallet">
          <Coins units={snap.you.availableUnits} />
          {st.pending && <span className="sync-dot" title={t('syncing')} />}
        </span>
      </div>

      {banners.length > 0 && (
        <div className="banners">
          {banners.map((b) => (
            <p key={b} className="banner">
              {b}
            </p>
          ))}
        </div>
      )}

      <Table
        snap={snap}
        meId={meId}
        back={me.cardBack}
        theme={me.tableTheme}
        offset={offset}
        dealer={dealer}
        sessionKey={snap.roomId}
        resyncKey={st.resyncKey}
        reactions={st.reactions}
        muted={muted}
        onSeatTap={(seat) => setDetail(seat)}
        onDealerTap={dealerMember && dealerMember.userId !== meId ? () => setDetail(dealerMember) : undefined}
        overlay={
          !muted.has('*') && st.reactions.some((r) => !snap.seats.some((x) => x.userId === r.userId) && r.userId !== snap.dealerUserId && r.userId !== meId) ? (
            <div className="reaction-float" aria-hidden="true">
              {st.reactions
                .filter((r) => Date.now() - r.at < 4000 && !muted.has(r.userId) && !snap.seats.some((x) => x.userId === r.userId) && r.userId !== snap.dealerUserId && r.userId !== meId)
                .map((r) => (
                  <span key={`${r.userId}${r.at}`} className="reaction-bubble">
                    <bdi>{r.name}</bdi>: {REACTION_TEXT[r.reaction]?.[getLocale()]}
                  </span>
                ))}
            </div>
          ) : null
        }
      />

      <div className="controls" data-testid="controls">
        {controls()}
      </div>

      <div className="reactions" role="group" aria-label="reactions">
        {REACTIONS.map((r) => (
          <button key={r} className="pill" onClick={() => client.react(r)} data-testid={`react-${r}`}>
            {REACTION_TEXT[r][getLocale()]}
          </button>
        ))}
        <button className={`pill ${muted.has('*') ? 'on' : ''}`} onClick={() => toggleMute('*')} aria-pressed={muted.has('*')} aria-label={t('muteAll')}>
          <svg viewBox="0 0 24 24" width="18" height="18" className="ico" aria-hidden="true">
            <path d="M6 9h3l5-4v14l-5-4H6z" />
            {muted.has('*') && <path d="M17 9l4 6M21 9l-4 6" />}
          </svg>
        </button>
      </div>

      {matchRunning && match && (
        <details className="panel match-panel">
          <summary>{t('standings')}</summary>
          <MatchStandings snap={snap} meId={meId} />
        </details>
      )}

      <ShareSheet snap={snap} open={sheet === 'share'} onClose={() => setSheet(null)} />
      <Sheet open={sheet === 'members'} onClose={() => setSheet(null)} title={t('players')}>
        <ul className="member-list">
          {snap.members.map((m) => (
            <li key={m.userId}>
              <Avatar id={m.avatar} size={32} />
              <bdi>{m.name}</bdi>
              <span className="muted small">{m.role === 'dealer' ? t('dealer') : m.role === 'spectator' ? t('spectators') : t('players')}</span>
              <span className={`dot ${m.connected ? 'on' : ''}`} aria-label={m.connected ? t('online') : t('offline')} />
            </li>
          ))}
        </ul>
        {spectators.length > 0 && <p className="muted small">{t('spectating')}: {spectators.length}</p>}
      </Sheet>
      <Sheet open={sheet === 'more'} onClose={() => setSheet(null)} title="TABLE21">
        <div className="stack">
          {mySeat && (
            <button className="btn wide" onClick={() => (setSheet(null), send({ type: 'leave_seat' }))} data-testid="leave-seat">
              {t('leaveSeat')}
            </button>
          )}
          {snap.you.isOwner && (snap.phase === 'waiting' || snap.phase === 'results') && !matchRunning && (
            <button className="btn wide" onClick={() => setSheet('settings')}>
              {t('settings')}
            </button>
          )}
          <button className="btn ghost wide" onClick={() => (client.close(), go('home'))}>
            {t('leaveRoom')}
          </button>
          <p className="fine">{t('coinsNote')}</p>
        </div>
      </Sheet>
      <RoomSettingsSheet snap={snap} open={sheet === 'settings'} onClose={() => setSheet(null)} send={send} />
      <Sheet open={!!detail} onClose={() => setDetail(null)} title={detail?.name}>
        {detail && (
          <div className="tray" data-testid="seat-tray">
            <div className="seat-detail" dir="ltr">
              <Avatar id={detail.avatar} size={56} />
              {detailRound?.hands.map((h, i) => (
                <div key={i} className="detail-hand">
                  {detailRound.hands.length > 1 && <span className="hc-n num">{i + 1}</span>}
                  <span className="total num">{totalLabel(h)}</span>
                  <Coins units={h.stakeUnits} />
                  {h.outcome && <span className={`badge b-${h.outcome}`}>{t(h.outcome)}</span>}
                </div>
              )) ?? (detail.betUnits ? <Coins units={detail.betUnits} /> : null)}
            </div>
            {detail.userId !== meId && (
              <>
                <h3 className="sub">{t('sendGift')}</h3>
                <div className="gift-grid">
                  {GIFTS.map((g) => (
                    <button key={g} className="gift-pick" onClick={() => giveGift(detail.userId, g)} data-testid={`gift-${g}`}>
                      <GiftIcon id={g} size={36} />
                      <span>{GIFT_LABEL[g][getLocale()]}</span>
                    </button>
                  ))}
                </div>
                <p className="fine">{t('giftNote')}</p>
                <button className={`btn ghost wide ${muted.has(detail.userId) ? 'on' : ''}`} onClick={() => toggleMute(detail.userId)} aria-pressed={muted.has(detail.userId)}>
                  {muted.has(detail.userId) ? t('unmutePerson') : t('mutePerson')}
                </button>
              </>
            )}
          </div>
        )}
      </Sheet>
    </div>
  );
}

function RoomSettingsSheet({ snap, open, onClose, send }: { snap: RoomSnapshot; open: boolean; onClose: () => void; send: (i: Intent) => Promise<unknown> }) {
  const [turn, setTurn] = useState(snap.settings.turnSeconds);
  const [dealerMode, setDealerMode] = useState(snap.settings.dealerMode);
  const [rotate, setRotate] = useState(snap.settings.rotateDealerEvery === 5);
  return (
    <Sheet open={open} onClose={onClose} title={t('settings')}>
      <label className="field">
        <span>{t('turnTime')}</span>
        <select value={turn} onChange={(e) => setTurn(Number(e.target.value))}>
          {[15, 25, 40, 60].map((v) => (
            <option key={v} value={v}>
              {v} {t('seconds')}
            </option>
          ))}
        </select>
      </label>
      <div className="choice-list">
        {(['auto', 'human'] as const).map((d) => (
          <button key={d} className={`choice ${dealerMode === d ? 'on' : ''}`} onClick={() => setDealerMode(d)} aria-pressed={dealerMode === d}>
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
      <button
        className="btn primary wide"
        onClick={async () => {
          await send({ type: 'settings', settings: { turnSeconds: turn, dealerMode, rotateDealerEvery: rotate ? 5 : 0 } });
          onClose();
        }}
      >
        {t('save')}
      </button>
    </Sheet>
  );
}
