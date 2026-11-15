import Phaser from 'phaser';
import { COSMETICS, WEAPONS } from '@game/content';
import type { PlayerView } from '@game/net';
import { angleToRad } from '@game/sim';
import { CHAR_SCALE, armTexture, gunArt, headTexture, jetpackTexture, legTexture, torsoTexture, type GunArt } from '../art/characters';
import { GAME_FONT } from '../art/draw';

/** Display scale for 4x character textures. */
const K = 1 / CHAR_SCALE;

/**
 * A chunky cartoon soldier built from separate parts (head, torso, arms, legs, jetpack, gun) so
 * every cosmetic swaps cleanly. Procedurally animated (breathing, run cycle, aim, crouch, flight lean,
 * landing squash, layered jet flame).
 */
export class CharacterRig {
  readonly root: Phaser.GameObjects.Container;
  private body: Phaser.GameObjects.Container;
  private legB: Phaser.GameObjects.Image;
  private legF: Phaser.GameObjects.Image;
  private torso: Phaser.GameObjects.Image;
  private head: Phaser.GameObjects.Image;
  private jet: Phaser.GameObjects.Image;
  private armB: Phaser.GameObjects.Image;
  private gunPivot: Phaser.GameObjects.Container;
  private gun: Phaser.GameObjects.Image;
  private gun2: Phaser.GameObjects.Image;
  private armF: Phaser.GameObjects.Image;
  private flame: Phaser.GameObjects.Image;
  private flameCore: Phaser.GameObjects.Image;
  private flameGlow: Phaser.GameObjects.Image;
  private shield: Phaser.GameObjects.Image;
  readonly shadow: Phaser.GameObjects.Image;
  readonly label: Phaser.GameObjects.Text;
  readonly marker: Phaser.GameObjects.Image;
  readonly hpBar: Phaser.GameObjects.Graphics;
  private phase = 0;
  private gunWi = -2;
  private gunInfo: GunArt | null = null;
  private lookKey = '';
  private wasGround = true;
  private squash = 0;
  private lean = 0;
  private idleT = Math.random() * 10;
  look: number[] = [];
  team = -1;
  teamColor = 0xffffff;
  lastX = 0;
  lastY = 0;
  recoil = 0;
  muzzle = { x: 0, y: 0, angle: 0 };
  flipped = false;

  constructor(
    private scene: Phaser.Scene,
    look: number[],
    team: number,
    teamColor: number,
    labelResolution = 2,
  ) {
    this.shadow = scene.add.image(0, 0, 'shadow').setVisible(false);
    this.root = scene.add.container(0, 0);
    this.body = scene.add.container(0, 0);
    this.legB = scene.add.image(0, 0, '__WHITE').setOrigin(0.5, 0.1).setScale(K);
    this.legF = scene.add.image(0, 0, '__WHITE').setOrigin(0.5, 0.1).setScale(K);
    this.jet = scene.add.image(0, 0, '__WHITE').setOrigin(0.85, 0.3).setScale(K);
    this.flameGlow = scene.add.image(0, 0, 'dot').setOrigin(0.5, 0.35).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.flame = scene.add.image(0, 0, 'jetflame').setOrigin(0.5, 0.06).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.flameCore = scene.add.image(0, 0, 'jetflame').setOrigin(0.5, 0.06).setBlendMode(Phaser.BlendModes.ADD).setTint(0xfff6d8).setVisible(false);
    this.torso = scene.add.image(0, 0, '__WHITE').setScale(K);
    this.armB = scene.add.image(0, 0, '__WHITE').setOrigin(0.5, 0.15).setScale(K);
    this.head = scene.add.image(0, 0, '__WHITE').setOrigin(0.5, 0.82).setScale(K);
    this.gunPivot = scene.add.container(0, 0);
    this.gun2 = scene.add.image(0, 0, '__WHITE').setScale(K).setVisible(false);
    this.gun = scene.add.image(0, 0, '__WHITE').setScale(K);
    this.armF = scene.add.image(0, 0, '__WHITE').setOrigin(0.5, 0.15).setScale(K);
    this.gunPivot.add([this.gun2, this.gun]);
    this.shield = scene.add.image(0, -22, 'ring').setScale(0.42).setAlpha(0.5).setTint(0x9ff3ff).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.body.add([this.flameGlow, this.flame, this.flameCore, this.jet, this.legB, this.armB, this.torso, this.legF, this.head, this.gunPivot, this.armF, this.shield]);
    this.root.add(this.body);
    this.label = scene.add
      .text(0, 0, '', { fontFamily: GAME_FONT, fontSize: '12px', fontStyle: '800', color: '#ffffff', stroke: '#11131b', strokeThickness: 3.5 })
      .setOrigin(0.5, 1)
      .setResolution(labelResolution);
    this.marker = scene.add.image(0, 0, 'crown').setScale(0.7).setVisible(false);
    this.hpBar = scene.add.graphics();
    this.setLook(look, team, teamColor);
  }

  setLook(look: number[], team: number, teamColor: number): void {
    const key = `${look.join(',')}|${team}|${teamColor}`;
    if (key === this.lookKey) return;
    this.lookKey = key;
    this.look = look;
    this.team = team;
    this.teamColor = teamColor;
    const s = this.scene;
    const [head, outfit, jet] = look.length ? look : [0, 7, 15];
    this.head.setTexture(headTexture(s, head));
    this.torso.setTexture(torsoTexture(s, outfit, team, teamColor));
    this.legB.setTexture(legTexture(s, outfit)).setTint(0xc4c8d2);
    this.legF.setTexture(legTexture(s, outfit));
    this.armB.setTexture(armTexture(s, outfit)).setTint(0xc4c8d2);
    this.armF.setTexture(armTexture(s, outfit));
    this.jet.setTexture(jetpackTexture(s, jet));
    const jc = COSMETICS[jet] ?? COSMETICS[15];
    const fc = jc.colors[1] ?? 0xffa53d;
    this.flame.setTint(fc);
    this.flameGlow.setTint(fc);
    this.gunWi = -2;
  }

  private setGun(wi: number): void {
    if (wi === this.gunWi) return;
    this.gunWi = wi;
    if (wi < 0) {
      this.gun.setVisible(false);
      this.gun2.setVisible(false);
      this.gunInfo = null;
      return;
    }
    const g = gunArt(this.scene, wi, this.look[3] ?? 20);
    this.gunInfo = g;
    this.gun.setTexture(g.key).setVisible(true).setOrigin(g.gripX / g.w, g.gripY / g.h);
    this.gun2.setTexture(g.key).setOrigin(g.gripX / g.w, g.gripY / g.h).setTint(0xc4c8d2);
  }

  /**
   * Ground contact shadow. `gap` is the distance from the feet to the floor below (null = no floor in range).
   */
  setShadow(x: number, floorY: number | null, gap: number): void {
    if (floorY === null) {
      this.shadow.setVisible(false);
      return;
    }
    const k = Math.max(0, 1 - gap / 180);
    this.shadow.setVisible(this.root.visible && k > 0.02).setPosition(x, floorY + 1).setScale(0.45 + k * 0.35, 0.14 + k * 0.08).setAlpha(0.45 * k);
  }

  /** Update from a player view. `dt` in seconds. */
  update(p: PlayerView, aim: number, dt: number, now: number, reduceMotion = false): void {
    const crouchOff = p.crouch ? 10 : 0;
    this.root.setPosition(p.x, p.y);
    const a = angleToRad(aim);
    const facing = Math.cos(a) >= 0 ? 1 : -1;
    this.flipped = facing < 0;
    const speed = Math.abs(p.vx);
    // Landing squash.
    if (p.onGround && !this.wasGround && p.vy >= 0) this.squash = reduceMotion ? 0 : 1;
    this.wasGround = p.onGround;
    this.squash = Math.max(0, this.squash - dt * 6);
    const sq = Math.sin(this.squash * Math.PI) * 0.12;
    this.body.setScale(facing * (1 + sq * 0.6), 1 - sq);
    // Lean into horizontal motion while airborne (world-space rotation around the feet).
    const targetLean = reduceMotion ? 0 : p.onGround ? Math.max(-0.06, Math.min(0.06, p.vx / 4000)) : Math.max(-0.2, Math.min(0.2, p.vx / 1600));
    this.lean += (targetLean - this.lean) * Math.min(1, dt * 10);
    this.body.setRotation(this.lean);
    // Run cycle / airborne pose.
    if (p.onGround && speed > 20 && !p.crouch) this.phase += dt * (speed / 22);
    else if (p.onGround) this.phase *= 0.8;
    this.idleT += dt;
    const swing = p.onGround ? Math.sin(this.phase) * Math.min(1, speed / 200) * 0.8 : p.jetting ? 0.32 + Math.sin(now * 0.02) * 0.04 : 0.22;
    const moveDir = Math.sign(p.vx) * facing || 1;
    const hipY = -17 + crouchOff * 0.6;
    this.legB.setPosition(-3, hipY).setRotation(p.onGround ? -swing * moveDir : 0.34);
    this.legF.setPosition(3, hipY).setRotation(p.onGround ? swing * moveDir : -0.18 + (p.jetting ? 0.12 : 0));
    if (p.crouch) {
      this.legB.setRotation(-0.9);
      this.legF.setRotation(0.9);
    }
    const breathe = p.onGround && speed < 20 && !reduceMotion ? Math.sin(this.idleT * 3.2) * 0.55 : 0;
    const bob = p.onGround && speed > 20 ? Math.abs(Math.sin(this.phase)) * -1.6 : 0;
    const torsoY = -28 + crouchOff + bob + breathe;
    this.torso.setPosition(0, torsoY);
    this.jet.setPosition(-7, torsoY - 4);
    // Jet flame: additive outer plume + white-hot core + soft glow, flickering.
    const fx = -11.6;
    const fy = torsoY + 9;
    if (p.jetting) {
      const f = 0.85 + Math.random() * 0.3;
      this.flame.setVisible(true).setPosition(fx, fy).setScale(0.3 * f, (0.42 + Math.random() * 0.14) * f).setAlpha(0.95);
      this.flameCore.setVisible(true).setPosition(fx, fy).setScale(0.16 * f, 0.24 * f).setAlpha(0.9);
      this.flameGlow.setVisible(true).setPosition(fx, fy + 6).setScale(1.5 + Math.random() * 0.3).setAlpha(0.45);
    } else {
      this.flame.setVisible(false);
      this.flameCore.setVisible(false);
      this.flameGlow.setVisible(false);
    }
    // Aim: local angle in the mirrored body space.
    const local = facing > 0 ? a : Math.PI - a;
    const shoulderY = torsoY;
    this.head.setPosition(1, torsoY - 8 - breathe * 0.4).setRotation(Math.max(-0.35, Math.min(0.35, normal(local) * 0.35)));
    this.recoil = Math.max(0, this.recoil - dt * 40);
    const kick = this.recoil;
    this.gunPivot.setPosition(0, shoulderY).setRotation(local - kick * 0.03);
    const reach = 9 - kick;
    this.gun.setPosition(reach, 0);
    const def = p.slots[p.active]?.wi >= 0 ? WEAPONS[p.slots[p.active].wi] : null;
    this.setGun(p.slots[p.active]?.wi ?? -1);
    const dual = p.dualT > 0 && !!def?.dualWieldable;
    this.gun2.setVisible(dual && this.gunWi >= 0).setPosition(reach - 3, -4);
    // Front arm reaches to the grip; back arm holds the barrel (or the second gun).
    const handX = Math.cos(local) * (reach + 2);
    const handY = Math.sin(local) * (reach + 2);
    this.armF.setPosition(2, shoulderY - 2).setRotation(Math.atan2(handY + 2, handX - 2) - Math.PI / 2);
    this.armB.setPosition(-3, shoulderY - 2).setRotation(Math.atan2(handY + (dual ? -2 : 2), handX + 3) - Math.PI / 2 - 0.15);
    if (p.meleeT > 0) this.armF.setRotation(this.armF.rotation - 1.2 * Math.sin((p.meleeT / 15) * Math.PI));
    // Muzzle world position (for flashes and tracers).
    const gi = this.gunInfo;
    if (gi) {
      const mx = reach + (gi.muzzleX - gi.gripX);
      const my = gi.muzzleY - gi.gripY;
      const lx = Math.cos(local) * mx - Math.sin(local) * my;
      const ly = Math.sin(local) * mx + Math.cos(local) * my;
      this.muzzle.x = p.x + lx * facing;
      this.muzzle.y = p.y + shoulderY + ly;
      this.muzzle.angle = a;
    }
    // Spawn protection shimmer, burning, alpha.
    this.shield.setVisible(p.protT > 0).setAlpha(0.35 + Math.sin(now * 0.012) * 0.15);
    this.body.setAlpha(p.protT > 0 ? 0.75 + Math.sin(now * 0.02) * 0.2 : 1);
    if (p.burnT > 0) this.torso.setTint(Math.sin(now * 0.03) > 0 ? 0xffb080 : 0xffffff);
    else this.torso.clearTint();
    this.lastX = p.x;
    this.lastY = p.y;
  }

  setVisible(v: boolean): void {
    this.root.setVisible(v);
    this.label.setVisible(v);
    this.hpBar.setVisible(v);
    if (!v) {
      this.marker.setVisible(false);
      this.shadow.setVisible(false);
    }
  }

  setDepth(d: number): void {
    this.shadow.setDepth(15);
    this.root.setDepth(d);
    this.label.setDepth(d + 1);
    this.marker.setDepth(d + 1);
    this.hpBar.setDepth(d + 1);
  }

  /** Part textures for the cartoon ragdoll burst. */
  parts(): { key: string; x: number; y: number; origin: [number, number]; scale: number }[] {
    const list = [this.head, this.torso, this.legB, this.legF, this.armF, this.jet];
    return list.map((img) => ({ key: img.texture.key, x: this.root.x + img.x * (this.flipped ? -1 : 1), y: this.root.y + img.y, origin: [img.originX, img.originY], scale: K }));
  }

  destroy(): void {
    this.root.destroy();
    this.shadow.destroy();
    this.label.destroy();
    this.marker.destroy();
    this.hpBar.destroy();
  }
}

function normal(a: number): number {
  let x = a;
  while (x > Math.PI) x -= Math.PI * 2;
  while (x < -Math.PI) x += Math.PI * 2;
  return x;
}
