import { useEffect, useSyncExternalStore, type ReactNode } from 'react';
import { useMe } from './api.ts';
import { t } from './i18n.ts';
import { usePrefs } from './prefs.ts';
import { Announcer, Toaster } from './components/bits.tsx';
import { Onboarding } from './screens/Onboarding.tsx';
import { Home } from './screens/Home.tsx';
import { Room } from './screens/Room.tsx';
import { LocalPlay } from './screens/LocalPlay.tsx';
import { Friends } from './screens/Friends.tsx';
import { Leaderboard } from './screens/Leaderboard.tsx';
import { Profile } from './screens/Profile.tsx';
import { Rewards } from './screens/Rewards.tsx';
import { Settings } from './screens/Settings.tsx';
import { Lan } from './screens/Lan.tsx';

const subscribeHash = (f: () => void) => {
  addEventListener('hashchange', f);
  return () => removeEventListener('hashchange', f);
};
export const useRoute = () => useSyncExternalStore(subscribeHash, () => location.hash.replace(/^#\/?/, '') || 'home');
export const go = (path: string) => {
  location.hash = `#/${path}`;
};

function Nav({ route }: { route: string }) {
  const items: [string, Parameters<typeof t>[0], string][] = [
    ['home', 'navHome', 'M4 11.5 12 5l8 6.5V20h-5v-5H9v5H4z'],
    ['friends', 'navFriends', 'M9 11a3.5 3.5 0 1 0 0-7 3.5 3.5 0 0 0 0 7Zm7 0a3 3 0 1 0 0-6M3 20c0-3.3 2.7-6 6-6s6 2.7 6 6m1-6c2.8 0 5 2.2 5 5'],
    ['leaderboard', 'navBoard', 'M5 20V10m7 10V4m7 16v-7'],
    ['profile', 'navProfile', 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8c0-3.9 3.1-7 7-7s7 3.1 7 7'],
    ['settings', 'navSettings', 'M12 15a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm7.4-3a7.4 7.4 0 0 0-.1-1.2l2-1.6-2-3.4-2.4 1a7.5 7.5 0 0 0-2-1.2L14.5 3h-5l-.4 2.6a7.5 7.5 0 0 0-2 1.2l-2.4-1-2 3.4 2 1.6a7.4 7.4 0 0 0 0 2.4l-2 1.6 2 3.4 2.4-1c.6.5 1.3.9 2 1.2l.4 2.6h5l.4-2.6c.7-.3 1.4-.7 2-1.2l2.4 1 2-3.4-2-1.6c.1-.4.1-.8.1-1.2Z'],
  ];
  return (
    <nav className="tabbar" aria-label="main">
      {items.map(([path, key, d]) => (
        <a key={path} href={`#/${path}`} className={route.startsWith(path) ? 'on' : ''} aria-current={route.startsWith(path) ? 'page' : undefined}>
          <svg viewBox="0 0 24 24" aria-hidden="true">
            <path d={d} />
          </svg>
          <span>{t(key)}</span>
        </a>
      ))}
    </nav>
  );
}

function Shell({ route, children, nav = true }: { route: string; children: ReactNode; nav?: boolean }) {
  return (
    <div className={`shell ${nav ? 'with-nav' : ''}`}>
      <main className="screen">{children}</main>
      {nav && <Nav route={route} />}
    </div>
  );
}

export function App() {
  const me = useMe();
  const route = useRoute();
  usePrefs();
  const [head, ...rest] = route.split('/');

  useEffect(() => {
    scrollTo(0, 0);
  }, [head]);

  let content: ReactNode;
  let nav = true;
  if (head === 'practice' || head === 'pass') {
    content = <LocalPlay mode={head === 'practice' ? 'solo' : 'pass'} />;
    nav = false;
  } else if (head === 'settings' || head === 'help') content = <Settings />;
  else if (head === 'lan') content = <Lan />;
  else if (me.status === 'loading') content = <p className="muted center pad">{t('loading')}</p>;
  else if (me.status === 'guest-needed' || head === 'onboard') content = <Onboarding />;
  else if (head === 'r' && rest[0]) {
    content = me.status === 'ready' ? <Room code={rest[0].toUpperCase()} me={me.me} /> : <Home />;
    nav = false;
  } else if (head === 'friends') content = <Friends />;
  else if (head === 'leaderboard') content = <Leaderboard />;
  else if (head === 'profile') content = <Profile />;
  else if (head === 'rewards') content = <Rewards />;
  else content = <Home />;

  return (
    <>
      <Shell route={head} nav={nav}>
        {content}
      </Shell>
      <Toaster />
      <Announcer />
    </>
  );
}
