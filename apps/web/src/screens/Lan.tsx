import { useEffect, useState } from 'react';
import QRCode from 'qrcode';
import { api } from '../api.ts';
import { t } from '../i18n.ts';

export function Lan() {
  const [addrs, setAddrs] = useState<string[] | null>(null);
  const [qrs, setQrs] = useState<Record<string, string>>({});
  useEffect(() => {
    api<{ addresses: string[] }>('/api/lan-info')
      .then((r) => setAddrs(r.addresses))
      .catch(() => setAddrs([]));
  }, []);
  const port = location.port ? `:${location.port}` : '';
  const urls = (addrs ?? []).map((a) => `${location.protocol}//${a}${port}/`);
  useEffect(() => {
    urls.forEach((u) =>
      QRCode.toDataURL(u, { margin: 1, width: 200, color: { dark: '#080F14', light: '#F5F2EA' } })
        .then((d) => setQrs((q) => ({ ...q, [u]: d })))
        .catch(() => {}),
    );
  }, [addrs]);
  return (
    <div className="pad stack">
      <h1 className="title">{t('lanHost')}</h1>
      <p>{t('connHelp')}</p>
      {urls.length > 0 ? (
        <>
          <p>{t('lanScan')}</p>
          {urls.map((u) => (
            <div key={u} className="panel share-box">
              {qrs[u] && <img className="qr" src={qrs[u]} alt={u} width={180} height={180} />}
              <bdi className="url big" dir="ltr">
                {u}
              </bdi>
            </div>
          ))}
        </>
      ) : (
        <p className="muted">{addrs ? 'pnpm lan' : t('loading')}</p>
      )}
      <p className="fine">{t('lanNote')}</p>
      <p className="fine">{t('installSecure')}</p>
    </div>
  );
}
