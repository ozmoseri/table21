import { useEffect, useRef, useState } from 'react';
import type { ProviderStatus } from '@table21/protocol';
import { api, ApiError, refreshMe, serverConfig, useMe } from '../api.ts';
import { errorText, getLocale, t } from '../i18n.ts';
import { getLocal } from '../prefs.ts';
import { Coins, Sheet, toast } from '../components/bits.tsx';
import { authCall, facebookAccessToken, loadProviders, mountGoogleButton, newNonce, providerName, reloadHome, testCredential, usable } from '../providers.ts';

type Session = { id: string; label: string; createdAt: string; lastSeenAt: string; current: boolean };

const when = (iso: string) =>
  new Date(iso).toLocaleString(getLocale() === 'he' ? 'he-IL' : 'en-GB', { timeZone: 'Asia/Jerusalem', dateStyle: 'short', timeStyle: 'short' });

/** Recovery codes are shown once, with copy and download. */
function RecoveryCodes({ remaining, onChange }: { remaining: number; onChange: () => void }) {
  const [codes, setCodes] = useState<string[] | null>(null);
  const [saved, setSaved] = useState(false);
  const [confirm, setConfirm] = useState(false);
  const create = async () => {
    setConfirm(false);
    try {
      setCodes((await api<{ codes: string[] }>('/api/auth/recovery-codes', { method: 'POST' })).codes);
      setSaved(false);
      onChange();
    } catch (e: any) {
      toast(errorText(e?.code));
    }
  };
  const text = codes ? `TABLE21 recovery codes\n${codes.join('\n')}\n` : '';
  return (
    <section className="panel acct" data-testid="recovery">
      <h2 className="title sm">{t('recoveryTitle')}</h2>
      <p className="fine">{t('recoveryText')}</p>
      {codes ? (
        <>
          <p className="note">{t('recoveryShowOnce')}</p>
          <ol className="code-grid" dir="ltr" data-testid="recovery-codes">
            {codes.map((c) => (
              <li key={c} className="num">
                {c}
              </li>
            ))}
          </ol>
          <div className="row">
            <button className="btn sm" onClick={() => navigator.clipboard?.writeText(text).then(() => toast(t('copiedText')), () => {})}>
              {t('copyAll')}
            </button>
            <a className="btn sm" download="table21-recovery-codes.txt" href={`data:text/plain;charset=utf-8,${encodeURIComponent(text)}`}>
              {t('downloadTxt')}
            </a>
          </div>
          <label className="check">
            <input type="checkbox" checked={saved} onChange={(e) => setSaved(e.target.checked)} data-testid="codes-saved" />
            <span>{t('savedThem')}</span>
          </label>
          <button className="btn primary wide" disabled={!saved} onClick={() => setCodes(null)}>
            {t('close')}
          </button>
        </>
      ) : remaining > 0 ? (
        <div className="row between">
          <span className="muted small">{t('recoveryRemaining', { n: remaining })}</span>
          <button className="btn sm ghost" onClick={() => setConfirm(true)}>
            {t('recoveryRegenerate')}
          </button>
        </div>
      ) : (
        <button className="btn primary wide" onClick={create} data-testid="create-codes">
          {t('recoveryCreate')}
        </button>
      )}
      <Sheet open={confirm} onClose={() => setConfirm(false)} title={t('recoveryRegenerate')}>
        <p>{t('recoveryRegenerateWarn')}</p>
        <button className="btn primary wide" onClick={create}>
          {t('recoveryRegenerate')}
        </button>
      </Sheet>
    </section>
  );
}

function PairDevice() {
  const [pair, setPair] = useState<{ code: string; expiresAt: string } | null>(null);
  const link = pair ? `${location.origin}/#/link/${pair.code}` : '';
  return (
    <section className="panel acct">
      <h2 className="title sm">{t('pairTitle')}</h2>
      <p className="fine">{t('pairText')}</p>
      {pair && new Date(pair.expiresAt).getTime() > Date.now() ? (
        <div className="pair-box">
          <bdi className="big-code num" dir="ltr" data-testid="pair-code">
            {pair.code}
          </bdi>
          <span className="muted small">{t('pairValidUntil', { t: when(pair.expiresAt) })}</span>
          <p className="fine">{t('pairHow')}</p>
          <button className="btn sm" onClick={() => navigator.clipboard?.writeText(link).then(() => toast(t('copiedText')), () => {})}>
            {t('copyAll')}
          </button>
        </div>
      ) : (
        <button className="btn wide" data-testid="create-pair" onClick={() => api('/api/auth/pair', { method: 'POST' }).then(setPair, (e) => toast(errorText(e?.code)))}>
          {t('pairCreate')}
        </button>
      )}
    </section>
  );
}

/** One provider row. Only "ready" providers on a secure page get a working control; everything else is labeled. */
export function ProviderRow({ p, linked, intent, onDone }: { p: ProviderStatus; linked?: string | null; intent: 'link' | 'signin'; onDone: (o: Awaited<ReturnType<typeof authCall>>, retry: (extra: Record<string, unknown>) => Promise<void>) => Promise<void> | void }) {
  const box = useRef<HTMLDivElement>(null);
  const [testSub, setTestSub] = useState('');
  const send = async (credential: string, nonce: string | null) => {
    const body = { provider: p.id, credential, nonce, intent };
    const run = async (b: Record<string, unknown>): Promise<void> => onDone(await authCall('/api/auth/provider', b), (extra) => run({ ...b, ...extra }));
    await run(body);
  };
  useEffect(() => {
    if (p.id !== 'google' || !usable(p) || linked || !box.current) return;
    let alive = true;
    newNonce()
      .then((nonce) => {
        if (alive && box.current) return mountGoogleButton(box.current, p.publicConfig!.clientId, nonce, getLocale(), (jwt) => void send(jwt, nonce));
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, [p.id, p.state, linked]);

  const state = linked ? (
    <span className="badge b-win">
      {t('providerLinked')}
      {linked !== '1' && <bdi dir="ltr"> · {linked}</bdi>}
    </span>
  ) : p.state === 'not_configured' ? (
    <span className="muted small">{t('providerNotConfigured')}</span>
  ) : p.state === 'planned' ? (
    <span className="muted small">{t('providerPlanned')}</span>
  ) : !usable(p) ? (
    <span className="muted small">{t('providerNeedsHttps')}</span>
  ) : null;

  return (
    <li className={`provider-row ${usable(p) && !linked ? 'ready' : 'off'}`} data-testid={`provider-${p.id}`} data-state={linked ? 'linked' : p.state}>
      <span className={`prov-mark prov-${p.id}`} aria-hidden="true" />
      <b>{providerName(p.id)}</b>
      <span className="grow" />
      {state}
      {linked && intent === 'link' && (
        <button
          className="btn ghost sm"
          onClick={() =>
            api('/api/auth/unlink', { method: 'POST', body: { provider: p.id } }).then(
              () => refreshMe(),
              (e) => toast(errorText(e?.code)),
            )
          }
        >
          {t('providerDisconnect')}
        </button>
      )}
      {!linked && usable(p) && p.id === 'google' && <div ref={box} className="gsi-box" />}
      {!linked && usable(p) && p.id === 'facebook' && (
        <button
          className="btn sm"
          onClick={() => facebookAccessToken(p.publicConfig!.appId, p.publicConfig!.graphVersion).then((tok) => send(tok, null), () => toast(t('error')))}
        >
          {t('providerConnect')}
        </button>
      )}
      {!linked && usable(p) && p.id === 'test' && import.meta.env.VITE_LAB === '1' && (
        <form
          className="row"
          title={t('providerTestHint')}
          onSubmit={(e) => {
            e.preventDefault();
            if (testSub) void newNonce().then((n) => send(testCredential(testSub, n), n));
          }}
        >
          <input value={testSub} onChange={(e) => setTestSub(e.target.value)} dir="ltr" placeholder="subject" data-testid="test-sub" className="sm-input" />
          <button className="btn sm" data-testid="test-go">
            {t('providerConnect')}
          </button>
        </form>
      )}
    </li>
  );
}

/** Shared handler for account-change outcomes: unsaved-guest confirmation, no account yet, identity owned elsewhere. */
export function useSwitchFlow(canLink = true) {
  type Action = { label: string; testid: string; run: () => void | Promise<void>; primary?: boolean };
  const [prompt, setPrompt] = useState<null | { title: string; text: string; actions: Action[] }>(null);
  const handle = async (o: Awaited<ReturnType<typeof authCall>>, retry: (extra: Record<string, unknown>) => Promise<void>): Promise<void> => {
    if (o.kind === 'done') {
      if (o.status === 'same_account') return void toast(t('sameAccount'));
      if (o.status === 'linked' || o.status === 'already_linked') {
        // Same account, new session cookie: refresh in place (no reload, so nothing races with navigation).
        toast(t('providerLinked'));
        await refreshMe();
        return;
      }
      toast(t('signedIn'));
      return reloadHome();
    }
    if (o.kind === 'confirm_switch')
      return setPrompt({
        title: t('switchTitle'),
        text: t('switchText', { name: o.guest.name, coins: Math.floor(o.guest.availableUnits / 2).toLocaleString() }),
        actions: [
          { label: t('switchSaveFirst'), testid: 'switch-save', primary: true, run: () => void (location.hash = '#/account') },
          { label: t('switchContinue'), testid: 'switch-continue', run: () => retry({ confirmSwitch: true }) },
        ],
      });
    if (o.kind === 'no_account')
      return setPrompt({
        title: t('noAccountForProvider'),
        text: '',
        actions: canLink ? [{ label: t('linkToCurrent'), testid: 'link-current', primary: true, run: () => retry({ intent: 'link' }) }] : [],
      });
    if (o.kind === 'identity_in_use')
      return setPrompt({
        title: t('identityInUse'),
        text: '',
        actions: [{ label: t('goToThatAccount'), testid: 'go-that-account', primary: true, run: () => retry({ intent: 'signin' }) }],
      });
    toast(errorText(o.code));
  };
  const dialog = (
    <Sheet open={!!prompt} onClose={() => setPrompt(null)} title={prompt?.title}>
      {prompt && (
        <div className="stack" data-testid="switch-confirm">
          {prompt.text && <p>{prompt.text}</p>}
          {prompt.actions.map((a) => (
            <button key={a.testid} className={`btn wide ${a.primary ? 'primary' : ''}`} data-testid={a.testid} onClick={() => (setPrompt(null), void a.run())}>
              {a.label}
            </button>
          ))}
        </div>
      )}
    </Sheet>
  );
  return { handle, dialog };
}

export function Account() {
  const me = useMe();
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const [sessions, setSessions] = useState<Session[]>([]);
  const [leave, setLeave] = useState(false);
  const [del, setDel] = useState('');
  const flow = useSwitchFlow();
  const loadSessions = () => api<Session[]>('/api/auth/sessions').then(setSessions, () => {});
  useEffect(() => {
    void loadProviders().then(setProviders);
    void loadSessions();
  }, []);
  if (me.status !== 'ready') return <p className="pad muted">{t('offlineOnboard')}</p>;
  const u = me.me;
  const acct = u.account;
  const linked = (id: string) => {
    const i = acct.identities.find((x) => x.provider === id);
    return i ? (i.emailHint ?? '1') : null;
  };

  const signOut = async (confirmLoss = false) => {
    try {
      await api('/api/auth/signout', { method: 'POST', body: { confirmLoss } });
      reloadHome();
    } catch (e) {
      if (e instanceof ApiError && e.code === 'confirm_loss') setLeave(true);
      else toast(t('error'));
    }
  };

  return (
    <div className="pad stack" data-testid="account">
      <h1 className="title">{t('accountTitle')}</h1>
      <section className={`panel acct-status ${acct.kind}`} data-testid="account-status" data-kind={acct.kind}>
        <span className={`badge ${acct.kind === 'saved' ? 'b-win' : 'b-push'}`}>{t(acct.kind === 'saved' ? 'accountSaved' : 'accountGuest')}</span>
        <p>{t(acct.kind === 'saved' ? 'accountSavedText' : 'accountGuestText')}</p>
        {serverConfig.deployment === 'lan' && <p className="fine">{t('accountServerLan')}</p>}
        <p className="fine">
          {t('userIdLabel')} <bdi dir="ltr" className="user-id" data-testid="user-id">{u.userId}</bdi>
        </p>
      </section>

      <RecoveryCodes remaining={acct.recovery.remaining} onChange={() => void refreshMe()} />
      <PairDevice />

      <section className="panel acct">
        <h2 className="title sm">{t('providersTitle')}</h2>
        <ul className="provider-list">
          {providers.map((p) => (
            <ProviderRow key={p.id} p={p} linked={linked(p.id)} intent="link" onDone={flow.handle} />
          ))}
        </ul>
      </section>

      <section className="panel acct">
        <h2 className="title sm">{t('devicesTitle')}</h2>
        <ul className="device-list" data-testid="devices">
          {sessions.map((s) => (
            <li key={s.id}>
              <span>
                <b>{s.label || t('deviceUnknown')}</b>
                {s.current && <span className="badge b-push">{t('deviceThis')}</span>}
                <br />
                <span className="muted small">{t('deviceLastSeen', { t: when(s.lastSeenAt) })}</span>
              </span>
              {!s.current && (
                <button className="btn ghost sm" onClick={() => api('/api/auth/sessions/revoke', { method: 'POST', body: { sessionId: s.id } }).then(loadSessions)}>
                  {t('deviceRevoke')}
                </button>
              )}
            </li>
          ))}
        </ul>
        {sessions.length > 1 && (
          <button className="btn wide" onClick={() => api('/api/auth/sessions/revoke-others', { method: 'POST' }).then(loadSessions)}>
            {t('revokeOthers')}
          </button>
        )}
      </section>

      <section className="panel acct coins-split" data-testid="coins-split">
        <div className="row between">
          <span className="muted small">{t('onlineCoins')}</span>
          <Coins units={u.wallet.availableUnits} />
        </div>
        <div className="row between">
          <span className="muted small">{t('practiceCoinsDevice')}</span>
          <Coins units={getLocal().practiceUnits} />
        </div>
        <p className="fine">{t('coinsSeparation')}</p>
      </section>

      <section className="panel acct danger">
        <button className="btn wide" onClick={() => void signOut()} data-testid="sign-out">
          {t('signOut')}
        </button>
        <details>
          <summary>{t('deleteTitle')}</summary>
          <p className="fine">{t('deleteText')}</p>
          <form
            className="stack"
            onSubmit={(e) => {
              e.preventDefault();
              api('/api/auth/delete', { method: 'POST', body: { confirmName: del } }).then(
                () => (toast(t('deleted')), reloadHome()),
                (err) => toast(errorText(err?.code)),
              );
            }}
          >
            <input value={del} onChange={(e) => setDel(e.target.value)} placeholder={t('deleteConfirm', { name: u.name })} dir="auto" aria-label={t('deleteConfirm', { name: u.name })} />
            <button className="btn danger wide" disabled={del.trim() !== u.name.trim()}>
              {t('deleteDo')}
            </button>
          </form>
        </details>
      </section>

      <Sheet open={leave} onClose={() => setLeave(false)} title={t('signOut')}>
        <p>{t('signOutLoss')}</p>
        <button className="btn primary wide" onClick={() => (setLeave(false), (location.hash = '#/account'))}>
          {t('saveAccount')}
        </button>
        <button className="btn wide" onClick={() => void signOut(true)} data-testid="sign-out-anyway">
          {t('signOutAnyway')}
        </button>
      </Sheet>
      {flow.dialog}
    </div>
  );
}
