// Draws the world: map, entities, fog of war, and the screen-space overlays around the crosshair.
import {
  PLAYER_R, SPEC, GREN_ORDER, HE_RADIUS, SMOKE_RADIUS, FIRE_RADIUS, GREN_MAX_DIST, GREN_MIN_DIST,
} from '../../../shared/constants.js';
import { WEAPON_LIST, HELD_GREN_BASE } from '../../../shared/weapons.js';
import { canSee } from '../../../shared/vision.js';
import { computeVision } from './vision.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

export const TEAM_COL = {
  0: { body: '#d39a3a', dark: '#8a5f17', helm: '#a8741e', text: '#f4b544' },
  1: { body: '#3f86d8', dark: '#1f4c85', helm: '#28599a', text: '#5aa7ff' },
  2: { body: '#888', dark: '#555', helm: '#666', text: '#bbb' },
};
const GREN_COL = { he: '#4a6b3a', flash: '#e8e8e8', smoke: '#b0b8c0', molo: '#d4552a' };

export class Renderer {
  constructor(canvas, game) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.game = game;
    this.dpr = 1;
    this.W = 0; this.H = 0;
    this.scale = 1;
    this.userZoom = 1;
    this.cam = { x: 0, y: 0 };
    this.fogCanvas = document.createElement('canvas');
    this.fctx = this.fogCanvas.getContext('2d');
    this.map = null; this.art = null;
    this.t = 0;
    this.smoothCam = null;
    this.seen = new Map();
    this.viewRect = { x0: 0, y0: 0, x1: 0, y1: 0 };
    try { const z = parseFloat(localStorage.getItem('cs.zoom')); if (Number.isFinite(z)) this.userZoom = clamp(z, 0.7, 1.4); } catch { /* ignore */ }
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  setMap(map, art) { this.map = map; this.art = art; this.smoothCam = null; }

  setZoom(z) { this.userZoom = clamp(z, 0.7, 1.4); try { localStorage.setItem('cs.zoom', String(this.userZoom)); } catch { /* ignore */ } }

  resize() {
    this.dpr = Math.min(window.devicePixelRatio || 1, 2);
    this.W = window.innerWidth; this.H = window.innerHeight;
    this.canvas.width = Math.floor(this.W * this.dpr);
    this.canvas.height = Math.floor(this.H * this.dpr);
    this.canvas.style.width = this.W + 'px';
    this.canvas.style.height = this.H + 'px';
    this.fogCanvas.width = Math.ceil(this.canvas.width / 2);
    this.fogCanvas.height = Math.ceil(this.canvas.height / 2);
  }

  worldToScreen(x, y) { return { x: (x - this.cam.x) * this.scale + this.W / 2, y: (y - this.cam.y) * this.scale + this.H / 2 }; }
  screenToWorld(sx, sy) { return { x: (sx - this.W / 2) / this.scale + this.cam.x, y: (sy - this.H / 2) / this.scale + this.cam.y }; }

  // ------------------------------------------------------------------ main
  render(dt, nowMs) {
    const g = this.game, ctx = this.ctx;
    if (!this.map) return;
    this.t = nowMs / 1000;
    // fixed amount of world on screen (ultra-wide monitors must not see farther than everyone else)
    this.scale = Math.max(this.H / 720, this.W / 1750) * this.userZoom;
    const viewer = g.viewer();

    // ---- camera
    let tx, ty;
    const inp = g.input;
    if (g.freecam) {
      const sp = 900 / this.scale * dt;
      if (inp.down.has('KeyW')) g.cam.y -= sp; if (inp.down.has('KeyS')) g.cam.y += sp;
      if (inp.down.has('KeyA')) g.cam.x -= sp; if (inp.down.has('KeyD')) g.cam.x += sp;
      tx = g.cam.x; ty = g.cam.y;
    } else if (viewer) {
      const own = g.alive && g.me && g.me.own;
      let lx = 0, ly = 0;
      if (own) {
        const k = viewer.scoped ? 0.92 : 0.30;
        lx = (inp.mx - this.W / 2) * k / this.scale;
        ly = (inp.my - this.H / 2) * k / this.scale;
        const m = viewer.scoped ? 700 : 360;
        const l = Math.hypot(lx, ly);
        if (l > m) { lx *= m / l; ly *= m / l; }
      }
      tx = viewer.x + lx; ty = viewer.y + ly;
    } else { tx = this.map.width / 2; ty = this.map.height / 2; }
    if (!this.smoothCam) this.smoothCam = { x: tx, y: ty };
    const follow = 1 - Math.exp(-(viewer && g.alive ? 16 : 7) * dt);
    this.smoothCam.x += (tx - this.smoothCam.x) * follow;
    this.smoothCam.y += (ty - this.smoothCam.y) * follow;
    this.cam.x = this.smoothCam.x + g.fx.shakeX;
    this.cam.y = this.smoothCam.y + g.fx.shakeY;
    const halfW = this.W / 2 / this.scale, halfH = this.H / 2 / this.scale;
    this.viewRect = { x0: this.cam.x - halfW - 40, y0: this.cam.y - halfH - 40, x1: this.cam.x + halfW + 40, y1: this.cam.y + halfH + 40 };

    // ---- world layer
    const sc = this.scale * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(sc, 0, 0, sc, (this.W / 2 - this.cam.x * this.scale) * this.dpr, (this.H / 2 - this.cam.y * this.scale) * this.dpr);
    const vr = this.viewRect;
    const sx = clamp(Math.floor(vr.x0), 0, this.map.width), sy = clamp(Math.floor(vr.y0), 0, this.map.height);
    const ex = clamp(Math.ceil(vr.x1), 0, this.map.width), ey = clamp(Math.ceil(vr.y1), 0, this.map.height);
    if (ex > sx && ey > sy) {
      ctx.drawImage(this.art, sx, sy, ex - sx, ey - sy, sx, sy, ex - sx, ey - sy);
      if (g.fx.decal) ctx.drawImage(g.fx.decal, sx, sy, ex - sx, ey - sy, sx, sy, ex - sx, ey - sy);
    }

    const smokes = g.smokeCircles();
    this.drawSites(ctx);
    this.drawDrops(ctx, viewer);
    this.drawBomb(ctx);
    this.drawCorpses(ctx);
    g.fx.drawLow(ctx);
    this.drawFires(ctx);
    this.drawGrenades(ctx);
    this.drawPlayers(ctx, viewer, smokes);
    g.fx.drawHigh(ctx);
    this.drawSmokes(ctx);

    // ---- fog of war
    let poly = null;
    if (viewer && g.fogOn && !g.freecam) poly = computeVision(this.map, smokes, viewer.x, viewer.y, viewer.angle, viewer.view);
    this.drawFog(poly, viewer);

    // ---- world-space labels that should stay readable in the dark
    ctx.setTransform(sc, 0, 0, sc, (this.W / 2 - this.cam.x * this.scale) * this.dpr, (this.H / 2 - this.cam.y * this.scale) * this.dpr);
    this.drawLabels(ctx, viewer);
    this.drawPings(ctx);
    g.fx.drawFloaters(ctx);

    // ---- screen-space overlays
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawOffscreenMarkers(ctx);
    this.drawOverlays(ctx, viewer, dt);
  }

  inView(x, y, m = 40) { const v = this.viewRect; return x > v.x0 - m && x < v.x1 + m && y > v.y0 - m && y < v.y1 + m; }

  // ------------------------------------------------------------------ world entities
  drawSites(ctx) { void ctx; }

  drawDrops(ctx, viewer) {
    const g = this.game;
    for (const d of g.ents.dr) {
      const [, widx, x, y] = d;
      if (!this.inView(x, y)) continue;
      const w = WEAPON_LIST[widx];
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 4 + x);
      ctx.save(); ctx.translate(x, y); ctx.rotate(0.5);
      ctx.fillStyle = `rgba(255,255,255,${0.06 + 0.06 * pulse})`; ctx.beginPath(); ctx.arc(0, 0, 15, 0, TAU); ctx.fill();
      ctx.strokeStyle = `rgba(255,255,255,${0.25 + 0.2 * pulse})`; ctx.lineWidth = 1; ctx.stroke();
      ctx.translate(-9, 0);
      this.drawGunShape(ctx, w, 1);
      ctx.restore();
      if (viewer && Math.hypot(viewer.x - x, viewer.y - y) < 90) {
        ctx.font = '600 9px system-ui, sans-serif'; ctx.textAlign = 'center';
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillText(w.name, x + 1, y - 17);
        ctx.fillStyle = '#fff'; ctx.fillText(w.name, x, y - 18);
      }
    }
  }

  drawBomb(ctx) {
    const b = this.game.bombInfo;
    if (!b) return;
    const [state, x, y, timer, defusing] = b;
    if (!this.inView(x, y, 80)) return;
    ctx.save(); ctx.translate(x, y);
    if (state === 3) {
      const blink = (Math.floor(this.t * (timer < 10 ? 6 : timer < 20 ? 3 : 1.6)) % 2) === 0;
      // pulsing ring
      const k = (this.t * (timer < 10 ? 2 : 1)) % 1;
      ctx.strokeStyle = `rgba(255,60,40,${0.45 * (1 - k)})`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 14 + k * 60, 0, TAU); ctx.stroke();
      ctx.fillStyle = 'rgba(0,0,0,0.35)'; ctx.fillRect(-9, -7, 20, 15);
      ctx.fillStyle = '#2b2f33'; ctx.fillRect(-10, -8, 20, 15);
      ctx.fillStyle = '#4b5158'; ctx.fillRect(-8, -6, 16, 4);
      ctx.fillStyle = '#c9a227'; ctx.fillRect(-8, 0, 4, 5); ctx.fillRect(-2, 0, 4, 5); ctx.fillRect(4, 0, 4, 5);
      ctx.fillStyle = blink ? '#ff3b2f' : '#4a1210'; ctx.beginPath(); ctx.arc(6, -4, 2.2, 0, TAU); ctx.fill();
      if (blink) { const g2 = ctx.createRadialGradient(6, -4, 0, 6, -4, 16); g2.addColorStop(0, 'rgba(255,60,40,0.5)'); g2.addColorStop(1, 'rgba(255,60,40,0)'); ctx.fillStyle = g2; ctx.beginPath(); ctx.arc(6, -4, 16, 0, TAU); ctx.fill(); }
      if (defusing) { ctx.strokeStyle = '#5aa7ff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(0, 0, 24, 0, TAU * 0.999); ctx.stroke(); }
    } else if (state === 2) {
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 6);
      ctx.fillStyle = `rgba(255,60,40,${0.15 + 0.2 * pulse})`; ctx.beginPath(); ctx.arc(0, 0, 18, 0, TAU); ctx.fill();
      ctx.fillStyle = '#2b2f33'; ctx.fillRect(-8, -6, 16, 12);
      ctx.fillStyle = '#c9a227'; ctx.fillRect(-6, 0, 12, 3);
      ctx.fillStyle = '#ff3b2f'; ctx.beginPath(); ctx.arc(5, -3, 1.8, 0, TAU); ctx.fill();
    } else if (state === 4) {
      ctx.fillStyle = '#2b2f33'; ctx.fillRect(-8, -6, 16, 12);
      ctx.fillStyle = '#3ddc84'; ctx.beginPath(); ctx.arc(5, -3, 2, 0, TAU); ctx.fill();
    }
    ctx.restore();
  }

  drawCorpses(ctx) {
    const g = this.game;
    for (const c of g.corpses) {
      if (!this.inView(c.x, c.y)) continue;
      ctx.save(); ctx.translate(c.x, c.y); ctx.rotate(c.a + 0.4);
      ctx.globalAlpha = 0.9;
      const col = TEAM_COL[c.team] || TEAM_COL[2];
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.ellipse(2, 3, 13, 11, 0, 0, TAU); ctx.fill();
      ctx.fillStyle = col.dark; ctx.beginPath(); ctx.arc(0, 0, 11, 0, TAU); ctx.fill();
      ctx.fillStyle = col.helm; ctx.beginPath(); ctx.arc(-1, 2, 6, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(0, 0, 11, 0, TAU); ctx.stroke();
      ctx.restore();
    }
  }

  drawFires(ctx) {
    const g = this.game;
    for (const f of g.ents.fi) {
      const [, x, y, r, age] = f;
      if (!this.inView(x, y, r)) continue;
      const fade = clamp((7 - age) / 1.2, 0, 1) * clamp(age / 0.2, 0, 1);
      const gr = ctx.createRadialGradient(x, y, 0, x, y, r);
      gr.addColorStop(0, `rgba(255,190,80,${0.55 * fade})`); gr.addColorStop(0.6, `rgba(255,110,30,${0.32 * fade})`); gr.addColorStop(1, 'rgba(255,60,10,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(x, y, r, 0, TAU); ctx.fill();
      if (fade > 0.3) g.fx.flames(x, y, r * 0.85);
    }
  }

  drawGrenades(ctx) {
    const g = this.game;
    for (const n of g.ents.g) {
      const [, type, x, y] = n;
      if (!this.inView(x, y)) continue;
      const name = GREN_ORDER[type];
      ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.beginPath(); ctx.arc(x + 3, y + 4, 4.2, 0, TAU); ctx.fill();
      ctx.fillStyle = GREN_COL[name]; ctx.beginPath(); ctx.arc(x, y, 4.2, 0, TAU); ctx.fill();
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 1; ctx.stroke();
      ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.beginPath(); ctx.arc(x - 1.3, y - 1.3, 1.3, 0, TAU); ctx.fill();
    }
  }

  drawSmokes(ctx) {
    const g = this.game;
    for (const s of g.ents.sm) {
      const [id, x, y, r, age] = s;
      if (!this.inView(x, y, r + 30)) continue;
      const fadeOut = age > 14 ? clamp((16 - age) / 2, 0, 1) : 1;
      const puffs = 16;
      for (let i = 0; i < puffs; i++) {
        const h = Math.sin(id * 12.9898 + i * 78.233) * 43758.5453; const q = h - Math.floor(h);
        const h2 = Math.sin(id * 4.1414 + i * 37.719) * 12345.678; const q2 = h2 - Math.floor(h2);
        const ang = q * TAU + this.t * (0.15 + q2 * 0.25) * (i % 2 ? 1 : -1);
        const d = Math.sqrt(q2) * r * 0.62;
        const px = x + Math.cos(ang) * d, py = y + Math.sin(ang) * d;
        const pr = r * (0.38 + q * 0.22);
        const gr = ctx.createRadialGradient(px, py, 0, px, py, pr);
        const shade = 176 + Math.floor(q2 * 40);
        gr.addColorStop(0, `rgba(${shade},${shade + 4},${shade + 8},${0.78 * fadeOut})`);
        gr.addColorStop(0.7, `rgba(${shade - 10},${shade - 6},${shade},${0.55 * fadeOut})`);
        gr.addColorStop(1, `rgba(${shade - 20},${shade - 16},${shade - 12},0)`);
        ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(px, py, pr, 0, TAU); ctx.fill();
      }
    }
  }

  // ------------------------------------------------------------------ players
  drawPlayers(ctx, viewer, smokes) {
    const g = this.game, now = performance.now();
    const myTeam = g.myTeam();
    const list = [];
    const latest = g.snaps[g.snaps.length - 1];
    const ownId = g.alive && g.me && g.me.own ? g.you : 0;
    if (latest) {
      for (const id of latest.players.keys()) {
        if (id === ownId) continue;
        const p = g.interpolated(id);
        if (!p) continue;
        const team = g.teamOf(id);
        const sameSide = viewer && g.me ? (team === (g.roster.get(g.me.id) || {}).tm) : (team === myTeam && myTeam !== SPEC);
        p.team = team;
        p.mate = sameSide;
        if (!sameSide && viewer && g.fogOn && !g.freecam) {
          if (!canSee(this.map, smokes, viewer.x, viewer.y, viewer.angle, viewer.view, p.x, p.y, 0, PLAYER_R)) continue;
          // enemies fade in over a moment instead of popping into existence at the edge of the cone
          let rec = this.seen.get(id);
          const t = performance.now();
          if (!rec || t - rec.last > 350) rec = { first: t, last: t };
          rec.last = t; this.seen.set(id, rec);
          p.alpha = Math.min(1, (t - rec.first) / 130 + 0.25);
        }
        list.push(p);
      }
    }
    if (ownId && viewer) {
      const me = g.me;
      list.push({ id: ownId, x: viewer.x, y: viewer.y, a: g.angle, hp: me.hp, held: me.held, fl: me.sc ? 1 : 0, team: myTeam, mate: true, own: true, ar: me.ar, speed: Math.hypot(g.pred.vx, g.pred.vy) });
    }
    list.sort((a, b) => a.y - b.y);
    for (const p of list) {
      if (!this.inView(p.x, p.y, 60)) continue;
      if (p.alpha !== undefined && p.alpha < 1) { ctx.globalAlpha = p.alpha; this.drawPlayer(ctx, p, now); ctx.globalAlpha = 1; }
      else this.drawPlayer(ctx, p, now);
    }
  }

  drawPlayer(ctx, p, now) {
    const g = this.game;
    const col = TEAM_COL[p.team] || TEAM_COL[2];
    const speed = p.own ? p.speed : this._speedOf(p);
    const stride = Math.sin(this.t * 11 + p.id * 1.7) * clamp(speed / 120, 0, 1);
    ctx.save();
    ctx.translate(p.x, p.y);
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.32)'; ctx.beginPath(); ctx.ellipse(3, 4, 13, 12, 0, 0, TAU); ctx.fill();
    ctx.rotate(p.a);
    // feet
    ctx.fillStyle = '#20242a';
    ctx.beginPath(); ctx.ellipse(-2 + stride * 5, -5, 5, 3.2, 0, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-2 - stride * 5, 5, 5, 3.2, 0, 0, TAU); ctx.fill();
    // weapon (in front of the body)
    const held = p.held;
    const flashOn = (g.muzzle.get(p.id) || 0) > now;
    let tip = 26;
    ctx.save();
    ctx.translate(8, 2);
    if (held >= HELD_GREN_BASE && held < 120) {
      ctx.fillStyle = GREN_COL[GREN_ORDER[held - HELD_GREN_BASE]] || '#888';
      ctx.beginPath(); ctx.arc(12, 0, 4.5, 0, TAU); ctx.fill(); ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.stroke();
      tip = 0;
    } else {
      tip = this.drawGunShape(ctx, WEAPON_LIST[held] || WEAPON_LIST[0], 0);
    }
    ctx.restore();
    // arms
    ctx.strokeStyle = col.dark; ctx.lineWidth = 4.5; ctx.lineCap = 'round';
    ctx.beginPath(); ctx.moveTo(1, -8); ctx.lineTo(13, 0); ctx.moveTo(1, 8); ctx.lineTo(11, 3); ctx.stroke();
    // torso
    ctx.fillStyle = col.body; ctx.beginPath(); ctx.arc(0, 0, PLAYER_R, 0, TAU); ctx.fill();
    ctx.strokeStyle = 'rgba(0,0,0,0.55)'; ctx.lineWidth = 1.6; ctx.stroke();
    // vest / shoulder pads
    ctx.fillStyle = col.dark;
    ctx.beginPath(); ctx.ellipse(-1, -8, 4.4, 3.4, 0.2, 0, TAU); ctx.fill();
    ctx.beginPath(); ctx.ellipse(-1, 8, 4.4, 3.4, -0.2, 0, TAU); ctx.fill();
    if (p.ar > 0) { ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.2; ctx.beginPath(); ctx.arc(0, 0, 8.2, 0.6, TAU - 0.6); ctx.stroke(); }
    // head + helmet
    ctx.fillStyle = col.helm; ctx.beginPath(); ctx.arc(1, 0, 6.6, 0, TAU); ctx.fill();
    ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.arc(-0.5, -1.5, 3.2, 0, TAU); ctx.fill();
    ctx.fillStyle = '#e0b48a'; ctx.beginPath(); ctx.arc(4.5, 0, 2.6, -1.3, 1.3); ctx.fill();
    // bomb on back
    if (p.fl & 16) { ctx.fillStyle = '#c23a2a'; ctx.fillRect(-13, -3, 4, 6); }
    // muzzle flash
    if (flashOn && tip > 0) {
      const fx = 8 + tip;
      const gr = ctx.createRadialGradient(fx, 2, 0, fx, 2, 14);
      gr.addColorStop(0, 'rgba(255,240,180,0.95)'); gr.addColorStop(0.4, 'rgba(255,180,60,0.6)'); gr.addColorStop(1, 'rgba(255,120,20,0)');
      ctx.fillStyle = gr; ctx.beginPath(); ctx.arc(fx, 2, 14, 0, TAU); ctx.fill();
      ctx.fillStyle = 'rgba(255,255,220,0.95)';
      ctx.beginPath(); ctx.moveTo(fx - 2, 2); ctx.lineTo(fx + 12, -1); ctx.lineTo(fx + 5, 2); ctx.lineTo(fx + 12, 5); ctx.closePath(); ctx.fill();
    }
    ctx.restore();
    if (p.own && this.game.me && this.game.me.pl > 0) this.progressRing(ctx, p.x, p.y, this.game.me.pl, '#f5a742');
    if (p.own && this.game.me && this.game.me.df > 0) this.progressRing(ctx, p.x, p.y, this.game.me.df, '#5aa7ff');
    if (p.own && this.game.me && this.game.me.rel > 0) this.progressRing(ctx, p.x, p.y, this.game.me.rel, '#ffffff', 18);
  }

  progressRing(ctx, x, y, k, color, r = 22) {
    ctx.save(); ctx.translate(x, y);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(k, 0, 1)); ctx.stroke();
    ctx.restore();
  }

  _speedOf(p) {
    // approximate speed of remote players from the last two snapshots
    const g = this.game, s = g.snaps;
    if (s.length < 2) return 0;
    const a = s[s.length - 2].players.get(p.id), b = s[s.length - 1].players.get(p.id);
    if (!a || !b) return 0;
    return Math.hypot(b[1] - a[1], b[2] - a[2]) / Math.max(0.001, s[s.length - 1].st - s[s.length - 2].st);
  }

  /** Draws a weapon pointing along +x starting at the origin. Returns the barrel tip x. */
  drawGunShape(ctx, w, mini) {
    const dark = '#22262b', mid = '#3a4048', lite = '#59616b';
    const k = w ? w.kind : 'knife';
    if (k === 'knife') {
      ctx.fillStyle = '#c9d2da'; ctx.beginPath(); ctx.moveTo(4, -1.5); ctx.lineTo(17, 0); ctx.lineTo(4, 1.5); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#3a2d20'; ctx.fillRect(-2, -1.5, 6, 3);
      return 17;
    }
    if (k === 'pistol') {
      ctx.fillStyle = mid; ctx.fillRect(3, -2.2, 12, 4.4);
      ctx.fillStyle = dark; ctx.fillRect(3, 0.5, 5, 5);
      ctx.fillStyle = lite; ctx.fillRect(5, -2.2, 9, 1.2);
      return 15;
    }
    if (k === 'smg') {
      ctx.fillStyle = mid; ctx.fillRect(2, -2.4, 19, 4.8);
      ctx.fillStyle = dark; ctx.fillRect(8, 1, 3.4, 7);
      ctx.fillStyle = lite; ctx.fillRect(4, -2.4, 15, 1.2);
      return 21;
    }
    if (k === 'rifle') {
      ctx.fillStyle = '#4b3a2a'; if (w.id === 'ak47') ctx.fillRect(-4, -2.4, 9, 5); else { ctx.fillStyle = dark; ctx.fillRect(-4, -2.4, 9, 5); }
      ctx.fillStyle = mid; ctx.fillRect(4, -2.6, 24, 5.2);
      ctx.fillStyle = dark; ctx.fillRect(12, 1.5, 4, 8);
      ctx.fillStyle = lite; ctx.fillRect(6, -2.6, 20, 1.3);
      ctx.fillStyle = dark; ctx.fillRect(28, -1.2, 5, 2.4);
      return 33;
    }
    if (k === 'sniper') {
      ctx.fillStyle = dark; ctx.fillRect(-5, -2.6, 11, 5.2);
      ctx.fillStyle = mid; ctx.fillRect(5, -2, 32, 4);
      ctx.fillStyle = '#1a1d21'; ctx.fillRect(12, -5.4, 11, 3.4);
      ctx.fillStyle = lite; ctx.fillRect(7, -2, 26, 1);
      return 37;
    }
    if (k === 'shotgun') {
      ctx.fillStyle = '#5a4230'; ctx.fillRect(-4, -2.6, 10, 5.2);
      ctx.fillStyle = mid; ctx.fillRect(5, -2.4, 26, 4.8);
      ctx.fillStyle = dark; ctx.fillRect(15, -3.4, 8, 6.8);
      return 31;
    }
    void mini;
    return 20;
  }

  // ------------------------------------------------------------------ fog
  drawFog(poly, viewer) {
    const g = this.game, ctx = this.ctx;
    if (!poly || !viewer) {
      if (g.alive || g.myTeam() === SPEC) return;
      return;
    }
    const f = this.fctx, fw = this.fogCanvas.width, fh = this.fogCanvas.height;
    const th = this.map.theme.fog || [8, 10, 16];
    f.globalCompositeOperation = 'source-over';
    f.clearRect(0, 0, fw, fh);
    f.fillStyle = `rgba(${th[0]},${th[1]},${th[2]},0.76)`;
    f.fillRect(0, 0, fw, fh);
    f.globalCompositeOperation = 'destination-out';
    const s = this.scale * this.dpr * 0.5;
    const ox = (this.W / 2 - this.cam.x * this.scale) * this.dpr * 0.5, oy = (this.H / 2 - this.cam.y * this.scale) * this.dpr * 0.5;
    f.beginPath();
    for (let i = 0; i < poly.n; i++) {
      const x = poly.pts[i * 2] * s + ox, y = poly.pts[i * 2 + 1] * s + oy;
      if (i === 0) f.moveTo(x, y); else f.lineTo(x, y);
    }
    f.closePath();
    f.fillStyle = 'rgba(0,0,0,1)'; f.fill();
    f.lineJoin = 'round';
    f.strokeStyle = 'rgba(0,0,0,0.5)'; f.lineWidth = 9 * this.scale * 0.5; f.stroke();
    f.strokeStyle = 'rgba(0,0,0,0.25)'; f.lineWidth = 18 * this.scale * 0.5; f.stroke();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.fogCanvas, 0, 0, this.canvas.width, this.canvas.height);
  }

  // ------------------------------------------------------------------ labels & markers
  drawLabels(ctx, viewer) {
    const g = this.game;
    const latest = g.snaps[g.snaps.length - 1];
    if (!latest) return;
    ctx.textAlign = 'center';
    ctx.font = '600 10px system-ui, sans-serif';
    for (const id of latest.players.keys()) {
      if (g.alive && g.me && g.me.own && id === g.you) continue;
      const p = g.interpolated(id);
      if (!p || !this.inView(p.x, p.y)) continue;
      const team = g.teamOf(id);
      const myTeam = g.me ? (g.roster.get(g.me.id) || {}).tm : g.myTeam();
      const mate = team === myTeam;
      if (!mate && g.myTeam() !== SPEC) continue;
      if (!mate && viewer && g.fogOn && !g.freecam && !canSee(this.map, g.smokeCircles(), viewer.x, viewer.y, viewer.angle, viewer.view, p.x, p.y, 0, PLAYER_R)) continue;
      const col = TEAM_COL[team] || TEAM_COL[2];
      const name = g.nameOf(id);
      ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillText(name, p.x + 1, p.y - 20 + 1);
      ctx.fillStyle = col.text; ctx.fillText(name, p.x, p.y - 20);
      if (p.hp > 0) {
        const w = 22;
        ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(p.x - w / 2 - 1, p.y - 17, w + 2, 4);
        ctx.fillStyle = p.hp > 50 ? '#4cd964' : p.hp > 25 ? '#f5c542' : '#ff453a';
        ctx.fillRect(p.x - w / 2, p.y - 16, w * clamp(p.hp / 100, 0, 1), 2);
      }
    }
  }

  drawPings(ctx) {
    const g = this.game, now = performance.now();
    g.pings = g.pings.filter((p) => now - p.t < 4500);
    for (const p of g.pings) {
      const age = (now - p.t) / 1000;
      const col = TEAM_COL[p.team] || TEAM_COL[2];
      const k = (age * 1.4) % 1;
      ctx.strokeStyle = col.text; ctx.globalAlpha = (1 - k) * clamp((4.5 - age) / 1, 0, 1);
      ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(p.x, p.y, 8 + k * 28, 0, TAU); ctx.stroke();
      ctx.globalAlpha = clamp((4.5 - age) / 1, 0, 1);
      ctx.fillStyle = col.text;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - 7, p.y - 17); ctx.lineTo(p.x + 7, p.y - 17); ctx.closePath(); ctx.fill();
      ctx.font = '700 11px system-ui, sans-serif'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillText(g.nameOf(p.id), p.x + 1, p.y - 22);
      ctx.fillStyle = '#fff'; ctx.fillText(g.nameOf(p.id), p.x, p.y - 23);
    }
    ctx.globalAlpha = 1;
  }

  drawOffscreenMarkers(ctx) {
    const g = this.game;
    const marks = [];
    const b = g.bombInfo;
    if (b && (b[0] === 3 || b[0] === 2)) marks.push({ x: b[1], y: b[2], label: b[0] === 3 ? (b[5] === 0 ? 'A' : b[5] === 1 ? 'B' : '') : '', col: '#ff5a44', bomb: true });
    for (const m of marks) {
      const p = this.worldToScreen(m.x, m.y);
      const pad = 34;
      if (p.x > pad && p.x < this.W - pad && p.y > pad && p.y < this.H - pad) continue;
      const cx = this.W / 2, cy = this.H / 2;
      const dx = p.x - cx, dy = p.y - cy;
      const k = Math.min((this.W / 2 - pad) / Math.abs(dx || 1e-6), (this.H / 2 - pad) / Math.abs(dy || 1e-6));
      const ex = cx + dx * k, ey = cy + dy * k, a = Math.atan2(dy, dx);
      ctx.save(); ctx.translate(ex, ey);
      const pulse = 0.7 + 0.3 * Math.sin(this.t * 6);
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.beginPath(); ctx.arc(0, 0, 15, 0, TAU); ctx.fill();
      ctx.rotate(a); ctx.fillStyle = m.col; ctx.globalAlpha = pulse;
      ctx.beginPath(); ctx.moveTo(22, 0); ctx.lineTo(13, -6); ctx.lineTo(13, 6); ctx.closePath(); ctx.fill();
      ctx.rotate(-a); ctx.globalAlpha = 1;
      ctx.fillStyle = '#fff'; ctx.font = '800 13px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(m.label || '●', 0, 1);
      ctx.restore();
    }
  }

  // ------------------------------------------------------------------ screen overlays
  drawOverlays(ctx, viewer, dt) {
    void dt;
    const g = this.game, W = this.W, H = this.H, now = performance.now();
    // damage direction arcs
    g.damageDirs = g.damageDirs.filter((d) => now - d.t < 900);
    for (const d of g.damageDirs) {
      const k = (now - d.t) / 900;
      ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(d.a);
      const gr = ctx.createRadialGradient(Math.min(W, H) * 0.4, 0, 0, Math.min(W, H) * 0.4, 0, 90);
      ctx.strokeStyle = `rgba(255,40,30,${0.7 * (1 - k)})`; ctx.lineWidth = 9;
      ctx.beginPath(); ctx.arc(0, 0, Math.min(W, H) * 0.36, -0.28, 0.28); ctx.stroke();
      void gr;
      ctx.restore();
    }
    // low-health vignette
    if (g.alive && g.me && g.me.own && g.me.hp < 35) {
      const a = (0.25 + 0.1 * Math.sin(this.t * 5)) * (1 - g.me.hp / 35);
      const gr = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
      gr.addColorStop(0, 'rgba(160,0,0,0)'); gr.addColorStop(1, `rgba(160,0,0,${a + 0.25})`);
      ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    }
    // scope vignette
    if (viewer && viewer.scoped && g.alive) {
      const gr = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.7);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, 'rgba(0,0,0,0.5)');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    }
    // flashbang whiteout
    const el = (now - g.flashRecv) / 1000;
    const full = g.flashFull - el, left = g.flashLeft - el;
    if (left > 0) {
      const a = full > 0 ? 1 : clamp(left / Math.max(0.6, g.flashLeft - g.flashFull), 0, 1) * 0.95;
      ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.fillRect(0, 0, W, H);
    }
    // crosshair
    if (g.alive && g.me && g.me.own && !(g.ui.isOverlayOpen && g.ui.isOverlayOpen())) this.drawCrosshair(ctx, viewer, now);
  }

  drawCrosshair(ctx, viewer, now) {
    const g = this.game, me = g.me, inp = g.input;
    const mx = inp.mx, my = inp.my;
    const held = me.held;
    const w = held < HELD_GREN_BASE ? WEAPON_LIST[held] : null;
    // grenade landing preview
    if (held >= HELD_GREN_BASE && held < 120 && viewer) {
      const type = GREN_ORDER[held - HELD_GREN_BASE];
      const ps = this.worldToScreen(viewer.x, viewer.y);
      const wm = this.screenToWorld(mx, my);
      let d = Math.hypot(wm.x - viewer.x, wm.y - viewer.y);
      d = clamp(d, GREN_MIN_DIST, GREN_MAX_DIST);
      const a = Math.atan2(my - ps.y, mx - ps.x);
      const lx = ps.x + Math.cos(a) * d * this.scale, ly = ps.y + Math.sin(a) * d * this.scale;
      const rad = (type === 'he' ? HE_RADIUS : type === 'smoke' ? SMOKE_RADIUS : type === 'molo' ? FIRE_RADIUS : 60) * this.scale;
      ctx.save();
      ctx.setLineDash([6, 6]); ctx.strokeStyle = 'rgba(255,255,255,0.35)'; ctx.lineWidth = 1.5;
      ctx.beginPath(); ctx.moveTo(ps.x, ps.y); ctx.lineTo(lx, ly); ctx.stroke();
      ctx.strokeStyle = type === 'he' ? 'rgba(255,110,60,0.8)' : type === 'molo' ? 'rgba(255,140,40,0.8)' : 'rgba(255,255,255,0.7)';
      ctx.setLineDash([4, 5]); ctx.beginPath(); ctx.arc(lx, ly, rad, 0, TAU); ctx.stroke();
      ctx.setLineDash([]); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.beginPath(); ctx.arc(lx, ly, 3, 0, TAU); ctx.fill();
      ctx.restore();
    }
    // spread: half-angle at the aim distance
    let gap = 7;
    if (viewer) {
      const wm = this.screenToWorld(mx, my);
      const dist = Math.hypot(wm.x - viewer.x, wm.y - viewer.y);
      gap = clamp(Math.tan(me.sp || 0) * dist * this.scale, 5, 160);
    }
    g._gap = g._gap === undefined ? gap : g._gap + (gap - g._gap) * 0.35;
    const gp = g._gap;
    ctx.save(); ctx.translate(mx, my);
    const hm = now - g.hitMarker < 170;
    const col = hm ? (g.hitKill ? '#ff453a' : '#ffffff') : 'rgba(120,255,160,0.95)';
    ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 4; ctx.lineCap = 'butt';
    const len = 8;
    const ticks = (color, lw) => {
      ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath();
      ctx.moveTo(gp, 0); ctx.lineTo(gp + len, 0); ctx.moveTo(-gp, 0); ctx.lineTo(-gp - len, 0);
      ctx.moveTo(0, gp); ctx.lineTo(0, gp + len); ctx.moveTo(0, -gp); ctx.lineTo(0, -gp - len); ctx.stroke();
    };
    if (!w || w.kind !== 'knife') { ticks('rgba(0,0,0,0.6)', 4); ticks(col, 2); }
    ctx.fillStyle = col; ctx.beginPath(); ctx.arc(0, 0, 1.6, 0, TAU); ctx.fill();
    if (hm) { ctx.strokeStyle = g.hitKill ? '#ff453a' : '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-9, -9); ctx.lineTo(-4, -4); ctx.moveTo(9, -9); ctx.lineTo(4, -4); ctx.moveTo(-9, 9); ctx.lineTo(-4, 4); ctx.moveTo(9, 9); ctx.lineTo(4, 4); ctx.stroke(); }
    if (me.rel > 0) {
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(0, 0, gp + 16, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, gp + 16, -Math.PI / 2, -Math.PI / 2 + TAU * me.rel); ctx.stroke();
    }
    ctx.restore();
  }
}
