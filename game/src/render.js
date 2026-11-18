// Starshatter Arena — canvas rendering: the neon arena, the ship, enemies,
// particles and juice. The renderer owns the scale transform (a fixed 1280x720
// logical field letterboxed into the window), pre-rendered glow sprites, and
// the parallax starfield. Screens and the HUD live in part 2 below.

import { FIELD, SHIP, PALETTE, FONT } from './config.js';
import { createRandom } from './random.js';

const TAU = Math.PI * 2;

export const SCREEN_TITLE = 'title';
export const SCREEN_PLAY = 'play';
export const SCREEN_PAUSE = 'pause';
export const SCREEN_OVER = 'over';
export const SCREEN_WIN = 'win';

function polygon(ctx, x, y, radius, sides, rotation) {
  ctx.beginPath();
  for (let i = 0; i < sides; i += 1) {
    const a = rotation + (i / sides) * TAU;
    const px = x + Math.cos(a) * radius;
    const py = y + Math.sin(a) * radius;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

function star(ctx, x, y, outer, inner, points, rotation) {
  ctx.beginPath();
  for (let i = 0; i < points * 2; i += 1) {
    const r = i % 2 === 0 ? outer : inner;
    const a = rotation + (i / (points * 2)) * TAU;
    const px = x + Math.cos(a) * r;
    const py = y + Math.sin(a) * r;
    if (i === 0) ctx.moveTo(px, py);
    else ctx.lineTo(px, py);
  }
  ctx.closePath();
}

export class Renderer {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.scale = 1;
    this.ox = 0;
    this.oy = 0;
    this.dpr = 1;
    this.glowCache = new Map();
    this.stars = this.makeStars();
    this.vignette = null;
    this.resize();
  }

  makeStars() {
    const random = createRandom(1337);
    const layers = [];
    for (let layer = 0; layer < 3; layer += 1) {
      const count = [90, 60, 34][layer];
      const stars = [];
      for (let i = 0; i < count; i += 1) {
        stars.push({
          x: random() * (FIELD.width + 200) - 100,
          y: random() * (FIELD.height + 200) - 100,
          r: 0.6 + random() * (layer + 0.8),
          tw: random() * TAU,
        });
      }
      layers.push({ stars, depth: [0.12, 0.3, 0.55][layer] });
    }
    return layers;
  }

  resize() {
    this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = window.innerWidth;
    const h = window.innerHeight;
    this.canvas.width = Math.floor(w * this.dpr);
    this.canvas.height = Math.floor(h * this.dpr);
    this.scale = Math.min(w / FIELD.width, h / FIELD.height);
    this.ox = (w - FIELD.width * this.scale) / 2;
    this.oy = (h - FIELD.height * this.scale) / 2;
    this.vignette = null;
  }

  /** Convert CSS-pixel canvas coords to logical field coords (for the mouse). */
  toLogical(px, py) {
    return { x: (px - this.ox) / this.scale, y: (py - this.oy) / this.scale };
  }

  glowSprite(color) {
    let sprite = this.glowCache.get(color);
    if (sprite) return sprite;
    const size = 64;
    const off = document.createElement('canvas');
    off.width = size;
    off.height = size;
    const c = off.getContext('2d');
    const grad = c.createRadialGradient(size / 2, size / 2, 0, size / 2, size / 2, size / 2);
    grad.addColorStop(0, color);
    grad.addColorStop(0.25, color);
    grad.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = grad;
    c.fillRect(0, 0, size, size);
    sprite = off;
    this.glowCache.set(color, sprite);
    return sprite;
  }

  drawGlow(x, y, radius, color, alpha) {
    const ctx = this.ctx;
    ctx.globalAlpha = alpha;
    ctx.drawImage(this.glowSprite(color), x - radius, y - radius, radius * 2, radius * 2);
    ctx.globalAlpha = 1;
  }

  // ---- frame -----------------------------------------------------------------

  draw(world, screen, ui, now) {
    const ctx = this.ctx;
    const w = window.innerWidth;
    const h = window.innerHeight;
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    ctx.fillStyle = PALETTE.backdrop;
    ctx.fillRect(0, 0, w, h);

    ctx.save();
    ctx.translate(this.ox, this.oy);
    ctx.scale(this.scale, this.scale);
    // Screen shake: a decaying random offset.
    if (world.shake > 0.2) {
      ctx.translate((Math.random() - 0.5) * world.shake, (Math.random() - 0.5) * world.shake);
    }
    // Clip to the arena so shake never shows the void at the edges.
    ctx.beginPath();
    ctx.rect(-30, -30, FIELD.width + 60, FIELD.height + 60);
    ctx.clip();

    this.drawBackground(world, now);
    this.drawShards(world, now);
    this.drawPowerups(world, now);
    this.drawEnemies(world, now);
    this.drawBullets(world);
    if (!world.over) this.drawShip(world, now);
    this.drawFx(world);
    this.drawFrame(world);

    if (screen === SCREEN_PLAY || screen === SCREEN_PAUSE) this.drawHud(world, ui, now);
    if (screen === SCREEN_TITLE) this.drawTitle(world, ui, now);
    else if (screen === SCREEN_PAUSE) this.drawPause(ui);
    else if (screen === SCREEN_OVER) this.drawOver(world, ui, now);
    else if (screen === SCREEN_WIN) this.drawWin(world, ui, now);

    ctx.restore();

    // Hit flash and vignette live in screen space, over everything.
    if (world.flash > 0) {
      ctx.fillStyle = `rgba(255, 46, 99, ${(world.flash * 0.28).toFixed(3)})`;
      ctx.fillRect(0, 0, w, h);
    }
    this.drawVignette(w, h);
    if (ui.input) this.drawSticks(ui.input);
  }

  drawBackground(world, now) {
    const ctx = this.ctx;
    ctx.fillStyle = '#0a0e24';
    ctx.fillRect(0, 0, FIELD.width, FIELD.height);
    // Parallax starfield, drifting against the ship's position.
    const cx = FIELD.width / 2 - world.ship.x;
    const cy = FIELD.height / 2 - world.ship.y;
    for (const layer of this.stars) {
      const ox = cx * layer.depth;
      const oy = cy * layer.depth;
      for (const s of layer.stars) {
        let x = s.x + ox;
        let y = s.y + oy;
        x = ((x + 100) % (FIELD.width + 200) + FIELD.width + 200) % (FIELD.width + 200) - 100;
        y = ((y + 100) % (FIELD.height + 200) + FIELD.height + 200) % (FIELD.height + 200) - 100;
        const twinkle = 0.55 + 0.45 * Math.sin(now * 1.7 + s.tw);
        ctx.globalAlpha = twinkle * (0.35 + layer.depth * 0.6);
        ctx.fillStyle = '#cdd7ff';
        ctx.beginPath();
        ctx.arc(x, y, s.r, 0, TAU);
        ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
    // Floor grid.
    ctx.strokeStyle = PALETTE.grid;
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let x = 80; x < FIELD.width; x += 80) {
      ctx.moveTo(x, 0);
      ctx.lineTo(x, FIELD.height);
    }
    for (let y = 80; y < FIELD.height; y += 80) {
      ctx.moveTo(0, y);
      ctx.lineTo(FIELD.width, y);
    }
    ctx.stroke();
    // A soft nebula wash, fixed in the arena.
    this.drawGlow(320, 180, 260, '#1b2a6b', 0.5);
    this.drawGlow(980, 540, 300, '#3d1655', 0.45);
  }

  drawFrame(world) {
    const ctx = this.ctx;
    ctx.strokeStyle = PALETTE.arenaEdge;
    ctx.lineWidth = 3;
    ctx.strokeRect(1.5, 1.5, FIELD.width - 3, FIELD.height - 3);
    ctx.strokeStyle = 'rgba(77, 215, 255, 0.25)';
    ctx.lineWidth = 1;
    ctx.strokeRect(6, 6, FIELD.width - 12, FIELD.height - 12);
    void world;
  }

  drawShards(world, now) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const s of world.shards) {
      const blink = s.life < 2 ? (Math.sin(now * 14) > 0 ? 1 : 0.25) : 1;
      ctx.globalAlpha = blink;
      this.drawGlow(s.x, s.y, 20, PALETTE.shard, 0.55 * blink);
      ctx.save();
      ctx.translate(s.x, s.y);
      ctx.rotate(now * 2.4 + s.seed);
      ctx.fillStyle = PALETTE.shard;
      ctx.beginPath();
      ctx.moveTo(0, -8);
      ctx.lineTo(5.5, 0);
      ctx.lineTo(0, 8);
      ctx.lineTo(-5.5, 0);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#fffbe0';
      ctx.beginPath();
      ctx.moveTo(0, -4);
      ctx.lineTo(2.5, 0);
      ctx.lineTo(0, 4);
      ctx.lineTo(-2.5, 0);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.restore();
    ctx.globalAlpha = 1;
  }

  drawPowerups(world, now) {
    const ctx = this.ctx;
    const colors = { spread: '#4dd7ff', rapid: '#ffe45d', shield: '#7bed9f', bomb: '#ff5d5d', magnet: '#c86bff' };
    for (const p of world.powerups) {
      const pulse = 1 + 0.12 * Math.sin(now * 4 + p.seed);
      const blink = p.life < 2 ? (Math.sin(now * 14) > 0 ? 1 : 0.3) : 1;
      const color = colors[p.kind];
      ctx.save();
      ctx.globalAlpha = blink;
      this.drawGlow(p.x, p.y, 34 * pulse, color, 0.5);
      ctx.translate(p.x, p.y);
      ctx.scale(pulse, pulse);
      ctx.fillStyle = 'rgba(7, 10, 24, 0.9)';
      ctx.strokeStyle = color;
      ctx.lineWidth = 2.5;
      ctx.beginPath();
      ctx.arc(0, 0, 16, 0, TAU);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = color;
      ctx.strokeStyle = color;
      if (p.kind === 'spread') {
        for (const a of [-0.5, 0, 0.5]) {
          ctx.save();
          ctx.rotate(a);
          ctx.beginPath();
          ctx.moveTo(0, -9);
          ctx.lineTo(3.4, -1);
          ctx.lineTo(-3.4, -1);
          ctx.closePath();
          ctx.fill();
          ctx.restore();
        }
      } else if (p.kind === 'rapid') {
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(-6, -8);
        ctx.lineTo(0, -8);
        ctx.lineTo(-3, 0);
        ctx.lineTo(3, 0);
        ctx.lineTo(-2, 8);
        ctx.stroke();
      } else if (p.kind === 'shield') {
        ctx.lineWidth = 2.5;
        polygon(ctx, 0, 0, 9, 6, 0);
        ctx.stroke();
      } else if (p.kind === 'bomb') {
        star(ctx, 0, 0, 10, 4, 8, now);
        ctx.fill();
      } else {
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.arc(0, -1, 7, Math.PI, 0, false);
        ctx.moveTo(7, -1);
        ctx.lineTo(7, 6);
        ctx.moveTo(-7, -1);
        ctx.lineTo(-7, 6);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  drawEnemies(world, now) {
    const ctx = this.ctx;
    for (const e of world.enemies) {
      const spawnScale = e.spawnT > 0 ? 1 - e.spawnT / 0.8 : 1;
      const alpha = e.spawnT > 0 ? 0.35 + 0.65 * (1 - e.spawnT / 0.8) : 1;
      ctx.save();
      ctx.translate(e.x, e.y);
      ctx.scale(Math.max(0.2, spawnScale), Math.max(0.2, spawnScale));
      ctx.globalAlpha = alpha;
      this.drawGlow(0, 0, e.radius * 1.9, e.color, 0.35);
      ctx.fillStyle = e.color;
      ctx.strokeStyle = e.color;
      if (e.kind === 'chaser' || e.kind === 'mini') {
        const aim = Math.atan2(world.ship.y - e.y, world.ship.x - e.x);
        ctx.rotate(aim);
        ctx.globalAlpha = alpha * 0.28;
        ctx.beginPath();
        ctx.moveTo(e.radius + 4, 0);
        ctx.lineTo(-e.radius * 0.8, e.radius * 0.8);
        ctx.lineTo(-e.radius * 0.4, 0);
        ctx.lineTo(-e.radius * 0.8, -e.radius * 0.8);
        ctx.closePath();
        ctx.fill();
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 2.5;
        ctx.stroke();
      } else if (e.kind === 'weaver') {
        ctx.rotate(e.rot);
        ctx.globalAlpha = alpha * 0.3;
        polygon(ctx, 0, 0, e.radius, 4, 0);
        ctx.fill();
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 2.5;
        ctx.stroke();
      } else if (e.kind === 'tank') {
        ctx.rotate(e.rot * 0.4);
        ctx.globalAlpha = alpha * 0.3;
        polygon(ctx, 0, 0, e.radius, 6, 0);
        ctx.fill();
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 3;
        ctx.stroke();
        ctx.rotate(-e.rot * 0.9);
        ctx.lineWidth = 2;
        polygon(ctx, 0, 0, e.radius * 0.55, 6, 0);
        ctx.stroke();
        // Health pips.
        ctx.rotate(e.rot * 0.5);
        for (let i = 0; i < e.maxHp; i += 1) {
          ctx.fillStyle = i < e.hp ? e.color : 'rgba(255,255,255,0.18)';
          ctx.fillRect(-e.radius + 5 + i * ((e.radius * 2 - 10) / e.maxHp), -e.radius - 12, (e.radius * 2 - 10) / e.maxHp - 3, 4);
        }
      } else if (e.kind === 'splitter') {
        ctx.rotate(e.rot);
        ctx.globalAlpha = alpha * 0.3;
        polygon(ctx, 0, 0, e.radius, 4, Math.PI / 4);
        ctx.fill();
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 2.5;
        ctx.stroke();
        polygon(ctx, 0, 0, e.radius * 0.5, 4, Math.PI / 4);
        ctx.stroke();
      } else if (e.kind === 'sniper') {
        const aim = Math.atan2(world.ship.y - e.y, world.ship.x - e.x);
        ctx.rotate(aim);
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(0, 0);
        ctx.lineTo(e.radius + 10, 0);
        ctx.stroke();
        ctx.rotate(-aim + e.rot * 0.3);
        ctx.globalAlpha = alpha * 0.3;
        polygon(ctx, 0, 0, e.radius, 5, 0);
        ctx.fill();
        ctx.globalAlpha = alpha;
        ctx.lineWidth = 2.5;
        ctx.stroke();
      } else if (e.kind === 'boss') {
        this.drawBossShape(e, world, now, alpha);
      }
      // Hit flash: the shape burns white for a beat.
      if (e.flash > 0 && e.kind !== 'boss') {
        ctx.globalAlpha = Math.min(1, e.flash) * alpha;
        ctx.fillStyle = '#ffffff';
        ctx.fill();
      }
      ctx.restore();
    }
  }

  drawBossShape(boss, world, now, alpha) {
    const ctx = this.ctx;
    const telegraphing = boss.telegraph > 0;
    if (telegraphing) {
      const pulse = 0.5 + 0.5 * Math.sin(now * 24);
      this.drawGlow(0, 0, boss.radius * 3, '#ff2e63', 0.4 + 0.4 * pulse);
    }
    ctx.save();
    ctx.rotate(boss.rot);
    ctx.globalAlpha = alpha * 0.3;
    ctx.fillStyle = boss.color;
    star(ctx, 0, 0, boss.radius + 8, boss.radius * 0.72, 8, 0);
    ctx.fill();
    ctx.globalAlpha = alpha;
    ctx.lineWidth = 3.5;
    ctx.strokeStyle = boss.color;
    ctx.stroke();
    ctx.restore();
    ctx.save();
    ctx.rotate(-boss.rot * 1.6);
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ff8fab';
    polygon(ctx, 0, 0, boss.radius * 0.62, 8, 0);
    ctx.stroke();
    ctx.restore();
    // Core: bright, beating.
    const beat = 1 + 0.1 * Math.sin(now * 5);
    this.drawGlow(0, 0, boss.radius * 0.55 * beat, '#ffffff', 0.55);
    ctx.fillStyle = '#fff0f3';
    ctx.beginPath();
    ctx.arc(0, 0, boss.radius * 0.26 * beat, 0, TAU);
    ctx.fill();
    if (boss.flash > 0) {
      ctx.globalAlpha = Math.min(1, boss.flash) * alpha;
      ctx.fillStyle = '#ffffff';
      star(ctx, 0, 0, boss.radius + 8, boss.radius * 0.72, 8, boss.rot);
      ctx.fill();
    }
    void world;
  }

  drawBullets(world) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const b of world.bullets) {
      this.drawGlow(b.x, b.y, 14, PALETTE.bullet, 0.8);
      ctx.strokeStyle = '#ffffff';
      ctx.lineWidth = 3;
      ctx.beginPath();
      ctx.moveTo(b.x - b.vx * 0.016, b.y - b.vy * 0.016);
      ctx.lineTo(b.x, b.y);
      ctx.stroke();
    }
    for (const b of world.enemyBullets) {
      const pulse = 1 + 0.15 * Math.sin(world.time * 10 + b.x);
      this.drawGlow(b.x, b.y, 18 * pulse, '#ff2e63', 0.75);
      ctx.fillStyle = '#ffd6de';
      ctx.beginPath();
      ctx.arc(b.x, b.y, b.radius * 0.6, 0, TAU);
      ctx.fill();
    }
    ctx.restore();
  }

  drawShip(world, now) {
    const ctx = this.ctx;
    const ship = world.ship;
    // Invulnerability blink.
    if (ship.invuln > 0 && Math.sin(now * 30) > 0.2) return;
    ctx.save();
    ctx.translate(ship.x, ship.y);
    this.drawGlow(0, 0, 34, PALETTE.ship, 0.5);
    // Thruster flame.
    const flame = 10 + ship.thrust * 12 + Math.sin(now * 31) * 3 + Math.random() * 3;
    if (ship.thrust > 0.05) {
      ctx.save();
      ctx.rotate(ship.angle);
      const grad = ctx.createLinearGradient(-10, 0, -10 - flame - 8, 0);
      grad.addColorStop(0, 'rgba(174, 243, 255, 0.95)');
      grad.addColorStop(0.5, 'rgba(77, 215, 255, 0.7)');
      grad.addColorStop(1, 'rgba(77, 215, 255, 0)');
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.moveTo(-10, -5);
      ctx.lineTo(-10 - flame, 0);
      ctx.lineTo(-10, 5);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
    }
    ctx.rotate(ship.angle);
    // Hull: a sleek dart.
    ctx.fillStyle = PALETTE.ship;
    ctx.beginPath();
    ctx.moveTo(20, 0);
    ctx.lineTo(-12, 12);
    ctx.lineTo(-6, 0);
    ctx.lineTo(-12, -12);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = '#0a0e24';
    ctx.beginPath();
    ctx.moveTo(12, 0);
    ctx.lineTo(-6, 6);
    ctx.lineTo(-3, 0);
    ctx.lineTo(-6, -6);
    ctx.closePath();
    ctx.fill();
    ctx.fillStyle = PALETTE.shipCore;
    ctx.beginPath();
    ctx.arc(4, 0, 3.4, 0, TAU);
    ctx.fill();
    ctx.restore();
    // Shield bubble.
    if (ship.shield) {
      ctx.save();
      ctx.translate(ship.x, ship.y);
      ctx.strokeStyle = `rgba(123, 237, 159, ${0.55 + 0.25 * Math.sin(now * 4)})`;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(0, 0, 26, 0, TAU);
      ctx.stroke();
      ctx.rotate(now * 1.2);
      ctx.beginPath();
      ctx.arc(0, 0, 26, 0, 1.1);
      ctx.stroke();
      ctx.beginPath();
      ctx.arc(0, 0, 26, Math.PI, Math.PI + 1.1);
      ctx.stroke();
      ctx.restore();
    }
  }

  drawFx(world) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalCompositeOperation = 'lighter';
    for (const p of world.particles) {
      const t = p.life / p.maxLife;
      this.drawGlow(p.x, p.y, p.size * 3.2 * t + 2, p.color, 0.7 * t);
    }
    ctx.restore();
    for (const r of world.rings) {
      const t = r.life / r.maxLife;
      ctx.globalAlpha = t;
      ctx.strokeStyle = r.color;
      ctx.lineWidth = 2 + 3 * t;
      ctx.beginPath();
      ctx.arc(r.x, r.y, r.r, 0, TAU);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;
    for (const f of world.floaters) {
      const t = f.life / f.maxLife;
      ctx.globalAlpha = Math.min(1, t * 2);
      ctx.font = `700 ${f.size}px ${FONT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillStyle = f.color;
      ctx.fillText(f.text, f.x, f.y);
    }
    ctx.globalAlpha = 1;
  }

  // ---- HUD & screens ---------------------------------------------------------

  text(str, x, y, { size = 20, color = PALETTE.text, align = 'center', weight = 700, alpha = 1, spacing = 0 } = {}) {
    const ctx = this.ctx;
    ctx.save();
    ctx.globalAlpha = alpha;
    ctx.font = `${weight} ${size}px ${FONT}`;
    ctx.textAlign = align;
    ctx.textBaseline = 'middle';
    if (spacing) {
      try { ctx.letterSpacing = `${spacing}px`; } catch { /* older canvas: ignore */ }
    }
    ctx.fillStyle = color;
    ctx.fillText(str, x, y);
    ctx.restore();
  }

  panel(x, y, w, h, edge = PALETTE.panelEdge) {
    const ctx = this.ctx;
    ctx.save();
    ctx.fillStyle = PALETTE.panel;
    ctx.strokeStyle = edge;
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (ctx.roundRect) ctx.roundRect(x, y, w, h, 14);
    else ctx.rect(x, y, w, h);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }

  heartPath(ctx, x, y, s) {
    ctx.beginPath();
    ctx.moveTo(x, y + s * 0.85);
    ctx.bezierCurveTo(x - s * 1.35, y - s * 0.1, x - s * 0.7, y - s, x, y - s * 0.35);
    ctx.bezierCurveTo(x + s * 0.7, y - s, x + s * 1.35, y - s * 0.1, x, y + s * 0.85);
    ctx.closePath();
  }

  drawHud(world, ui, now) {
    const ctx = this.ctx;
    // Score block, top-left.
    this.text('SCORE', 28, 30, { size: 13, color: PALETTE.muted, align: 'left', spacing: 3 });
    this.text(world.score.toLocaleString('en-US'), 28, 58, { size: 34, align: 'left', weight: 800 });
    if (ui.best > 0) {
      this.text(`BEST ${ui.best.toLocaleString('en-US')}`, 28, 86, { size: 13, color: PALETTE.muted, align: 'left', spacing: 1 });
    }
    // Combo badge + timer.
    if (world.mult > 1) {
      const pulse = 1 + 0.06 * Math.sin(now * 8);
      ctx.save();
      ctx.translate(28, 116);
      ctx.scale(pulse, pulse);
      this.text(`COMBO x${world.mult}`, 0, 0, { size: 19, color: '#ff9f43', align: 'left' });
      ctx.restore();
      const w = 130 * Math.max(0, world.chainTimer / 3.5);
      ctx.fillStyle = 'rgba(255, 159, 67, 0.25)';
      ctx.fillRect(28, 130, 130, 5);
      ctx.fillStyle = '#ff9f43';
      ctx.fillRect(28, 130, w, 5);
    }
    // Hearts, top-right.
    for (let i = 0; i < SHIP.hearts; i += 1) {
      const x = FIELD.width - 34 - i * 34;
      const y = 40;
      this.heartPath(ctx, x, y, 13);
      if (i < world.ship.hearts) {
        ctx.fillStyle = '#ff2e63';
        ctx.fill();
      } else {
        ctx.strokeStyle = 'rgba(255, 46, 99, 0.4)';
        ctx.lineWidth = 2;
        ctx.stroke();
      }
    }
    // Wave, top-center.
    const remaining = world.enemies.length + world.spawnQueue.length;
    const waveLabel = world.wave === 0 ? 'GET READY' : `WAVE ${world.wave}`;
    this.text(waveLabel, FIELD.width / 2, 30, { size: 16, color: PALETTE.muted, spacing: 4 });
    if (world.waveState === 'fighting' && !world.boss) {
      this.text(`${remaining} HOSTILE${remaining === 1 ? '' : 'S'}`, FIELD.width / 2, 52, { size: 13, color: PALETTE.muted, spacing: 2 });
    }
    // Boss bar.
    if (world.boss) {
      const bw = 420;
      const bx = FIELD.width / 2 - bw / 2;
      const by = 62;
      this.text('VOID WARDEN', FIELD.width / 2, by - 4, { size: 13, color: '#ff8fab', spacing: 4 });
      ctx.fillStyle = 'rgba(255, 46, 99, 0.22)';
      ctx.fillRect(bx, by + 8, bw, 9);
      const frac = Math.max(0, world.boss.hp / world.boss.maxHp);
      ctx.fillStyle = '#ff2e63';
      ctx.fillRect(bx, by + 8, bw * frac, 9);
      ctx.strokeStyle = 'rgba(255, 143, 171, 0.6)';
      ctx.lineWidth = 1;
      ctx.strokeRect(bx, by + 8, bw, 9);
    }
    // Active powerup timers, bottom-left.
    const timers = [];
    if (world.ship.spread > 0) timers.push(['SPREAD', world.ship.spread, 12, '#4dd7ff']);
    if (world.ship.rapid > 0) timers.push(['RAPID', world.ship.rapid, 10, '#ffe45d']);
    if (world.ship.magnet > 0) timers.push(['MAGNET', world.ship.magnet, 10, '#c86bff']);
    if (world.ship.shield) timers.push(['SHIELD', 1, 1, '#7bed9f']);
    timers.forEach(([label, left, total, color], i) => {
      const y = FIELD.height - 28 - i * 24;
      this.text(label, 28, y, { size: 13, color, align: 'left', spacing: 2 });
      ctx.fillStyle = 'rgba(255,255,255,0.14)';
      ctx.fillRect(110, y - 4, 90, 7);
      ctx.fillStyle = color;
      ctx.fillRect(110, y - 4, 90 * Math.max(0, left / total), 7);
    });
    // Wave banner between waves.
    if (world.waveState === 'between' && !world.over && !world.won) {
      const next = world.wave + 1;
      const isBoss = next % 5 === 0;
      const label = isBoss ? 'BOSS INCOMING' : `WAVE ${next}`;
      const t = 1 - world.betweenTimer / 2.6;
      const alpha = t < 0.15 ? t / 0.15 : t > 0.85 ? (1 - t) / 0.15 : 1;
      const scaleIn = 0.9 + 0.1 * Math.min(1, t * 3);
      ctx.save();
      ctx.translate(FIELD.width / 2, 240);
      ctx.scale(scaleIn, scaleIn);
      this.text(label, 0, 0, { size: isBoss ? 54 : 46, color: isBoss ? '#ff2e63' : PALETTE.text, alpha: Math.max(0, alpha), spacing: 8, weight: 800 });
      ctx.restore();
    }
    // Controls hint, bottom-right (fades once the run is underway).
    if (ui.showHint) {
      this.text('WASD MOVE · MOUSE AIM · CLICK / SPACE FIRE · P PAUSE · M MUTE', FIELD.width - 28, FIELD.height - 24, { size: 12, color: PALETTE.muted, align: 'right', spacing: 1 });
    }
  }

  drawTitle(world, ui, now) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(7, 10, 24, 0.52)';
    ctx.fillRect(0, 0, FIELD.width, FIELD.height);
    const grad = ctx.createLinearGradient(FIELD.width / 2 - 360, 0, FIELD.width / 2 + 360, 0);
    grad.addColorStop(0, '#4dd7ff');
    grad.addColorStop(0.5, '#eef1ff');
    grad.addColorStop(1, '#ff2e63');
    ctx.save();
    ctx.font = `800 88px ${FONT}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    try { ctx.letterSpacing = '6px'; } catch { /* ignore */ }
    ctx.fillStyle = grad;
    ctx.fillText('STARSHATTER', FIELD.width / 2, 168);
    ctx.restore();
    this.text('A R E N A', FIELD.width / 2, 226, { size: 30, color: PALETTE.muted, spacing: 18, weight: 600 });
    this.text('Blast the swarm. Chain the combo. Slay the Warden.', FIELD.width / 2, 272, { size: 19, color: PALETTE.text, weight: 500 });

    this.panel(FIELD.width / 2 - 330, 312, 660, 148, 'rgba(58, 74, 143, 0.9)');
    const rows = [
      ['MOVE', 'WASD / ARROWS  ·  LEFT STICK'],
      ['AIM + FIRE', 'MOUSE + CLICK / SPACE  ·  RIGHT STICK'],
      ['GOAL', 'SURVIVE 10 WAVES — KILL THE WAVE-10 BOSS'],
    ];
    rows.forEach(([label, body], i) => {
      const y = 340 + i * 40;
      this.text(label, FIELD.width / 2 - 300, y, { size: 15, color: '#4dd7ff', align: 'left', spacing: 2 });
      this.text(body, FIELD.width / 2 - 180, y, { size: 15, color: PALETTE.text, align: 'left', weight: 500 });
    });
    this.text('DROPS:  SPREAD SHOT  ·  RAPID FIRE  ·  SHIELD  ·  NOVA BOMB  ·  SHARD MAGNET', FIELD.width / 2, 492, { size: 14, color: '#7bed9f', spacing: 1 });
    if (ui.best > 0) {
      this.text(`BEST  ${ui.best.toLocaleString('en-US')}`, FIELD.width / 2, 530, { size: 17, color: '#ffe45d', spacing: 2 });
    }
    const blink = 0.7 + 0.3 * Math.sin(now * 3.2);
    this.text('CLICK OR PRESS ENTER TO FLY', FIELD.width / 2, 592, { size: 22, color: PALETTE.text, alpha: blink, spacing: 4 });
    this.text('P PAUSE · M MUTE', FIELD.width / 2, 648, { size: 13, color: PALETTE.muted, spacing: 3 });
    void world;
  }

  drawPause(ui) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(7, 10, 24, 0.66)';
    ctx.fillRect(0, 0, FIELD.width, FIELD.height);
    this.text('PAUSED', FIELD.width / 2, 310, { size: 52, spacing: 10, weight: 800 });
    this.text('P / ESC — RESUME', FIELD.width / 2, 372, { size: 18, color: PALETTE.muted, spacing: 2 });
    this.text('M — SOUND ' + (ui.muted ? 'OFF' : 'ON'), FIELD.width / 2, 402, { size: 18, color: PALETTE.muted, spacing: 2 });
  }

  drawStats(world, ui, y0) {
    const rows = [
      ['SCORE', world.score.toLocaleString('en-US')],
      ['BEST', Math.max(ui.best, world.score).toLocaleString('en-US')],
      ['WAVE REACHED', String(Math.max(1, world.wave))],
      ['KILLS', String(world.kills)],
      ['SHARDS', String(world.shardsCollected)],
    ];
    rows.forEach(([label, value], i) => {
      const y = y0 + i * 34;
      this.text(label, FIELD.width / 2 - 130, y, { size: 16, color: PALETTE.muted, align: 'left', spacing: 2 });
      this.text(value, FIELD.width / 2 + 130, y, { size: 16, align: 'right' });
    });
    return y0 + rows.length * 34;
  }

  drawOver(world, ui, now) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(7, 10, 24, 0.68)';
    ctx.fillRect(0, 0, FIELD.width, FIELD.height);
    this.text('SHIP DESTROYED', FIELD.width / 2, 218, { size: 54, color: '#ff2e63', spacing: 6, weight: 800 });
    if (ui.newBest) {
      this.text('NEW BEST!', FIELD.width / 2, 262, { size: 20, color: '#ffe45d', spacing: 3 });
    }
    const endY = this.drawStats(world, ui, 306);
    if (world.overTimer > 0.6) {
      const blink = 0.7 + 0.3 * Math.sin(now * 3.2);
      this.text('ENTER OR CLICK — FLY AGAIN', FIELD.width / 2, endY + 30, { size: 21, alpha: blink, spacing: 3 });
    }
  }

  drawWin(world, ui, now) {
    const ctx = this.ctx;
    ctx.fillStyle = 'rgba(7, 10, 24, 0.62)';
    ctx.fillRect(0, 0, FIELD.width, FIELD.height);
    this.text('SECTOR CLEARED!', FIELD.width / 2, 208, { size: 56, color: '#ffe45d', spacing: 6, weight: 800 });
    this.text('The Void Warden is shattered. The arena is yours.', FIELD.width / 2, 256, { size: 18, color: PALETTE.text, weight: 500 });
    if (ui.newBest) {
      this.text('NEW BEST!', FIELD.width / 2, 288, { size: 20, color: '#ffe45d', spacing: 3 });
    }
    const endY = this.drawStats(world, ui, 322);
    const blink = 0.7 + 0.3 * Math.sin(now * 3.2);
    this.text('ENTER — KEEP FLYING (ENDLESS)', FIELD.width / 2, endY + 26, { size: 20, alpha: blink, spacing: 2 });
    this.text('CLICK — NEW RUN', FIELD.width / 2, endY + 58, { size: 16, color: PALETTE.muted, spacing: 2 });
  }

  drawVignette(w, h) {
    const ctx = this.ctx;
    if (!this.vignette || this.vignette.w !== w || this.vignette.h !== h) {
      const grad = ctx.createRadialGradient(w / 2, h / 2, Math.min(w, h) * 0.42, w / 2, h / 2, Math.max(w, h) * 0.75);
      grad.addColorStop(0, 'rgba(0,0,0,0)');
      grad.addColorStop(1, 'rgba(2,3,12,0.55)');
      this.vignette = { w, h, grad };
    }
    ctx.fillStyle = this.vignette.grad;
    ctx.fillRect(0, 0, w, h);
  }

  drawSticks(input) {
    const ctx = this.ctx;
    const drawStick = (stick, color) => {
      if (!stick) return;
      const dx = stick.x - stick.ox;
      const dy = stick.y - stick.oy;
      const len = Math.hypot(dx, dy);
      const cl = Math.min(56, len);
      const kx = len > 0 ? stick.ox + (dx / len) * cl : stick.ox;
      const ky = len > 0 ? stick.oy + (dy / len) * cl : stick.oy;
      ctx.globalAlpha = 0.3;
      ctx.strokeStyle = color;
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(stick.ox, stick.oy, 56, 0, TAU);
      ctx.stroke();
      ctx.globalAlpha = 0.55;
      ctx.fillStyle = color;
      ctx.beginPath();
      ctx.arc(kx, ky, 26, 0, TAU);
      ctx.fill();
      ctx.globalAlpha = 1;
    };
    drawStick(input.moveStick, '#4dd7ff');
    drawStick(input.aimStick, '#ff9f43');
  }
}
