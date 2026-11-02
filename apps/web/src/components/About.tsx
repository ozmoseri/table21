import { useEffect, useState } from 'react';
import { PROTOCOL_VERSION } from '@table21/protocol';
import { api } from '../api.ts';
import { CLIENT_BUILD } from '../update.ts';
import { isStandalone } from '../fullscreen.ts';
import { t } from '../i18n.ts';

declare const __T21_COMMIT__: string | undefined;
declare const __T21_BUILT_AT__: string | undefined;
export const CLIENT_COMMIT: string = typeof __T21_COMMIT__ === 'string' ? __T21_COMMIT__ : 'dev';
export const CLIENT_BUILT_AT: string = typeof __T21_BUILT_AT__ === 'string' ? __T21_BUILT_AT__ : '';

/**
 * Developer mode: test tools (the sound board) appear only here. On with ?dev=1 once (remembered on the device),
 * off with ?dev=0. Lab builds used by the automated tests always have it.
 */
export function isDevMode(): boolean {
  if (import.meta.env.VITE_LAB === '1' || import.meta.env.DEV) return true;
  try {
    const q = new URLSearchParams(location.search).get('dev');
    if (q === '1') localStorage.setItem('t21:dev', '1');
    if (q === '0') localStorage.removeItem('t21:dev');
    return localStorage.getItem('t21:dev') === '1';
  } catch {
    return false;
  }
}

interface ServerVersion {
  build?: string | null;
  commit?: string | null;
  builtAt?: string | null;
  protocol?: number;
  deployment?: string;
}

const fmt = (iso: string) => {
  if (!iso) return '-';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString('he-IL', { dateStyle: 'short', timeStyle: 'short' });
};

/**
 * About / diagnostics (Settings): which client and server versions are running, from where, and whether they match.
 * One screenshot from the phone identifies the tested version. Nothing here is shown on the game screen.
 */
export function About() {
  const [server, setServer] = useState<ServerVersion | null>(null);
  const [failed, setFailed] = useState(false);
  const [sw, setSw] = useState<string>('-');
  useEffect(() => {
    api<ServerVersion>('/api/config')
      .then(setServer)
      .catch(() => setFailed(true));
    const ctl = navigator.serviceWorker?.controller;
    setSw(ctl ? new URL(ctl.scriptURL).pathname : t('aboutSwNone'));
  }, []);
  const match = server ? server.build === CLIENT_BUILD && (server.protocol ?? 1) === PROTOCOL_VERSION : null;
  const rows: [string, string][] = [
    [t('aboutClient'), `${CLIENT_COMMIT} · ${CLIENT_BUILD}`],
    [t('aboutBuiltAt'), fmt(CLIENT_BUILT_AT)],
    [t('aboutProtocol'), String(PROTOCOL_VERSION)],
    [t('aboutServer'), failed ? t('aboutServerOffline') : server ? `${server.commit ?? '?'} · ${server.build ?? '?'}` : '…'],
    [t('aboutServerProtocol'), server?.protocol !== undefined ? String(server.protocol) : '-'],
    [t('aboutOrigin'), location.origin],
    [t('aboutMode'), `${isStandalone() ? t('aboutInstalled') : t('aboutBrowser')}${server?.deployment ? ` · ${server.deployment}` : ''}`],
    [t('aboutSw'), sw],
  ];
  return (
    <section className="panel about" data-testid="about">
      <h2 className="title sm">{t('about')}</h2>
      <dl className="about-list">
        {rows.map(([k, v]) => (
          <div key={k}>
            <dt>{k}</dt>
            <dd dir="ltr">{v}</dd>
          </div>
        ))}
      </dl>
      {match !== null && (
        <p className={`about-match ${match ? 'ok' : 'warn'}`} data-testid="about-match">
          {match ? t('aboutMatch') : t('aboutMismatch')}
        </p>
      )}
    </section>
  );
}
