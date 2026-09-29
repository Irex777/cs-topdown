// Fully synthesised sound effects (no audio files to download), with simple positional audio.
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

class AudioEngine {
  constructor() {
    this.ctx = null;
    this.master = null;
    this.volume = 0.7;
    this.muted = false;
    this.noise = null;
    this.lx = 0; this.ly = 0;
    this.lastPlay = new Map();
    try { const v = parseFloat(localStorage.getItem('cs.volume')); if (Number.isFinite(v)) this.volume = clamp(v, 0, 1); } catch { /* ignore */ }
  }

  unlock() {
    if (this.ctx) { if (this.ctx.state === 'suspended') this.ctx.resume(); return; }
    const AC = window.AudioContext || window.webkitAudioContext;
    if (!AC) return;
    this.ctx = new AC();
    const comp = this.ctx.createDynamicsCompressor();
    comp.threshold.value = -14; comp.ratio.value = 6; comp.attack.value = 0.003; comp.release.value = 0.15;
    this.master = this.ctx.createGain();
    this.master.gain.value = this.volume;
    this.master.connect(comp); comp.connect(this.ctx.destination);
    // one second of white noise reused by every effect
    const len = this.ctx.sampleRate;
    this.noise = this.ctx.createBuffer(1, len, this.ctx.sampleRate);
    const d = this.noise.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = Math.random() * 2 - 1;
  }

  setVolume(v) {
    this.volume = clamp(v, 0, 1);
    if (this.master) this.master.gain.value = this.volume;
    try { localStorage.setItem('cs.volume', String(this.volume)); } catch { /* ignore */ }
  }

  setListener(x, y) { this.lx = x; this.ly = y; }

  // ---- building blocks -----------------------------------------------------------------
  _out(pos, vol, maxDist = 1500) {
    const c = this.ctx;
    const g = c.createGain();
    let node = g;
    let lp = null;
    if (pos) {
      const dx = pos.x - this.lx, dy = pos.y - this.ly;
      const d = Math.hypot(dx, dy);
      if (d > maxDist) return null;
      const att = 1 / (1 + Math.pow(d / 380, 1.7));
      g.gain.value = vol * att;
      lp = c.createBiquadFilter();
      lp.type = 'lowpass';
      lp.frequency.value = clamp(16000 / (1 + d / 260), 700, 16000);
      g.connect(lp);
      node = lp;
      if (c.createStereoPanner) {
        const pan = c.createStereoPanner();
        pan.pan.value = clamp(dx / 700, -0.9, 0.9);
        lp.connect(pan); pan.connect(this.master);
      } else lp.connect(this.master);
    } else {
      g.gain.value = vol;
      g.connect(this.master);
    }
    return g;
  }

  _noise(out, t, dur, { type = 'bandpass', freq = 2000, q = 0.7, gain = 1, attack = 0.002, sweepTo = 0 } = {}) {
    const c = this.ctx;
    const src = c.createBufferSource();
    src.buffer = this.noise; src.loop = true;
    const f = c.createBiquadFilter();
    f.type = type; f.frequency.setValueAtTime(freq, t); f.Q.value = q;
    if (sweepTo) f.frequency.exponentialRampToValueAtTime(sweepTo, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(f); f.connect(g); g.connect(out);
    src.start(t, Math.random() * 0.5); src.stop(t + dur + 0.05);
  }

  _tone(out, t, dur, { type = 'sine', from = 440, to = 0, gain = 0.5, attack = 0.002 } = {}) {
    const c = this.ctx;
    const o = c.createOscillator();
    o.type = type; o.frequency.setValueAtTime(from, t);
    if (to) o.frequency.exponentialRampToValueAtTime(to, t + dur);
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + attack);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    o.connect(g); g.connect(out);
    o.start(t); o.stop(t + dur + 0.05);
  }

  ready() { return this.ctx && this.ctx.state === 'running' && this.volume > 0; }

  /** throttle repeated identical sounds (e.g. many footsteps in one snapshot) */
  _throttle(key, ms) {
    const now = performance.now();
    if (now - (this.lastPlay.get(key) || 0) < ms) return true;
    this.lastPlay.set(key, now);
    return false;
  }

  // ---- public effects --------------------------------------------------------------------
  shot(kind, pos, suppressed = false, own = false) {
    if (!this.ready()) return;
    const c = this.ctx, t = c.currentTime;
    const out = this._out(pos, own ? 0.9 : 1, 2200);
    if (!out) return;
    if (suppressed) {
      this._noise(out, t, 0.09, { type: 'lowpass', freq: 1800, gain: 0.5 });
      this._tone(out, t, 0.06, { from: 180, to: 70, gain: 0.35 });
      return;
    }
    switch (kind) {
      case 'pistol':
        this._noise(out, t, 0.07, { freq: 2200, q: 0.8, gain: 0.7 });
        this._tone(out, t, 0.08, { from: 220, to: 70, gain: 0.55 });
        break;
      case 'smg':
        this._noise(out, t, 0.06, { freq: 2600, q: 0.7, gain: 0.6 });
        this._tone(out, t, 0.06, { from: 260, to: 90, gain: 0.45 });
        break;
      case 'rifle':
        this._noise(out, t, 0.13, { type: 'lowpass', freq: 4500, gain: 0.85 });
        this._noise(out, t, 0.28, { type: 'lowpass', freq: 900, gain: 0.3 });
        this._tone(out, t, 0.12, { from: 150, to: 45, gain: 0.7 });
        break;
      case 'sniper':
        this._noise(out, t, 0.32, { type: 'lowpass', freq: 3500, gain: 1 });
        this._noise(out, t + 0.02, 0.9, { type: 'lowpass', freq: 500, gain: 0.35 });
        this._tone(out, t, 0.25, { from: 110, to: 30, gain: 0.95 });
        break;
      case 'shotgun':
        this._noise(out, t, 0.2, { type: 'lowpass', freq: 3000, gain: 1 });
        this._tone(out, t, 0.18, { from: 120, to: 35, gain: 0.9 });
        break;
      default:
        this._noise(out, t, 0.1, { freq: 2000, gain: 0.6 });
    }
  }

  knife(pos, hit) {
    if (!this.ready()) return;
    const out = this._out(pos, 0.6, 700); if (!out) return;
    const t = this.ctx.currentTime;
    this._noise(out, t, 0.16, { freq: 900, q: 1.2, gain: hit ? 0.9 : 0.5, sweepTo: 3500 });
    if (hit) this._tone(out, t + 0.05, 0.08, { from: 200, to: 90, gain: 0.5 });
  }

  reload(pos) {
    if (!this.ready() || this._throttle('rel', 120)) return;
    const out = this._out(pos, 0.5, 700); if (!out) return;
    const t = this.ctx.currentTime;
    this._noise(out, t, 0.04, { freq: 3000, gain: 0.6 }); this._tone(out, t, 0.05, { type: 'square', from: 900, to: 700, gain: 0.1 });
    this._noise(out, t + 0.5, 0.05, { freq: 2200, gain: 0.7 }); this._tone(out, t + 0.5, 0.06, { type: 'square', from: 500, to: 300, gain: 0.12 });
    this._noise(out, t + 0.85, 0.03, { freq: 4000, gain: 0.5 });
  }

  empty() { if (!this.ready() || this._throttle('empty', 150)) return; const out = this._out(null, 0.4); const t = this.ctx.currentTime; this._noise(out, t, 0.03, { freq: 3500, gain: 0.5 }); }
  step(pos) {
    if (!this.ready() || this._throttle('step' + Math.round(pos.x / 60) + Math.round(pos.y / 60), 90)) return;
    const out = this._out(pos, 0.35, 620); if (!out) return;
    const t = this.ctx.currentTime;
    this._noise(out, t, 0.07, { type: 'lowpass', freq: 500 + Math.random() * 200, gain: 0.9 });
  }

  hitmarker(kill) {
    if (!this.ready()) return;
    const out = this._out(null, 0.5); const t = this.ctx.currentTime;
    this._tone(out, t, 0.05, { type: 'triangle', from: kill ? 1500 : 2300, gain: 0.4 });
    if (kill) this._tone(out, t + 0.06, 0.08, { type: 'triangle', from: 1900, gain: 0.4 });
  }

  hurt() {
    if (!this.ready() || this._throttle('hurt', 80)) return;
    const out = this._out(null, 0.7); const t = this.ctx.currentTime;
    this._tone(out, t, 0.14, { from: 130, to: 50, gain: 0.8 });
    this._noise(out, t, 0.1, { type: 'lowpass', freq: 900, gain: 0.6 });
  }

  death(pos) {
    if (!this.ready()) return;
    const out = this._out(pos, 0.7, 900); if (!out) return;
    const t = this.ctx.currentTime;
    this._tone(out, t, 0.35, { type: 'sawtooth', from: 220, to: 60, gain: 0.25 });
    this._noise(out, t, 0.25, { type: 'lowpass', freq: 700, gain: 0.5 });
  }

  explosion(kind, pos) {
    if (!this.ready()) return;
    const out = this._out(pos, kind === 'bomb' ? 1.6 : 1.2, kind === 'bomb' ? 6000 : 3200); if (!out) return;
    const t = this.ctx.currentTime;
    const big = kind === 'bomb';
    this._noise(out, t, big ? 2.4 : 1.1, { type: 'lowpass', freq: big ? 2400 : 1800, sweepTo: 90, gain: 1 });
    this._tone(out, t, big ? 1.4 : 0.7, { from: big ? 70 : 90, to: 24, gain: 1.1 });
    this._noise(out, t, 0.12, { freq: 4000, gain: 0.8 });
  }

  flash(pos) {
    if (!this.ready()) return;
    const out = this._out(pos, 0.9, 2600); if (!out) return;
    const t = this.ctx.currentTime;
    this._noise(out, t, 0.12, { freq: 5000, gain: 0.9 });
    this._tone(out, t + 0.02, 0.06, { type: 'square', from: 1200, gain: 0.2 });
  }

  flashRing() {
    if (!this.ready()) return;
    const out = this._out(null, 0.35); const t = this.ctx.currentTime;
    this._tone(out, t, 2.4, { from: 3600, to: 3000, gain: 0.5, attack: 0.01 });
  }

  smoke(pos) {
    if (!this.ready()) return;
    const out = this._out(pos, 0.8, 2000); if (!out) return;
    const t = this.ctx.currentTime;
    this._noise(out, t, 1.1, { freq: 3200, q: 0.5, gain: 0.7, attack: 0.05 });
    this._tone(out, t, 0.1, { from: 200, to: 80, gain: 0.5 });
  }

  molotov(pos) {
    if (!this.ready()) return;
    const out = this._out(pos, 0.9, 2000); if (!out) return;
    const t = this.ctx.currentTime;
    this._tone(out, t, 0.18, { from: 180, to: 60, gain: 0.7 });
    for (let i = 0; i < 9; i++) this._noise(out, t + 0.1 + i * 0.09 + Math.random() * 0.05, 0.05, { freq: 2500 + Math.random() * 1500, gain: 0.35 });
    this._noise(out, t, 0.9, { type: 'lowpass', freq: 1200, gain: 0.35, attack: 0.04 });
  }

  throwNade(pos) {
    if (!this.ready()) return;
    const out = this._out(pos, 0.5, 900); if (!out) return;
    this._noise(out, this.ctx.currentTime, 0.18, { freq: 700, q: 0.8, gain: 0.5, sweepTo: 1800 });
  }

  bounce(pos) { if (!this.ready() || this._throttle('bnc', 60)) return; const out = this._out(pos, 0.3, 700); if (out) this._tone(out, this.ctx.currentTime, 0.05, { type: 'triangle', from: 700, to: 400, gain: 0.3 }); }

  beep(pos, urgency = 0) {
    if (!this.ready()) return;
    const out = this._out(pos, 0.8, 2400); if (!out) return;
    const t = this.ctx.currentTime;
    this._tone(out, t, 0.09, { type: 'square', from: 1900 + urgency * 500, gain: 0.22 });
  }

  plantTick(pos) { if (!this.ready() || this._throttle('pt', 200)) return; const out = this._out(pos, 0.6, 1400); if (out) this._tone(out, this.ctx.currentTime, 0.05, { type: 'square', from: 1400, gain: 0.15 }); }

  planted(pos) {
    if (!this.ready()) return;
    const out = this._out(pos, 0.9, 6000); if (!out) return;
    const t = this.ctx.currentTime;
    for (let i = 0; i < 3; i++) this._tone(out, t + i * 0.12, 0.09, { type: 'square', from: 1500, gain: 0.25 });
  }

  defused() {
    if (!this.ready()) return;
    const out = this._out(null, 0.7); const t = this.ctx.currentTime;
    [660, 880, 1100, 1320].forEach((f, i) => this._tone(out, t + i * 0.08, 0.14, { type: 'triangle', from: f, gain: 0.3 }));
  }

  buy() { if (!this.ready()) return; const out = this._out(null, 0.5); const t = this.ctx.currentTime; this._tone(out, t, 0.08, { type: 'triangle', from: 1300, gain: 0.35 }); this._tone(out, t + 0.07, 0.14, { type: 'triangle', from: 1950, gain: 0.35 }); }
  pickup(pos) { if (!this.ready()) return; const out = this._out(pos, 0.5, 600); if (!out) return; const t = this.ctx.currentTime; this._noise(out, t, 0.05, { freq: 2500, gain: 0.6 }); this._tone(out, t, 0.06, { type: 'square', from: 500, to: 800, gain: 0.1 }); }
  click() { if (!this.ready()) return; const out = this._out(null, 0.35); this._tone(out, this.ctx.currentTime, 0.03, { type: 'triangle', from: 1100, gain: 0.35 }); }
  switchWeapon() { if (!this.ready() || this._throttle('sw', 60)) return; const out = this._out(null, 0.3); const t = this.ctx.currentTime; this._noise(out, t, 0.04, { freq: 2200, gain: 0.5 }); this._tone(out, t, 0.04, { type: 'square', from: 400, to: 250, gain: 0.08 }); }
  ping() { if (!this.ready()) return; const out = this._out(null, 0.5); const t = this.ctx.currentTime; this._tone(out, t, 0.12, { from: 1500, to: 1000, gain: 0.35 }); this._tone(out, t + 0.1, 0.12, { from: 1500, to: 1000, gain: 0.25 }); }
  chat() { if (!this.ready() || this._throttle('chat', 200)) return; const out = this._out(null, 0.3); this._tone(out, this.ctx.currentTime, 0.06, { type: 'triangle', from: 900, to: 1200, gain: 0.3 }); }

  roundStart() {
    if (!this.ready()) return;
    const out = this._out(null, 0.5); const t = this.ctx.currentTime;
    this._tone(out, t, 0.2, { type: 'sawtooth', from: 330, gain: 0.18 }); this._tone(out, t + 0.22, 0.32, { type: 'sawtooth', from: 440, gain: 0.18 });
  }
  roundWin() { if (!this.ready()) return; const out = this._out(null, 0.6); const t = this.ctx.currentTime; [523, 659, 784, 1047].forEach((f, i) => this._tone(out, t + i * 0.1, 0.22, { type: 'triangle', from: f, gain: 0.3 })); }
  roundLose() { if (!this.ready()) return; const out = this._out(null, 0.6); const t = this.ctx.currentTime; [392, 330, 262].forEach((f, i) => this._tone(out, t + i * 0.16, 0.28, { type: 'triangle', from: f, gain: 0.28 })); }
  countdown() { if (!this.ready() || this._throttle('cd', 300)) return; const out = this._out(null, 0.4); this._tone(out, this.ctx.currentTime, 0.08, { type: 'sine', from: 900, gain: 0.3 }); }
}

export const audio = new AudioEngine();
