import { useEffect, useState } from 'react';
import type { ProviderStatus } from '@table21/protocol';
import { useMe } from '../api.ts';
import { t } from '../i18n.ts';
import { authCall, loadProviders } from '../providers.ts';
import { ProviderRow, useSwitchFlow } from './Account.tsx';
import { Brand } from './Onboarding.tsx';

/** Sign in to an existing account on this device: recovery code, connect code from another device, or a provider. */
export function SignIn({ pairCode }: { pairCode?: string }) {
  const me = useMe();
  const [mode, setMode] = useState<'recovery' | 'pair'>(pairCode ? 'pair' : 'recovery');
  const [code, setCode] = useState(pairCode ?? '');
  const [busy, setBusy] = useState(false);
  const [providers, setProviders] = useState<ProviderStatus[]>([]);
  const flow = useSwitchFlow(me.status === 'ready');
  useEffect(() => {
    void loadProviders().then(setProviders);
  }, []);
  const path = mode === 'recovery' ? '/api/auth/recover' : '/api/auth/pair/redeem';
  const submit = async () => {
    setBusy(true);
    const body = { code };
    const run = async (b: Record<string, unknown>): Promise<void> => flow.handle(await authCall(path, b), (extra) => run({ ...b, ...extra }));
    await run(body).finally(() => setBusy(false));
  };

  return (
    <div className="onboard" data-testid="signin">
      <Brand />
      <h1 className="title">{t('signInTitle')}</h1>
      <div className="seg" role="tablist">
        {(['recovery', 'pair'] as const).map((m) => (
          <button key={m} role="tab" aria-selected={mode === m} className={`pill ${mode === m ? 'on' : ''}`} onClick={() => setMode(m)} data-testid={`signin-${m}`}>
            {t(m === 'recovery' ? 'signInRecovery' : 'signInPair')}
          </button>
        ))}
      </div>
      <form
        className="panel form"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <input
          className="code-input"
          dir="ltr"
          value={code}
          onChange={(e) => setCode(e.target.value)}
          placeholder={mode === 'recovery' ? 'XXXX-XXXX-XXXX' : 'XXXX-XXXX'}
          aria-label={t(mode === 'recovery' ? 'signInRecovery' : 'signInPair')}
          autoCapitalize="characters"
          autoComplete="one-time-code"
          maxLength={20}
          data-testid="signin-code"
        />
        <button className="btn primary wide" disabled={busy || code.replace(/[^0-9a-z]/gi, '').length < 8} data-testid="signin-go">
          {t('signInGo')}
        </button>
      </form>
      {providers.length > 0 && (
        <section className="panel">
          <h2 className="title sm">{t('signInProviders')}</h2>
          <ul className="provider-list">
            {providers.map((p) => (
              <ProviderRow key={p.id} p={p} intent="signin" onDone={flow.handle} />
            ))}
          </ul>
        </section>
      )}
      <p className="fine">{t('coinsSeparation')}</p>
      <a className="btn ghost" href={me.status === 'ready' ? '#/' : '#/onboard'}>
        {t('back')}
      </a>
      {flow.dialog}
    </div>
  );
}
