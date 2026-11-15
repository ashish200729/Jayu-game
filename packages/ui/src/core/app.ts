import type { LanServiceInfo } from '@game/lan';
import {
  GameClient,
  LanHostBridge,
  MatchHost,
  PROTOCOL_VERSION,
  createLanClientTransport,
  createLocalPair,
  createLocalSession,
  makeInviteCode,
  type ClientStatus,
  type LobbyAction,
  type LobbySettings,
  type LobbyStateMsg,
} from '@game/net';
import type { MatchConfig, MatchResults } from '@game/sim';
import { isTouchDevice, platform, storage } from '@game/platform';
import { setLanguage } from '../i18n';
import { applyMatch, migrateProfile, newProfile, refreshChallenges, type MatchReward, type Profile } from './profile';
import { defaultSettings, migrateSettings, type Settings } from './settings';
import { Store } from './store';

export type Screen =
  | 'boot'
  | 'menu'
  | 'bots'
  | 'survival'
  | 'training'
  | 'online'
  | 'lan'
  | 'lobby'
  | 'game'
  | 'results'
  | 'armoury'
  | 'profile'
  | 'settings'
  | 'credits'
  | 'update';

export type SessionKind = 'offline' | 'online' | 'lan-host' | 'lan-join';
export type SessionPurpose = 'match' | 'training' | 'tutorial';

export interface SessionSnapshot {
  kind: SessionKind;
  purpose: SessionPurpose;
  status: ClientStatus;
  code: string;
  lobby: LobbyStateMsg | null;
  results: MatchResults | null;
  playerId: number;
  isHost: boolean;
  reconnecting: boolean;
  error: string;
  config: MatchConfig | null;
  lanAddresses: string[];
}

export interface Toast {
  id: number;
  text: string;
  kind: 'info' | 'success' | 'error';
}

export interface Region {
  id: string;
  name: string;
  url: string;
}

export interface AppState {
  ready: boolean;
  screen: Screen;
  prevScreen: Screen;
  profile: Profile;
  settings: Settings;
  session: SessionSnapshot | null;
  reward: MatchReward | null;
  toasts: Toast[];
  overlay: null | 'pause' | 'scoreboard' | 'emotes' | 'layout';
  updateReady: boolean;
  lanServices: LanServiceInfo[];
  regions: Region[];
  pings: Record<string, number>;
  /** Settings of the last offline match, for "Play again". */
  lastOffline: { settings: Partial<LobbySettings>; purpose: SessionPurpose } | null;
  webgl: boolean;
}

const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env ?? {};

function parseRegions(): Region[] {
  try {
    if (env.VITE_REGIONS) return JSON.parse(env.VITE_REGIONS) as Region[];
  } catch {
    // fall through to default
  }
  const url = env.VITE_SERVER_URL || (typeof location !== 'undefined' && location.hostname !== 'localhost' && location.protocol === 'https:' ? `wss://${location.hostname.replace(/^www\./, 'play.')}` : 'ws://localhost:2567');
  return [{ id: 'ap-south', name: 'Mumbai', url }];
}

export const app = new Store<AppState>({
  ready: false,
  screen: 'boot',
  prevScreen: 'menu',
  profile: newProfile(),
  settings: defaultSettings(isTouchDevice()),
  session: null,
  reward: null,
  toasts: [],
  overlay: null,
  updateReady: false,
  lanServices: [],
  regions: parseRegions(),
  pings: {},
  lastOffline: null,
  webgl: true,
});

export function go(screen: Screen): void {
  app.set((s) => ({ screen, prevScreen: s.screen, overlay: null }));
}

let toastId = 1;
export function toast(text: string, kind: Toast['kind'] = 'info'): void {
  const id = toastId++;
  app.set((s) => ({ toasts: [...s.toasts, { id, text, kind }] }));
  setTimeout(() => app.set((s) => ({ toasts: s.toasts.filter((x) => x.id !== id) })), 3200);
}

// ------------------------------------------------------------------ persistence

let saveTimer: ReturnType<typeof setTimeout> | null = null;
let lastGoodProfile = '';

export function updateProfile(fn: (p: Profile) => Profile): void {
  app.set((s) => ({ profile: fn(s.profile) }));
  scheduleSave();
}

export function updateSettings(fn: (s: Settings) => Settings): void {
  app.set((s) => ({ settings: fn(s.settings) }));
  setLanguage(app.get().settings.language);
  scheduleSave();
}

function scheduleSave(): void {
  if (saveTimer) clearTimeout(saveTimer);
  saveTimer = setTimeout(() => void saveNow(), 300);
}

export async function saveNow(): Promise<void> {
  const { profile, settings } = app.get();
  const json = JSON.stringify(profile);
  // Keep the previous good copy as a backup before overwriting.
  if (lastGoodProfile && lastGoodProfile !== json) await storage.set('profile.bak', lastGoodProfile);
  await storage.set('profile', json);
  lastGoodProfile = json;
  await storage.set('settings', JSON.stringify(settings));
}

/** Load profile and settings; corrupted data falls back to the backup copy, then the cloud copy. */
export async function loadPersisted(): Promise<void> {
  let profile: Profile | null = null;
  for (const key of ['profile', 'profile.bak']) {
    try {
      const raw = await storage.get(key);
      if (raw) {
        profile = migrateProfile(JSON.parse(raw));
        break;
      }
    } catch {
      // try the next copy
    }
  }
  const settingsRaw = await storage.get('settings').catch(() => null);
  let settings = defaultSettings(isTouchDevice());
  try {
    if (settingsRaw) settings = migrateSettings(JSON.parse(settingsRaw), isTouchDevice());
  } catch {
    // defaults
  }
  profile = refreshChallenges(profile ?? newProfile());
  lastGoodProfile = JSON.stringify(profile);
  setLanguage(settings.language);
  app.set({ profile, settings, ready: true });
  void cloudSync();
}

function httpBase(): string {
  const region = app.get().regions.find((r) => r.id === app.get().settings.network.region) ?? app.get().regions[0];
  return region.url.replace(/^ws/, 'http');
}

/** Sync the guest profile with the server copy (newer syncVersion wins). Silent when offline; resolves to whether the server answered. */
export async function cloudSync(): Promise<boolean> {
  const p = app.get().profile;
  try {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 4000);
    const res = await fetch(`${httpBase()}/api/profile/sync`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: p.id, secret: p.secret, profile: p, version: p.syncVersion }),
      signal: ctrl.signal,
    });
    clearTimeout(timer);
    if (!res.ok) return false;
    const body = (await res.json()) as { ok: boolean; profile?: unknown; version?: number };
    if (body.ok && body.version && body.version > p.syncVersion && body.profile) {
      const remote = migrateProfile(body.profile);
      app.set({ profile: remote });
      scheduleSave();
    }
    return !!body.ok;
  } catch {
    // offline: keep local profile
    return false;
  }
}

export async function deleteCloudProfile(): Promise<boolean> {
  const p = app.get().profile;
  try {
    const res = await fetch(`${httpBase()}/api/profile/delete`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ id: p.id, secret: p.secret }),
    });
    return res.ok;
  } catch {
    return false;
  }
}

export async function resetProfile(): Promise<void> {
  await deleteCloudProfile();
  const p = refreshChallenges(newProfile(app.get().profile.name));
  app.set({ profile: p });
  await storage.remove('profile.bak');
  lastGoodProfile = '';
  await saveNow();
}

export async function measurePings(): Promise<void> {
  const out: Record<string, number> = {};
  await Promise.all(
    app.get().regions.map(async (r) => {
      const t0 = performance.now();
      try {
        const ctrl = new AbortController();
        const timer = setTimeout(() => ctrl.abort(), 3000);
        await fetch(`${r.url.replace(/^ws/, 'http')}/health`, { signal: ctrl.signal, cache: 'no-store' });
        clearTimeout(timer);
        out[r.id] = Math.round(performance.now() - t0);
      } catch {
        out[r.id] = -1;
      }
    }),
  );
  app.set({ pings: out });
}

export async function reportPlayer(name: string, reason: 'name' | 'cheating' | 'griefing' | 'other'): Promise<void> {
  const s = app.get().session;
  try {
    await fetch(`${httpBase()}/api/report`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ room: s?.code ?? '', name, reason }),
    });
  } catch {
    // best effort
  }
}

// ------------------------------------------------------------------ sessions

interface ActiveSession {
  kind: SessionKind;
  purpose: SessionPurpose;
  client: GameClient;
  host?: MatchHost;
  update: () => void;
  close: () => void;
  code: string;
  rejoin?: () => Promise<void>;
  lanAddresses: string[];
}

let active: ActiveSession | null = null;
let raf = 0;
let rewardedMatch = '';
let matchStartedAt = 0;
let reconnecting = false;

export function currentClient(): GameClient | null {
  return active?.client ?? null;
}

export function currentSession(): ActiveSession | null {
  return active;
}

function hello() {
  const p = app.get().profile;
  const l = p.loadout;
  return { name: p.name || 'Player', look: [l.head, l.outfit, l.jetpack, l.skin, l.emote, l.pose], token: '', platform: platform };
}

function publish(): void {
  if (!active) {
    app.set({ session: null });
    return;
  }
  const c = active.client;
  const lobby = c.lobby;
  const snap: SessionSnapshot = {
    kind: active.kind,
    purpose: active.purpose,
    status: c.status,
    code: active.code || lobby?.code || '',
    lobby,
    results: c.results,
    playerId: c.playerId,
    isHost: !!lobby && lobby.hostId === c.playerId,
    reconnecting,
    error: c.status === 'rejected' ? `error.${c.rejectReason === 'version' ? 'update' : c.rejectReason === 'kicked' ? 'kicked' : c.rejectReason === 'full' ? 'full' : 'disconnected'}` : '',
    config: c.start?.config ?? null,
    lanAddresses: active.lanAddresses,
  };
  app.set({ session: snap });
  const screen = app.get().screen;
  if (c.status === 'rejected' && c.rejectReason === 'version') go('update');
  else if (c.status === 'playing' && screen !== 'game') {
    matchStartedAt = performance.now();
    go('game');
  } else if (c.status === 'results' && c.results) {
    const key = `${active.code}:${c.start?.matchId ?? 0}`;
    if (rewardedMatch !== key && active.purpose !== 'tutorial') {
      rewardedMatch = key;
      const me = c.results.players.find((r) => r.id === c.playerId);
      const res = applyMatch(app.get().profile, c.results, c.playerId, me?.team ?? -1, (performance.now() - matchStartedAt) / 1000);
      app.set({ profile: res.profile, reward: res.reward });
      scheduleSave();
      void cloudSync();
    }
    if (screen === 'game') go('results');
  } else if (c.status === 'lobby' && (screen === 'game' || screen === 'results') && active.kind !== 'offline') go('lobby');
}

function loop(): void {
  if (!active) return;
  try {
    active.update();
  } catch (e) {
    console.error(e);
  }
  raf = requestAnimationFrame(loop);
}

function begin(s: ActiveSession): void {
  endSession();
  active = s;
  reconnecting = false;
  s.client.onChange = () => {
    publish();
    if (s.client.status === 'closed' && s.rejoin && !reconnecting) void tryReconnect(s);
  };
  publish();
  raf = requestAnimationFrame(loop);
}

async function tryReconnect(s: ActiveSession): Promise<void> {
  reconnecting = true;
  publish();
  const deadline = performance.now() + 30000;
  while (active === s && performance.now() < deadline) {
    try {
      await s.rejoin!();
      reconnecting = false;
      publish();
      return;
    } catch {
      await new Promise((r) => setTimeout(r, 2000));
    }
  }
  reconnecting = false;
  if (active === s) {
    toast('error.disconnected', 'error');
    endSession();
    go('menu');
  }
}

/** Keep the best jetpack-course time from a training session in the profile. */
function recordCourseTime(s: ActiveSession): void {
  if (s.purpose !== 'training') return;
  try {
    const me = s.client.view()?.me;
    const best = me?.bestCourse ?? 0;
    if (best > 0) {
      const prev = app.get().profile.stats.bestCourseTicks;
      if (!prev || best < prev) updateProfile((p) => ({ ...p, stats: { ...p.stats, bestCourseTicks: best } }));
    }
  } catch {
    // no view yet
  }
}

export function endSession(): void {
  if (raf) cancelAnimationFrame(raf);
  raf = 0;
  if (active) {
    const a = active;
    recordCourseTime(a);
    active = null;
    try {
      a.close();
    } catch {
      // already closed
    }
  }
  app.set({ session: null });
}

export function leaveSession(): void {
  endSession();
  go('menu');
}

/**
 * "Play again" from the results screen: replays an offline match, asks the host for a rematch in a
 * private/LAN room, or queues a fresh quick match.
 */
export async function rematch(): Promise<void> {
  const st = app.get();
  const sess = st.session;
  if (!sess || sess.kind === 'offline') {
    if (st.lastOffline) startOffline(st.lastOffline.settings, st.lastOffline.purpose);
    else go('menu');
    return;
  }
  if (sess.lobby?.quickMatch) {
    endSession();
    go('online');
    try {
      await quickMatch();
      go('lobby');
    } catch {
      // toast already shown
    }
    return;
  }
  if (sess.isHost) lobbyAction({ a: 'rematch' });
  go('lobby');
}

/** Pause/resume an offline match (online matches keep running behind the pause menu). */
export function setPaused(paused: boolean): void {
  if (active?.kind === 'offline' && active.host) active.host.paused = paused;
}

export function lobbyAction(a: LobbyAction): void {
  active?.client.lobbyAction(a);
}

/** Offline match vs bots (also training, tutorial and solo survival). */
export function startOffline(settings: Partial<LobbySettings>, purpose: SessionPurpose = 'match'): void {
  app.set({ lastOffline: { settings, purpose }, reward: null });
  const s = app.get().settings;
  const local = createLocalSession(
    { settings: { maxPlayers: 12, ...settings } },
    hello(),
    { latencyMs: s.network.simLatency / 2, jitterMs: s.network.simJitter / 2, loss: s.network.simLoss },
  );
  begin({
    kind: 'offline',
    purpose,
    client: local.client,
    host: local.host,
    update: () => local.update(),
    close: () => local.close(),
    code: '',
    lanAddresses: [],
  });
}

function regionUrl(): Region {
  const st = app.get();
  return st.regions.find((r) => r.id === st.settings.network.region) ?? st.regions[0];
}

async function onlineSession(join: import('@game/net/online').OnlineJoin, silent = false): Promise<void> {
  const { connectOnline } = await import('@game/net/online');
  const region = regionUrl();
  let conn;
  try {
    conn = await connectOnline(region.url, join);
  } catch (e) {
    const msg = String((e as Error)?.message ?? e);
    if (!silent) toast(/not found|invalid|no rooms/i.test(msg) ? 'error.notFound' : 'error.server', 'error');
    throw e;
  }
  const client = new GameClient(conn.transport, hello());
  const sess: ActiveSession = {
    kind: 'online',
    purpose: 'match',
    client,
    update: () => sess.client.update(),
    close: () => sess.client.leave(),
    code: conn.code,
    lanAddresses: [],
  };
  sess.rejoin = async () => {
    const again = await connectOnline(region.url, { kind: 'join', code: sess.code });
    const h = { ...hello(), token: sess.client.token };
    const old = sess.client;
    const fresh = new GameClient(again.transport, h);
    fresh.sampler = old.sampler;
    fresh.onChange = old.onChange;
    sess.client = fresh;
  };
  begin(sess);
}

export const quickMatch = () => onlineSession({ kind: 'quick', region: regionUrl().id });

/** Arena maps that suit an instant 8-player team match. */
const FALLBACK_MAPS = ['volcano-base', 'rooftop-dusk', 'desert-canyon', 'shipyard', 'jungle-temple', 'orbital-station'];

/**
 * The main Play button: join an online quick match, or — when the game server cannot be reached
 * (offline, server down, not deployed) — drop straight into an offline team match with bots
 * instead of dead-ending on an error. Resolves to where the player ended up.
 */
export async function quickMatchOrOffline(): Promise<'online' | 'offline'> {
  try {
    await onlineSession({ kind: 'quick', region: regionUrl().id }, true);
    return 'online';
  } catch {
    toast('error.offlineFallback', 'info');
    const mapId = FALLBACK_MAPS[Math.floor(Math.random() * FALLBACK_MAPS.length)];
    startOffline({ mapId, mode: 'tdm', botCount: 7, botDifficulty: 1 }, 'match');
    return 'offline';
  }
}
export const createPrivateRoom = (settings: Partial<LobbySettings>) => onlineSession({ kind: 'create', region: regionUrl().id, settings });
export const joinPrivateRoom = (code: string) => onlineSession({ kind: 'join', code });

/** Host a LAN match on this phone: the sim runs here and is advertised via Bonjour/NSD. */
export async function hostLan(settings: Partial<LobbySettings>): Promise<void> {
  const { openLanHost } = await import('./lan');
  const code = makeInviteCode();
  const host = new MatchHost({ kind: 'lan', code, settings: { maxPlayers: 12, ...settings } });
  const name = app.get().profile.name || 'Player';
  const { socket, port, addresses } = await openLanHost(`Jayu-${code}`, {
    code,
    hostName: name.slice(0, 16),
    mode: host.settings.mode,
    map: host.settings.mapId,
    max: String(host.settings.maxPlayers),
    v: String(PROTOCOL_VERSION),
  });
  const bridge = new LanHostBridge(host, socket);
  // The host phone also plays: its own client talks to the host in-process.
  const pair = createLocalPair(
    (d) => host.receive('self', d),
    () => host.disconnect('self'),
    undefined,
    undefined,
    1,
    'lan',
  );
  host.connect('self', pair.link);
  const client = new GameClient(pair.client, hello());
  begin({
    kind: 'lan-host',
    purpose: 'match',
    client,
    host,
    update: () => {
      host.update();
      bridge.update();
      client.update();
      socket.flush();
    },
    close: () => {
      client.leave();
      host.close('host left');
      bridge.close();
    },
    code,
    lanAddresses: addresses.map((a) => `${a}:${port}`),
  });
}

export async function joinLan(hostAddr: string, port: number): Promise<void> {
  const { openLanClient } = await import('./lan');
  const t = createLanClientTransport(await openLanClient(hostAddr, port));
  const client = new GameClient(t, hello());
  begin({
    kind: 'lan-join',
    purpose: 'match',
    client,
    update: () => {
      t.update();
      client.update();
    },
    close: () => client.leave(),
    code: '',
    lanAddresses: [],
  });
}
