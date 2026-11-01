import { setPrefs, usePrefs } from '../prefs.ts';
import { t } from '../i18n.ts';
import type { DealSpeed } from '../anim/timing.ts';

/** Dealing speed (Elegant, Quick, Turbo; remembered) and the left-handed layout. Shown in the room menu and Settings. */
export function DealSettings() {
  const p = usePrefs();
  return (
    <div className="deal-settings stack">
      <div className="row between wrap">
        <span>{t('dealSpeed')}</span>
        <div className="segmented" role="radiogroup" aria-label={t('dealSpeed')} data-testid="deal-speed">
          {(['elegant', 'quick', 'turbo'] as DealSpeed[]).map((s) => (
            <button key={s} role="radio" aria-checked={p.dealSpeed === s} className={p.dealSpeed === s ? 'on' : ''} onClick={() => setPrefs({ dealSpeed: s })} data-speed={s}>
              {t(s === 'elegant' ? 'speedElegant' : s === 'quick' ? 'speedQuick' : 'speedTurbo')}
            </button>
          ))}
        </div>
      </div>
      <label className="check">
        <input type="checkbox" checked={p.leftHanded} onChange={() => setPrefs({ leftHanded: !p.leftHanded })} data-testid="left-handed" />
        <span>{t('leftHanded')}</span>
      </label>
    </div>
  );
}
