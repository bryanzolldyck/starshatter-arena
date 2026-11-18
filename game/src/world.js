// Starshatter Arena — the simulation: ship, enemies, waves, boss, shards,
// powerups, particles and scoring. Pure logic on a fixed timestep; rendering
// lives in render.js. All randomness flows through the seeded stream, so the
// same seed and inputs always replay the same game.

import { FIELD, SHIP, ENEMY, BOSS, WAVES, COMBO, SHARD, POWERUP, PARTICLES, FLOATERS } from './config.js';
import { createRandom } from './random.js';

const TAU = Math.PI * 2;

function dist(ax, ay, bx, by) {
  return Math.hypot(ax - bx, ay - by);
}

function clampToField(entity, radius) {
  if (entity.x < radius) { entity.x = radius; entity.vx = Math.abs(entity.vx) * 0.4; }
  if (entity.x > FIELD.width - radius) { entity.x = FIELD.width - radius; entity.vx = -Math.abs(entity.vx) * 0.4; }
  if (entity.y < radius) { entity.y = radius; entity.vy = Math.abs(entity.vy) * 0.4; }
  if (entity.y > FIELD.height - radius) { entity.y = FIELD.height - radius; entity.vy = -Math.abs(entity.vy) * 0.4; }
}

export class World {
  constructor(seed) {
    this.seed = seed;
    this.events = [];
    this.reset();
  }

  reset() {
    this.random = createRandom(this.seed);
    this.time = 0;
    this.ship = {
      x: FIELD.width / 2, y: FIELD.height / 2, vx: 0, vy: 0,
      angle: -Math.PI / 2, hearts: SHIP.hearts, invuln: 0, fireTimer: 0,
      spread: 0, rapid: 0, shield: false, magnet: 0, thrust: 0,
    };
    this.bullets = [];
    this.enemyBullets = [];
    this.enemies = [];
    this.shards = [];
    this.powerups = [];
    this.particles = [];
    this.floaters = [];
    this.rings = [];
    this.score = 0;
    this.chain = 0;
    this.chainTimer = 0;
    this.mult = 1;
    this.kills = 0;
    this.shardsCollected = 0;
    this.wave = 0;
    this.waveState = 'between';
    this.betweenTimer = 1.4;
    this.spawnQueue = [];
    this.spawnTimer = 0;
    this.boss = null;
    this.bossIndex = 0;
    this.shake = 0;
    this.flash = 0;
    this.over = false;
    this.won = false;
    this.overTimer = 0;
    this.events.length = 0;
  }

  emit(type, data = null) {
    this.events.push({ type, data });
  }

  drainEvents() {
    const out = this.events;
    this.events = [];
    return out;
  }

  // ---- waves ---------------------------------------------------------------

  /** Composition for a normal wave: budget grows, new types unlock. */
  composition(n) {
    const budget = WAVES.budgetBase + WAVES.budgetPerWave * (n - 1);
    const queue = [];
    for (let i = 0; i < budget; i += 1) {
      const r = this.random();
      let kind = 'chaser';
      if (n >= 6 && r > 0.86) kind = 'tank';
      else if (n >= 4 && r > 0.72) kind = 'sniper';
      else if (n >= 3 && r > 0.58) kind = 'splitter';
      else if (n >= 2 && r > 0.38) kind = 'weaver';
      queue.push(kind);
    }
    return queue;
  }

  startWave(n) {
    this.wave = n;
    this.waveState = 'fighting';
    this.spawnTimer = 0.2;
    if (n % WAVES.bossEvery === 0) {
      this.bossIndex += 1;
      this.spawnBoss();
      // A trickle of adds keeps the boss fight busy.
      const adds = Math.min(8, 3 + n);
      this.spawnQueue = [];
      for (let i = 0; i < adds; i += 1) this.spawnQueue.push(this.random() < 0.6 ? 'chaser' : 'mini');
      this.emit('bossspawn', { wave: n });
    } else {
      this.spawnQueue = this.composition(n);
      this.emit('wave', { wave: n });
    }
  }

  /** Jump straight to a wave (screenshot staging only): the real wave state, played forward. */
  jumpToWave(n) {
    this.startWave(n);
  }

  edgeSpawnPoint(minPlayerDist) {
    for (let tries = 0; tries < 12; tries += 1) {
      const side = Math.floor(this.random() * 4);
      const t = this.random();
      let x;
      let y;
      if (side === 0) { x = t * FIELD.width; y = 30; }
      else if (side === 1) { x = t * FIELD.width; y = FIELD.height - 30; }
      else if (side === 2) { x = 30; y = t * FIELD.height; }
      else { x = FIELD.width - 30; y = t * FIELD.height; }
      if (dist(x, y, this.ship.x, this.ship.y) >= minPlayerDist) return { x, y };
    }
    return { x: 40, y: 40 };
  }

  spawnEnemy(kind, x = null, y = null) {
    const spec = ENEMY[kind];
    const point = x === null ? this.edgeSpawnPoint(280) : { x, y };
    const enemy = {
      kind,
      x: point.x, y: point.y, vx: 0, vy: 0,
      hp: spec.hp, maxHp: spec.hp, radius: spec.radius, speed: spec.speed,
      score: spec.score, color: spec.color,
      seed: this.random() * TAU,
      rot: this.random() * TAU,
      rotSpeed: (this.random() - 0.5) * 2.4,
      flash: 0, spawnT: 0.45, fireTimer: 1 + this.random(),
      phase: 0, phaseTimer: 0, telegraph: 0,
    };
    this.enemies.push(enemy);
    return enemy;
  }

  spawnBoss() {
    const spec = ENEMY.boss;
    const hp = spec.hp + BOSS.hpPerIndex * (this.bossIndex - 1);
    const point = this.edgeSpawnPoint(420);
    const boss = {
      kind: 'boss',
      x: point.x, y: point.y, vx: 0, vy: 0,
      hp, maxHp: hp, radius: spec.radius, speed: spec.speed,
      score: spec.score, color: spec.color,
      seed: this.random() * TAU, rot: 0, rotSpeed: 0.5,
      flash: 0, spawnT: 0.8, fireTimer: 1.2,
      phase: 'radial', phaseTimer: 3.2, telegraph: 0, spiralAngle: 0,
    };
    this.boss = boss;
    this.enemies.push(boss);
    this.burst(boss.x, boss.y, boss.color, 26, 260);
    this.ring(boss.x, boss.y, boss.color, 190);
    return boss;
  }

  // ---- effects ---------------------------------------------------------------

  burst(x, y, color, count, speed) {
    for (let i = 0; i < count; i += 1) {
      if (this.particles.length >= PARTICLES.max) return;
      const angle = this.random() * TAU;
      const v = speed * (0.25 + this.random() * 0.95);
      const life = 0.35 + this.random() * 0.5;
      this.particles.push({
        x, y,
        vx: Math.cos(angle) * v, vy: Math.sin(angle) * v,
        life, maxLife: life,
        size: 2 + this.random() * 3.5,
        color, drag: 3.2,
      });
    }
  }

  ring(x, y, color, maxR) {
    this.rings.push({ x, y, r: 8, maxR, life: 0.45, maxLife: 0.45, color });
  }

  floater(x, y, text, color, size = 17) {
    if (this.floaters.length >= FLOATERS.max) this.floaters.shift();
    this.floaters.push({ x, y, text, color, size, life: 0.9, maxLife: 0.9 });
  }

  addShake(amount) {
    this.shake = Math.min(26, this.shake + amount);
  }

  addScore(base, x, y, label = null) {
    const gained = base * this.mult;
    this.score += gained;
    this.floater(x, y, label || `+${gained}`, '#ffe45d');
    return gained;
  }

  dropShards(x, y, count) {
    for (let i = 0; i < count; i += 1) {
      const angle = this.random() * TAU;
      const v = 60 + this.random() * 130;
      this.shards.push({
        x, y,
        vx: Math.cos(angle) * v, vy: Math.sin(angle) * v,
        life: SHARD.life, seed: this.random() * TAU,
      });
    }
  }

  maybeDropPowerup(x, y) {
    if (this.random() > POWERUP.dropChance) return;
    const kinds = ['spread', 'rapid', 'shield', 'bomb', 'magnet'];
    const kind = kinds[Math.floor(this.random() * kinds.length)];
    this.powerups.push({ kind, x, y, life: POWERUP.life, seed: this.random() * TAU });
  }

  // ---- main step -----------------------------------------------------------

  /** Advance the simulation one fixed step. `input` is {mx, my, aimX, aimY, firing}. */
  step(dt, input) {
    this.time += dt;
    this.shake = Math.max(0, this.shake - dt * 34);
    this.flash = Math.max(0, this.flash - dt * 2.4);

    if (this.over || this.won) {
      this.overTimer += dt;
      this.updateFx(dt);
      return;
    }

    const ship = this.ship;
    ship.invuln = Math.max(0, ship.invuln - dt);
    ship.spread = Math.max(0, ship.spread - dt);
    ship.rapid = Math.max(0, ship.rapid - dt);
    ship.magnet = Math.max(0, ship.magnet - dt);
    if (this.chainTimer > 0) {
      this.chainTimer -= dt;
      if (this.chainTimer <= 0) {
        this.chain = 0;
        this.mult = 1;
      }
    }

    // Ship movement: snappy acceleration with drag, clamped to the arena.
    ship.vx += input.mx * SHIP.accel * dt;
    ship.vy += input.my * SHIP.accel * dt;
    const dragK = Math.max(0, 1 - SHIP.drag * dt);
    ship.vx *= dragK;
    ship.vy *= dragK;
    const speed = Math.hypot(ship.vx, ship.vy);
    if (speed > SHIP.maxSpeed) {
      ship.vx = (ship.vx / speed) * SHIP.maxSpeed;
      ship.vy = (ship.vy / speed) * SHIP.maxSpeed;
    }
    ship.x += ship.vx * dt;
    ship.y += ship.vy * dt;
    clampToField(ship, SHIP.radius);
    ship.angle = Math.atan2(input.aimY, input.aimX);
    ship.thrust = Math.min(1, Math.hypot(input.mx, input.my));
    if (ship.thrust > 0.1 && this.random() < 0.6) {
      const back = ship.angle + Math.PI;
      this.particles.push({
        x: ship.x + Math.cos(back) * 14, y: ship.y + Math.sin(back) * 14,
        vx: Math.cos(back) * 120 + (this.random() - 0.5) * 40,
        vy: Math.sin(back) * 120 + (this.random() - 0.5) * 40,
        life: 0.22, maxLife: 0.22, size: 2.5, color: '#4dd7ff', drag: 2,
      });
    }

    // Firing.
    ship.fireTimer -= dt;
    if (input.firing && ship.fireTimer <= 0) {
      const interval = ship.rapid > 0 ? SHIP.fireInterval * 0.55 : SHIP.fireInterval;
      ship.fireTimer = interval;
      const offsets = ship.spread > 0 ? [-0.18, 0, 0.18] : [0];
      for (const off of offsets) {
        const a = ship.angle + off;
        this.bullets.push({
          x: ship.x + Math.cos(a) * 18, y: ship.y + Math.sin(a) * 18,
          vx: Math.cos(a) * SHIP.bulletSpeed, vy: Math.sin(a) * SHIP.bulletSpeed,
          life: SHIP.bulletLife,
        });
      }
      ship.vx -= Math.cos(ship.angle) * 14;
      ship.vy -= Math.sin(ship.angle) * 14;
      this.emit('shoot');
    }

    // Wave flow.
    if (this.waveState === 'between') {
      this.betweenTimer -= dt;
      if (this.betweenTimer <= 0) this.startWave(this.wave + 1);
    } else if (this.waveState === 'fighting') {
      if (this.spawnQueue.length > 0) {
        this.spawnTimer -= dt;
        if (this.spawnTimer <= 0) {
          this.spawnTimer = Math.max(0.22, WAVES.spawnInterval - this.wave * 0.03);
          this.spawnEnemy(this.spawnQueue.shift());
        }
      } else if (this.enemies.length === 0) {
        this.waveState = 'between';
        this.betweenTimer = WAVES.betweenSeconds;
        this.emit('waveclear', { wave: this.wave });
      }
    }

    this.updateEnemies(dt);
    this.updateBullets(dt);
    this.updatePickups(dt);
    this.updateFx(dt);
  }

  updateEnemies(dt) {
    const ship = this.ship;
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const e = this.enemies[i];
      e.flash = Math.max(0, e.flash - dt * 6);
      e.rot += e.rotSpeed * dt;
      if (e.spawnT > 0) {
        e.spawnT -= dt;
        continue; // materialising: harmless, drifting in
      }
      const dx = ship.x - e.x;
      const dy = ship.y - e.y;
      const d = Math.max(1, Math.hypot(dx, dy));
      const nx = dx / d;
      const ny = dy / d;

      if (e.kind === 'chaser' || e.kind === 'mini' || e.kind === 'tank') {
        e.vx += nx * e.speed * 3.2 * dt;
        e.vy += ny * e.speed * 3.2 * dt;
      } else if (e.kind === 'weaver') {
        const wobble = Math.sin(this.time * 4 + e.seed) * 0.85;
        const px = -ny * wobble;
        const py = nx * wobble;
        e.vx += (nx + px) * e.speed * 3.2 * dt;
        e.vy += (ny + py) * e.speed * 3.2 * dt;
      } else if (e.kind === 'splitter') {
        e.vx += nx * e.speed * 2.6 * dt;
        e.vy += ny * e.speed * 2.6 * dt;
      } else if (e.kind === 'sniper') {
        // Hold a firing ring around the player, strafing sideways.
        const want = d > 430 ? 1 : d < 300 ? -1 : 0;
        const strafe = Math.sin(this.time * 1.4 + e.seed) > 0 ? 1 : -1;
        e.vx += (nx * want + -ny * strafe * 0.7) * e.speed * 2.6 * dt;
        e.vy += (ny * want + nx * strafe * 0.7) * e.speed * 2.6 * dt;
        e.fireTimer -= dt;
        if (e.fireTimer <= 0 && d < 560) {
          e.fireTimer = 2.1 + this.random() * 0.5;
          this.enemyBullets.push({
            x: e.x, y: e.y,
            vx: nx * 330, vy: ny * 330,
            life: 2.2, radius: 5,
          });
          this.emit('enemyshot');
        }
      } else if (e.kind === 'boss') {
        this.updateBoss(e, dt, nx, ny, d);
      }

      // Cap speed, integrate, separate from siblings. A dashing boss keeps its
      // lunge velocity; everything else is capped near its cruise speed.
      const sp = Math.hypot(e.vx, e.vy);
      const dashing = e.kind === 'boss' && e.phase === 'dash' && e.telegraph <= 0;
      const cap = dashing ? 620 : e.speed * (e.kind === 'boss' ? 2.6 : 1.35);
      if (sp > cap) {
        e.vx = (e.vx / sp) * cap;
        e.vy = (e.vy / sp) * cap;
      }
      e.x += e.vx * dt;
      e.y += e.vy * dt;
      clampToField(e, e.radius);
    }

    // Cheap pairwise separation so enemies don't stack into one blob.
    const list = this.enemies;
    for (let i = 0; i < list.length; i += 1) {
      for (let j = i + 1; j < list.length; j += 1) {
        const a = list[i];
        const b = list[j];
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const d = Math.hypot(dx, dy);
        const min = a.radius + b.radius;
        if (d > 0.01 && d < min) {
          const push = ((min - d) / d) * 0.5;
          a.x -= dx * push * 0.5;
          a.y -= dy * push * 0.5;
          b.x += dx * push * 0.5;
          b.y += dy * push * 0.5;
        }
      }
    }

    // Contact with the ship.
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const e = this.enemies[i];
      if (e.spawnT > 0) continue;
      if (dist(e.x, e.y, ship.x, ship.y) < e.radius + SHIP.radius - 2) {
        if (e.kind === 'boss' || e.kind === 'tank') {
          this.damagePlayer(e.x, e.y);
          // Shove the player away from the heavy body.
          const dx = ship.x - e.x;
          const dy = ship.y - e.y;
          const d = Math.max(1, Math.hypot(dx, dy));
          ship.vx = (dx / d) * 420;
          ship.vy = (dy / d) * 420;
        } else {
          this.killEnemy(i, true);
          this.damagePlayer(e.x, e.y);
        }
      }
    }
  }

  updateBoss(boss, dt, nx, ny, d) {
    boss.phaseTimer -= dt;
    // Drift toward a mid-range orbit around the player.
    const want = d > 320 ? 1 : d < 220 ? -0.7 : 0;
    const orbit = 0.55;
    boss.vx += (nx * want + -ny * orbit) * boss.speed * 2 * dt;
    boss.vy += (ny * want + nx * orbit) * boss.speed * 2 * dt;

    if (boss.phase === 'radial') {
      boss.fireTimer -= dt;
      if (boss.fireTimer <= 0) {
        boss.fireTimer = BOSS.burstEvery * 0.55;
        const count = 14 + this.bossIndex * 2;
        const offset = this.random() * TAU;
        for (let k = 0; k < count; k += 1) {
          const a = offset + (k / count) * TAU;
          this.enemyBullets.push({
            x: boss.x, y: boss.y,
            vx: Math.cos(a) * BOSS.boltSpeed, vy: Math.sin(a) * BOSS.boltSpeed,
            life: 3.2, radius: 6,
          });
        }
        this.ring(boss.x, boss.y, boss.color, 120);
        this.emit('bossshot');
      }
      if (boss.phaseTimer <= 0) {
        boss.phase = 'spiral';
        boss.phaseTimer = 3.4;
        boss.fireTimer = 0;
      }
    } else if (boss.phase === 'spiral') {
      boss.fireTimer -= dt;
      if (boss.fireTimer <= 0) {
        boss.fireTimer = BOSS.spiralEvery;
        boss.spiralAngle += 0.42;
        for (const arm of [0, Math.PI]) {
          const a = boss.spiralAngle + arm;
          this.enemyBullets.push({
            x: boss.x, y: boss.y,
            vx: Math.cos(a) * (BOSS.boltSpeed * 0.85), vy: Math.sin(a) * (BOSS.boltSpeed * 0.85),
            life: 3.2, radius: 5,
          });
        }
      }
      if (boss.phaseTimer <= 0) {
        boss.phase = 'dash';
        boss.phaseTimer = 0.7;
        boss.telegraph = 0.7;
        this.emit('bosstelegraph');
      }
    } else if (boss.phase === 'dash') {
      if (boss.telegraph > 0) {
        boss.telegraph -= dt;
        boss.vx *= 0.9;
        boss.vy *= 0.9;
        if (boss.telegraph <= 0) {
          boss.vx = nx * 560;
          boss.vy = ny * 560;
          boss.phaseTimer = 0.55;
          this.addShake(8);
          this.emit('bossdash');
        }
      } else if (boss.phaseTimer <= 0) {
        boss.phase = 'spawn';
        boss.phaseTimer = 0.5;
      }
    } else if (boss.phase === 'spawn') {
      if (boss.phaseTimer <= 0) {
        for (let k = 0; k < 3; k += 1) {
          const a = (k / 3) * TAU + this.random();
          this.spawnEnemy('mini', boss.x + Math.cos(a) * 70, boss.y + Math.sin(a) * 70);
        }
        boss.phase = 'radial';
        boss.phaseTimer = 3.6;
        boss.fireTimer = 0.6;
      }
    }
  }

  updateBullets(dt) {
    // Player bullets vs enemies.
    for (let i = this.bullets.length - 1; i >= 0; i -= 1) {
      const b = this.bullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || b.x < -20 || b.x > FIELD.width + 20 || b.y < -20 || b.y > FIELD.height + 20) {
        this.bullets.splice(i, 1);
        continue;
      }
      for (let j = this.enemies.length - 1; j >= 0; j -= 1) {
        const e = this.enemies[j];
        if (e.spawnT > 0) continue;
        if (dist(b.x, b.y, e.x, e.y) < e.radius + SHIP.bulletRadius) {
          this.bullets.splice(i, 1);
          e.hp -= 1;
          e.flash = 1;
          this.burst(b.x, b.y, e.color, 3, 140);
          if (e.hp <= 0) this.killEnemy(j, false);
          break;
        }
      }
    }

    // Enemy bolts vs the ship.
    const ship = this.ship;
    for (let i = this.enemyBullets.length - 1; i >= 0; i -= 1) {
      const b = this.enemyBullets[i];
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      b.life -= dt;
      if (b.life <= 0 || b.x < -30 || b.x > FIELD.width + 30 || b.y < -30 || b.y > FIELD.height + 30) {
        this.enemyBullets.splice(i, 1);
        continue;
      }
      if (dist(b.x, b.y, ship.x, ship.y) < b.radius + SHIP.radius - 3) {
        this.enemyBullets.splice(i, 1);
        this.damagePlayer(b.x, b.y);
      }
    }
  }

  updatePickups(dt) {
    const ship = this.ship;
    const magnetR = ship.magnet > 0 ? 1400 : SHARD.magnetRadius;
    for (let i = this.shards.length - 1; i >= 0; i -= 1) {
      const s = this.shards[i];
      s.life -= dt;
      if (s.life <= 0) {
        this.shards.splice(i, 1);
        continue;
      }
      const d = dist(s.x, s.y, ship.x, ship.y);
      if (d < magnetR) {
        const pull = 1 - d / (magnetR + 1);
        const a = Math.atan2(ship.y - s.y, ship.x - s.x);
        const v = SHARD.flySpeed * (0.4 + pull);
        s.vx += Math.cos(a) * v * 3 * dt;
        s.vy += Math.sin(a) * v * 3 * dt;
      } else {
        s.vx *= Math.max(0, 1 - 2.4 * dt);
        s.vy *= Math.max(0, 1 - 2.4 * dt);
      }
      s.x += s.vx * dt;
      s.y += s.vy * dt;
      if (d < SHARD.collectRadius) {
        this.shards.splice(i, 1);
        this.shardsCollected += 1;
        this.addScore(SHARD.value, s.x, s.y - 8);
        this.burst(s.x, s.y, '#ffe45d', 4, 110);
        this.emit('shard');
      }
    }

    for (let i = this.powerups.length - 1; i >= 0; i -= 1) {
      const p = this.powerups[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.powerups.splice(i, 1);
        continue;
      }
      if (dist(p.x, p.y, ship.x, ship.y) < POWERUP.radius + SHIP.radius) {
        this.powerups.splice(i, 1);
        this.applyPowerup(p);
      }
    }
  }

  applyPowerup(p) {
    const ship = this.ship;
    const labels = {
      spread: 'SPREAD SHOT!', rapid: 'RAPID FIRE!', shield: 'SHIELD UP!',
      bomb: 'NOVA BOMB!', magnet: 'SHARD MAGNET!',
    };
    this.floater(p.x, p.y - 14, labels[p.kind], '#7bed9f', 20);
    this.ring(p.x, p.y, '#7bed9f', 90);
    if (p.kind === 'spread') ship.spread = POWERUP.spreadSeconds;
    else if (p.kind === 'rapid') ship.rapid = POWERUP.rapidSeconds;
    else if (p.kind === 'shield') ship.shield = true;
    else if (p.kind === 'magnet') ship.magnet = POWERUP.magnetSeconds;
    else if (p.kind === 'bomb') this.detonateBomb();
    this.emit('powerup', { kind: p.kind });
  }

  detonateBomb() {
    this.addShake(22);
    this.flash = 0.7;
    this.ring(this.ship.x, this.ship.y, '#ffffff', 700);
    this.emit('bomb');
    for (let i = this.enemies.length - 1; i >= 0; i -= 1) {
      const e = this.enemies[i];
      if (e.kind === 'boss') {
        e.hp -= 15;
        e.flash = 1;
        if (e.hp <= 0) this.killEnemy(i, false);
      } else {
        this.killEnemy(i, false);
      }
    }
    this.enemyBullets.length = 0;
  }

  updateFx(dt) {
    for (let i = this.particles.length - 1; i >= 0; i -= 1) {
      const p = this.particles[i];
      p.life -= dt;
      if (p.life <= 0) {
        this.particles.splice(i, 1);
        continue;
      }
      const k = Math.max(0, 1 - p.drag * dt);
      p.vx *= k;
      p.vy *= k;
      p.x += p.vx * dt;
      p.y += p.vy * dt;
    }
    for (let i = this.floaters.length - 1; i >= 0; i -= 1) {
      const f = this.floaters[i];
      f.life -= dt;
      f.y -= 42 * dt;
      if (f.life <= 0) this.floaters.splice(i, 1);
    }
    for (let i = this.rings.length - 1; i >= 0; i -= 1) {
      const r = this.rings[i];
      r.life -= dt;
      const t = 1 - r.life / r.maxLife;
      r.r = 8 + (r.maxR - 8) * t * t;
      if (r.life <= 0) this.rings.splice(i, 1);
    }
  }

  // ---- kills & damage ------------------------------------------------------

  killEnemy(index, byContact) {
    const e = this.enemies[index];
    this.enemies.splice(index, 1);
    this.kills += 1;
    this.chain += 1;
    this.chainTimer = COMBO.window;
    this.mult = Math.min(COMBO.maxMult, 1 + Math.floor(this.chain / COMBO.step));

    const big = e.kind === 'boss' || e.kind === 'tank';
    this.burst(e.x, e.y, e.color, big ? 42 : 18, big ? 320 : 240);
    this.ring(e.x, e.y, e.color, big ? 150 : 70);
    this.addShake(big ? 12 : 4);
    this.addScore(e.score, e.x, e.y - 10);
    if (this.mult >= 3) {
      this.floater(e.x, e.y - 30, `x${this.mult} COMBO`, '#ff9f43', 15);
    }
    this.dropShards(e.x, e.y, e.kind === 'boss' ? 10 : e.kind === 'tank' ? 3 : e.kind === 'splitter' ? 2 : 1);
    this.maybeDropPowerup(e.x, e.y);
    this.emit('kill', { kind: e.kind, big });

    if (e.kind === 'splitter') {
      for (let k = 0; k < 2; k += 1) {
        const mini = this.spawnEnemy('mini', e.x, e.y);
        mini.spawnT = 0.12;
        const a = this.random() * TAU;
        mini.vx = Math.cos(a) * 200;
        mini.vy = Math.sin(a) * 200;
      }
    }
    if (e.kind === 'boss') {
      this.boss = null;
      this.burst(e.x, e.y, '#ffffff', 40, 420);
      this.ring(e.x, e.y, '#ffffff', 320);
      this.addShake(20);
      this.flash = 0.5;
      this.enemyBullets.length = 0;
      if (this.wave >= WAVES.finalWave) {
        this.won = true;
        this.waveState = 'done';
        this.emit('win', { score: this.score });
      }
    }
    void byContact;
  }

  damagePlayer(fromX, fromY) {
    const ship = this.ship;
    if (ship.invuln > 0 || this.over || this.won) return;
    if (ship.shield) {
      ship.shield = false;
      ship.invuln = 0.9;
      this.ring(ship.x, ship.y, '#4dd7ff', 110);
      this.burst(ship.x, ship.y, '#4dd7ff', 16, 220);
      this.emit('shieldbreak');
      return;
    }
    ship.hearts -= 1;
    ship.invuln = SHIP.invulnerable;
    this.chain = 0;
    this.mult = 1;
    this.chainTimer = 0;
    this.addShake(16);
    this.flash = 0.55;
    this.burst(ship.x, ship.y, '#ff5d5d', 24, 300);
    this.ring(ship.x, ship.y, '#ff5d5d', 130);
    this.emit('hit', { hearts: ship.hearts, fromX, fromY });
    if (ship.hearts <= 0) {
      this.over = true;
      this.overTimer = 0;
      this.burst(ship.x, ship.y, '#4dd7ff', 60, 420);
      this.burst(ship.x, ship.y, '#ffffff', 30, 300);
      this.ring(ship.x, ship.y, '#ffffff', 260);
      this.addShake(24);
      this.emit('over', { score: this.score });
    }
  }
}
