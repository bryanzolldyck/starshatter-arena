// Starshatter Arena — keyboard, mouse and touch input in one place.
// Keyboard: WASD / arrows move, Space shoots, P or Escape pauses, M mutes,
// Enter starts / restarts. Mouse: aim follows the pointer, hold to shoot.
// Touch: left half of the screen is a move stick, right half an aim-and-fire
// stick; both are dynamic-origin, so a thumb can land anywhere.

export class Input {
  constructor(canvas, toLogical) {
    this.canvas = canvas;
    this.toLogical = toLogical; // screen px -> logical field coords
    this.keys = new Set();
    this.moveX = 0;
    this.moveY = 0;
    this.aimX = 0;
    this.aimY = -1;
    this.firing = false;
    this.usingTouchAim = false;
    this.pressed = new Set(); // edge-triggered actions, consumed each frame
    this.moveStick = null; // { id, ox, oy, x, y }
    this.aimStick = null;
    this.mouseSeen = false;
    this.mouseX = 0;
    this.mouseY = 0;
    this.bind();
  }

  bind() {
    window.addEventListener('keydown', (event) => {
      if (event.repeat) return;
      const key = event.key.toLowerCase();
      this.keys.add(key);
      if (key === 'enter') this.pressed.add('confirm');
      if (key === 'p' || key === 'escape') this.pressed.add('pause');
      if (key === 'm') this.pressed.add('mute');
      if ([' ', 'arrowup', 'arrowdown', 'arrowleft', 'arrowright'].includes(key)) event.preventDefault();
    });
    window.addEventListener('keyup', (event) => {
      this.keys.delete(event.key.toLowerCase());
    });
    window.addEventListener('blur', () => {
      this.keys.clear();
      this.firing = false;
    });

    this.canvas.addEventListener('mousemove', (event) => {
      const rect = this.canvas.getBoundingClientRect();
      const point = this.toLogical(event.clientX - rect.left, event.clientY - rect.top);
      this.mouseX = point.x;
      this.mouseY = point.y;
      this.mouseSeen = true;
    });
    this.canvas.addEventListener('mousedown', (event) => {
      if (event.button === 0) this.firing = true;
      this.pressed.add('tap');
    });
    window.addEventListener('mouseup', (event) => {
      if (event.button === 0) this.firing = false;
    });
    this.canvas.addEventListener('contextmenu', (event) => event.preventDefault());

    this.canvas.addEventListener('touchstart', (event) => {
      event.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      for (const touch of event.changedTouches) {
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        if (x < rect.width / 2 && !this.moveStick) {
          this.moveStick = { id: touch.identifier, ox: x, oy: y, x, y };
        } else if (!this.aimStick) {
          this.aimStick = { id: touch.identifier, ox: x, oy: y, x, y };
          this.usingTouchAim = true;
        }
      }
      this.pressed.add('tap');
    }, { passive: false });
    this.canvas.addEventListener('touchmove', (event) => {
      event.preventDefault();
      const rect = this.canvas.getBoundingClientRect();
      for (const touch of event.changedTouches) {
        const x = touch.clientX - rect.left;
        const y = touch.clientY - rect.top;
        if (this.moveStick && touch.identifier === this.moveStick.id) {
          this.moveStick.x = x;
          this.moveStick.y = y;
        }
        if (this.aimStick && touch.identifier === this.aimStick.id) {
          this.aimStick.x = x;
          this.aimStick.y = y;
        }
      }
    }, { passive: false });
    const endTouch = (event) => {
      for (const touch of event.changedTouches) {
        if (this.moveStick && touch.identifier === this.moveStick.id) this.moveStick = null;
        if (this.aimStick && touch.identifier === this.aimStick.id) {
          this.aimStick = null;
          this.usingTouchAim = false;
        }
      }
    };
    this.canvas.addEventListener('touchend', endTouch);
    this.canvas.addEventListener('touchcancel', endTouch);
  }

  /** Recompute the polled state from keys, sticks and the pointer. Call once per step. */
  update(shipX, shipY) {
    let mx = 0;
    let my = 0;
    if (this.keys.has('a') || this.keys.has('arrowleft')) mx -= 1;
    if (this.keys.has('d') || this.keys.has('arrowright')) mx += 1;
    if (this.keys.has('w') || this.keys.has('arrowup')) my -= 1;
    if (this.keys.has('s') || this.keys.has('arrowdown')) my += 1;
    if (this.moveStick) {
      const dx = (this.moveStick.x - this.moveStick.ox) / 56;
      const dy = (this.moveStick.y - this.moveStick.oy) / 56;
      const len = Math.hypot(dx, dy);
      if (len > 0.18) {
        const clamped = Math.min(1, len);
        mx = (dx / len) * clamped;
        my = (dy / len) * clamped;
      }
    }
    const mLen = Math.hypot(mx, my);
    if (mLen > 1) {
      mx /= mLen;
      my /= mLen;
    }
    this.moveX = mx;
    this.moveY = my;

    if (this.aimStick) {
      const dx = this.aimStick.x - this.aimStick.ox;
      const dy = this.aimStick.y - this.aimStick.oy;
      const len = Math.hypot(dx, dy);
      if (len > 18) {
        this.aimX = dx / len;
        this.aimY = dy / len;
        this.firing = true;
      } else {
        this.firing = false;
      }
    } else if (this.mouseSeen) {
      const dx = this.mouseX - shipX;
      const dy = this.mouseY - shipY;
      const len = Math.hypot(dx, dy);
      if (len > 4) {
        this.aimX = dx / len;
        this.aimY = dy / len;
      }
    }
    if (this.keys.has(' ')) this.firing = true;
    else if (!this.aimStick && !this.mouseDown()) this.firing = false;
  }

  mouseDown() {
    // mousedown sets firing; mouseup clears it. The flag doubles as the state.
    return this.firing && !this.keys.has(' ') && !this.aimStick;
  }

  consume(action) {
    if (this.pressed.has(action)) {
      this.pressed.delete(action);
      return true;
    }
    return false;
  }

  clearPressed() {
    this.pressed.clear();
  }
}
