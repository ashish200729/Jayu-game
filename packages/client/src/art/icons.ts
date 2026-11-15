import type Phaser from 'phaser';
import { canvas } from './draw';

export type HudIcon = 'fire' | 'jet' | 'grenade' | 'swap' | 'reload' | 'melee' | 'zoom' | 'crouch' | 'emote' | 'pause' | 'score' | 'heart' | 'star' | 'trophy';

const SIZE = 96;

/** White vector glyphs (96x96) for HUD buttons and readouts; tint at use. */
export function hudIcon(scene: Phaser.Scene, name: HudIcon): string {
  const key = `icon:${name}`;
  if (scene.textures.exists(key)) return key;
  const [c, g] = canvas(SIZE, SIZE);
  g.fillStyle = '#ffffff';
  g.strokeStyle = '#ffffff';
  g.lineCap = 'round';
  g.lineJoin = 'round';
  g.lineWidth = 9;
  switch (name) {
    case 'fire': {
      // Crosshair with a solid centre.
      g.lineWidth = 8;
      g.beginPath();
      g.arc(48, 48, 24, 0, Math.PI * 2);
      g.stroke();
      for (const [x0, y0, x1, y1] of [
        [48, 8, 48, 26],
        [48, 70, 48, 88],
        [8, 48, 26, 48],
        [70, 48, 88, 48],
      ]) {
        g.beginPath();
        g.moveTo(x0, y0);
        g.lineTo(x1, y1);
        g.stroke();
      }
      g.beginPath();
      g.arc(48, 48, 8, 0, Math.PI * 2);
      g.fill();
      break;
    }
    case 'jet': {
      g.beginPath();
      g.moveTo(48, 6);
      g.bezierCurveTo(70, 30, 80, 48, 72, 66);
      g.bezierCurveTo(66, 82, 56, 90, 48, 90);
      g.bezierCurveTo(40, 90, 30, 82, 24, 66);
      g.bezierCurveTo(16, 48, 30, 32, 38, 22);
      g.bezierCurveTo(40, 34, 44, 40, 50, 42);
      g.bezierCurveTo(52, 30, 50, 18, 48, 6);
      g.closePath();
      g.fill();
      g.globalCompositeOperation = 'destination-out';
      g.beginPath();
      g.moveTo(48, 50);
      g.bezierCurveTo(58, 60, 60, 72, 48, 80);
      g.bezierCurveTo(36, 72, 40, 60, 48, 50);
      g.fill();
      break;
    }
    case 'grenade': {
      g.beginPath();
      g.ellipse(46, 58, 26, 28, 0, 0, Math.PI * 2);
      g.fill();
      g.fillRect(36, 18, 20, 14);
      g.lineWidth = 7;
      g.beginPath();
      g.arc(66, 22, 9, 0, Math.PI * 2);
      g.stroke();
      g.globalCompositeOperation = 'destination-out';
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(22, 58);
      g.lineTo(70, 58);
      g.moveTo(46, 32);
      g.lineTo(46, 84);
      g.stroke();
      break;
    }
    case 'swap': {
      const arrow = (y: number, dir: number) => {
        g.beginPath();
        g.moveTo(48 - dir * 32, y);
        g.lineTo(48 + dir * 26, y);
        g.stroke();
        g.beginPath();
        g.moveTo(48 + dir * 36, y);
        g.lineTo(48 + dir * 18, y - 16);
        g.lineTo(48 + dir * 18, y + 16);
        g.closePath();
        g.fill();
      };
      arrow(32, 1);
      arrow(64, -1);
      break;
    }
    case 'reload': {
      g.lineWidth = 10;
      g.beginPath();
      g.arc(48, 50, 28, -Math.PI * 0.35, Math.PI * 1.45);
      g.stroke();
      g.beginPath();
      g.moveTo(84, 22);
      g.lineTo(80, 50);
      g.lineTo(56, 34);
      g.closePath();
      g.fill();
      break;
    }
    case 'melee': {
      // Combat knife.
      g.save();
      g.translate(48, 48);
      g.rotate(-Math.PI / 4);
      g.beginPath();
      g.moveTo(-8, -40);
      g.quadraticCurveTo(10, -30, 8, 4);
      g.lineTo(-8, 4);
      g.closePath();
      g.fill();
      g.fillRect(-16, 6, 32, 7);
      g.beginPath();
      g.roundRect(-7, 14, 14, 28, 5);
      g.fill();
      g.restore();
      break;
    }
    case 'zoom': {
      g.lineWidth = 8;
      g.beginPath();
      g.arc(42, 42, 26, 0, Math.PI * 2);
      g.stroke();
      g.lineWidth = 12;
      g.beginPath();
      g.moveTo(62, 62);
      g.lineTo(84, 84);
      g.stroke();
      g.lineWidth = 5;
      g.beginPath();
      g.moveTo(42, 26);
      g.lineTo(42, 58);
      g.moveTo(26, 42);
      g.lineTo(58, 42);
      g.stroke();
      break;
    }
    case 'crouch': {
      g.lineWidth = 11;
      for (const y of [28, 52]) {
        g.beginPath();
        g.moveTo(22, y);
        g.lineTo(48, y + 20);
        g.lineTo(74, y);
        g.stroke();
      }
      break;
    }
    case 'emote': {
      g.lineWidth = 8;
      g.beginPath();
      g.arc(48, 48, 34, 0, Math.PI * 2);
      g.stroke();
      g.beginPath();
      g.arc(36, 40, 5, 0, Math.PI * 2);
      g.arc(60, 40, 5, 0, Math.PI * 2);
      g.fill();
      g.beginPath();
      g.arc(48, 52, 18, 0.15 * Math.PI, 0.85 * Math.PI);
      g.stroke();
      break;
    }
    case 'pause': {
      g.beginPath();
      g.roundRect(24, 18, 16, 60, 5);
      g.roundRect(56, 18, 16, 60, 5);
      g.fill();
      break;
    }
    case 'score': {
      for (let i = 0; i < 3; i++) {
        g.beginPath();
        g.arc(22, 26 + i * 22, 6, 0, Math.PI * 2);
        g.fill();
        g.beginPath();
        g.roundRect(36, 21 + i * 22, 44, 10, 5);
        g.fill();
      }
      break;
    }
    case 'heart': {
      g.beginPath();
      g.moveTo(48, 84);
      g.bezierCurveTo(10, 58, 8, 30, 26, 20);
      g.bezierCurveTo(38, 14, 46, 22, 48, 30);
      g.bezierCurveTo(50, 22, 58, 14, 70, 20);
      g.bezierCurveTo(88, 30, 86, 58, 48, 84);
      g.closePath();
      g.fill();
      break;
    }
    case 'star': {
      g.beginPath();
      for (let i = 0; i < 10; i++) {
        const a = -Math.PI / 2 + (i * Math.PI) / 5;
        const r = i % 2 ? 18 : 42;
        g.lineTo(48 + Math.cos(a) * r, 52 + Math.sin(a) * r);
      }
      g.closePath();
      g.fill();
      break;
    }
    case 'trophy': {
      g.beginPath();
      g.moveTo(24, 14);
      g.lineTo(72, 14);
      g.quadraticCurveTo(72, 58, 48, 62);
      g.quadraticCurveTo(24, 58, 24, 14);
      g.fill();
      g.lineWidth = 7;
      g.beginPath();
      g.arc(24, 30, 12, Math.PI * 0.5, Math.PI * 1.5);
      g.moveTo(72, 18);
      g.arc(72, 30, 12, -Math.PI * 0.5, Math.PI * 0.5);
      g.stroke();
      g.fillRect(42, 60, 12, 14);
      g.beginPath();
      g.roundRect(28, 74, 40, 10, 3);
      g.fill();
      break;
    }
  }
  scene.textures.addCanvas(key, c);
  return key;
}
