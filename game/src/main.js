// Starshatter Arena — boot, the fixed-timestep loop, and the screen state
// machine (title with an autopilot attract mode, play, pause, game over,
// victory with an endless continue). Screenshot mode (?shot=start|play|boss|end
// &seed=N) stages a scene once, freezes the simulation, and keeps rendering.

import { STEP, BEST_KEY } from './config.js';
import { World } from './world.js';
import { Renderer, SCREEN_TITLE, SCREEN_PLAY, SCREEN_PAUSE, SCREEN_OVER, SCREEN_WIN } from './render.js';
import { Input } from './input.js';
import { AudioEngine } from './audio.js';
import { stageShot, autopilot } from './shots.js';

const params = new URLSearchParams(location.search);
const seedParam = parseInt(params.get('seed') || '1', 10);
const seed = Number.isFinite(seedParam) ? seedParam : 1;
const shotName = params.get('shot');

const canvas = document.getElementById('game');
const statusEl = document.getElementById('status');
const renderer = new Renderer(canvas);
const input = new Input(canvas, (x, y) => renderer.toLogical(x, y));
const audio = new AudioEngine();
const world = new World(seed);

let screen = SCREEN_TITLE;
let best = loadBest();
let newBest = false;
let frozen = false;
let runTime = 0;

window.addEventListener('resize', () => renderer.resize());

function loadBest() {
  try {
    return parseInt(localStorage.getItem(BEST_KEY) || '0', 10) || 0;
  } catch {
    return 0;
  }
}

function saveBest() {
  try {
    localStorage.setItem(BEST_KEY, String(best));
  } catch { /* private mode: the best score lasts the session */ }
}

function announce(message) {
  statusEl.textContent = message;
}

function startRun() {
  world.reset();
  newBest = false;
  runTime = 0;
  screen = SCREEN_PLAY;
  audio.unlock();
  audio.startMusic();
  audio.click();
  announce('Game started. Wave 1 incoming.');
}

function continueEndless() {
  world.won = false;
  world.waveState = 'between';
  world.betweenTimer = 1.6;
  world.ship.hearts = Math.max(world.ship.hearts, 2);
  world.ship.invuln = 1;
  screen = SCREEN_PLAY;
  audio.click();
  announce('Endless mode. Next wave incoming.');
}

function handleEvents() {
  for (const event of world.drainEvents()) {
    switch (event.type) {
      case 'shoot': audio.shoot(); break;
      case 'kill': audio.enemyDie(event.data && event.data.big); break;
      case 'hit': audio.playerHit(); break;
      case 'shard': audio.shard(); break;
      case 'powerup': audio.powerup(); break;
      case 'bomb': audio.bomb(); break;
      case 'waveclear': audio.waveClear(); break;
      case 'shieldbreak': audio.powerup(); break;
      case 'wave': announce(`Wave ${event.data.wave}.`); break;
      case 'bossspawn':
        audio.bossSpawn();
        announce(`Wave ${event.data.wave}: the Void Warden approaches.`);
        break;
      case 'over':
        audio.stopMusic();
        audio.gameOver();
        if (world.score > best) {
          best = world.score;
          newBest = true;
          saveBest();
        }
        screen = SCREEN_OVER;
        announce(`Ship destroyed. Score ${world.score}.`);
        break;
      case 'win':
        audio.stopMusic();
        audio.victory();
        if (world.score > best) {
          best = world.score;
          newBest = true;
          saveBest();
        }
        screen = SCREEN_WIN;
        announce(`Sector cleared! Score ${world.score}.`);
        break;
      default: break;
    }
  }
}

// Screenshot mode: stage the scene, freeze the simulation, keep rendering.
if (shotName) {
  const staged = stageShot(shotName, world);
  screen = staged.screen;
  if (screen === SCREEN_OVER && world.score > best) {
    newBest = true;
    best = world.score;
  }
  frozen = true;
  announce(`Screenshot scene: ${shotName}.`);
}

const IDLE = { mx: 0, my: 0, aimX: 0, aimY: -1, firing: false };
let last = performance.now();
let acc = 0;

function frame(nowMs) {
  requestAnimationFrame(frame);
  const now = nowMs / 1000;
  const dt = Math.min(0.1, (nowMs - last) / 1000);
  last = nowMs;

  if (input.consume('mute')) {
    const muted = audio.toggleMute();
    announce(muted ? 'Sound off.' : 'Sound on.');
  }
  if (input.consume('pause')) {
    if (screen === SCREEN_PLAY) {
      screen = SCREEN_PAUSE;
      audio.stopMusic();
      announce('Paused.');
    } else if (screen === SCREEN_PAUSE) {
      screen = SCREEN_PLAY;
      audio.startMusic();
      announce('Resumed.');
    }
  }
  // Any gesture unlocks audio (the browser's autoplay rule).
  if (input.pressed.has('tap') || input.pressed.has('confirm')) audio.unlock();

  if (!frozen) {
    if (screen === SCREEN_TITLE) {
      // Attract mode: the autopilot flies behind the title card.
      acc += dt;
      while (acc >= STEP) {
        world.step(STEP, autopilot(world, 280, 0));
        acc -= STEP;
        if (world.over || world.won) world.reset();
      }
      world.drainEvents();
      if (input.consume('confirm') || input.consume('tap')) startRun();
      input.clearPressed();
    } else if (screen === SCREEN_PLAY) {
      input.update(world.ship.x, world.ship.y);
      runTime += dt;
      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps < 5) {
        world.step(STEP, {
          mx: input.moveX, my: input.moveY,
          aimX: input.aimX, aimY: input.aimY, firing: input.firing,
        });
        acc -= STEP;
        steps += 1;
      }
      if (steps === 5) acc = 0; // drop backlog rather than spiral
      handleEvents();
      input.clearPressed();
    } else if (screen === SCREEN_PAUSE) {
      input.clearPressed();
    } else if (screen === SCREEN_OVER || screen === SCREEN_WIN) {
      // Let the aftermath FX play out behind the panel.
      acc += dt;
      while (acc >= STEP) {
        world.step(STEP, IDLE);
        acc -= STEP;
      }
      if (screen === SCREEN_OVER) {
        if (world.overTimer > 0.6 && (input.consume('confirm') || input.consume('tap'))) startRun();
      } else if (input.consume('confirm')) {
        continueEndless();
      } else if (input.consume('tap')) {
        startRun();
      }
      input.clearPressed();
    }
  }

  renderer.draw(world, screen, {
    best,
    newBest,
    muted: audio.muted,
    showHint: screen === SCREEN_PLAY && runTime < 12,
    input,
  }, now);
}

requestAnimationFrame(frame);

document.addEventListener('visibilitychange', () => {
  if (document.hidden && screen === SCREEN_PLAY && !frozen) {
    screen = SCREEN_PAUSE;
    audio.stopMusic();
  }
});
