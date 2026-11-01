import { useEffect, useState } from 'react';
import { api, useMe } from '../api.ts';
import { errorText, t } from '../i18n.ts';
import { Avatar, Sheet, toast } from '../components/bits.tsx';

type MyInvite = { id: string; kind: 'friend' | 'club'; group: { id: string; name: string } | null; uses: number; maxUses: number; expiresAt: string; state: string };

/** Creates an invite link and offers the system share sheet (chosen by the user) or copy. */
async function shareInvite(body: { kind: 'friend' | 'club'; groupId?: string }, after: () => void) {
  try {
    const r = await api<{ token: string }>('/api/invites', { method: 'POST', body });
    const url = `${location.origin}/#/i/${r.token}`;
    after();
    if (navigator.share) await navigator.share({ title: 'TABLE21', url }).catch(() => {});
    else await navigator.clipboard?.writeText(url).then(() => toast(t('copied')), () => toast(url));
    return url;
  } catch (e: any) {
    toast(errorText(e?.code));
    return null;
  }
}

type Person = { userId: string; name: string; avatar: string; online: boolean };
type Group = { id: string; name: string; code: string; isOwner: boolean; members: Person[] };

export function useGroups() {
  const [groups, setGroups] = useState<Group[] | null>(null);
  const load = () =>
    api<Group[]>('/api/groups')
      .then(setGroups)
      .catch(() => setGroups([]));
  useEffect(() => {
    void load();
  }, []);
  return { groups, reload: load };
}

export function Friends() {
  const me = useMe();
  const [friends, setFriends] = useState<Person[] | null>(null);
  const { groups, reload } = useGroups();
  const [friendCode, setFriendCode] = useState('');
  const [groupName, setGroupName] = useState('');
  const [groupCode, setGroupCode] = useState('');
  const [invites, setInvites] = useState<MyInvite[]>([]);
  const [lastLink, setLastLink] = useState<string | null>(null);
  const [blocked, setBlocked] = useState<Person[]>([]);
  const [menu, setMenu] = useState<Person | null>(null);
  const loadInvites = () => api<MyInvite[]>('/api/invites').then(setInvites, () => {});
  const loadBlocked = () => api<Person[]>('/api/blocks').then(setBlocked, () => {});
  useEffect(() => {
    void loadInvites();
    void loadBlocked();
  }, []);
  const loadFriends = () =>
    api<Person[]>('/api/friends')
      .then(setFriends)
      .catch(() => setFriends([]));
  useEffect(() => {
    void loadFriends();
  }, []);
  if (me.status !== 'ready') return <p className="pad muted">{t('offlineOnboard')}</p>;

  const post = async (path: string, body: unknown, after: () => void) => {
    try {
      await api(path, { method: 'POST', body });
      after();
    } catch (e: any) {
      toast(errorText(e?.code));
    }
  };

  const PersonRow = ({ p, actions }: { p: Person; actions?: boolean }) => (
    <li>
      <Avatar id={p.avatar} size={32} />
      <bdi>{p.name}</bdi>
      <span className={`dot ${p.online ? 'on' : ''}`} aria-label={p.online ? t('online') : t('offline')} />
      {actions && (
        <button className="btn ghost sm more" aria-label={`${t('friendMenu')}: ${p.name}`} onClick={() => setMenu(p)} data-testid="friend-menu">
          ⋯
        </button>
      )}
    </li>
  );
  const active = invites.filter((i) => i.state === 'valid');

  return (
    <div className="pad stack">
      <h1 className="title">{t('navFriends')}</h1>
      <div className="panel">
        <span className="muted small">{t('friendCode')}</span>
        <bdi className="big-code" dir="ltr">
          {me.me.friendCode}
        </bdi>
      </div>
      <form className="panel row" onSubmit={(e) => (e.preventDefault(), post('/api/friends', { friendCode }, () => (setFriendCode(''), loadFriends())))}>
        <input value={friendCode} onChange={(e) => setFriendCode(e.target.value)} placeholder={t('addFriend')} dir="ltr" maxLength={10} />
        <button className="btn">{t('add')}</button>
      </form>
      {friends && friends.length === 0 && <p className="muted">{t('friendsEmpty')}</p>}
      {friends && friends.length > 0 && (
        <ul className="member-list panel">
          {friends.map((f) => (
            <PersonRow key={f.userId} p={f} actions />
          ))}
        </ul>
      )}

      <section className="panel stack invite-panel">
        <h2 className="title sm">{t('inviteFriend')}</h2>
        <p className="fine">{t('inviteText')}</p>
        <button className="btn primary wide" data-testid="invite-create" onClick={async () => setLastLink(await shareInvite({ kind: 'friend' }, loadInvites))}>
          {t('inviteCreate')}
        </button>
        {lastLink && (
          <bdi className="link-box" dir="ltr" data-testid="invite-link">
            {lastLink}
          </bdi>
        )}
        {active.length > 0 && (
          <>
            <h3 className="sub">{t('inviteActive')}</h3>
            <ul className="invite-list">
              {active.map((i) => (
                <li key={i.id}>
                  <span>{i.kind === 'club' ? <bdi>{i.group?.name}</bdi> : t('navFriends')}</span>
                  <span className="muted small num">{t('inviteUses', { n: i.uses, m: i.maxUses })}</span>
                  <button className="btn ghost sm" onClick={() => api(`/api/invites/${i.id}/revoke`, { method: 'POST' }).then(loadInvites)}>
                    {t('inviteRevoke')}
                  </button>
                </li>
              ))}
            </ul>
          </>
        )}
      </section>

      <h2 className="title sm">{t('groups')}</h2>
      {groups && groups.length === 0 && <p className="muted">{t('groupsEmpty')}</p>}
      {groups?.map((g) => (
        <div key={g.id} className="panel">
          <div className="row between">
            <b>
              <bdi>{g.name}</bdi>
            </b>
            <bdi className="code-tag" dir="ltr">
              {g.code}
            </bdi>
          </div>
          <ul className="member-list">
            {g.members.map((m) => (
              <PersonRow key={m.userId} p={m} />
            ))}
          </ul>
          <div className="row">
            <button className="btn sm" onClick={async () => setLastLink(await shareInvite({ kind: 'club', groupId: g.id }, loadInvites))}>
              {t('inviteToClub')}
            </button>
            <button className="btn ghost sm" onClick={() => api(`/api/groups/${g.id}/leave`, { method: 'POST' }).then(reload)}>
              {t('leaveClub')}
            </button>
          </div>
        </div>
      ))}
      <form className="panel row" onSubmit={(e) => (e.preventDefault(), groupName.trim() && post('/api/groups', { name: groupName }, () => (setGroupName(''), reload())))}>
        <input value={groupName} onChange={(e) => setGroupName(e.target.value)} placeholder={t('groupName')} maxLength={20} dir="auto" />
        <button className="btn">{t('createGroup')}</button>
      </form>
      <form className="panel row" onSubmit={(e) => (e.preventDefault(), post('/api/groups/join', { code: groupCode }, () => (setGroupCode(''), reload())))}>
        <input value={groupCode} onChange={(e) => setGroupCode(e.target.value)} placeholder={t('groupCode')} dir="ltr" maxLength={8} />
        <button className="btn">{t('joinGroup')}</button>
      </form>

      {blocked.length > 0 && (
        <details className="panel">
          <summary>
            {t('blockedList')} <span className="muted num">({blocked.length})</span>
          </summary>
          <ul className="member-list">
            {blocked.map((b) => (
              <li key={b.userId}>
                <Avatar id={b.avatar} size={28} />
                <bdi>{b.name}</bdi>
                <button className="btn ghost sm" onClick={() => api('/api/blocks/remove', { method: 'POST', body: { userId: b.userId } }).then(loadBlocked)}>
                  {t('unblock')}
                </button>
              </li>
            ))}
          </ul>
        </details>
      )}

      <Sheet open={!!menu} onClose={() => setMenu(null)} title={menu?.name}>
        {menu && (
          <div className="stack">
            <button className="btn wide" onClick={() => api('/api/friends/remove', { method: 'POST', body: { userId: menu.userId } }).then(() => (setMenu(null), loadFriends()))}>
              {t('friendRemove')}
            </button>
            <p className="fine">{t('blockText')}</p>
            <button
              className="btn danger wide"
              data-testid="friend-block"
              onClick={() => api('/api/blocks', { method: 'POST', body: { userId: menu.userId } }).then(() => (setMenu(null), loadFriends(), loadBlocked()))}
            >
              {t('block')}
            </button>
          </div>
        )}
      </Sheet>
    </div>
  );
}
