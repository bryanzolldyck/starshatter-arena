// Starshatter Arena — every tuning number and colour in one place.
// The playfield is a fixed 1280x720 logical area; the renderer scales it to
// the window, so no rule below depends on the screen size.

export const FIELD = { width: 1280, height: 720 };

/** The simulation's fixed step, in seconds: 60 updates a second whatever the display's rate. */
export const STEP = 1 / 60;

export const SHIP = {
  radius: 14,
  accel: 2400,
  maxSpeed: 360,
  drag: 4.2,
  fireInterval: 0.14,
  bulletSpeed: 920,
  bulletLife: 0.85,
  bulletRadius: 4,
  invulnerable: 1.6,
  hearts: 3,
};

export const ENEMY = {
  chaser: { radius: 15, speed: 132, hp: 1, score: 50, color: '#ff5d5d' },
  weaver: { radius: 14, speed: 168, hp: 1, score: 75, color: '#ff9f43' },
  tank: { radius: 27, speed: 62, hp: 6, score: 150, color: '#c86bff' },
  splitter: { radius: 20, speed: 96, hp: 2, score: 100, color: '#2ed573' },
  sniper: { radius: 15, speed: 110, hp: 2, score: 125, color: '#eccc68' },
  mini: { radius: 9, speed: 235, hp: 1, score: 25, color: '#7bed9f' },
  boss: { radius: 52, speed: 55, hp: 70, score: 2000, color: '#ff2e63' },
};

export const BOSS = {
  hpPerIndex: 25,
  boltSpeed: 260,
  burstEvery: 2.6,
  spiralEvery: 0.09,
  dashEvery: 7.5,
  spawnEvery: 5.0,
  contactDamage: 1,
};

/** Waves: budget grows, new enemy types unlock, boss every 5th wave. Wave 10's boss is the finale. */
export const WAVES = {
  budgetBase: 6,
  budgetPerWave: 4,
  spawnInterval: 0.7,
  betweenSeconds: 2.6,
  bossEvery: 5,
  finalWave: 10,
};

export const COMBO = {
  window: 3.5,
  perKill: 1,
  step: 4,
  maxMult: 8,
};

export const SHARD = {
  radius: 6,
  value: 10,
  magnetRadius: 110,
  collectRadius: 24,
  life: 9,
  flySpeed: 520,
};

export const POWERUP = {
  dropChance: 0.13,
  life: 8,
  radius: 16,
  spreadSeconds: 12,
  rapidSeconds: 10,
  magnetSeconds: 10,
};

export const PARTICLES = { max: 420 };
export const FLOATERS = { max: 24 };

export const PALETTE = {
  backdrop: '#070a18',
  arenaEdge: '#1c2450',
  grid: 'rgba(90, 110, 220, 0.10)',
  ship: '#4dd7ff',
  shipCore: '#eafcff',
  bullet: '#aef3ff',
  shard: '#ffe45d',
  text: '#eef1ff',
  muted: '#9aa3c7',
  danger: '#ff2e63',
  panel: 'rgba(10, 14, 34, 0.82)',
  panelEdge: '#3a4a8f',
};

export const FONT = '"Avenir Next", system-ui, -apple-system, "Segoe UI", sans-serif';

export const BEST_KEY = 'starshatter.best';
export const MUTE_KEY = 'starshatter.muted';
