import { createRoot } from 'react-dom/client';
// Only the Hebrew and Latin subsets are bundled (smaller offline cache for phones).
import '@fontsource/heebo/hebrew-400.css';
import '@fontsource/heebo/latin-400.css';
import '@fontsource/heebo/hebrew-500.css';
import '@fontsource/heebo/latin-500.css';
import '@fontsource/heebo/hebrew-700.css';
import '@fontsource/heebo/latin-700.css';
import '@fontsource/heebo/hebrew-800.css';
import '@fontsource/heebo/latin-800.css';
import '@fontsource/inter/latin-500.css';
import '@fontsource/inter/latin-700.css';
import '@fontsource/libre-bodoni/latin-600.css';
import './styles.css';
import { App } from './App.tsx';
import { loadConfig, markBootSlow, refreshMe, retryUntilOnline } from './api.ts';
import { initUpdates } from './update.ts';
import { loadLocal, loadPrefs } from './prefs.ts';
import { setLocale } from './i18n.ts';

async function boot() {
  const prefs = await loadPrefs();
  setLocale(prefs.locale);
  await loadLocal();
  createRoot(document.getElementById('root')!).render(<App />);
  void loadConfig();
  markBootSlow();
  const first = await refreshMe();
  if (first.status === 'offline') retryUntilOnline();
  // Service workers need a secure context (https or localhost). Plain-http LAN play works without one.
  // Updates install in the background and are offered only between hands (update.ts).
  void initUpdates();
}

void boot();
