// Recorded, spatial Battlefield audio. CS retains its separate legacy engine.
import { AudioEngine } from './audio.js';

const BASE = new window.URL('../assets/audio/', import.meta.url).href;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const MATERIAL = { B: 'impactMining', R: 'impactMining', '#': 'impactMining', G: 'impactGlass_heavy', X: 'impactWood_heavy', T: 'impactWood_heavy', M: 'impactMetal_heavy', o: 'impactMetal_heavy', '=': 'impactMetal_heavy', L: 'impactSoft_heavy' };
class BattlefieldAudio extends AudioEngine {
  constructor() { super(); this.buffers = new Map(); this.loops = new Map(); this.voices = new Set(); this.lastVariant = new Map(); this.loadErrors = []; this.yaw = 0; this.lz = 26; this.worldActive = false; }
  unlock() {
    super.unlock();
    if (!this.ctx || this.loading) return;
    const c = this.ctx;
    this.reverb = c.createConvolver();
    const impulse = c.createBuffer(2, c.sampleRate * 1.35, c.sampleRate);
    for (let ch = 0; ch < 2; ch++) { const a = impulse.getChannelData(ch); for (let i = 0; i < a.length; i++) a[i] = (Math.random() * 2 - 1) * Math.exp(-i / c.sampleRate * 7) * .17; }
    this.reverb.buffer = impulse; const wet = c.createGain(); wet.gain.value = .14; this.reverb.connect(wet); wet.connect(this.master);
    this.loading = (async () => {
      const manifest = await (await window.fetch(BASE + 'manifest.json')).json();
      await Promise.all(Object.entries(manifest).map(async ([family, files]) => {
        const decoded = await Promise.all(files.map(async (file) => {
          try { const r = await window.fetch(BASE + file); if (!r.ok) throw Error(r.status); return await c.decodeAudioData(await r.arrayBuffer()); }
          catch (e) { this.loadErrors.push(file + ': ' + e.message); return null; }
        })); this.buffers.set(family, decoded.filter(Boolean));
      }));
    })().catch((e) => this.loadErrors.push(e.message));
  }
  ready() { return super.ready() && !this.muted; }
  setListener(x, y, yaw = 0, z = 26, map = null) {
    super.setListener(x, y); this.yaw = yaw; this.lz = z; this.map = map;
    if (!this.ctx) return;
    const l = this.ctx.listener, t = this.ctx.currentTime;
    if (l.positionX) {
      l.positionX.setTargetAtTime(x / 16, t, .025); l.positionY.setTargetAtTime(z / 16, t, .025); l.positionZ.setTargetAtTime(y / 16, t, .025);
      l.forwardX.setTargetAtTime(Math.cos(yaw), t, .025); l.forwardY.value = 0; l.forwardZ.setTargetAtTime(Math.sin(yaw), t, .025); l.upX.value = 0; l.upY.value = 1; l.upZ.value = 0;
    } else { l.setPosition(x / 16, z / 16, y / 16); l.setOrientation(Math.cos(yaw), 0, Math.sin(yaw), 0, 1, 0); }
  }
  spatial(pos, gain, maxDist = 4000) {
    const c = this.ctx, d = pos ? Math.hypot(pos.x - this.lx, pos.y - this.ly, (pos.z ?? this.lz) - this.lz) : 0;
    if (d > maxDist) return null;
    const out = c.createGain(), filter = c.createBiquadFilter(); filter.type = 'lowpass';
    const pan = pos ? c.createPanner() : null;
    const route = { out, filter, pan, nodes: [out, filter], delay: pos ? d / 16 / 343 : 0 };
    this.position(route, pos, gain); out.connect(filter);
    if (pan) { pan.panningModel = 'HRTF'; pan.distanceModel = 'inverse'; pan.refDistance = 4; pan.rolloffFactor = .65; pan.maxDistance = maxDist / 16; filter.connect(pan); pan.connect(this.master); pan.connect(this.reverb); route.nodes.push(pan); }
    else { filter.connect(this.master); filter.connect(this.reverb); }
    return route;
  }
  position(route, pos, gain) {
    const t = this.ctx.currentTime, d = pos ? Math.hypot(pos.x - this.lx, pos.y - this.ly) : 0;
    const blocked = pos && d > 40 && this.map && !this.map.los(this.lx, this.ly, pos.x, pos.y, this.lz, pos.z ?? this.map.heightAt(pos.x, pos.y) + 20);
    route.out.gain.setTargetAtTime(gain * (blocked ? .5 : 1), t, .03);
    route.filter.frequency.setTargetAtTime(blocked ? 1000 : clamp(15000 / (1 + d / 850), 1700, 15000), t, .04);
    if (route.pan && pos) { route.pan.positionX.setTargetAtTime(pos.x / 16, t, .025); route.pan.positionY.setTargetAtTime((pos.z ?? this.lz) / 16, t, .025); route.pan.positionZ.setTargetAtTime(pos.y / 16, t, .025); }
  }
  _out(pos, vol, maxDist = 1500) {
    // Small UI/warning tones from the base engine also use the corrected spatial convention.
    if (pos) { const route = this.spatial(pos, vol * .55, maxDist); if (!route) return null; window.setTimeout(() => { for (const n of route.nodes) n.disconnect(); }, 4000); return route.out; }
    const out = this.ctx.createGain(); out.gain.value = vol * .45; out.connect(this.master); window.setTimeout(() => out.disconnect(), 4000); return out;
  }
  sample(family) {
    const list = this.buffers.get(family); if (!list?.length) return null;
    let i = Math.floor(Math.random() * list.length); if (list.length > 1 && i === this.lastVariant.get(family)) i = (i + 1) % list.length;
    this.lastVariant.set(family, i); return list[i];
  }
  play(family, pos = null, gain = .7, rate = 1, maxDist = 4000, delay = 0, lowpass = 0) {
    if (!this.ready() || !this.worldActive) return false;
    const buffer = this.sample(family); if (!buffer) return false;
    const route = this.spatial(pos, gain, maxDist); if (!route) return false;
    if (lowpass) { route.filter.frequency.cancelScheduledValues(this.ctx.currentTime); route.filter.frequency.value = lowpass; }
    // Bound polyphony in a 32-player firefight. Stop the oldest voice and disconnect every node.
    if (this.voices.size >= 64) { const oldest = this.voices.values().next().value; oldest.stop(); oldest.onended?.(); oldest.onended = null; }
    const src = this.ctx.createBufferSource(); src.buffer = buffer; src.playbackRate.value = rate; src.connect(route.out); this.voices.add(src);
    src.onended = () => { this.voices.delete(src); src.disconnect(); for (const n of route.nodes) n.disconnect(); };
    src.start(this.ctx.currentTime + Math.min(.6, route.delay) + delay); return true;
  }
  shot(kind, pos, suppressed = false, own = false) {
    const family = { smg: 'pistol', dmr: 'rifle', lmg: 'rifle' }[kind] || kind;
    this.play(family, pos, suppressed ? .13 : own ? .8 : .7, (kind === 'smg' ? 1.17 : kind === 'lmg' ? .88 : 1) * (.97 + Math.random() * .06), suppressed ? 750 : 4000, 0, suppressed ? 1600 : 0);
    if (own && !suppressed) this.play('impactMetal_heavy', null, .045, 1.5, 600, .055);
  }
  vshot(kind, pos) { if (kind === 'cannon') this.play('cannon', pos, 1.15, .85, 6000); else if (kind === 'rocket') this.launch(0, pos); else this.shot(kind === 'cannon2' ? 'sniper' : 'lmg', pos); }
  explosion(kind, pos) { this.play('explosion', pos, kind === 'bomb' ? 1.1 : .85, kind === 'bomb' ? .7 : 1, 6000); this.play('impactMining', pos, .5, .7, 2800, .12); }
  material(ch, pos, force = .5) { if (!this._throttle('material:' + ch + ':' + Math.round(pos.x / 48), 65)) this.play(MATERIAL[ch] || 'impactMining', pos, clamp(force, .08, .75), .85 + Math.random() * .3, 1300); }
  collapse(pos) { this.play('impactMining', pos, .85, .6, 2500); this.play('impactWood_heavy', pos, .55, .65, 1800, .2); this.play('impactMining', pos, .7, .75, 2400, .55); }
  stepFamily(pos) {
    if (!this.map) return 'footstep_concrete'; const x = pos?.x ?? this.lx, y = pos?.y ?? this.ly, ch = this.map.charAt(Math.floor(x / 32), Math.floor(y / 32));
    return ch === '.' || ch === ',' || ch === 't' || ch === 'c' ? 'footstep_grass' : ch === ':' || ch === 'r' || ch === 'd' ? 'footstep_snow' : 'footstep_concrete';
  }
  ownStep(loud) { if (!this._throttle('ownstep', 130)) this.play(this.stepFamily(), null, loud ? .5 : .2, loud ? .85 : .96 + Math.random() * .08, 700); }
  step(pos) { if (!this._throttle('step:' + Math.round(pos.x / 30) + ':' + Math.round(pos.y / 30), 100)) this.play(this.stepFamily(pos), pos, .38, .95 + Math.random() * .1, 750); }
  reload(pos, kind = 'rifle', duration = 2.4) { const family = kind === 'pistol' ? 'reloadPistol' : kind === 'shotgun' ? 'bolt' : 'reload'; const b = this.buffers.get(family)?.[0]; this.play(family, pos, .45, b ? clamp(b.duration / duration, .6, 1.6) : 1, 800); }
  switchWeapon() { if (!this._throttle('switch', 80)) this.play('bolt', null, .16, 1.4); }
  empty() { if (!this._throttle('empty', 170)) this.play('impactMetal_heavy', null, .12, 1.7); }
  doorOpen() { this.play('impactMetal_heavy', null, .3, .85); }
  crash(pos = null) { if (!this._throttle('crash', 180)) { this.play('impactMetal_heavy', pos, .7, .7); this.play('impactGlass_heavy', pos, .25, 1.1); } }
  bounce(pos) { this.material('M', pos, .25); }
  throwNade(pos) { this.play('bolt', pos, .15, 1.2); }
  launch(idx, pos) { this.play('cannon', pos, .7, 1.35, 4000); }
  flareBurst(pos) { this.play('explosion', pos, .3, 1.8, 1700); }
  smoke(pos) { this.play('bolt', pos, .25, .8); }
  flash(pos) { this.play('cannon', pos, .5, 1.5); }
  molotov(pos) { this.play('impactGlass_heavy', pos, .65); }
  knife(pos, hit) { this.play(hit ? 'impactSoft_heavy' : 'bolt', pos, hit ? .6 : .13, 1.3); }
  hurt() { if (!this._throttle('hurt', 100)) this.play('impactSoft_heavy', null, .5, .85); }
  death(pos) { this.play('impactSoft_heavy', pos, .6, .65); }
  deploy(pos) { this.play('impactMetal_heavy', pos, .2, 1.2); }
  repair(pos) { if (!this._throttle('repair', 230)) this.play('bolt', pos, .15, .9); }
  engine(kind, speed, pos, id = kind) {
    if (!this.ready() || !this.worldActive) return;
    const key = 'vehicle:' + id; let loop = this.loops.get(key);
    if (!loop) {
      if (this.loops.size >= 16) return;
      const buffer = this.sample(kind === 'heli' ? 'rotor' : 'engine'); if (!buffer) return;
      const route = this.spatial(pos, 0, 2000); if (!route) return;
      const src = this.ctx.createBufferSource(); src.buffer = buffer; src.loop = true; src.connect(route.out); src.start(0, Math.random() * buffer.duration);
      loop = { src, route, seen: performance.now() }; this.loops.set(key, loop);
    }
    const base = { tank: .68, apc: .8, jeep: 1, quad: 1.45, boat: 1.1, heli: 1 }[kind] || 1;
    loop.src.playbackRate.setTargetAtTime(kind === 'heli' ? 1 + Math.min(.12, speed / 2000) : base + clamp(speed / 240, 0, 1) * .65, this.ctx.currentTime, .16);
    this.position(loop.route, pos, (kind === 'heli' ? .58 : .3) * (.6 + Math.min(.7, speed / 280))); loop.seen = performance.now();
  }
  ambient() {
    if (!this.ready() || !this.worldActive || !this.map) return;
    let loop = this.loops.get('ambience');
    if (!loop) {
      const buffer = this.sample('wind'); if (!buffer) return;
      const route = this.spatial(null, 0); const src = this.ctx.createBufferSource(); src.buffer = buffer; src.loop = true; src.connect(route.out); src.start();
      loop = { src, route, seen: performance.now() }; this.loops.set('ambience', loop);
    }
    const inside = Number.isFinite(this.map.ceilingAt(this.lx, this.ly, this.lz - 26));
    const duck = this.voices.size > 4 ? .4 : 1;
    loop.route.out.gain.setTargetAtTime(.055 * (inside ? .22 : 1) * duck, this.ctx.currentTime, .3);
    loop.route.filter.frequency.setTargetAtTime(inside ? 450 : 4200, this.ctx.currentTime, .3); loop.seen = performance.now();
  }
  tick() { this.ambient(); for (const [id, loop] of this.loops) if (!this.ready() || !this.worldActive || performance.now() - loop.seen > 350) { this.stopLoop(id, loop); } }
  stopLoop(id, loop) {
    const t = this.ctx.currentTime; loop.route.out.gain.cancelScheduledValues(t); loop.route.out.gain.setValueAtTime(loop.route.out.gain.value, t); loop.route.out.gain.linearRampToValueAtTime(0, t + .04);
    loop.src.onended = () => { loop.src.disconnect(); for (const n of loop.route.nodes) n.disconnect(); }; loop.src.stop(t + .05); this.loops.delete(id);
  }
  startWorld() { this.worldActive = true; }
  stopWorld() { this.worldActive = false; for (const [id, loop] of this.loops) this.stopLoop(id, loop); for (const src of [...this.voices]) { src.stop(); src.onended?.(); src.onended = null; } this.map = null; }
}
export const audio = new BattlefieldAudio();
