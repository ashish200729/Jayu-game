import Phaser from 'phaser';
import { COSMETICS, WEAPONS } from '@game/content';
import type { PlayerView } from '@game/net';
import { angleToRad } from '@game/sim';
import { armTexture, gunArt, headTexture, jetpackTexture, legTexture, torsoTexture, type GunArt } from '../art/characters';

const HALF = 0.5;

/**
 * A chunky cartoon soldier built from separate parts (head, torso, arms, legs, jetpack, gun) so
 * every cosmetic swaps cleanly. Procedurally animated (run cycle, aim, crouch, jet flight).
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
  private shield: Phaser.GameObjects.Image;
  readonly label: Phaser.GameObjects.Text;
  readonly marker: Phaser.GameObjects.Image;
  readonly hpBar: Phaser.GameObjects.Graphics;
  private phase = 0;
  private gunWi = -2;
  private gunInfo: GunArt | null = null;
  private lookKey = '';
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
  ) {
    this.root = scene.add.container(0, 0);
    this.body = scene.add.container(0, 0);
    this.legB = scene.add.image(0, 0, '__WHITE').setOrigin(0.5, 0.1).setScale(HALF);
    this.legF = scene.add.image(0, 0, '__WHITE').setOrigin(0.5, 0.1).setScale(HALF);
    this.jet = scene.add.image(0, 0, '__WHITE').setOrigin(0.85, 0.3).setScale(HALF);
    this.flame = scene.add.image(0, 0, 'dot').setOrigin(0.5, 0.1).setTint(0xffa53d).setBlendMode(Phaser.BlendModes.ADD).setVisible(false);
    this.torso = scene.add.image(0, 0, '__WHITE').setScale(HALF);
    this.armB = scene.add.image(0, 0, '__WHITE').setOrigin(0.5, 0.15).setScale(HALF);
    this.head = scene.add.image(0, 0, '__WHITE').setOrigin(0.5, 0.82).setScale(HALF);
    this.gunPivot = scene.add.container(0, 0);
    this.gun2 = scene.add.image(0, 0, '__WHITE').setScale(HALF).setVisible(false);
    this.gun = scene.add.image(0, 0, '__WHITE').setScale(HALF);
    this.armF = scene.add.image(0, 0, '__WHITE').setOrigin(0.5, 0.15).setScale(HALF);
    this.gunPivot.add([this.gun2, this.gun]);
    this.shield = scene.add.image(0, -22, 'ring').setScale(0.42).setAlpha(0.5).setTint(0x9ff3ff).setVisible(false);
    this.body.add([this.flame, this.jet, this.legB, this.armB, this.torso, this.legF, this.head, this.gunPivot, this.armF, this.shield]);
    this.root.add(this.body);
    this.label = scene.add
      .text(0, 0, '', { fontFamily: 'Baloo 2, system-ui, sans-serif', fontSize: '13px', fontStyle: '700', color: '#ffffff', stroke: '#1b1d26', strokeThickness: 4 })
      .setOrigin(0.5, 1)
      .setResolution(2);
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
    this.legB.setTexture(legTexture(s, outfit)).setTint(0xcfcfcf);
    this.legF.setTexture(legTexture(s, outfit));
    this.armB.setTexture(armTexture(s, outfit)).setTint(0xcfcfcf);
    this.armF.setTexture(armTexture(s, outfit));
    this.jet.setTexture(jetpackTexture(s, jet));
    const jc = COSMETICS[jet] ?? COSMETICS[15];
    this.flame.setTint(jc.colors[1] ?? 0xffa53d);
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
    this.gun2.setTexture(g.key).setOrigin(g.gripX / g.w, g.gripY / g.h);
  }

  /** Update from a player view. `dt` in seconds. */
  update(p: PlayerView, aim: number, dt: number, now: number): void {
    const crouchOff = p.crouch ? 10 : 0;
    this.root.setPosition(p.x, p.y);
    const a = angleToRad(aim);
    const facing = Math.cos(a) >= 0 ? 1 : -1;
    this.flipped = facing < 0;
    this.body.setScale(facing, 1);
    const speed = Math.abs(p.vx);
    // Run cycle / airborne pose.
    if (p.onGround && speed > 20 && !p.crouch) this.phase += dt * (speed / 22);
    else if (p.onGround) this.phase *= 0.8;
    const swing = p.onGround ? Math.sin(this.phase) * Math.min(1, speed / 200) * 0.75 : p.jetting ? 0.35 : 0.2;
    const moveDir = Math.sign(p.vx) * facing || 1;
    const hipY = -17 + crouchOff * 0.6;
    this.legB.setPosition(-3, hipY).setRotation(p.onGround ? -swing * moveDir : 0.3);
    this.legF.setPosition(3, hipY).setRotation(p.onGround ? swing * moveDir : -0.15 + (p.jetting ? 0.1 : 0));
    if (p.crouch) {
      this.legB.setRotation(-0.9);
      this.legF.setRotation(0.9);
    }
    const bob = p.onGround && speed > 20 ? Math.abs(Math.sin(this.phase)) * -1.5 : 0;
    const torsoY = -28 + crouchOff + bob;
    this.torso.setPosition(0, torsoY);
    this.jet.setPosition(-7, torsoY - 4);
    this.flame.setPosition(-12, torsoY + 8);
    if (p.jetting) {
      this.flame.setVisible(true).setScale(0.55 + Math.random() * 0.25, 0.9 + Math.random() * 0.6);
    } else this.flame.setVisible(false);
    // Aim: local angle in the mirrored body space.
    const local = facing > 0 ? a : Math.PI - a;
    const shoulderY = torsoY;
    this.head.setPosition(1, torsoY - 8).setRotation(Math.max(-0.35, Math.min(0.35, normal(local) * 0.35)));
    this.recoil = Math.max(0, this.recoil - dt * 40);
    const kick = this.recoil;
    this.gunPivot.setPosition(0, shoulderY).setRotation(local);
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
      const mx = reach + (gi.muzzleX - gi.gripX) * HALF;
      const my = (gi.muzzleY - gi.gripY) * HALF;
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
    if (!v) this.marker.setVisible(false);
  }

  setDepth(d: number): void {
    this.root.setDepth(d);
    this.label.setDepth(d + 1);
    this.marker.setDepth(d + 1);
    this.hpBar.setDepth(d + 1);
  }

  /** Part textures for the cartoon ragdoll burst. */
  parts(): { key: string; x: number; y: number; origin: [number, number] }[] {
    const list = [this.head, this.torso, this.legB, this.legF, this.armF, this.jet];
    return list.map((img) => ({ key: img.texture.key, x: this.root.x + img.x * (this.flipped ? -1 : 1), y: this.root.y + img.y, origin: [img.originX, img.originY] }));
  }

  destroy(): void {
    this.root.destroy();
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
