import Phaser from 'phaser';
import { getMap, type MapData } from '@game/maps';
import { BG_H, BG_W, backdropLayer, skyTexture } from '../art/backdrop';
import type { GameContext } from './context';

/**
 * Sky + parallax layers, rendered by an unzoomed camera underneath the world scene so the backdrop is
 * always crisp and screen-filling regardless of the world camera's zoom. GameScene calls `sync` after it
 * moves its camera each frame.
 */
export class BackdropScene extends Phaser.Scene {
  ctx!: GameContext;
  private map!: MapData;
  private sky!: Phaser.GameObjects.Image;
  private layers: Phaser.GameObjects.TileSprite[] = [];
  private factors = [0.08, 0.2, 0.38];
  private t0 = performance.now();

  constructor() {
    super({ key: 'backdrop' });
  }

  init(data: { ctx: GameContext }): void {
    this.ctx = data.ctx;
  }

  create(): void {
    this.map = getMap(this.ctx.client.start!.config.mapId);
    const th = this.map.theme;
    this.cameras.main.setBackgroundColor(th.skyBottom);
    this.sky = this.add.image(0, 0, skyTexture(this, th, this.map.id)).setOrigin(0.5, 0.5);
    const q = this.ctx.settings().graphics.quality;
    for (let i = 0; i < 3; i++) {
      if (q === 'low' && i === 1) continue;
      const ts = this.add.tileSprite(0, 0, BG_W, BG_H, backdropLayer(this, th, this.map.id, i)).setOrigin(0, 1);
      ts.setData('i', i);
      this.layers.push(ts);
    }
    this.scale.on('resize', this.layout, this);
    this.events.once('shutdown', () => this.scale.off('resize', this.layout, this));
    this.layout();
  }

  private layout(): void {
    const W = this.scale.width;
    const H = this.scale.height;
    this.cameras.main.setSize(W, H);
    // Cover-fit the sky so the sun/planet stays round.
    const s = Math.max(W / this.sky.width, H / this.sky.height) * 1.08;
    this.sky.setScale(s);
  }

  /** Called by GameScene with the world camera's view (world px) after it moves. */
  sync(scrollX: number, scrollY: number, zoom: number, viewW: number, viewH: number): void {
    const W = this.scale.width;
    const H = this.scale.height;
    const worldH = this.map.height * 32;
    const worldW = this.map.width * 32;
    const fracY = Math.max(0, Math.min(1, (scrollY + viewH / 2) / worldH));
    const fracX = Math.max(0, Math.min(1, (scrollX + viewW / 2) / worldW));
    const drift = (performance.now() - this.t0) / 1000;
    this.sky.setPosition(W / 2 - (fracX - 0.5) * W * 0.04, H / 2 - (fracY - 0.5) * H * 0.05);
    // Layers are ~70-95% of screen height, anchored below the screen bottom, rising as the camera looks down.
    const layerScale = (H / BG_H) * 0.95;
    for (const l of this.layers) {
      const i = l.getData('i') as number;
      const f = this.factors[i];
      const lw = Math.ceil(W / layerScale) + 2;
      if (l.scaleX !== layerScale) l.setScale(layerScale);
      if (l.width !== lw) l.setSize(lw, BG_H);
      const space = this.map.theme.backdrop === 'space' && i === 0 ? drift * 6 : 0;
      l.tilePositionX = (scrollX * zoom * f) / layerScale + space;
      const lift = (fracY - 0.5) * H * (0.18 + i * 0.12);
      l.setPosition(0, H * (1.04 + i * 0.05) - lift);
    }
  }
}
