import { describe, expect, it } from 'vitest';
import { en } from '../src/i18n/en';
import { hi } from '../src/i18n/hi';
import { applyMatch, levelInfo, migrateProfile, newProfile, refreshChallenges, PROFILE_VERSION } from '../src/core/profile';
import { migrateSettings, defaultSettings } from '../src/core/settings';

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
});
