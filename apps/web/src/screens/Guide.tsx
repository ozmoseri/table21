import type { PlayerAction } from '@table21/game-engine';
import { advise, type CoachRank } from '../coach.ts';
import { t, tl } from '../i18n.ts';

/** Strategy guide. The chart is generated from the same advise() the in-game coach uses, so they never disagree. */
const UPS: CoachRank[] = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];
const ALL: PlayerAction[] = ['hit', 'stand', 'double', 'split'];

function cell(cards: CoachRank[], up: CoachRank): { code: string; kind: string } {
  const [H, S, D, Ds, P] = tl('guideCodes');
  const best = advise(cards, up, ALL).best;
  if (best === 'double') {
    const fallback = advise(cards, up, ['hit', 'stand']).best;
    return fallback === 'stand' ? { code: Ds, kind: 'd' } : { code: D, kind: 'd' };
  }
  return best === 'hit' ? { code: H, kind: 'h' } : best === 'stand' ? { code: S, kind: 's' } : { code: P, kind: 'p' };
}

function Chart({ title, rows, testId }: { title: string; rows: { label: string; cards: CoachRank[] }[]; testId: string }) {
  return (
    <section className="panel guide-chart" data-testid={testId}>
      <h2 className="title sm">{title}</h2>
      <p className="fine guide-axes">{t('guideAxes')}</p>
      <div className="guide-scroll" dir="ltr">
        <table>
          <thead>
            <tr>
              <th scope="col" className="guide-corner" aria-label={t('guideYou')} />
              {UPS.map((u) => (
                <th key={u} scope="col">
                  {u}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.label}>
                <th scope="row">{r.label}</th>
                {UPS.map((u) => {
                  const c = cell(r.cards, u);
                  return (
                    <td key={u} className={`g-${c.kind}`}>
                      {c.code}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}

const hard: { label: string; cards: CoachRank[] }[] = [
  { label: '8-', cards: ['5', '3'] },
  { label: '9', cards: ['5', '4'] },
  { label: '10', cards: ['6', '4'] },
  { label: '11', cards: ['6', '5'] },
  { label: '12', cards: ['10', '2'] },
  { label: '13', cards: ['10', '3'] },
  { label: '14', cards: ['10', '4'] },
  { label: '15', cards: ['10', '5'] },
  { label: '16', cards: ['10', '6'] },
  { label: '17+', cards: ['10', '7'] },
];
const soft = (['2', '3', '4', '5', '6', '7', '8', '9'] as CoachRank[]).map((r) => ({ label: `A,${r}`, cards: ['A', r] as CoachRank[] }));
const pairs = (['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'] as CoachRank[]).map((r) => ({ label: `${r},${r}`, cards: [r, r] as CoachRank[] }));

export function Guide() {
  return (
    <div className="pad stack guide" data-testid="guide">
      <h1 className="title">{t('guideTitle')}</h1>
      <p>{t('guideIntro')}</p>
      <section className="panel">
        <h2 className="title sm">{t('guideGoldTitle')}</h2>
        <ol className="rules">
          {tl('guideGold').map((r) => (
            <li key={r}>{r}</li>
          ))}
        </ol>
      </section>
      <p className="fine guide-legend">{t('guideLegend')}</p>
      <Chart title={t('guideHard')} rows={hard} testId="guide-hard" />
      <Chart title={t('guideSoft')} rows={soft} testId="guide-soft" />
      <Chart title={t('guidePairs')} rows={pairs} testId="guide-pairs" />
      <p className="fine">{t('guideWhyLose')}</p>
      <p className="fine">{t('coinsNote')}</p>
    </div>
  );
}
