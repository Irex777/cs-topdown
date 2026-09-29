// Particles, tracers, decals and screen shake.
const rnd = Math.random;
const TAU = Math.PI * 2;

export class FX {
  constructor() {
    this.parts = [];
    this.tracers = [];
    this.rings = [];
    this.floaters = [];
    this.decal = null;
    this.dctx = null;
    this.shake = 0;
    this.shakeX = 0; this.shakeY = 0;
  }

  initMap(map) {
    this.decal = document.createElement('canvas');
    this.decal.width = map.width; this.decal.height = map.height;
    this.dctx = this.decal.getContext('2d');
    this.parts.length = 0; this.tracers.length = 0; this.rings.length = 0; this.floaters.length = 0;
  }

  clearRound() {
    if (this.dctx) this.dctx.clearRect(0, 0, this.decal.width, this.decal.height);
    this.parts.length = 0; this.tracers.length = 0; this.rings.length = 0; this.floaters.length = 0;
  }

  addShake(a) { this.shake = Math.min(14, this.shake + a); }

  // ------------------------------------------------------------------ spawners
  tracer(x0, y0, x1, y1, own, big) {
    this.tracers.push({ x0, y0, x1, y1, t: 0, life: big ? 0.16 : 0.09, own, big });
    if (this.tracers.length > 120) this.tracers.shift();
  }

  blood(x, y, dir, n = 8) {
    for (let i = 0; i < n; i++) {
      const a = dir + (rnd() - 0.5) * 1.1, sp = 60 + rnd() * 200;
      this.parts.push({ k: 'blood', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.25 + rnd() * 0.35, t: 0, r: 1 + rnd() * 2.2 });
    }
    this.splat(x, y, dir, 3 + Math.floor(rnd() * 3), 1);
  }

  splat(x, y, dir, n, spread) {
    const c = this.dctx; if (!c) return;
    for (let i = 0; i < n; i++) {
      const d = 4 + rnd() * 16 * spread;
      const a = dir + (rnd() - 0.5) * 1.6;
      c.fillStyle = `rgba(${120 + (rnd() * 30) | 0},8,10,${0.28 + rnd() * 0.3})`;
      c.beginPath(); c.ellipse(x + Math.cos(a) * d, y + Math.sin(a) * d, 1.5 + rnd() * 3.5, 1 + rnd() * 2.5, a, 0, TAU); c.fill();
    }
  }

  corpseStain(x, y) {
    const c = this.dctx; if (!c) return;
    for (let i = 0; i < 9; i++) {
      c.fillStyle = `rgba(${110 + (rnd() * 30) | 0},6,8,${0.25 + rnd() * 0.25})`;
      c.beginPath(); c.ellipse(x + (rnd() - 0.5) * 22, y + (rnd() - 0.5) * 22, 3 + rnd() * 8, 2 + rnd() * 6, rnd() * 3, 0, TAU); c.fill();
    }
  }

  scorch(x, y, r) {
    const c = this.dctx; if (!c) return;
    const g = c.createRadialGradient(x, y, 2, x, y, r);
    g.addColorStop(0, 'rgba(0,0,0,0.55)'); g.addColorStop(0.6, 'rgba(20,14,8,0.3)'); g.addColorStop(1, 'rgba(0,0,0,0)');
    c.fillStyle = g; c.beginPath(); c.arc(x, y, r, 0, TAU); c.fill();
  }

  sparks(x, y, dir, n = 5) {
    for (let i = 0; i < n; i++) {
      const a = dir + Math.PI + (rnd() - 0.5) * 1.6, sp = 80 + rnd() * 220;
      this.parts.push({ k: 'spark', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.1 + rnd() * 0.15, t: 0, r: 1 });
    }
    this.parts.push({ k: 'puff', x, y, vx: 0, vy: 0, life: 0.35, t: 0, r: 4, grow: 14, col: '190,190,190', a0: 0.25 });
  }

  casing(x, y, ang) {
    const a = ang + Math.PI / 2 + (rnd() - 0.5) * 0.6, sp = 90 + rnd() * 70;
    this.parts.push({ k: 'casing', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.5, t: 0, r: 1.6, rot: rnd() * 6, vr: (rnd() - 0.5) * 30 });
  }

  muzzleSmoke(x, y, ang) {
    this.parts.push({ k: 'puff', x: x + Math.cos(ang) * 4, y: y + Math.sin(ang) * 4, vx: Math.cos(ang) * 20, vy: Math.sin(ang) * 20, life: 0.5, t: 0, r: 3, grow: 12, col: '200,200,200', a0: 0.18 });
  }

  ring(x, y, r0, r1, life, color, width = 3) { this.rings.push({ x, y, r0, r1, life, t: 0, color, width }); }

  explosion(x, y, big) {
    const n = big ? 60 : 26;
    for (let i = 0; i < n; i++) {
      const a = rnd() * TAU, sp = (big ? 90 : 60) + rnd() * (big ? 420 : 260);
      this.parts.push({ k: 'fire', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.35 + rnd() * 0.5, t: 0, r: 4 + rnd() * (big ? 14 : 9) });
    }
    for (let i = 0; i < (big ? 26 : 12); i++) {
      const a = rnd() * TAU, sp = 20 + rnd() * 120;
      this.parts.push({ k: 'puff', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 1 + rnd() * 1.2, t: 0, r: 10 + rnd() * 10, grow: 26, col: '70,64,60', a0: 0.5 });
    }
    this.ring(x, y, 10, big ? 460 : 250, big ? 0.7 : 0.4, 'rgba(255,200,120,0.9)', big ? 8 : 5);
    this.parts.push({ k: 'flare', x, y, vx: 0, vy: 0, life: 0.22, t: 0, r: big ? 260 : 150 });
    this.scorch(x, y, big ? 130 : 60);
  }

  flashBurst(x, y) {
    this.parts.push({ k: 'flare', x, y, vx: 0, vy: 0, life: 0.35, t: 0, r: 220 });
    this.ring(x, y, 10, 200, 0.3, 'rgba(255,255,255,0.9)', 4);
  }

  molotovSplash(x, y) {
    for (let i = 0; i < 26; i++) {
      const a = rnd() * TAU, sp = 40 + rnd() * 200;
      this.parts.push({ k: 'fire', x, y, vx: Math.cos(a) * sp, vy: Math.sin(a) * sp, life: 0.3 + rnd() * 0.4, t: 0, r: 3 + rnd() * 6 });
    }
    this.scorch(x, y, 50);
  }

  flames(x, y, r) {
    // called each frame for active fires
    for (let i = 0; i < 2; i++) {
      const a = rnd() * TAU, d = Math.sqrt(rnd()) * r;
      this.parts.push({ k: 'fire', x: x + Math.cos(a) * d, y: y + Math.sin(a) * d, vx: (rnd() - 0.5) * 16, vy: -10 - rnd() * 24, life: 0.3 + rnd() * 0.35, t: 0, r: 4 + rnd() * 6 });
    }
  }

  floater(x, y, text, color) { this.floaters.push({ x, y, text, color, t: 0, life: 1.4 }); }

  // ------------------------------------------------------------------ update / draw
  update(dt) {
    for (let i = this.parts.length - 1; i >= 0; i--) {
      const p = this.parts[i];
      p.t += dt;
      if (p.t >= p.life) { this.parts[i] = this.parts[this.parts.length - 1]; this.parts.pop(); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt;
      if (p.k === 'blood' || p.k === 'spark' || p.k === 'casing') { const f = Math.exp(-4 * dt); p.vx *= f; p.vy *= f; }
      else if (p.k === 'puff') { const f = Math.exp(-2 * dt); p.vx *= f; p.vy *= f; }
      if (p.rot !== undefined) p.rot += p.vr * dt;
    }
    for (let i = this.tracers.length - 1; i >= 0; i--) { this.tracers[i].t += dt; if (this.tracers[i].t > this.tracers[i].life) this.tracers.splice(i, 1); }
    for (let i = this.rings.length - 1; i >= 0; i--) { this.rings[i].t += dt; if (this.rings[i].t > this.rings[i].life) this.rings.splice(i, 1); }
    for (let i = this.floaters.length - 1; i >= 0; i--) { this.floaters[i].t += dt; if (this.floaters[i].t > this.floaters[i].life) this.floaters.splice(i, 1); }
    if (this.parts.length > 900) this.parts.splice(0, this.parts.length - 900);
    this.shake *= Math.exp(-7 * dt);
    if (this.shake < 0.05) this.shake = 0;
    this.shakeX = (rnd() - 0.5) * 2 * this.shake;
    this.shakeY = (rnd() - 0.5) * 2 * this.shake;
  }

  drawGround(ctx) {
    if (this.decal) ctx.drawImage(this.decal, 0, 0);
  }

  /** particles that sit under players */
  drawLow(ctx) {
    for (const p of this.parts) {
      if (p.k === 'casing') {
        ctx.save(); ctx.translate(p.x, p.y); ctx.rotate(p.rot);
        ctx.globalAlpha = 1 - p.t / p.life; ctx.fillStyle = '#d7b14a'; ctx.fillRect(-2, -1, 4, 2); ctx.restore();
      } else if (p.k === 'blood') {
        ctx.globalAlpha = 1 - p.t / p.life; ctx.fillStyle = '#8f0d12'; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
      }
    }
    ctx.globalAlpha = 1;
  }

  drawHigh(ctx) {
    for (const p of this.parts) {
      const k = p.t / p.life;
      if (p.k === 'spark') {
        ctx.globalAlpha = 1 - k; ctx.fillStyle = '#ffd98a'; ctx.fillRect(p.x - 1, p.y - 1, 2, 2);
      } else if (p.k === 'puff') {
        ctx.globalAlpha = (p.a0 || 0.3) * (1 - k); ctx.fillStyle = `rgb(${p.col})`;
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r + p.grow * k, 0, TAU); ctx.fill();
      } else if (p.k === 'fire') {
        ctx.globalAlpha = (1 - k) * 0.9;
        ctx.fillStyle = k < 0.35 ? '#ffe28a' : k < 0.7 ? '#ff8a2a' : '#c23a12';
        ctx.beginPath(); ctx.arc(p.x, p.y, p.r * (1 - k * 0.6), 0, TAU); ctx.fill();
      } else if (p.k === 'flare') {
        const a = (1 - k);
        const g = ctx.createRadialGradient(p.x, p.y, 0, p.x, p.y, p.r);
        g.addColorStop(0, `rgba(255,240,200,${0.85 * a})`); g.addColorStop(1, 'rgba(255,200,120,0)');
        ctx.globalAlpha = 1; ctx.fillStyle = g; ctx.beginPath(); ctx.arc(p.x, p.y, p.r, 0, TAU); ctx.fill();
      }
    }
    for (const r of this.rings) {
      const k = r.t / r.life;
      ctx.globalAlpha = (1 - k) * 0.9; ctx.strokeStyle = r.color; ctx.lineWidth = r.width * (1 - k * 0.5);
      ctx.beginPath(); ctx.arc(r.x, r.y, r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - k, 2)), 0, TAU); ctx.stroke();
    }
    for (const t of this.tracers) {
      const k = t.t / t.life;
      ctx.globalAlpha = (1 - k) * (t.own ? 0.9 : 0.75);
      const g = ctx.createLinearGradient(t.x0, t.y0, t.x1, t.y1);
      g.addColorStop(0, 'rgba(255,230,150,0)'); g.addColorStop(0.15, 'rgba(255,240,190,0.9)'); g.addColorStop(1, 'rgba(255,200,90,0.5)');
      ctx.strokeStyle = g; ctx.lineWidth = t.big ? 2.4 : 1.4;
      ctx.beginPath(); ctx.moveTo(t.x0, t.y0); ctx.lineTo(t.x1, t.y1); ctx.stroke();
    }
    ctx.globalAlpha = 1;
  }

  drawFloaters(ctx) {
    ctx.textAlign = 'center'; ctx.font = '700 15px system-ui, sans-serif';
    for (const f of this.floaters) {
      const k = f.t / f.life;
      ctx.globalAlpha = 1 - k * k;
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillText(f.text, f.x + 1, f.y - k * 34 + 1);
      ctx.fillStyle = f.color; ctx.fillText(f.text, f.x, f.y - k * 34);
    }
    ctx.globalAlpha = 1;
  }
}
