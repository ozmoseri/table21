import { createRoot } from 'react-dom/client';
// DECISIONS 8: Rubik 400/500/600 for the interface, Frank Ruhl Libre 700 for titles and card indices.
// Only the Hebrew and Latin subsets are bundled (smaller offline cache for phones).
import '@fontsource/rubik/hebrew-400.css';
import '@fontsource/rubik/latin-400.css';
import '@fontsource/rubik/hebrew-500.css';
import '@fontsource/rubik/latin-500.css';
import '@fontsource/rubik/hebrew-600.css';
import '@fontsource/rubik/latin-600.css';
import '@fontsource/frank-ruhl-libre/hebrew-700.css';
import '@fontsource/frank-ruhl-libre/latin-700.css';
import './styles.css';
// After the base styles: the v5 palette, type and full-screen shell, then the premium table and HUD.
import './theme/tokens.css';
import './theme/premium.css';
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
