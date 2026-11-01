import { applyUpdate, dismissUpdate, updateVisible, useUpdate } from '../update.ts';
import { t } from '../i18n.ts';

/** "New version available", shown only at a safe point (never during a hand). The page reloads only on tap. */
export function UpdateBanner() {
  const u = useUpdate();
  if (!updateVisible(u)) return null;
  return (
    <div className={`update-banner ${u.outdated ? 'is-outdated' : ''}`} role="status" aria-live="polite" data-testid="update-banner" data-kind={u.outdated ? 'outdated' : 'update'}>
      <div className="update-text">
        <b>{t(u.outdated ? 'outdatedTitle' : 'updateReady')}</b>
        <span>{t(u.outdated ? 'outdatedBody' : 'updateReadyBody')}</span>
      </div>
      <div className="update-actions">
        <button className="btn primary" onClick={() => void applyUpdate()} data-testid="update-apply">
          {t('updateApply')}
        </button>
        {!u.outdated && (
          <button className="btn ghost" onClick={dismissUpdate} data-testid="update-later">
            {t('updateLater')}
          </button>
        )}
      </div>
    </div>
  );
}

/** In an online hand with an outdated client: actions are refused by the server, so say why and offer the refresh.
 *  Reloading here is safe: the server holds the hand and the coins, and the page comes back to the same hand. */
export function OutdatedNotice() {
  const u = useUpdate();
  if (!u.outdated) return null;
  return (
    <div className="update-banner is-outdated in-hand" role="alert" data-testid="outdated-notice">
      <div className="update-text">
        <b>{t('outdatedTitle')}</b>
        <span>{t('outdatedBody')}</span>
      </div>
      <div className="update-actions">
        <button className="btn primary" onClick={() => void applyUpdate()} data-testid="outdated-apply">
          {t('updateApply')}
        </button>
      </div>
    </div>
  );
}
