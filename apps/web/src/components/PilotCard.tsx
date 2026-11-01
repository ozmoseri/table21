import { useEffect, useState } from 'react';
import type { PilotInfo } from '@table21/protocol';
import { api } from '../api.ts';
import { getLocale, t } from '../i18n.ts';

const fmtDate = (iso: string) =>
  new Date(iso).toLocaleDateString(getLocale() === 'he' ? 'he-IL' : 'en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Jerusalem' });
const fmtBytes = (n: number) => (n >= 1024 ** 2 ? `${(n / 1024 ** 2).toFixed(1)} MB` : `${Math.max(1, Math.round(n / 1024))} KB`);

/** Operator-only: when the free database expires, the free quotas, and a one-tap full backup. */
export function PilotCard({ compact }: { compact?: boolean }) {
  const [p, setP] = useState<PilotInfo | null>(null);
  useEffect(() => {
    api<{ pilot: PilotInfo | null }>('/api/admin/pilot')
      .then((r) => setP(r.pilot))
      .catch(() => setP(null));
  }, []);
  if (!p) return null;
  if (compact && p.state === 'ok') return null;
  return (
    <section className={`panel pilot pilot-${p.state}`} data-testid="pilot-card" data-state={p.state}>
      <h2 className="title sm">{t('pilotTitle')}</h2>
      <p className="pilot-date">
        <b>{p.state === 'expired' ? t('pilotExpired', { date: fmtDate(p.dbDeletedAt) }) : t('pilotDbEnds', { date: fmtDate(p.dbExpiresAt) })}</b>
        {p.state !== 'expired' && <span className="pilot-days" data-testid="pilot-days">{t('pilotDaysLeft', { n: p.daysLeft })}</span>}
      </p>
      {!compact && (
        <>
          <p className="fine">{t('pilotNote')}</p>
          <p className="fine">
            {t('pilotQuota')}
            {p.dbBytes !== null && <> · {t('pilotUsed', { used: fmtBytes(p.dbBytes) })}</>}
          </p>
          <p className="fine">{t('pilotFrom', { src: t(p.dbCreatedSource === 'env' ? 'pilotFromEnv' : 'pilotFromMigration') })}</p>
        </>
      )}
      <a className="btn sm" href="/api/admin/backup" download data-testid="pilot-backup">
        {t('pilotBackup')}
      </a>
      {!compact && <p className="fine">{t('pilotOnlyYou')}</p>}
    </section>
  );
}
