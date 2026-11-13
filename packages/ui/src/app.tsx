import { AnimatePresence } from 'motion/react';
import { lazy, Suspense, useEffect } from 'react';
import { audio } from '@game/client/audio';
import { initLifecycle, initNativeShell, isNative, webglAvailable } from '@game/platform';
import { app, currentSession, go, joinPrivateRoom, loadPersisted, saveNow, measurePings, setPaused, startOffline, type Screen } from './core/app';
import type { LobbySettings } from '@game/net';
import { useStore } from './core/store';
import { t } from './i18n';
import { Button, Toasts } from './components/ui';
import { useGamepadNav } from './components/gamepad';
import { GameScreen } from './screens/GameScreen';
import { MainMenu } from './screens/MainMenu';

const PlayBots = lazy(() => import('./screens/PlayBots').then((m) => ({ default: m.PlayBots })));
const Survival = lazy(() => import('./screens/PlayBots').then((m) => ({ default: m.SurvivalSetup })));
const Training = lazy(() => import('./screens/PlayBots').then((m) => ({ default: m.TrainingSetup })));
const Online = lazy(() => import('./screens/Online').then((m) => ({ default: m.Online })));
const Lan = lazy(() => import('./screens/Lan').then((m) => ({ default: m.Lan })));
const Lobby = lazy(() => import('./screens/Lobby').then((m) => ({ default: m.Lobby })));
const Results = lazy(() => import('./screens/Results').then((m) => ({ default: m.Results })));
const Armoury = lazy(() => import('./screens/Armoury').then((m) => ({ default: m.Armoury })));
const Profile = lazy(() => import('./screens/Profile').then((m) => ({ default: m.Profile })));
const SettingsScreen = lazy(() => import('./screens/Settings').then((m) => ({ default: m.SettingsScreen })));
const Credits = lazy(() => import('./screens/Credits').then((m) => ({ default: m.Credits })));
const UpdateRequired = lazy(() => import('./screens/UpdateRequired').then((m) => ({ default: m.UpdateRequired })));

let applyUpdate: (() => void) | null = null;

/** App start: storage, native shell, lifecycle, service worker. */
export async function boot(): Promise<void> {
  app.set({ webgl: webglAvailable() });
  await loadPersisted();
  void initNativeShell();
  void initLifecycle({
    onPause: () => {
      audio.suspend();
      if (currentSession()?.kind === 'offline' && app.get().screen === 'game') {
        setPaused(true);
        app.set({ overlay: 'pause' });
      }
    },
    onResume: () => audio.resume(),
    onBack: () => {
      const s = app.get().screen;
      if (s === 'game') {
        app.set({ overlay: 'pause' });
        return true;
      }
      if (s === 'menu' || s === 'boot') return false;
      if (s === 'lobby' || s === 'results') return true; // these screens have explicit leave buttons
      go('menu');
      return true;
    },
  });
  applyPrefs();
  app.subscribe(applyPrefs);
  // Flush pending profile/settings writes when the page is hidden or closed.
  document.addEventListener('visibilitychange', () => document.hidden && void saveNow());
  window.addEventListener('pagehide', () => void saveNow());
  go('menu');
  // Invite links (?join=CODE) open the online screen with the code filled in, once a name is set.
  try {
    if (/^[A-Z2-9]{6}$/i.test(new URLSearchParams(location.search).get('join') ?? '') && app.get().profile.name) go('online');
  } catch {
    // no location (tests)
  }
  void measurePings();
  handleDeepLink();
  if (!isNative && 'serviceWorker' in navigator && import.meta.env.PROD) {
    try {
      const { Workbox } = await import('workbox-window');
      const wb = new Workbox('./sw.js');
      wb.addEventListener('waiting', () => {
        app.set({ updateReady: true });
        applyUpdate = () => {
          wb.addEventListener('controlling', () => window.location.reload());
          wb.messageSkipWaiting();
        };
      });
      void wb.register();
    } catch {
      // service worker unavailable
    }
  }
}

/**
 * Deep links: `?join=CODE` opens an online invite; `?play=map:mode:bots[:difficulty]` starts an offline
 * match directly (used by automated tests and the benchmark).
 */
function handleDeepLink(): void {
  const q = new URLSearchParams(location.search);
  const join = q.get('join');
  const play = q.get('play');
  if (join && /^[A-Za-z2-9]{6}$/.test(join)) {
    if (!app.get().profile.name) updateProfileName();
    void joinPrivateRoom(join.toUpperCase()).catch(() => go('online'));
  } else if (play) {
    const [mapId, mode, bots, diff] = play.split(':');
    if (!app.get().profile.name) updateProfileName();
    const purpose = mode === 'training' ? (q.get('tutorial') ? 'tutorial' : 'training') : 'match';
    startOffline(
      {
        mapId: mapId || 'training-grounds',
        mode: (mode || 'ffa') as LobbySettings['mode'],
        botCount: Math.max(0, Math.min(11, Number(bots ?? 3) || 0)),
        botDifficulty: (Math.max(0, Math.min(2, Number(diff ?? 1) || 0)) as 0 | 1 | 2),
        timeLimit: Number(q.get('time') ?? 300) || 300,
      },
      purpose,
    );
  }
  if (join || play) history.replaceState(null, '', location.pathname);
}

function updateProfileName(): void {
  app.set((s) => ({ profile: { ...s.profile, name: s.profile.name || 'Player' } }));
}

let lastPrefs = '';
function applyPrefs(): void {
  const s = app.get().settings;
  const key = `${s.accessibility.reduceMotion}|${s.accessibility.uiScale}|${s.accessibility.textScale}|${s.audio.master}|${s.audio.music}|${s.audio.sfx}|${s.audio.ui}`;
  if (key === lastPrefs) return;
  lastPrefs = key;
  const root = document.documentElement;
  root.classList.toggle('reduce-motion', s.accessibility.reduceMotion);
  root.style.setProperty('--ui-scale', String(s.accessibility.uiScale));
  root.style.setProperty('--text-scale', String(s.accessibility.textScale));
  audio.setVolumes(s.audio);
}

function ScreenSwitch({ screen }: { screen: Screen }) {
  switch (screen) {
    case 'boot':
      return null;
    case 'menu':
      return <MainMenu key="menu" />;
    case 'bots':
      return <PlayBots key="bots" />;
    case 'survival':
      return <Survival key="survival" />;
    case 'training':
      return <Training key="training" />;
    case 'online':
      return <Online key="online" />;
    case 'lan':
      return <Lan key="lan" />;
    case 'lobby':
      return <Lobby key="lobby" />;
    case 'game':
      return <GameScreen key="game" />;
    case 'results':
      return <Results key="results" />;
    case 'armoury':
      return <Armoury key="armoury" />;
    case 'profile':
      return <Profile key="profile" />;
    case 'settings':
      return <SettingsScreen key="settings" />;
    case 'credits':
      return <Credits key="credits" />;
    case 'update':
      return <UpdateRequired key="update" />;
  }
}

export function App() {
  const screen = useStore(app, (s) => s.screen);
  const ready = useStore(app, (s) => s.ready);
  const webgl = useStore(app, (s) => s.webgl);
  const updateReady = useStore(app, (s) => s.updateReady);
  useStore(app, (s) => s.settings.language); // re-render on language change
  useGamepadNav(screen !== 'game');
  useEffect(() => {
    const unlock = () => audio.unlock();
    window.addEventListener('pointerdown', unlock, { once: true });
    window.addEventListener('keydown', unlock, { once: true });
    return () => {
      window.removeEventListener('pointerdown', unlock);
      window.removeEventListener('keydown', unlock);
    };
  }, []);
  if (!webgl)
    return (
      <div className="absolute inset-0 grid place-items-center p-8 text-center" data-testid="no-webgl">
        <p className="max-w-lg text-lg">{t('error.webgl')}</p>
      </div>
    );
  return (
    <div className="absolute inset-0 overflow-hidden bg-night" data-testid="app">
      {screen !== 'game' && <MenuBackdrop />}
      <Suspense fallback={<div className="absolute inset-0 grid place-items-center text-muted">{t('common.loading')}</div>}>
        <AnimatePresence mode="wait">{ready && <ScreenSwitch screen={screen} />}</AnimatePresence>
      </Suspense>
      <Toasts />
      {updateReady && screen !== 'game' && (
        <div className="absolute bottom-3 left-1/2 -translate-x-1/2 z-50 flex items-center gap-3 bg-panel border-2 border-ink rounded-md px-4 py-2 shadow-chunky" data-testid="update-toast">
          <span>{t('app.updateReady')}</span>
          <Button size="sm" variant="primary" onClick={() => applyUpdate?.()}>
            {t('app.restart')}
          </Button>
        </div>
      )}
    </div>
  );
}

/** Animated gradient + drifting silhouettes behind every menu (pure CSS, cheap). */
function MenuBackdrop() {
  return (
    <div aria-hidden="true" className="absolute inset-0 overflow-hidden" style={{ background: 'linear-gradient(180deg, #2a1f4a 0%, #6b3a6e 45%, #ff8a5c 100%)' }}>
      <div className="absolute inset-x-0 bottom-0 h-1/3" style={{ background: 'linear-gradient(180deg, transparent, rgba(16,18,26,0.85))' }} />
      <svg className="absolute bottom-0 w-[200%] h-1/2 opacity-60 animate-[drift_60s_linear_infinite]" viewBox="0 0 2000 400" preserveAspectRatio="none">
        <path d="M0 400 L0 240 L80 240 L80 160 L160 160 L160 220 L240 220 L240 120 L300 120 L300 200 L380 200 L380 250 L460 250 L460 140 L540 140 L540 230 L620 230 L620 180 L700 180 L700 260 L780 260 L780 110 L840 110 L840 210 L920 210 L920 240 L1000 240 L1000 160 L1080 160 L1080 220 L1160 220 L1160 120 L1220 120 L1220 200 L1300 200 L1300 250 L1380 250 L1380 140 L1460 140 L1460 230 L1540 230 L1540 180 L1620 180 L1620 260 L1700 260 L1700 110 L1760 110 L1760 210 L1840 210 L1840 240 L2000 240 L2000 400 Z" fill="#2a1f3a" />
      </svg>
      <style>{`@keyframes drift { from { transform: translateX(0) } to { transform: translateX(-50%) } }`}</style>
    </div>
  );
}
