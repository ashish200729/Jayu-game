import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { hi } from '../src/i18n/hi';
import { applyMatch, levelInfo, migrateProfile, newProfile, refreshChallenges, PROFILE_VERSION } from '../src/core/profile';
import { migrateSettings, defaultSettings, defaultTouchLayout } from '../src/core/settings';

describe('i18n', () => {
  it('Hindi has every English key and no extras', () => {
    expect(Object.keys(hi).sort()).toEqual(Object.keys(en).sort());
    for (const [k, v] of Object.entries(hi)) expect(v.length, k).toBeGreaterThan(0);
  });
  it('placeholders match between languages', () => {
    for (const k of Object.keys(en) as (keyof typeof en)[]) {
      const ph = (s: string) => (s.match(/\{\w+\}/g) ?? []).sort().join();
      expect(ph(hi[k]), k).toBe(ph(en[k]));
    }
  });
});

describe('profile', () => {
  it('migrates a v1 profile', () => {
    const v1 = { version: 1, id: 'abcdefghijklmnopqrstuvwx', name: 'Old', xp: 500, kills: 12, deaths: 3, matches: 4, loadout: { head: 'nope' } };
    const p = migrateProfile(v1);
    expect(p.version).toBe(PROFILE_VERSION);
    expect(p.stats.kills).toBe(12);
    expect(p.loadout.head).toBe('head_cadet');
    expect(p.secret.length).toBeGreaterThanOrEqual(16);
  });
  it('rejects garbage and newer versions', () => {
    expect(() => migrateProfile('x')).toThrow();
    expect(() => migrateProfile({ version: 99 })).toThrow();
  });
  it('levels grow with xp', () => {
    expect(levelInfo(0).level).toBe(1);
    expect(levelInfo(10000).level).toBeGreaterThan(5);
  });
  it('applies match rewards and challenge progress', () => {
    const p = refreshChallenges(newProfile('Me'));
    const res = applyMatch(
      p,
      {
        mode: 'ffa',
        mapId: 'x',
        winner: 1,
        winnerTeam: -1,
        teamScores: [0, 0],
        mvp: 1,
        wave: 0,
        durationTicks: 100,
        players: [
          { id: 1, name: 'Me', team: -1, isBot: false, kills: 5, deaths: 1, assists: 1, score: 5, objective: 0, damage: 300, accuracy: 0.5, shotsFired: 10, shotsHit: 5, headshots: 2, favouriteWeapon: 'mule', weaponKills: { mule: 5 }, bestCourse: 0 },
          { id: 2, name: 'Bot', team: -1, isBot: true, kills: 1, deaths: 5, assists: 0, score: 1, objective: 0, damage: 50, accuracy: 0.2, shotsFired: 10, shotsHit: 2, headshots: 0, favouriteWeapon: '', weaponKills: {}, bestCourse: 0 },
        ],
      },
      1,
      -1,
      120,
    );
    expect(res.reward.won).toBe(true);
    expect(res.reward.xp).toBeGreaterThan(200);
    expect(res.profile.stats.kills).toBe(5);
    expect(res.profile.stats.weaponKills.mule).toBe(5);
  });
});

describe('settings', () => {
  it('migrates partial settings', () => {
    const s = migrateSettings({ audio: { master: 0.2 }, language: 'hi' });
    expect(s.audio.master).toBe(0.2);
    expect(s.audio.music).toBe(defaultSettings().audio.music);
    expect(s.language).toBe('hi');
    expect(s.controls.layouts).toHaveLength(3);
  });

  it('upgrades untouched v1 touch layouts but keeps customised ones', () => {
    const c = (x: number, y: number, size = 1, visible = true) => ({ x, y, size, opacity: 0.55, visible });
    const v1 = {
      move: c(0.14, 0.72, 1),
      aim: c(0.84, 0.7, 1),
      fire: c(0.7, 0.86, 0.9, false),
      jet: c(0.26, 0.9, 0.9, false),
      grenade: c(0.9, 0.38, 0.85),
      swap: c(0.78, 0.38, 0.85),
      reload: c(0.66, 0.38, 0.8),
      melee: c(0.95, 0.52, 0.8),
      zoom: c(0.95, 0.24, 0.8),
      crouch: c(0.05, 0.42, 0.8),
      emote: c(0.05, 0.28, 0.75),
    };
    const custom = { ...v1, grenade: c(0.5, 0.5, 1.2) };
    const s = migrateSettings({ version: 1, controls: { ...defaultSettings().controls, layouts: [v1, custom, v1] } });
    expect(s.version).toBe(2);
    expect(s.controls.layouts[0]).toEqual(defaultTouchLayout());
    expect(s.controls.layouts[1].grenade).toEqual(c(0.5, 0.5, 1.2));
    expect(s.controls.layouts[2]).toEqual(defaultTouchLayout());
    // Already-migrated settings are never reset.
    const again = migrateSettings({ ...s, controls: { ...s.controls, layouts: [custom, custom, custom] } });
    expect(again.controls.layouts[0].grenade).toEqual(c(0.5, 0.5, 1.2));
  });

  it('default touch controls never overlap on a 915x412 phone', () => {
    const l = defaultTouchLayout();
    const W = 915;
    const H = 412;
    const r = (k: keyof typeof l) => (k === 'move' || k === 'aim' ? 62 : 30 * l[k].size);
    const keys = (Object.keys(l) as (keyof typeof l)[]).filter((k) => l[k].visible);
    for (const a of keys)
      for (const b of keys) {
        if (a >= b) continue;
        const d = Math.hypot((l[a].x - l[b].x) * W, (l[a].y - l[b].y) * H);
        expect(d, `${a} vs ${b}`).toBeGreaterThan(r(a) + r(b));
      }
  });
});
