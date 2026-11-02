import { useEffect, useState, useSyncExternalStore } from 'react';
import type { PlayerAction } from '@table21/game-engine';
import type { PublicRound, PublicCard } from '@table21/protocol';
import { advise, coachSession, recordDecision, type Advice, type CoachRank } from '../coach.ts';
import { t, type Key } from '../i18n.ts';
import { getPrefs, usePrefs } from '../prefs.ts';
import { ActionButtons } from './Table.tsx';
import { Sheet } from './bits.tsx';

/**
 * Coach (beginner tips, like the hints in a chess app): a "tip" button with the recommended move, a hot/cold meter of
 * the risk of busting on one more card, a closable "why" sheet, and a short verdict after each decision. Private to
 * this device: nothing is sent to the server and other players never see it. Uses only the player's own cards and the
 * dealer's up card (see coach.ts), so it is the same help as a printed strategy card.
 */

export type CoachWhere = 'practice' | 'room';
export const coachOn = (where: CoachWhere) => (where === 'practice' ? getPrefs().coachPractice : getPrefs().coachRooms);

/** The hand whose turn it is and the dealer's up card, from the public round view. */
export function turnHand(round: PublicRound | null | undefined): { ranks: CoachRank[]; up: CoachRank; key: string } | null {
  if (!round?.turn) return null;
  const hand = round.seats[round.turn.seat]?.hands[round.turn.hand];
  const up: PublicCard | undefined = round.dealer.cards[0];
  if (!hand || !up || !('rank' in up) || hand.cards.length < 2) return null;
  const ranks: CoachRank[] = [];
  for (const c of hand.cards) {
    if (!('rank' in c)) return null;
    ranks.push(c.rank as CoachRank);
  }
  return {
    ranks,
    up: up.rank as CoachRank,
    key: `${round.roundId}:${round.turn.seat}:${round.turn.hand}:${hand.cards.length}`,
  };
}

const MOVE_KEY: Record<PlayerAction, Key> = { hit: 'coachMoveHit', stand: 'coachMoveStand', double: 'coachMoveDouble', split: 'coachMoveSplit' };
const WHY_KEY = (r: Advice['reason']) => `coachWhy_${r}` as Key;
const upLabel = (v: number) => (v === 11 ? 'A' : String(v));
const whyVars = (a: Advice, ranks: CoachRank[]) => ({ total: a.total, up: upLabel(a.up), pair: ranks[0] === 'A' ? 'A' : ranks[0] });

/* verdict after a decision: shown for 2.2 s above the controls, never moves the layout */
type Verdict = { ok: boolean; best: PlayerAction; at: number } | null;
let verdict: Verdict = null;
const subs = new Set<() => void>();
function setVerdict(v: Verdict) {
  verdict = v;
  subs.forEach((f) => f());
}
const useVerdict = () =>
  useSyncExternalStore(
    (f) => {
      subs.add(f);
      return () => subs.delete(f);
    },
    () => verdict,
  );

export function CoachVerdict() {
  const v = useVerdict();
  useEffect(() => {
    if (!v) return;
    const id = setTimeout(() => setVerdict(null), 2200);
    return () => clearTimeout(id);
  }, [v]);
  if (!v) return null;
  return (
    <div className={`coach-verdict ${v.ok ? 'ok' : 'miss'}`} role="status" data-testid="coach-verdict" key={v.at}>
      {v.ok ? t('coachGood') : t('coachBetter', { move: t(MOVE_KEY[v.best]) })}
    </div>
  );
}

function Meter({ risk }: { risk: number }) {
  const pct = Math.round(risk * 100);
  // cold (safe, blue) to hot (red): the fill grows with the risk
  return (
    <div className="coach-meter" data-testid="coach-meter" data-risk={pct} title={t('coachMeterTitle')}>
      <span className="coach-meter-label">{pct === 0 ? t('coachRiskNone') : t('coachRisk', { pct })}</span>
      <span className="coach-meter-track" aria-hidden="true">
        <span className="coach-meter-fill" style={{ inlineSize: `${Math.max(4, pct)}%`, background: `hsl(${Math.round(205 - 200 * risk)} 72% 56%)` }} />
      </span>
    </div>
  );
}

/** The action row with the coach on top. With the coach off it renders exactly the plain action row. */
export function CoachedActions({
  where,
  round,
  legal,
  disabled,
  onAction,
}: {
  where: CoachWhere;
  round: PublicRound | null | undefined;
  legal: PlayerAction[];
  disabled?: boolean;
  onAction: (a: PlayerAction) => void;
}) {
  const p = usePrefs();
  const enabled = where === 'practice' ? p.coachPractice : p.coachRooms;
  const th = enabled ? turnHand(round) : null;
  const advice = th ? advise(th.ranks, th.up, legal) : null;
  const [shownFor, setShownFor] = useState<string | null>(null);
  const [why, setWhy] = useState(false);
  const revealed = !!th && (p.coachAuto || shownFor === th.key);
  if (!enabled || !th || !advice) return <ActionButtons legal={legal} disabled={disabled} onAction={onAction} />;
  const act = (a: PlayerAction) => {
    const ok = recordDecision(advice, a);
    setVerdict({ ok, best: advice.best, at: Date.now() });
    setWhy(false);
    onAction(a);
  };
  const s = coachSession();
  return (
    <>
      <div className="coach-bar" data-testid="coach-bar">
        {revealed ? (
          <button className="coach-tip on" onClick={() => setWhy(true)} data-testid="coach-tip" aria-haspopup="dialog">
            <span aria-hidden="true">💡</span> {t('coachSay', { move: t(MOVE_KEY[advice.best]) })} <u>{t('coachWhy')}</u>
          </button>
        ) : (
          <button className="coach-tip" onClick={() => setShownFor(th.key)} data-testid="coach-tip">
            <span aria-hidden="true">💡</span> {t('coachTip')}
          </button>
        )}
        <Meter risk={advice.bustRisk} />
      </div>
      <ActionButtons legal={legal} disabled={disabled} onAction={act} hint={revealed ? advice.best : undefined} />
      <Sheet open={why} onClose={() => setWhy(false)} title={t('coachWhyTitle', { move: t(MOVE_KEY[advice.best]) })}>
        <div className="coach-sheet" data-testid="coach-sheet">
          <p className="coach-why">{t(WHY_KEY(advice.reason), whyVars(advice, th.ranks))}</p>
          {advice.best !== advice.ideal && <p className="fine">{t('coachNoDouble')}</p>}
          <p className="fine">{advice.bustRisk === 0 ? t('coachMeterSafe') : t('coachMeterExplain', { pct: Math.round(advice.bustRisk * 100) })}</p>
          {s.decisions > 0 && <p className="fine">{t('coachAccuracy', { c: s.correct, n: s.decisions })}</p>}
          <p className="fine">{t('coachOffNote')}</p>
        </div>
      </Sheet>
    </>
  );
}
