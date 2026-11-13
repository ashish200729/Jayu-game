import { COSMETICS, DEFAULT_LOADOUT, MODE_IDS, WEAPONS, type CosmeticCategory, type Loadout, type ModeId } from '@game/content';
import type { MatchResults } from '@game/sim';

export const PROFILE_VERSION = 2;
export const MAX_LEVEL = 50;

export interface ChallengeState {
  id: string;
  kind: ChallengeKind;
  target: number;
  progress: number;
  param: string;
  reward: number;
  claimed: boolean;
}

export type ChallengeKind = 'kills' | 'weaponKills' | 'wins' | 'matches' | 'headshots' | 'objective' | 'waves' | 'grenadeKills';

export interface ProfileStats {
  matches: number;
  wins: number;
  kills: number;
  deaths: number;
  assists: number;
  shotsFired: number;
  shotsHit: number;
  headshots: number;
  damage: number;
  playTimeSec: number;
  weaponKills: Record<string, number>;
  modeWins: Record<string, number>;
  modePlayed: Record<string, number>;
  bestWave: number;
  bestCourseTicks: number;
}

export interface Profile {
  version: number;
  id: string;
  secret: string;
  name: string;
  createdAt: number;
  xp: number;
  sparks: number;
  loadout: Loadout;
  owned: string[];
  stats: ProfileStats;
  daily: ChallengeState[];
  weekly: ChallengeState[];
  dailyKey: string;
  weeklyKey: string;
  tutorialDone: boolean;
  muted: string[];
  syncVersion: number;
}

function randomId(n: number): string {
  const a = new Uint8Array(n);
  crypto.getRandomValues(a);
  return Array.from(a, (b) => (b % 36).toString(36)).join('');
}

export function emptyStats(): ProfileStats {
  return {
    matches: 0,
    wins: 0,
    kills: 0,
    deaths: 0,
    assists: 0,
    shotsFired: 0,
    shotsHit: 0,
    headshots: 0,
    damage: 0,
    playTimeSec: 0,
    weaponKills: {},
    modeWins: {},
    modePlayed: {},
    bestWave: 0,
    bestCourseTicks: 0,
  };
}

export function newProfile(name = ''): Profile {
  return {
    version: PROFILE_VERSION,
    id: randomId(24),
    secret: randomId(32),
    name,
    createdAt: Date.now(),
    xp: 0,
    sparks: 0,
    loadout: { ...DEFAULT_LOADOUT },
    owned: [],
    stats: emptyStats(),
    daily: [],
    weekly: [],
    dailyKey: '',
    weeklyKey: '',
    tutorialDone: false,
    muted: [],
    syncVersion: 0,
  };
}

/**
 * Migrations from every older saved shape. v1 (pre-release builds) stored `kills`/`deaths` at the top
 * level and had no challenges or secret.
 */
export function migrateProfile(raw: unknown): Profile {
  if (!raw || typeof raw !== 'object') throw new Error('profile is not an object');
  const p = { ...(raw as Record<string, unknown>) };
  let v = typeof p.version === 'number' ? p.version : 1;
  if (v > PROFILE_VERSION) throw new Error(`profile from a newer version (${v})`);
  if (v === 1) {
    const stats = emptyStats();
    stats.kills = Number(p.kills) || 0;
    stats.deaths = Number(p.deaths) || 0;
    stats.matches = Number(p.matches) || 0;
    delete p.kills;
    delete p.deaths;
    delete p.matches;
    p.stats = stats;
    p.secret = typeof p.secret === 'string' ? p.secret : randomId(32);
    p.daily = [];
    p.weekly = [];
    p.dailyKey = '';
    p.weeklyKey = '';
    p.muted = [];
    p.syncVersion = 0;
    v = 2;
  }
  const base = newProfile();
  const out: Profile = {
    ...base,
    ...(p as Partial<Profile>),
    version: PROFILE_VERSION,
    stats: { ...emptyStats(), ...((p.stats as Partial<ProfileStats>) ?? {}) },
    loadout: { ...DEFAULT_LOADOUT, ...((p.loadout as Partial<Loadout>) ?? {}) },
  };
  if (typeof out.id !== 'string' || out.id.length < 16) out.id = base.id;
  if (typeof out.secret !== 'string' || out.secret.length < 16) out.secret = base.secret;
  out.xp = Math.max(0, Number(out.xp) || 0);
  out.sparks = Math.max(0, Number(out.sparks) || 0);
  out.owned = Array.isArray(out.owned) ? out.owned.filter((x) => typeof x === 'string') : [];
  for (const k of Object.keys(out.loadout) as (keyof Loadout)[]) {
    if (!COSMETICS.some((c) => c.id === out.loadout[k])) out.loadout[k] = DEFAULT_LOADOUT[k];
  }
  return out;
}

// ---------------------------------------------------------------- levels

export function xpToNext(level: number): number {
  return 200 + 75 * (level - 1);
}

export function levelInfo(xp: number): { level: number; into: number; need: number } {
  let level = 1;
  let rest = xp;
  while (level < MAX_LEVEL && rest >= xpToNext(level)) {
    rest -= xpToNext(level);
    level++;
  }
  return { level, into: rest, need: level >= MAX_LEVEL ? 0 : xpToNext(level) };
}

export function isUnlocked(p: Profile, cosmeticId: string): boolean {
  const c = COSMETICS.find((x) => x.id === cosmeticId);
  if (!c) return false;
  return c.unlockLevel <= levelInfo(p.xp).level || p.owned.includes(cosmeticId);
}

export function buyCosmetic(p: Profile, cosmeticId: string): Profile | null {
  const c = COSMETICS.find((x) => x.id === cosmeticId);
  if (!c || isUnlocked(p, cosmeticId) || c.price <= 0 || p.sparks < c.price) return null;
  return { ...p, sparks: p.sparks - c.price, owned: [...p.owned, cosmeticId] };
}

export function equip(p: Profile, category: CosmeticCategory, id: string): Profile {
  if (!isUnlocked(p, id)) return p;
  return { ...p, loadout: { ...p.loadout, [category]: id } };
}

// ---------------------------------------------------------------- challenges

const DAILY_TEMPLATES: Omit<ChallengeState, 'id' | 'progress' | 'claimed'>[] = [
  { kind: 'kills', target: 15, param: '', reward: 120 },
  { kind: 'matches', target: 3, param: '', reward: 80 },
  { kind: 'headshots', target: 5, param: '', reward: 100 },
  { kind: 'wins', target: 1, param: '', reward: 100 },
  { kind: 'objective', target: 5, param: '', reward: 120 },
  { kind: 'grenadeKills', target: 3, param: '', reward: 110 },
  { kind: 'weaponKills', target: 5, param: 'mule', reward: 120 },
  { kind: 'weaponKills', target: 5, param: 'kestrel', reward: 110 },
  { kind: 'weaponKills', target: 3, param: 'heron', reward: 130 },
  { kind: 'weaponKills', target: 4, param: 'hornet', reward: 100 },
];
const WEEKLY_TEMPLATES: Omit<ChallengeState, 'id' | 'progress' | 'claimed'>[] = [
  { kind: 'kills', target: 120, param: '', reward: 600 },
  { kind: 'wins', target: 8, param: '', reward: 600 },
  { kind: 'waves', target: 15, param: '', reward: 500 },
  { kind: 'matches', target: 20, param: '', reward: 450 },
  { kind: 'weaponKills', target: 15, param: 'comet', reward: 550 },
  { kind: 'headshots', target: 40, param: '', reward: 550 },
];

function dayKey(d: Date): string {
  return d.toISOString().slice(0, 10);
}
function weekKey(d: Date): string {
  const t = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  const day = (t.getUTCDay() + 6) % 7;
  t.setUTCDate(t.getUTCDate() - day);
  return `w${dayKey(t)}`;
}
function seeded(key: string, n: number, pool: number): number[] {
  let h = 2166136261;
  for (const c of key) h = Math.imul(h ^ c.charCodeAt(0), 16777619);
  const out: number[] = [];
  while (out.length < n) {
    h = Math.imul(h ^ (h >>> 13), 0x5bd1e995) >>> 0;
    const i = h % pool;
    if (!out.includes(i)) out.push(i);
  }
  return out;
}

/** Roll new daily/weekly challenges when the day/week changes. */
export function refreshChallenges(p: Profile, now = new Date()): Profile {
  const dk = dayKey(now);
  const wk = weekKey(now);
  let out = p;
  if (p.dailyKey !== dk) {
    const daily = seeded(dk, 3, DAILY_TEMPLATES.length).map((i, k) => ({ ...DAILY_TEMPLATES[i], id: `${dk}-${k}`, progress: 0, claimed: false }));
    out = { ...out, daily, dailyKey: dk };
  }
  if (p.weeklyKey !== wk) {
    const weekly = seeded(wk, 3, WEEKLY_TEMPLATES.length).map((i, k) => ({ ...WEEKLY_TEMPLATES[i], id: `${wk}-${k}`, progress: 0, claimed: false }));
    out = { ...out, weekly, weeklyKey: wk };
  }
  return out;
}

export interface MatchReward {
  xp: number;
  sparks: number;
  won: boolean;
  levelBefore: number;
  levelAfter: number;
  breakdown: { label: string; xp: number }[];
  completedChallenges: ChallengeState[];
}

/** Apply a finished match to the profile: stats, XP, Sparks and challenge progress. */
export function applyMatch(p: Profile, results: MatchResults, myId: number, myTeam: number, durationSec: number): { profile: Profile; reward: MatchReward } {
  const me = results.players.find((r) => r.id === myId);
  const levelBefore = levelInfo(p.xp).level;
  if (!me || results.mode === 'training') {
    return { profile: p, reward: { xp: 0, sparks: 0, won: false, levelBefore, levelAfter: levelBefore, breakdown: [], completedChallenges: [] } };
  }
  const teams = results.mode === 'tdm' || results.mode === 'ctf' || results.mode === 'leader' || results.mode === 'koth';
  const won = results.mode === 'survival' ? false : teams ? results.winnerTeam === myTeam && myTeam >= 0 : results.winner === myId;
  const breakdown: { label: string; xp: number }[] = [{ label: 'xp.played', xp: 60 }];
  if (me.kills) breakdown.push({ label: 'xp.kills', xp: me.kills * 20 });
  if (me.assists) breakdown.push({ label: 'xp.assists', xp: me.assists * 8 });
  if (me.objective) breakdown.push({ label: 'xp.objective', xp: me.objective * 15 });
  if (won) breakdown.push({ label: 'xp.win', xp: 120 });
  if (results.mvp === myId && results.players.length > 1) breakdown.push({ label: 'xp.mvp', xp: 60 });
  if (results.mode === 'survival' && results.wave > 1) breakdown.push({ label: 'xp.waves', xp: (results.wave - 1) * 35 });
  const xp = breakdown.reduce((a, b) => a + b.xp, 0);
  const sparks = Math.round(xp / 5);
  const s = { ...p.stats, weaponKills: { ...p.stats.weaponKills }, modeWins: { ...p.stats.modeWins }, modePlayed: { ...p.stats.modePlayed } };
  s.matches++;
  if (won) s.wins++;
  s.kills += me.kills;
  s.deaths += me.deaths;
  s.assists += me.assists;
  s.headshots += me.headshots;
  s.damage += me.damage;
  s.playTimeSec += Math.round(durationSec);
  s.modePlayed[results.mode] = (s.modePlayed[results.mode] ?? 0) + 1;
  if (won) s.modeWins[results.mode] = (s.modeWins[results.mode] ?? 0) + 1;
  for (const [w, n] of Object.entries(me.weaponKills)) s.weaponKills[w] = (s.weaponKills[w] ?? 0) + n;
  if (results.mode === 'survival') s.bestWave = Math.max(s.bestWave, Math.max(0, results.wave - 1));
  s.shotsFired += me.shotsFired;
  s.shotsHit += me.shotsHit;
  const grenadeKills = ['frag', 'sticky', 'mine'].reduce((a, k) => a + (me.weaponKills[k] ?? 0), 0);
  const completed: ChallengeState[] = [];
  const bump = (list: ChallengeState[]) =>
    list.map((c) => {
      if (c.claimed) return c;
      let add = 0;
      if (c.kind === 'kills') add = me.kills;
      else if (c.kind === 'weaponKills') add = me.weaponKills[c.param] ?? 0;
      else if (c.kind === 'wins') add = won ? 1 : 0;
      else if (c.kind === 'matches') add = 1;
      else if (c.kind === 'headshots') add = me.headshots;
      else if (c.kind === 'objective') add = me.objective;
      else if (c.kind === 'waves') add = results.mode === 'survival' ? Math.max(0, results.wave - 1) : 0;
      else if (c.kind === 'grenadeKills') add = grenadeKills;
      const progress = Math.min(c.target, c.progress + add);
      const done = progress >= c.target;
      const next = { ...c, progress, claimed: done };
      if (done) completed.push(next);
      return next;
    });
  const refreshed = refreshChallenges(p);
  const daily = bump(refreshed.daily);
  const weekly = bump(refreshed.weekly);
  const challengeSparks = completed.reduce((a, c) => a + c.reward, 0);
  const profile: Profile = {
    ...refreshed,
    xp: p.xp + xp,
    sparks: p.sparks + sparks + challengeSparks,
    stats: s,
    daily,
    weekly,
    syncVersion: p.syncVersion + 1,
  };
  return {
    profile,
    reward: { xp, sparks: sparks + challengeSparks, won, levelBefore, levelAfter: levelInfo(profile.xp).level, breakdown, completedChallenges: completed },
  };
}

export function favouriteWeapon(stats: ProfileStats): string {
  let best = '';
  let n = 0;
  for (const [k, v] of Object.entries(stats.weaponKills)) if (v > n && WEAPONS.some((w) => w.id === k)) [best, n] = [k, v];
  return best;
}

export const ALL_MODES: readonly ModeId[] = MODE_IDS;
