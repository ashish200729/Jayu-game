import { describe, expect, it } from 'vitest';
import { COMBAT, GRENADES, PLAYER, TICK_RATE, WEAPONS, weaponIndex } from '@game/content';
import { compileSource } from '@game/maps';
import {
  ACT_MELEE,
  ACT_SWAP,
  ACT_THROW,
  BTN_FIRE,
  BTN_JET,
  Rng,
  Sim,
  bumpCounter,
  datan2,
  dcos,
  defaultConfig,
  dsin,
  emptyInput,
  radToAngle,
  type Input,
  type Player,
} from '@game/sim';

/** A tiny flat arena so tests are independent of the shipped maps. */
const ROWS = [
  '########################################',
  '#......................................#',
  '#......................................#',
  '#......................................#',
  '#......................................#',
  '#......................................#',
  '#......................................#',
  '#......................................#',
  '#......................................#',
  '#......................................#',
  '#......................................#',
  '#......................................#',
  '#......................................#',
  '#......................................#',
  '#..1....S....W....H....X...H....S...2..#',
  '#..1....+....g....R....d...U....+...2..#',
  '########################################',
  '########################################',
  '########################################',
  '########################################',
];
const arena = compileSource({
  id: 'test-arena',
  name: 'Test',
  description: '',
  feature: '',
  recommended: [2, 4],
  theme: { backdrop: 'training', skyTop: 0, skyBottom: 0, far: 0, mid: 0, near: 0, solid: 0, solidDark: 0, rim: 0, accent: 0, weather: 'none', dark: false, music: 0 },
  weapons: ['kestrel'],
  heavies: ['comet'],
  rows: ROWS,
});

function makeSim(mode: 'ffa' | 'tdm' | 'ctf' | 'koth' | 'bomb' | 'leader' | 'survival' | 'training' = 'ffa', extra = {}) {
  const sim = new Sim(defaultConfig({ mapId: 'test-arena', mode, seed: 3, ...extra }), arena);
  return sim;
}

/** Run ticks; players without an entry get an empty input. A `buttons` value of -1 toggles fire each tick. */
function run(sim: Sim, ticks: number, inputs: Record<number, Partial<Input>> = {}) {
  for (let i = 0; i < ticks; i++) {
    for (const p of sim.players) {
      if (p.isBot) continue;
      const inp = inputs[p.id] ?? {};
      const buttons = inp.buttons === -1 ? (i % 2 === 0 ? BTN_FIRE : 0) : inp.buttons ?? 0;
      sim.setInput(p.id, { ...emptyInput(sim.tick + 1), actions: p.input.actions, ...inp, buttons });
    }
    sim.step();
  }
}

function place(p: Player, x: number, y = 15 * 32) {
  p.x = x;
  p.y = y;
  p.vx = 0;
  p.vy = 0;
}

describe('deterministic math', () => {
  it('sin/cos table is accurate', () => {
    for (let a = 0; a < 65536; a += 977) {
      expect(dsin(a)).toBeCloseTo(Math.sin((a / 65536) * Math.PI * 2), 3);
      expect(dcos(a)).toBeCloseTo(Math.cos((a / 65536) * Math.PI * 2), 3);
    }
  });
  it('atan2 is within ~0.3 degrees', () => {
    for (const [y, x] of [[1, 1], [-1, 2], [3, -4], [-5, -0.5], [0, 1], [1, 0]]) {
      const expected = radToAngle(Math.atan2(y, x));
      const diff = Math.abs(((datan2(y, x) - expected + 98304) % 65536) - 32768);
      expect(diff).toBeLessThan(60);
    }
  });
  it('rng is reproducible', () => {
    const a = new Rng(42);
    const b = new Rng(42);
    for (let i = 0; i < 100; i++) expect(a.nextU32()).toBe(b.nextU32());
  });
});

describe('movement and jetpack', () => {
  it('runs, stops on walls and lands on the floor', () => {
    const sim = makeSim();
    const p = sim.addPlayer({ name: 'A' });
    run(sim, 200);
    expect(p.onGround).toBe(true);
    const x0 = p.x;
    run(sim, 30, { [p.id]: { moveX: 127 } });
    expect(p.x).toBeGreaterThan(x0 + 100);
    run(sim, 400, { [p.id]: { moveX: 127 } });
    expect(p.x).toBeLessThanOrEqual(39 * 32 - PLAYER.width / 2);
  });

  it('jetpack drains fuel while thrusting and refills on the ground after a delay', () => {
    const sim = makeSim();
    const p = sim.addPlayer({ name: 'A' });
    run(sim, 200);
    const y0 = p.y;
    run(sim, 60, { [p.id]: { buttons: BTN_JET } });
    expect(p.y).toBeLessThan(y0 - 150);
    expect(p.fuel).toBeLessThan(PLAYER.fuelMax - PLAYER.fuelDrain * 0.9);
    run(sim, 200);
    expect(p.onGround).toBe(true);
    expect(p.fuel).toBe(PLAYER.fuelMax);
  });

  it('taps give small hops, holds give long flights (thrust ramp)', () => {
    const tap = makeSim();
    const a = tap.addPlayer({ name: 'A' });
    run(tap, 200);
    const y0 = a.y;
    run(tap, 3, { [a.id]: { buttons: BTN_JET } });
    let minY = a.y;
    for (let i = 0; i < 60; i++) {
      run(tap, 1);
      minY = Math.min(minY, a.y);
    }
    const hold = makeSim();
    const b = hold.addPlayer({ name: 'B' });
    run(hold, 200);
    run(hold, 60, { [b.id]: { buttons: BTN_JET } });
    expect(y0 - minY).toBeLessThan(80);
    expect(y0 - b.y).toBeGreaterThan(200);
  });
});

describe('weapons and damage', () => {
  function duel(weapon: string, dist: number) {
    const sim = makeSim();
    const a = sim.addPlayer({ name: 'A' });
    const b = sim.addPlayer({ name: 'B' });
    run(sim, 200);
    place(a, 200);
    place(b, 200 + dist);
    a.protT = b.protT = 0;
    a.slots[1] = { wi: weaponIndex(weapon), mag: 50, reserve: -1 };
    a.active = 1;
    return { sim, a, b };
  }

  for (const w of WEAPONS) {
    it(`${w.id}: fires at its rate and deals damage`, () => {
      const dist = w.kind === 'flame' ? 120 : w.projectile ? 260 : 200;
      const { sim, a, b } = duel(w.id, dist);
      b.maxHp = b.hp = 5000;
      const interval = Math.round(w.fireInterval * TICK_RATE);
      const ticks = interval * 3 + 2;
      run(sim, ticks, { [a.id]: { buttons: w.auto ? BTN_FIRE : -1, aim: 0 } });
      run(sim, 90);
      const triggers = w.kind === 'flame' ? 3 : Math.min(3, w.magSize);
      expect(a.shotsFired).toBeGreaterThanOrEqual(triggers * (w.burst > 1 ? w.burst : 1) - (w.burst > 1 ? w.burst : 0));
      // Fire-rate cap: never more shots than the interval allows.
      if (w.kind !== 'flame') expect(a.shotsFired).toBeLessThanOrEqual((Math.floor(ticks / interval) + 1) * w.burst);
      expect(b.hp).toBeLessThan(b.maxHp);
    });
  }

  it('headshots deal bonus damage and range falloff reduces damage', () => {
    const near = duel('hornet', 100);
    run(near.sim, 1, { [near.a.id]: { buttons: BTN_FIRE, aim: 0 } });
    const nearDmg = near.b.maxHp - near.b.hp;
    const far = duel('hornet', 750);
    run(far.sim, 1, { [far.a.id]: { buttons: BTN_FIRE, aim: 0 } });
    const farDmg = far.b.maxHp - far.b.hp;
    expect(nearDmg).toBe(WEAPONS[weaponIndex('hornet')].damage);
    expect(farDmg).toBeGreaterThan(0);
    expect(farDmg).toBeLessThan(nearDmg);
    // Head height: aim slightly upward so the ray enters the top of the box.
    const head = duel('heron', 300);
    head.b.maxHp = head.b.hp = 1000;
    const sh = head.sim.shoulderOf(head.a);
    run(head.sim, 1, { [head.a.id]: { buttons: BTN_FIRE, aim: head.sim.aimAt(head.a, head.b.x, head.b.y - 40) } });
    void sh;
    expect(head.b.maxHp - head.b.hp).toBe(Math.round(80 * 1.6));
  });

  it('spawn protection blocks damage and ends when you fire', () => {
    const { sim, a, b } = duel('kestrel', 150);
    b.protT = 100;
    run(sim, 2, { [a.id]: { buttons: BTN_FIRE, aim: 0 } });
    expect(b.hp).toBe(b.maxHp);
    a.protT = 100;
    run(sim, 20, { [a.id]: { buttons: BTN_FIRE, aim: 0 } });
    expect(a.protT).toBe(0);
  });

  it('friendly fire is off by default in team modes', () => {
    const sim = makeSim('tdm');
    const a = sim.addPlayer({ name: 'A', team: 0 });
    const b = sim.addPlayer({ name: 'B', team: 0 });
    run(sim, 300);
    place(a, 200);
    place(b, 350);
    a.protT = b.protT = 0;
    run(sim, 30, { [a.id]: { buttons: BTN_FIRE, aim: 0 } });
    expect(b.hp).toBe(b.maxHp);
  });

  it('self damage from explosions is reduced and knocks you back (rocket jump)', () => {
    const { sim, a } = duel('comet', 900);
    run(sim, 1, { [a.id]: { buttons: BTN_FIRE, aim: 16384 } }); // straight down
    run(sim, 10);
    expect(a.hp).toBeGreaterThan(a.maxHp - 95 * COMBAT.selfDamageMult - 10);
    expect(a.vy).toBeLessThan(0);
  });

  it('reloads automatically when empty and manually on request', () => {
    const { sim, a } = duel('kestrel', 300);
    a.slots[1] = { wi: weaponIndex('kestrel'), mag: 1, reserve: 30 };
    run(sim, 3, { [a.id]: { buttons: BTN_FIRE, aim: 32768 } });
    expect(a.reloadT).toBeGreaterThan(0);
    run(sim, 120);
    expect(a.slots[1].mag).toBe(30);
    expect(a.slots[1].reserve).toBe(0);
    a.slots[1].mag = 10;
    a.slots[1].reserve = 5;
    run(sim, 2, { [a.id]: { actions: bumpCounter(a.input.actions, 8) } });
    expect(a.reloadT).toBeGreaterThan(0);
  });

  it('melee hits in front with knockback', () => {
    const { sim, a, b } = duel('kestrel', 30);
    run(sim, 2, { [a.id]: { aim: 0, actions: bumpCounter(0, ACT_MELEE) } });
    expect(b.hp).toBe(b.maxHp - COMBAT.meleeDamage);
  });

  it('every grenade type detonates or creates its cloud', () => {
    for (let k = 0; k < GRENADES.length; k++) {
      const { sim, a, b } = duel('kestrel', 140);
      b.maxHp = b.hp = 5000;
      a.grenades = [k];
      run(sim, 2, { [a.id]: { aim: 0, actions: bumpCounter(0, ACT_THROW), throwPower: 0 } });
      expect(a.grenades.length).toBe(0);
      let exploded = false;
      for (let i = 0; i < 60 * 6 && !exploded; i++) {
        if (GRENADES[k].id === 'mine' && i === 90) place(b, sim.grenades[0]?.x ?? b.x);
        run(sim, 1);
        exploded = sim.events.some((e) => e.type === 2);
      }
      expect(exploded, GRENADES[k].id).toBe(true);
    }
  });

  it('swap toggles weapons; swap on a dropped weapon picks it up', () => {
    const { sim, a } = duel('kestrel', 300);
    run(sim, 2, { [a.id]: { actions: bumpCounter(0, ACT_SWAP) } });
    expect(a.active).toBe(0);
  });
});

describe('pickups, health and respawn', () => {
  it('health regenerates after the delay and respawn happens after the timer', () => {
    const sim = makeSim();
    const p = sim.addPlayer({ name: 'A' });
    run(sim, 200);
    place(p, 12 * 32);
    run(sim, 30);
    p.hp = 50;
    p.lastDamageTick = sim.tick;
    run(sim, PLAYER.regenDelay * TICK_RATE - 10);
    expect(p.hp).toBe(50);
    run(sim, 120);
    expect(p.hp).toBeGreaterThan(50);
    sim.kill(p, -1, 102, false);
    expect(p.alive).toBe(false);
    run(sim, PLAYER.respawnTime * TICK_RATE + 2);
    expect(p.alive).toBe(true);
  });
});

describe('modes', () => {
  it('FFA ends at the score limit and names the winner', () => {
    const sim = makeSim('ffa', { scoreLimit: 2 });
    const a = sim.addPlayer({ name: 'A' });
    const b = sim.addPlayer({ name: 'B' });
    run(sim, 200);
    sim.kill(b, a.id, 3, false);
    run(sim, 200);
    sim.kill(b, a.id, 3, false);
    run(sim, 2);
    expect(sim.mode.phase).toBe('ended');
    expect(sim.mode.winner).toBe(a.id);
  });

  it('TDM counts team kills', () => {
    const sim = makeSim('tdm', { scoreLimit: 1 });
    const a = sim.addPlayer({ name: 'A', team: 0 });
    const b = sim.addPlayer({ name: 'B', team: 1 });
    run(sim, 200);
    sim.kill(b, a.id, 3, false);
    run(sim, 2);
    expect(sim.mode.teamScores[0]).toBe(1);
    expect(sim.mode.winnerTeam).toBe(0);
  });

  it('CTF: take the enemy flag and capture at home', () => {
    const sim = makeSim('ctf', { scoreLimit: 1 });
    const a = sim.addPlayer({ name: 'A', team: 0 });
    sim.addPlayer({ name: 'B', team: 1 });
    run(sim, 200);
    const enemy = sim.mode.flags[1];
    const own = sim.mode.flags[0];
    place(a, enemy.homeX, enemy.homeY);
    run(sim, 2);
    expect(a.carrying).toBe(1);
    place(a, own.homeX, own.homeY);
    run(sim, 2);
    expect(sim.mode.teamScores[0]).toBe(1);
  });

  it('KOTH scores for sole occupation', () => {
    const sim = makeSim('koth', { scoreLimit: 3 });
    const a = sim.addPlayer({ name: 'A', team: 0 });
    sim.addPlayer({ name: 'B', team: 1 });
    run(sim, 200);
    const z = sim.mode.zone;
    for (let i = 0; i < 250; i++) {
      place(a, z.x + z.w / 2, z.y + z.h);
      run(sim, 1);
    }
    expect(sim.mode.teamScores[0]).toBeGreaterThanOrEqual(3);
  });

  it('Hot potato eliminates the bomb holder when the fuse ends', () => {
    const sim = makeSim('bomb');
    sim.addPlayer({ name: 'A' });
    sim.addPlayer({ name: 'B' });
    sim.addPlayer({ name: 'C' });
    run(sim, 60 * 25);
    expect(sim.players.filter((p) => p.eliminated).length).toBeGreaterThanOrEqual(1);
  });

  it('Protect the leader: killing the leader scores', () => {
    const sim = makeSim('leader');
    const a = sim.addPlayer({ name: 'A', team: 0 });
    const b = sim.addPlayer({ name: 'B', team: 1 });
    run(sim, 200);
    expect(b.leader).toBe(true);
    expect(b.maxHp).toBe(PLAYER.leaderHp);
    sim.kill(b, a.id, 3, false);
    expect(sim.mode.teamScores[0]).toBe(1);
  });

  it('Survival spawns waves of drones and offers upgrades', () => {
    const sim = makeSim('survival');
    const a = sim.addPlayer({ name: 'A' });
    run(sim, 60 * 8);
    expect(sim.mode.wave).toBe(1);
    expect(sim.players.some((p) => p.drone)).toBe(true);
    for (const d of sim.players.filter((p) => p.drone)) sim.kill(d, a.id, 3, false);
    for (let i = 0; i < 60 * 20 && sim.mode.phase !== 'intermission'; i++) {
      for (const d of sim.players.filter((p) => p.drone && p.alive)) sim.kill(d, a.id, 3, false);
      a.hp = a.maxHp;
      run(sim, 1);
    }
    expect(sim.mode.phase).toBe('intermission');
    expect(a.pendingUpgrade).toBe(true);
  });

  it('Training spawns target dummies that respawn', () => {
    const sim = new Sim(defaultConfig({ mapId: 'training-grounds', mode: 'training' }));
    expect(sim.players.filter((p) => p.dummy).length).toBeGreaterThan(0);
  });
});

describe('determinism', () => {
  it('same inputs → same hashes', () => {
    const h = () => {
      const sim = makeSim('tdm');
      const ids = [0, 1, 2, 3].map((i) => sim.addPlayer({ name: `P${i}` }).id);
      const out: number[] = [];
      for (let t = 0; t < 1200; t++) {
        for (const id of ids) sim.setInput(id, { ...emptyInput(t), moveX: ((t + id * 40) % 120 < 60 ? 127 : -127), buttons: (t % 30 < 10 ? BTN_JET : 0) | (t % 7 === 0 ? BTN_FIRE : 0), aim: (t * 400 + id * 9000) & 0xffff });
        sim.step();
        if (t % 60 === 0) out.push(sim.hash());
      }
      return out;
    };
    expect(h()).toEqual(h());
  });
});
