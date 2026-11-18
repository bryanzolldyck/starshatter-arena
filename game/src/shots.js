// Starshatter Arena — the screenshot scenes behind ?shot=start|play|boss|end.
// Each scene plays the real rules forward from a fresh world, steered by a
// simple autopilot (flee what is close, chase shards when safe, lead the
// nearest target), so every frame is what a short game really looks like and
// the same seed always stages the same frame. The play and boss scenes run
// with extra staging hearts, invisible in the HUD, so the pilot survives to
// the photo; the end scene's pilot is half-blind and starts on one heart.

import { FIELD, STEP, SHIP } from './config.js';
import { SCREEN_TITLE, SCREEN_PLAY, SCREEN_OVER } from './render.js';

/** Steer the ship: flee close threats, seek pickups when safe, lead the nearest enemy. */
export function autopilot(world, horizon, noise) {
  const ship = world.ship;
  let fx = 0;
  let fy = 0;

  const flee = (x, y, radius, weight) => {
    const dx = ship.x - x;
    const dy = ship.y - y;
    const d = Math.hypot(dx, dy);
    const range = horizon + radius;
    if (d < range && d > 0.01) {
      const w = weight * (1 - d / range);
      fx += (dx / d) * w;
      fy += (dy / d) * w;
    }
  };
  for (const e of world.enemies) {
    if (e.spawnT > 0) continue;
    flee(e.x, e.y, e.radius + 26, e.kind === 'boss' ? 1.7 : 1);
  }
  for (const b of world.enemyBullets) flee(b.x, b.y, 30, 1.25);

  const threatened = fx !== 0 || fy !== 0;
  if (!threatened) {
    // Chase the nearest pickup, powerups first.
    let target = null;
    let targetD = Infinity;
    for (const p of world.powerups) {
      const d = Math.hypot(p.x - ship.x, p.y - ship.y);
      if (d < targetD) { targetD = d; target = p; }
    }
    if (!target) {
      for (const s of world.shards) {
        const d = Math.hypot(s.x - ship.x, s.y - ship.y);
        if (d < targetD) { targetD = d; target = s; }
      }
    }
    if (target && targetD > 1) {
      fx += ((target.x - ship.x) / targetD) * 0.55;
      fy += ((target.y - ship.y) / targetD) * 0.55;
    }
  }

  // Keep off the walls.
  const margin = 90;
  if (ship.x < margin) fx += 1;
  if (ship.x > FIELD.width - margin) fx -= 1;
  if (ship.y < margin) fy += 1;
  if (ship.y > FIELD.height - margin) fy -= 1;

  // A weak pilot's wobble (seeded, so staging stays repeatable).
  if (noise > 0) {
    fx += (world.random() - 0.5) * noise * 2;
    fy += (world.random() - 0.5) * noise * 2;
  }

  const len = Math.hypot(fx, fy);
  const mx = len > 0.05 ? fx / len : 0;
  const my = len > 0.05 ? fy / len : 0;

  // Aim at the nearest live enemy, leading the shot by its velocity.
  let aimX = 0;
  let aimY = -1;
  let bestD = Infinity;
  let target = null;
  for (const e of world.enemies) {
    if (e.spawnT > 0) continue;
    const d = Math.hypot(e.x - ship.x, e.y - ship.y);
    if (d < bestD) { bestD = d; target = e; }
  }
  if (target) {
    const lead = bestD / SHIP.bulletSpeed;
    const px = target.x + target.vx * lead;
    const py = target.y + target.vy * lead;
    const dx = px - ship.x;
    const dy = py - ship.y;
    const dl = Math.hypot(dx, dy);
    if (dl > 1) {
      aimX = dx / dl;
      aimY = dy / dl;
    }
  } else if (len > 0.05) {
    aimX = mx;
    aimY = my;
  }
  return { mx, my, aimX, aimY, firing: true };
}

function runFor(world, seconds, horizon, noise, firing = true) {
  const steps = Math.floor(seconds / STEP);
  for (let i = 0; i < steps; i += 1) {
    const input = autopilot(world, horizon, noise);
    input.firing = firing && input.firing;
    world.step(STEP, input);
    if (world.over || world.won) break;
  }
}

/**
 * Set `world` to the named scene and return the screen to draw over it.
 * Unknown names stage the title scene.
 */
export function stageShot(name, world) {
  if (name === 'play') {
    for (const horizon of [280, 340]) {
      world.reset();
      world.ship.hearts = 6;
      runFor(world, 24, horizon, 0);
      if (!world.over) break;
    }
    world.drainEvents();
    return { screen: SCREEN_PLAY };
  }

  if (name === 'boss') {
    // Try shorter fights until the boss is still standing for the photo.
    for (const seconds of [7, 5, 3.5]) {
      world.reset();
      world.ship.hearts = 6;
      world.jumpToWave(5);
      runFor(world, seconds, 300, 0);
      if (!world.over && world.boss) break;
    }
    world.drainEvents();
    return { screen: SCREEN_PLAY };
  }

  if (name === 'end') {
    world.reset();
    world.ship.hearts = 1;
    let steps = 0;
    while (!world.over && steps < 45 * 60) {
      world.step(STEP, autopilot(world, 60, 1.2));
      steps += 1;
    }
    if (!world.over) {
      // The pilot got lucky: stand down and let the swarm finish the job.
      world.ship.invuln = 0;
      let guard = 0;
      const idle = { mx: 0, my: 0, aimX: 0, aimY: -1, firing: false };
      while (!world.over && guard < 40 * 60) {
        world.step(STEP, idle);
        guard += 1;
      }
    }
    // Let the wreckage bloom so the frame shows the aftermath, not the hit.
    const idle = { mx: 0, my: 0, aimX: 0, aimY: -1, firing: false };
    for (let i = 0; i < 45; i += 1) world.step(STEP, idle);
    world.drainEvents();
    return { screen: SCREEN_OVER };
  }

  // start: the pilot dodges without firing while the first wave arrives, then
  // opens fire for a beat, so the title sits over a live-looking swarm.
  world.reset();
  runFor(world, 5, 280, 0, false);
  runFor(world, 1, 280, 0, true);
  world.drainEvents();
  return { screen: SCREEN_TITLE };
}
