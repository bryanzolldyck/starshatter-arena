// Starshatter Arena — all sound is synthesized with WebAudio: no audio files,
// no network. A tiny step sequencer drives the music bed; every effect is a
// short oscillator / filtered-noise gesture. Audio starts on the first user
// gesture (the browser's autoplay rule) and stays silent until then.

import { MUTE_KEY } from './config.js';

const NOTE = {
  c3: 130.81, d3: 146.83, e3: 164.81, g3: 196.0, a3: 220.0,
  c4: 261.63, d4: 293.66, e4: 329.63, g4: 392.0, a4: 440.0, c5: 523.25, e5: 659.25,
};

// A minor, driving 16-step loop: bass roots with a sparkle arp on top.
const BASS = ['c3', 'c3', 'c3', 'e3', 'c3', 'c3', 'g3', 'c3', 'a3', 'a3', 'a3', 'g3', 'e3', 'e3', 'd3', 'd3'];
const ARP = ['c4', null, 'e4', null, 'g4', null, 'e4', null, 'a4', null, 'g4', null, 'e4', null, 'd4', 'e4'];

export class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.musicGain = null;
    this.muted = false;
    this.musicTimer = null;
    this.step = 0;
    this.lastShotAt = 0;
    try {
      this.muted = localStorage.getItem(MUTE_KEY) === '1';
    } catch {
      this.muted = false;
    }
  }

  /** Create the context on a user gesture; safe to call repeatedly. */
  unlock() {
    if (this.ctx) {
      if (this.ctx.state === 'suspended') this.ctx.resume();
      return;
    }
    const Ctor = window.AudioContext || window.webkitAudioContext;
    if (!Ctor) return;
    this.ctx = new Ctor();
    this.master = this.ctx.createGain();
    this.master.gain.value = this.muted ? 0 : 0.9;
    this.master.connect(this.ctx.destination);
    this.musicGain = this.ctx.createGain();
    this.musicGain.gain.value = 0.16;
    this.musicGain.connect(this.master);
  }

  toggleMute() {
    this.muted = !this.muted;
    try {
      localStorage.setItem(MUTE_KEY, this.muted ? '1' : '0');
    } catch { /* private mode: mute still works for the session */ }
    if (this.master && this.ctx) {
      this.master.gain.setTargetAtTime(this.muted ? 0 : 0.9, this.ctx.currentTime, 0.02);
    }
    return this.muted;
  }

  /** A short pitched blip with a pitch slide. */
  blip(freqA, freqB, seconds, type, volume, when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freqA, t);
    osc.frequency.exponentialRampToValueAtTime(Math.max(20, freqB), t + seconds);
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + seconds);
    osc.connect(gain).connect(this.master);
    osc.start(t);
    osc.stop(t + seconds + 0.02);
  }

  /** Filtered noise: explosions, hits, hi-hats. */
  noise(seconds, filterFreq, volume, type = 'lowpass', when = 0) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime + when;
    const length = Math.max(1, Math.floor(this.ctx.sampleRate * seconds));
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = type;
    filter.frequency.value = filterFreq;
    const gain = this.ctx.createGain();
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + seconds);
    source.connect(filter).connect(gain).connect(this.master);
    source.start(t);
  }

  shoot() {
    if (!this.ctx) return;
    const now = performance.now();
    if (now - this.lastShotAt < 45) return; // throttle: full-auto would clip
    this.lastShotAt = now;
    this.blip(880 + Math.random() * 120, 220, 0.07, 'square', 0.05);
  }

  enemyDie(big = false) {
    this.noise(big ? 0.45 : 0.22, big ? 500 : 900, big ? 0.5 : 0.28);
    this.blip(big ? 220 : 320, 40, big ? 0.4 : 0.2, 'sawtooth', 0.16);
  }

  playerHit() {
    this.noise(0.35, 300, 0.5);
    this.blip(160, 35, 0.35, 'sawtooth', 0.35);
  }

  shard() {
    this.blip(1320 + Math.random() * 240, 1980, 0.09, 'sine', 0.1);
  }

  powerup() {
    [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => this.blip(f, f, 0.12, 'triangle', 0.16, i * 0.055));
  }

  bomb() {
    this.noise(0.8, 220, 0.6);
    this.blip(90, 28, 0.7, 'sine', 0.5);
  }

  waveClear() {
    [392.0, 523.25, 659.25].forEach((f, i) => this.blip(f, f, 0.14, 'triangle', 0.14, i * 0.07));
  }

  bossSpawn() {
    for (let i = 0; i < 3; i += 1) {
      this.blip(196, 196, 0.16, 'sawtooth', 0.2, i * 0.22);
      this.blip(147, 147, 0.16, 'sawtooth', 0.2, i * 0.22 + 0.11);
    }
  }

  gameOver() {
    [392.0, 329.63, 261.63, 196.0].forEach((f, i) => this.blip(f, f * 0.94, 0.3, 'triangle', 0.2, i * 0.16));
  }

  victory() {
    [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5, 1318.5].forEach((f, i) => this.blip(f, f, 0.18, 'triangle', 0.18, i * 0.1));
  }

  click() {
    this.blip(660, 520, 0.06, 'sine', 0.12);
  }

  /** Start the music bed; call once play begins. */
  startMusic() {
    if (!this.ctx || this.musicTimer !== null) return;
    const stepSeconds = 0.21;
    const tick = () => {
      if (!this.ctx) return;
      const bass = BASS[this.step % BASS.length];
      const arp = ARP[this.step % ARP.length];
      if (bass) this.musicNote(NOTE[bass], stepSeconds * 0.9, 'triangle', 0.5);
      if (arp) this.musicNote(NOTE[arp], stepSeconds * 0.7, 'sine', 0.22);
      if (this.step % 4 === 0) this.musicKick();
      if (this.step % 2 === 1) this.musicHat();
      this.step += 1;
    };
    tick();
    this.musicTimer = window.setInterval(tick, stepSeconds * 1000);
  }

  stopMusic() {
    if (this.musicTimer !== null) {
      window.clearInterval(this.musicTimer);
      this.musicTimer = null;
    }
  }

  musicNote(freq, seconds, type, volume) {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = type;
    osc.frequency.value = freq;
    gain.gain.setValueAtTime(volume, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + seconds);
    osc.connect(gain).connect(this.musicGain);
    osc.start(t);
    osc.stop(t + seconds + 0.02);
  }

  musicKick() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const osc = this.ctx.createOscillator();
    const gain = this.ctx.createGain();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(120, t);
    osc.frequency.exponentialRampToValueAtTime(38, t + 0.12);
    gain.gain.setValueAtTime(0.8, t);
    gain.gain.exponentialRampToValueAtTime(0.001, t + 0.14);
    osc.connect(gain).connect(this.musicGain);
    osc.start(t);
    osc.stop(t + 0.16);
  }

  musicHat() {
    if (!this.ctx) return;
    const t = this.ctx.currentTime;
    const length = Math.floor(this.ctx.sampleRate * 0.03);
    const buffer = this.ctx.createBuffer(1, length, this.ctx.sampleRate);
    const data = buffer.getChannelData(0);
    for (let i = 0; i < length; i += 1) data[i] = (Math.random() * 2 - 1) * (1 - i / length);
    const source = this.ctx.createBufferSource();
    source.buffer = buffer;
    const filter = this.ctx.createBiquadFilter();
    filter.type = 'highpass';
    filter.frequency.value = 6000;
    const gain = this.ctx.createGain();
    gain.gain.value = 0.12;
    source.connect(filter).connect(gain).connect(this.musicGain);
    source.start(t);
  }
}
