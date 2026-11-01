import { useEffect, useState } from 'react';
import { api, useMe } from '../api.ts';
import { errorText, t, type Key } from '../i18n.ts';
import { Avatar, toast } from '../components/bits.tsx';
import { go } from '../App.tsx';
import { Brand } from './Onboarding.tsx';

type Preview = {
  kind: 'friend' | 'club';
  state: 'valid' | 'expired' | 'revoked' | 'used_up';
  inviter: { userId: string; name: string; avatar: string };
  group: { id: string; name: string; members: number } | null;
  expiresAt: string;
  self: boolean;
};

export const PENDING_KEY = 't21:pending-route';

/** Landing page of an invite link (#/i/<token>). Works before the visitor has a name; accepting needs a session. */
export function Invite({ token }: { token: string }) {
  const me = useMe();
  const [p, setP] = useState<Preview | null | 'missing'>(null);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    api<Preview>(`/api/invites/${encodeURIComponent(token)}`).then(setP, () => setP('missing'));
  }, [token, me.status]);

  const accept = async () => {
    setBusy(true);
    try {
      const r = await api<{ kind: 'friend' | 'club' }>(`/api/invites/${encodeURIComponent(token)}/accept`, { method: 'POST' });
      toast(t(r.kind === 'friend' ? 'inviteDone' : 'inviteClubDone'));
      go('friends');
    } catch (e: any) {
      toast(errorText(e?.code));
    } finally {
      setBusy(false);
    }
  };

  if (p === null) return <p className="pad muted center">{t('loading')}</p>;
  if (p === 'missing')
    return (
      <div className="onboard" data-testid="invite">
        <Brand />
        <p className="lede">{t('inviteInvalid')}</p>
        <a className="btn" href="#/">
          {t('back')}
        </a>
      </div>
    );
  return (
    <div className="onboard" data-testid="invite">
      <Brand />
      <section className="panel invite-card">
        <Avatar id={p.inviter.avatar} size={72} />
        <h1 className="title">{t('inviteFrom', { name: p.inviter.name })}</h1>
        <p className="lede">{p.kind === 'friend' ? t('inviteFriendSub') : t('inviteClubSub', { group: p.group!.name, n: p.group!.members })}</p>
        {p.state !== 'valid' ? (
          <p className="note">{t(`inviteState_${p.state}` as Key)}</p>
        ) : p.self ? (
          <p className="note">{errorText('invite_self')}</p>
        ) : me.status === 'ready' ? (
          <button className="btn primary wide" disabled={busy} onClick={accept} data-testid="invite-accept">
            {t('inviteAccept')}
          </button>
        ) : (
          <button
            className="btn primary wide"
            data-testid="invite-onboard"
            onClick={() => {
              try {
                sessionStorage.setItem(PENDING_KEY, `i/${token}`);
              } catch {}
              go('onboard');
            }}
          >
            {t('inviteNeedName')}
          </button>
        )}
      </section>
      <p className="fine">{t('coinsNote')}</p>
    </div>
  );
}
