import { useEffect, useState } from 'react';
import { api, useMe } from '../api.ts';
import { errorText, t } from '../i18n.ts';
import { Avatar, toast } from '../components/bits.tsx';

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

  const PersonRow = ({ p }: { p: Person }) => (
    <li>
      <Avatar id={p.avatar} size={32} />
      <bdi>{p.name}</bdi>
      <span className={`dot ${p.online ? 'on' : ''}`} aria-label={p.online ? t('online') : t('offline')} />
    </li>
  );

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
            <PersonRow key={f.userId} p={f} />
          ))}
        </ul>
      )}

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
    </div>
  );
}
