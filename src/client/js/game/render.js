// Draws the world in 2.5D: baked voxel ground, y-sorted extruded blocks, stacked-voxel units, fog of war and overlays.
import { PLAYER_R, SPEC, GREN_ORDER, TILE, HE_RADIUS, SMOKE_RADIUS, FIRE_RADIUS, GREN_MAX_DIST, GREN_MIN_DIST } from '../../../shared/constants.js';
import { WEAPON_LIST, HELD_GREN_BASE, HELD_GADGET_BASE, GADGET_LIST, PROJ, ALT } from '../../../shared/weapons.js';
import { VEHICLES, VEHICLE_LIST } from '../../../shared/vehicles.js';
import { TILES } from '../../../shared/gamemap.js';
import { canSee } from '../../../shared/vision.js';
import { computeVision } from './vision.js';
import { soldierModel, vehicleModel, drawSprite, box25, TEAM_PAL, TAU } from './voxel.js';

const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const PROJ_LIST = Object.keys(PROJ);
export const TEAM_COL = {
  0: { body: '#c4472f', dark: '#8c2e20', helm: '#7a281c', text: '#ff8a72' },
  1: { body: '#3f7fd8', dark: '#264f8f', helm: '#213f73', text: '#7fb0ff' },
  2: { body: '#888', dark: '#555', helm: '#666', text: '#c8ccd2' },
};
const GREN_COL = { he: '#4a6b3a', flash: '#e8e8e8', smoke: '#b0b8c0', molo: '#d4552a' };
const KIND_TIP = { pistol: 14, smg: 20, rifle: 26, dmr: 26, lmg: 28, sniper: 32, shotgun: 24, knife: 16, launcher: 24, tool: 16, grenade: 12 };
const WALL_LIFT = 40;
const AIR_ALT = 44;

function weaponKindOf(held) {
  if (held >= HELD_GADGET_BASE) { const g = GADGET_LIST[held - HELD_GADGET_BASE]; return g ? (g.kind === 'launcher' ? 'launcher' : 'tool') : 'tool'; }
  if (held >= HELD_GREN_BASE) return 'grenade';
  const w = WEAPON_LIST[held];
  return w ? w.kind : 'rifle';
}

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
    this.map = null; this.terrain = null;
    this.t = 0;
    this.smoothCam = null;
    this.seen = new Map();
    this.viewRect = { x0: 0, y0: 0, x1: 0, y1: 0 };
    this.items = [];
    this.smokeT = 0;
    try { const z = parseFloat(localStorage.getItem('cs.zoom')); if (Number.isFinite(z)) this.userZoom = clamp(z, 0.7, 1.4); } catch { /* ignore */ }
    window.addEventListener('resize', () => this.resize());
    this.resize();
  }

  setMap(map, terrain) { this.map = map; this.terrain = terrain; this.smoothCam = null; }

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
    if (!this.map || !this.terrain) return;
    this.t = nowMs / 1000;
    // fixed amount of world on screen (ultra-wide monitors must not see farther than everyone else)
    this.scale = Math.max(this.H / 760, this.W / 1850) * this.userZoom;
    const viewer = g.viewer();

    // ---- camera
    let tx, ty;
    const inp = g.input;
    if (g.freecam) {
      const sp = 1100 / this.scale * dt;
      if (inp.down.has('KeyW')) g.cam.y -= sp; if (inp.down.has('KeyS')) g.cam.y += sp;
      if (inp.down.has('KeyA')) g.cam.x -= sp; if (inp.down.has('KeyD')) g.cam.x += sp;
      tx = g.cam.x; ty = g.cam.y;
    } else if (viewer) {
      const own = g.alive && g.me && g.me.own;
      let lx = 0, ly = 0;
      if (own) {
        const k = viewer.scoped ? (viewer.scopeLvl >= 2 ? 0.95 : 0.66) : 0.30;
        lx = (inp.mx - this.W / 2) * k / this.scale;
        ly = (inp.my - this.H / 2) * k / this.scale;
        const m = viewer.scoped ? (viewer.scopeLvl >= 3 ? 950 : viewer.scopeLvl === 2 ? 760 : 560) : (viewer.air ? 300 : 380);
        const l = Math.hypot(lx, ly);
        if (l > m) { lx *= m / l; ly *= m / l; }
      }
      tx = viewer.x + lx; ty = viewer.y + ly - 12;
    } else { tx = this.map.width / 2; ty = this.map.height / 2; }
    if (!this.smoothCam) this.smoothCam = { x: tx, y: ty };
    const follow = 1 - Math.exp(-(viewer && g.alive ? 16 : 7) * dt);
    this.smoothCam.x += (tx - this.smoothCam.x) * follow;
    this.smoothCam.y += (ty - this.smoothCam.y) * follow;
    this.cam.x = this.smoothCam.x + g.fx.shakeX;
    this.cam.y = this.smoothCam.y + g.fx.shakeY;
    const halfW = this.W / 2 / this.scale, halfH = this.H / 2 / this.scale;
    this.viewRect = { x0: this.cam.x - halfW - 40, y0: this.cam.y - halfH - 40, x1: this.cam.x + halfW + 40, y1: this.cam.y + halfH + 40 };
    const vr = this.viewRect;

    // ---- world layer
    const sc = this.scale * this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = '#05060a'; ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(sc, 0, 0, sc, Math.round((this.W / 2 - this.cam.x * this.scale) * this.dpr), Math.round((this.H / 2 - this.cam.y * this.scale) * this.dpr));
    ctx.imageSmoothingEnabled = false;
    this.terrain.drawGround(ctx, vr.x0, vr.y0, vr.x1, vr.y1);
    g.fx.drawDecals(ctx, vr.x0, vr.y0, vr.x1, vr.y1);

    const smokes = g.smokeCircles();
    this.drawFlagRings(ctx);
    this.drawGroundStuff(ctx, viewer);
    g.fx.drawLow(ctx);
    this.drawFires(ctx);

    // ---- y-sorted pass: blocks and everything that stands on the ground
    this.drawWorld(ctx, viewer, smokes);

    // ---- above it all: aircraft, smoke clouds, effects
    this.drawAir(ctx, viewer, smokes);
    this.drawSmokes(ctx);
    g.fx.drawHigh(ctx);

    // ---- fog of war
    let poly = null;
    if (viewer && g.fogOn && !g.freecam) poly = computeVision(this.map, smokes, viewer.x, viewer.y, viewer.angle, viewer.view);
    this.drawFog(poly, viewer);

    // ---- world-space labels that should stay readable in the dark
    ctx.setTransform(sc, 0, 0, sc, Math.round((this.W / 2 - this.cam.x * this.scale) * this.dpr), Math.round((this.H / 2 - this.cam.y * this.scale) * this.dpr));
    this.drawLabels(ctx, viewer);
    this.drawFlagLabels(ctx);
    this.drawPings(ctx);
    g.fx.drawFloaters(ctx);

    // ---- screen-space overlays
    ctx.setTransform(this.dpr, 0, 0, this.dpr, 0, 0);
    this.drawOffscreenMarkers(ctx);
    this.drawOverlays(ctx, viewer, dt);
  }

  inView(x, y, m = 40) { const v = this.viewRect; return x > v.x0 - m && x < v.x1 + m && y > v.y0 - m && y < v.y1 + m; }

  // ------------------------------------------------------------------ ground-level things
  drawFlagRings(ctx) {
    const g = this.game;
    for (const f of g.flagList()) {
      if (!this.inView(f.x, f.y, f.r + 20)) continue;
      const col = f.owner === 0 ? '255,110,90' : f.owner === 1 ? '110,160,255' : '235,235,235';
      const capCol = f.cap < 0 ? '255,110,90' : '110,160,255';
      // owned area
      ctx.fillStyle = `rgba(${col},${f.owner < 0 ? 0.06 : 0.11})`;
      const s = f.r;
      ctx.beginPath(); ctx.arc(f.x, f.y, s, 0, TAU); ctx.fill();
      ctx.lineWidth = 3; ctx.strokeStyle = `rgba(${col},0.7)`; ctx.setLineDash([12, 9]);
      ctx.beginPath(); ctx.arc(f.x, f.y, s, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      // capture progress arc
      const prog = Math.abs(f.cap);
      if (prog > 0.01 && prog < 0.999 || (f.owner < 0 && prog > 0.01)) {
        ctx.lineWidth = 6; ctx.strokeStyle = `rgba(${capCol},0.95)`;
        ctx.beginPath(); ctx.arc(f.x, f.y, s - 6, -Math.PI / 2, -Math.PI / 2 + TAU * prog); ctx.stroke();
      }
      if (f.contested) { ctx.lineWidth = 4; ctx.strokeStyle = `rgba(255,220,80,${0.5 + 0.4 * Math.sin(this.t * 8)})`; ctx.beginPath(); ctx.arc(f.x, f.y, s - 2, 0, TAU); ctx.stroke(); }
    }
  }

  drawGroundStuff(ctx, viewer) {
    const g = this.game;
    // corpses (flat sprites)
    for (const c of g.corpses) {
      if (!this.inView(c.x, c.y)) continue;
      const m = soldierModel(c.team, c.cls || 'assault', 'rifle', 0, true);
      ctx.globalAlpha = 0.95;
      drawSprite(ctx, m.sprite(c.a + 0.5), c.x, c.y);
      ctx.globalAlpha = 1;
    }
    // revive markers on the ground for downed teammates
    for (const c of g.ents.cp || []) {
      const [, x, y, left] = c;
      if (!this.inView(x, y)) continue;
      const pulse = 0.5 + 0.5 * Math.sin(this.t * 6);
      ctx.fillStyle = `rgba(80,255,140,${0.18 + 0.2 * pulse})`; ctx.fillRect(x - 12, y - 12, 24, 24);
      ctx.fillStyle = '#5dff9a'; ctx.fillRect(x - 2, y - 9, 4, 18); ctx.fillRect(x - 9, y - 2, 18, 4);
      void left;
    }
    // deployables
    for (const d of g.ents.gd || []) {
      const [, gi, x, y, a, team, armed, life] = d;
      if (!this.inView(x, y)) continue;
      const def = GADGET_LIST[gi];
      if (!def) continue;
      const col = team === 0 ? '255,120,100' : '120,170,255';
      if (def.id === 'medkit' || def.id === 'ammo') {
        ctx.strokeStyle = `rgba(${def.id === 'medkit' ? '90,255,150' : '255,220,110'},0.35)`; ctx.lineWidth = 2; ctx.setLineDash([6, 6]);
        ctx.beginPath(); ctx.arc(x, y, def.radius || 110, 0, TAU); ctx.stroke(); ctx.setLineDash([]);
      }
      if (def.id === 'sensor') { ctx.strokeStyle = `rgba(${col},0.25)`; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(x, y, 340, 0, TAU); ctx.stroke(); }
      if (def.id === 'claymore') { ctx.fillStyle = `rgba(${col},0.16)`; ctx.beginPath(); ctx.moveTo(x, y); ctx.arc(x, y, 150, a - 0.75, a + 0.75); ctx.closePath(); ctx.fill(); }
      void armed; void life;
    }
    // grenade shadows
    for (const n of g.ents.g || []) { if (this.inView(n[2], n[3])) { ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(n[2] - 3, n[3] + 1, 6, 4); } }
    void viewer;
  }

  drawFires(ctx) {
    const g = this.game;
    for (const f of g.ents.fi || []) {
      const [, x, y, r, age] = f;
      if (!this.inView(x, y, r)) continue;
      const fade = clamp((7 - age) / 1.2, 0, 1) * clamp(age / 0.2, 0, 1);
      ctx.fillStyle = `rgba(255,120,30,${0.32 * fade})`; ctx.fillRect(x - r * 0.9, y - r * 0.7, r * 1.8, r * 1.4);
      ctx.fillStyle = `rgba(255,200,80,${0.30 * fade})`; ctx.fillRect(x - r * 0.55, y - r * 0.45, r * 1.1, r * 0.9);
      if (fade > 0.3) g.fx.flames(x, y, r * 0.85);
    }
  }

  // ------------------------------------------------------------------ the y-sorted world
  drawWorld(ctx, viewer, smokes) {
    const g = this.game, map = this.map, terrain = this.terrain, vr = this.viewRect;
    const items = this.items; items.length = 0;
    const now = performance.now();
    const myTeam = g.myTeam();
    const ownId = g.alive && g.me && g.me.own ? g.you : 0;
    // soldiers
    for (const p of g.soldiers()) {
      if (!p.own && !this.inView(p.x, p.y, 60)) continue;
      if (p.own && !this.inView(p.x, p.y, 60)) continue;
      if (!p.mate && viewer && g.fogOn && !g.freecam) {
        if (!canSee(map, smokes, viewer.x, viewer.y, viewer.angle, viewer.view, p.x, p.y, 0, PLAYER_R)) continue;
        let rec = this.seen.get(p.id);
        if (!rec || now - rec.last > 350) rec = { first: now, last: now };
        rec.last = now; this.seen.set(p.id, rec);
        p.alpha = Math.min(1, (now - rec.first) / 130 + 0.25);
      }
      items.push({ y: p.y + 2, k: 0, o: p });
    }
    // ground vehicles
    const airList = this.airList || (this.airList = []); airList.length = 0;
    for (const v of g.vehiclesDrawn()) {
      if (!this.inView(v.x, v.y, 90)) continue;
      const def = VEHICLES[VEHICLE_LIST[v.ty]];
      if (!def) continue;
      if (v.team !== myTeam && v.team >= 0 && viewer && g.fogOn && !g.freecam && myTeam !== SPEC) {
        const air = def.kind === 'air';
        const view = air ? { range: viewer.view.range, fov: viewer.view.fov, air: true } : viewer.view;
        if (!canSee(map, smokes, viewer.x, viewer.y, viewer.angle, view, v.x, v.y, 0, def.r)) continue;
      }
      v.def = def;
      if (def.kind === 'air') airList.push(v); else items.push({ y: v.y + def.r * 0.4, k: 1, o: v });
    }
    // flags, m-coms, gadgets, projectiles, grenades
    for (const f of g.flagList()) if (this.inView(f.x, f.y, 90)) items.push({ y: f.y + 6, k: 2, o: f });
    for (const m of g.mcomList()) if (this.inView(m.x, m.y, 60)) items.push({ y: m.y + 8, k: 3, o: m });
    for (const d of g.ents.gd || []) if (this.inView(d[2], d[3], 40)) items.push({ y: d[3], k: 4, o: d });
    for (const n of g.ents.g || []) if (this.inView(n[2], n[3], 20)) items.push({ y: n[3], k: 5, o: n });
    for (const q of g.projectilesDrawn()) if (this.inView(q.x, q.y, 40)) items.push({ y: q.y + 30, k: 6, o: q });
    items.sort((a, b) => a.y - b.y);
    this.airList = airList;

    // fade the wall pieces that would hide the local viewer
    const vx = viewer ? viewer.x : -9999, vy = viewer ? viewer.y : -9999;
    const c0 = clamp(Math.floor(vr.x0 / TILE) - 1, 0, map.w - 1), c1 = clamp(Math.floor(vr.x1 / TILE) + 1, 0, map.w - 1);
    const r0 = clamp(Math.floor(vr.y0 / TILE), 0, map.h - 1), r1 = clamp(Math.floor(vr.y1 / TILE) + 4, 0, map.h - 1);
    let ii = 0;
    const solid = map.solid;
    for (let ty = r0; ty <= r1; ty++) {
      const limit = (ty + 1) * TILE;
      while (ii < items.length && items[ii].y < limit) this.drawItem(ctx, items[ii++], viewer, now);
      const base = ty * map.w;
      for (let tx = c0; tx <= c1; tx++) {
        if (!solid[base + tx]) continue;
        const s = terrain.spriteAt(tx, ty);
        const spr = s.spr;
        const x = tx * TILE - spr.ox, y = ty * TILE - spr.oy;
        if (y > vr.y1 || y + spr.h < vr.y0) continue;
        let alpha = 1;
        if (viewer && ty * TILE > vy - 4 && ty * TILE - vy < s.H + 26 && Math.abs((tx + 0.5) * TILE - vx) < 40) alpha = 0.38;
        else if (s.ch === 'T') alpha = 0.9;
        if (alpha < 1) ctx.globalAlpha = alpha;
        ctx.drawImage(spr.c, x, y, spr.w + 0.6, spr.h);
        if (alpha < 1) ctx.globalAlpha = 1;
      }
    }
    while (ii < items.length) this.drawItem(ctx, items[ii++], viewer, now);
    void ownId;
  }

  drawItem(ctx, it, viewer, now) {
    switch (it.k) {
      case 0: return this.drawSoldier(ctx, it.o, now);
      case 1: return this.drawVehicle(ctx, it.o, now);
      case 2: return this.drawFlag(ctx, it.o);
      case 3: return this.drawMcom(ctx, it.o);
      case 4: return this.drawGadget(ctx, it.o);
      case 5: return this.drawGrenade(ctx, it.o);
      case 6: return this.drawProjectile(ctx, it.o);
      default: return null;
    }
  }

  // ------------------------------------------------------------------ soldiers
  drawSoldier(ctx, p, now) {
    const g = this.game;
    const team = p.team >= 0 ? p.team : 2;
    const kind = weaponKindOf(p.held);
    const speed = p.speed || 0;
    const frame = speed > 35 ? (Math.floor(this.t * (speed > 240 ? 12 : 9) + p.id) % 2 === 0 ? 1 : 2) : 0;
    const model = soldierModel(team, p.cls || 'assault', kind, frame);
    const spr = model.sprite(p.a);
    if (p.alpha !== undefined && p.alpha < 1) ctx.globalAlpha = p.alpha;
    // shadow
    ctx.fillStyle = 'rgba(0,0,0,0.30)';
    ctx.beginPath(); ctx.ellipse(p.x + 4, p.y + 3, 12, 8, 0, 0, TAU); ctx.fill();
    drawSprite(ctx, spr, p.x, p.y);
    // muzzle flash
    if ((g.muzzle.get(p.id) || 0) > now) {
      const tip = KIND_TIP[kind] || 20;
      const fx = p.x + Math.cos(p.a) * tip, fy = p.y + Math.sin(p.a) * tip - 13;
      ctx.fillStyle = 'rgba(255,240,170,0.95)'; ctx.fillRect(fx - 4, fy - 4, 8, 8);
      ctx.fillStyle = '#ffae30'; ctx.fillRect(fx - 2, fy - 2, 4, 4);
      ctx.fillStyle = 'rgba(255,200,80,0.25)'; ctx.fillRect(fx - 12, fy - 12, 24, 24);
    }
    ctx.globalAlpha = 1;
    if (p.fl & 32) { // spawn protection shimmer
      ctx.strokeStyle = `rgba(160,220,255,${0.4 + 0.3 * Math.sin(this.t * 10)})`; ctx.lineWidth = 2;
      ctx.strokeRect(p.x - 14, p.y - 18, 28, 30);
    }
    if (p.own) {
      const me = g.me;
      if (me.pl > 0) this.progressRing(ctx, p.x, p.y - 8, me.pl, me.plk === 'revive' ? '#5dff9a' : '#f5a742');
      if (me.rel > 0) this.progressRing(ctx, p.x, p.y - 8, me.rel, '#ffffff', 20);
    }
  }

  progressRing(ctx, x, y, k, color, r = 24) {
    ctx.save(); ctx.translate(x, y);
    ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(0, 0, r, 0, TAU); ctx.stroke();
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, r, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(k, 0, 1)); ctx.stroke();
    ctx.restore();
  }

  // ------------------------------------------------------------------ vehicles
  drawVehicle(ctx, v, now) {
    const def = v.def;
    const team = v.team >= 0 ? v.team : 2;
    const body = vehicleModel(def.id, team, 'body');
    // ground shadow
    ctx.save(); ctx.translate(v.x + 5, v.y + 5); ctx.rotate(v.a);
    ctx.fillStyle = 'rgba(0,0,0,0.30)'; ctx.fillRect(-def.size[0] / 2, -def.size[1] / 2, def.size[0], def.size[1]); ctx.restore();
    if (def.id === 'quad') { drawSprite(ctx, vehicleModel('quad', team, 'body').sprite(v.a), v.x, v.y); }
    else drawSprite(ctx, body.sprite(v.a), v.x, v.y);
    const top = { jeep: 21, apc: 21, tank: 15, boat: 18 }[def.id] || 0;
    if (def.id === 'tank' || def.id === 'apc') {
      drawSprite(ctx, vehicleModel(def.id, team, 'turret').sprite(v.ta), v.x, v.y - top);
      if (def.id === 'tank') drawSprite(ctx, vehicleModel('tank', team, 'gun').sprite(v.ga), v.x + Math.cos(v.ta) * -6, v.y - top - 15 + Math.sin(v.ta) * -6);
      else drawSprite(ctx, vehicleModel('apc', team, 'gun').sprite(v.ga), v.x - 12 * Math.cos(v.a), v.y - top - 12 - 12 * Math.sin(v.a));
    } else if (def.id === 'jeep' || def.id === 'boat') {
      drawSprite(ctx, vehicleModel(def.id, team, 'gun').sprite(v.ga), v.x - Math.cos(v.a) * 9, v.y - top - Math.sin(v.a) * 9);
    }
    // occupants of open vehicles are visible
    if (def.open) {
      const c = TEAM_PAL[team] || TEAM_PAL[2];
      ctx.fillStyle = c.hat; ctx.fillRect(v.x - Math.cos(v.a) * 3 - 4, v.y - 16 - Math.sin(v.a) * 3, 8, 6);
    }
    // damage
    const hp = v.hp / 100;
    if (hp < 0.55 && this.game.fx.shouldSmoke(v.id, now)) this.game.fx.damageSmoke(v.x, v.y, hp < 0.25);
    if (v.own) {
      ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = 1; ctx.strokeRect(v.x - def.r - 2, v.y - def.r - 2 - 10, def.r * 2 + 4, def.r * 2 + 4);
    }
  }

  drawAir(ctx, viewer, smokes) {
    void viewer; void smokes;
    for (const v of this.airList || []) {
      const def = v.def;
      const team = v.team >= 0 ? v.team : 2;
      const alt = AIR_ALT;
      ctx.save(); ctx.translate(v.x + 22, v.y + 26); ctx.rotate(v.a);
      ctx.fillStyle = 'rgba(0,0,0,0.26)'; ctx.fillRect(-def.size[0] / 2, -def.size[1] / 2 + 3, def.size[0], def.size[1] - 6); ctx.fillRect(-2, -def.size[0] * 0.55, 4, def.size[0] * 1.1);
      ctx.restore();
      drawSprite(ctx, vehicleModel('heli', team, 'body').sprite(v.a), v.x, v.y - alt);
      // spinning rotor: translucent blades
      ctx.globalAlpha = 0.55;
      drawSprite(ctx, vehicleModel('heli', team, 'rotor').sprite(this.t * 26), v.x, v.y - alt - 24);
      ctx.globalAlpha = 0.16; ctx.fillStyle = '#cfd6dd'; ctx.beginPath(); ctx.ellipse(v.x, v.y - alt - 24, 38, 38, 0, 0, TAU); ctx.fill();
      ctx.globalAlpha = 1;
      drawSprite(ctx, vehicleModel('heli', team, 'gun').sprite(v.ga), v.x + Math.cos(v.a) * 9, v.y - alt + Math.sin(v.a) * 9 + 2);
      if (v.hp < 55 && this.game.fx.shouldSmoke(v.id, performance.now())) this.game.fx.damageSmoke(v.x, v.y - alt + 20, v.hp < 25);
    }
  }

  // ------------------------------------------------------------------ objects
  drawFlag(ctx, f) {
    const col = f.owner === 0 ? '#e0523a' : f.owner === 1 ? '#3f86e8' : '#d8dce0';
    const capCol = f.cap < 0 ? '#e0523a' : '#3f86e8';
    const x = f.x, y = f.y;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x + 4, y - 2, 30, 8);
    box25(ctx, x, y, 12, 12, 5, '#8d8f94', '#5a5d63');
    // pole
    ctx.fillStyle = '#2d3036'; ctx.fillRect(x - 1, y - 56, 3, 52); ctx.fillStyle = '#cfd3d8'; ctx.fillRect(x - 1, y - 58, 3, 3);
    // banner rises as the flag is captured
    const prog = f.owner >= 0 ? 1 : Math.abs(f.cap);
    const by = y - 50 + (1 - prog) * 26;
    const wave = Math.sin(this.t * 4 + f.id) * 2;
    for (let i = 0; i < 6; i++) {
      const cx = x + 2 + i * 4, cy = by + Math.sin(this.t * 5 + i * 0.8 + f.id) * 1.5 + wave * (i / 6);
      ctx.fillStyle = f.owner >= 0 ? col : (prog > 0.05 ? capCol : col);
      ctx.fillRect(cx, cy, 4, 14);
      ctx.fillStyle = 'rgba(0,0,0,0.18)'; ctx.fillRect(cx, cy + 10, 4, 4);
    }
    ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.font = '800 9px ui-monospace, monospace'; ctx.textAlign = 'center';
    ctx.fillText(f.letter, x + 14, by + 10);
  }

  drawMcom(ctx, m) {
    const x = m.x, y = m.y;
    ctx.fillStyle = 'rgba(0,0,0,0.3)'; ctx.fillRect(x - 12, y + 2, 26, 8);
    if (m.state === 2) {
      ctx.fillStyle = '#2a2624'; ctx.fillRect(x - 12, y - 4, 24, 12); ctx.fillStyle = '#4a4440'; ctx.fillRect(x - 8, y - 8, 10, 6);
      if (Math.random() < 0.15) this.game.fx.damageSmoke(x, y, true);
      return;
    }
    const armed = m.state === 1;
    const blink = armed && Math.floor(this.t * (m.timer < 10 ? 8 : 3)) % 2 === 0;
    box25(ctx, x, y, 24, 14, 14, '#4b5158', '#2b2f33');
    ctx.fillStyle = armed ? (blink ? '#ff3b2f' : '#661a14') : '#5aa7ff'; ctx.fillRect(x - 8, y - 13, 16, 8);
    ctx.fillStyle = 'rgba(0,0,0,0.5)'; ctx.fillRect(x - 8, y - 4, 16, 3);
    ctx.fillStyle = armed ? '#ff9a80' : '#bcd8ff'; ctx.font = '700 8px ui-monospace, monospace'; ctx.textAlign = 'center';
    ctx.fillText(armed ? String(Math.ceil(m.timer)) : 'M-COM', x, y - 7);
    if (armed && blink) { ctx.fillStyle = 'rgba(255,60,40,0.18)'; ctx.fillRect(x - 40, y - 40, 80, 70); }
  }

  drawGadget(ctx, d) {
    const [, gi, x, y, a, team, armed, life] = d;
    const def = GADGET_LIST[gi];
    if (!def) return;
    const tc = team === 0 ? '#e0523a' : '#3f86e8';
    switch (def.id) {
      case 'medkit': box25(ctx, x, y, 14, 10, 9, '#f2f2f2', '#c9cdd2'); ctx.fillStyle = '#d0392b'; ctx.fillRect(x - 1, y - 14, 3, 8); ctx.fillRect(x - 4, y - 11, 9, 3); break;
      case 'ammo': box25(ctx, x, y, 16, 10, 8, '#7d9a4a', '#586f34'); ctx.fillStyle = '#e8d26a'; ctx.fillRect(x - 5, y - 10, 10, 2); break;
      case 'mine': ctx.fillStyle = '#20232a'; ctx.fillRect(x - 8, y - 4, 16, 8); ctx.fillStyle = armed ? '#e05a3a' : '#777'; ctx.fillRect(x - 2, y - 2, 4, 4); break;
      case 'claymore': box25(ctx, x, y, 12, 5, 6, '#5d7a45', '#3d5230'); ctx.fillStyle = armed ? '#ff5a3a' : '#777'; ctx.fillRect(x + Math.cos(a) * 4 - 1, y + Math.sin(a) * 3 - 8, 3, 3); break;
      case 'c4': box25(ctx, x, y, 12, 8, 6, '#d9cdaa', '#a89c78'); ctx.fillStyle = Math.floor(this.t * 3) % 2 ? '#ff3b2f' : '#601810'; ctx.fillRect(x + 2, y - 8, 3, 3); break;
      case 'beacon': box25(ctx, x, y, 8, 8, 4, '#3a3f46', '#22262b'); ctx.fillStyle = '#2b2f36'; ctx.fillRect(x - 1, y - 30, 3, 26); ctx.fillStyle = Math.floor(this.t * 2) % 2 ? tc : '#222'; ctx.fillRect(x - 3, y - 34, 7, 5); break;
      case 'sensor': box25(ctx, x, y, 10, 10, 4, '#3a3f46', '#22262b'); ctx.fillStyle = '#7fe08a'; ctx.fillRect(x - 3, y - 10, 7, 4); ctx.strokeStyle = 'rgba(127,224,138,0.6)'; ctx.lineWidth = 1; ctx.strokeRect(x - 5, y - 12, 11, 8); break;
      default: box25(ctx, x, y, 10, 10, 6, '#aaa', '#777');
    }
    void life;
  }

  drawGrenade(ctx, n) {
    const [, type, x, y] = n;
    const c = GREN_COL[GREN_ORDER[type]] || '#888';
    ctx.fillStyle = c; ctx.fillRect(x - 3, y - 9, 6, 6);
    ctx.fillStyle = 'rgba(255,255,255,0.5)'; ctx.fillRect(x - 3, y - 9, 6, 2);
  }

  projectilePos(q) { return q; }

  drawProjectile(ctx, q) {
    const pr = PROJ[PROJ_LIST[q.idx]];
    const z = 16;
    const len = pr && pr.speed > 1000 ? 12 : 9;
    const dx = Math.cos(q.a), dy = Math.sin(q.a);
    ctx.lineCap = 'square';
    ctx.strokeStyle = '#2a2d33'; ctx.lineWidth = 4;
    ctx.beginPath(); ctx.moveTo(q.x - dx * len, q.y - dy * len - z); ctx.lineTo(q.x + dx * len * 0.4, q.y + dy * len * 0.4 - z); ctx.stroke();
    ctx.strokeStyle = '#d6d9de'; ctx.lineWidth = 2;
    ctx.beginPath(); ctx.moveTo(q.x - dx * len * 0.5, q.y - dy * len * 0.5 - z); ctx.lineTo(q.x + dx * len * 0.4, q.y + dy * len * 0.4 - z); ctx.stroke();
    ctx.fillStyle = '#ffb030'; ctx.fillRect(q.x - dx * len - 2, q.y - dy * len - z - 2, 5, 5);
    if (Math.random() < 0.6) this.game.fx.smokeTrail(q.x - dx * len, q.y - dy * len, z);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(q.x - 3, q.y + 3, 6, 4);
  }

  drawSmokes(ctx) {
    const g = this.game;
    for (const s of g.ents.sm || []) {
      const [id, x, y, r, age] = s;
      if (!this.inView(x, y, r + 30)) continue;
      const fadeOut = age > 16 ? clamp((18 - age) / 2, 0, 1) : 1;
      const puffs = 22;
      for (let i = 0; i < puffs; i++) {
        const h = Math.sin(id * 12.9898 + i * 78.233) * 43758.5453; const q = h - Math.floor(h);
        const h2 = Math.sin(id * 4.1414 + i * 37.719) * 12345.678; const q2 = h2 - Math.floor(h2);
        const ang = q * TAU + this.t * (0.12 + q2 * 0.2) * (i % 2 ? 1 : -1);
        const d = Math.sqrt(q2) * r * 0.66;
        const px = x + Math.cos(ang) * d, py = y + Math.sin(ang) * d - 10 - (i % 3) * 8;
        const pr = Math.round(r * (0.32 + q * 0.2) / 4) * 4;
        const shade = 176 + Math.floor(q2 * 44);
        ctx.globalAlpha = 0.85 * fadeOut;
        ctx.fillStyle = `rgb(${shade},${shade + 3},${shade + 7})`;
        ctx.fillRect(Math.round(px - pr), Math.round(py - pr), pr * 2, pr * 2);
        ctx.fillStyle = 'rgba(255,255,255,0.12)'; ctx.fillRect(Math.round(px - pr), Math.round(py - pr), pr * 2, 3);
      }
      ctx.globalAlpha = 1;
    }
  }

  // ------------------------------------------------------------------ fog
  drawFog(poly, viewer) {
    const g = this.game, ctx = this.ctx;
    if (!poly || !viewer) return;
    const f = this.fctx, fw = this.fogCanvas.width, fh = this.fogCanvas.height;
    const th = (this.map.theme && this.map.theme.fog) || [8, 10, 16];
    f.globalCompositeOperation = 'source-over';
    f.clearRect(0, 0, fw, fh);
    f.fillStyle = `rgba(${th[0]},${th[1]},${th[2]},0.68)`;
    f.fillRect(0, 0, fw, fh);
    f.globalCompositeOperation = 'destination-out';
    const s = this.scale * this.dpr * 0.5;
    const ox = (this.W / 2 - this.cam.x * this.scale) * this.dpr * 0.5, oy = (this.H / 2 - this.cam.y * this.scale) * this.dpr * 0.5;
    const lift = viewer.air ? 0 : (this.lift !== undefined ? this.lift : WALL_LIFT);
    f.beginPath();
    for (let i = 0; i < poly.n; i++) {
      const x = poly.pts[i * 2] * s + ox, y = (poly.pts[i * 2 + 1] - (poly.hit[i] ? lift : 0)) * s + oy;
      if (i === 0) f.moveTo(x, y); else f.lineTo(x, y);
    }
    f.closePath();
    f.fillStyle = 'rgba(0,0,0,1)'; f.fill();
    f.lineJoin = 'round';
    f.strokeStyle = 'rgba(0,0,0,0.5)'; f.lineWidth = 9 * this.scale * 0.5; f.stroke();
    f.strokeStyle = 'rgba(0,0,0,0.25)'; f.lineWidth = 18 * this.scale * 0.5; f.stroke();
    // the viewer stands slightly above the ground: never let a wall face swallow their own sprite
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.fogCanvas, 0, 0, this.canvas.width, this.canvas.height);
    ctx.imageSmoothingEnabled = false;
    void g;
  }

  // ------------------------------------------------------------------ labels & markers
  drawLabels(ctx, viewer) {
    const g = this.game;
    ctx.textAlign = 'center';
    ctx.font = '700 10px ui-monospace, Menlo, Consolas, monospace';
    const myTeam = g.me ? (g.roster.get(g.me.id) || {}).tm : g.myTeam();
    for (const p of g.soldiers()) {
      if (p.own || !this.inView(p.x, p.y)) continue;
      const mate = p.team === myTeam;
      if (!mate && g.myTeam() !== SPEC) continue;
      if (!mate && viewer && g.fogOn && !g.freecam && !canSee(this.map, g.smokeCircles(), viewer.x, viewer.y, viewer.angle, viewer.view, p.x, p.y, 0, PLAYER_R)) continue;
      const col = TEAM_COL[p.team] || TEAM_COL[2];
      const r = g.roster.get(p.id);
      const sq = mate && r && g.mySquad() >= 0 && r.sq === g.mySquad();
      const name = g.nameOf(p.id);
      const y = p.y - 36;
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillText(name, p.x + 1, y + 1);
      ctx.fillStyle = sq ? '#7dff9a' : col.text; ctx.fillText(name, p.x, y);
      if (sq) { ctx.fillStyle = '#7dff9a'; ctx.beginPath(); ctx.moveTo(p.x, y - 8); ctx.lineTo(p.x - 4, y - 14); ctx.lineTo(p.x + 4, y - 14); ctx.closePath(); ctx.fill(); }
      if (p.hp > 0) {
        const w = 24;
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(p.x - w / 2 - 1, y + 3, w + 2, 4);
        ctx.fillStyle = p.hp > 50 ? '#4cd964' : p.hp > 25 ? '#f5c542' : '#ff453a';
        ctx.fillRect(p.x - w / 2, y + 4, w * clamp(p.hp / 100, 0, 1), 2);
      }
    }
    // friendly vehicles get a tag
    for (const v of g.vehiclesDrawn()) {
      if (!this.inView(v.x, v.y) || !v.def) continue;
      const mate = v.team === myTeam;
      const y = v.y - (v.def.kind === 'air' ? AIR_ALT + 40 : v.def.r + 30);
      ctx.font = '700 10px ui-monospace, Menlo, Consolas, monospace';
      const col = v.team >= 0 ? TEAM_COL[v.team] : TEAM_COL[2];
      if (mate || v.team < 0) {
        ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillText(v.def.name, v.x + 1, y + 1);
        ctx.fillStyle = col.text; ctx.fillText(v.def.name, v.x, y);
        const w = 34;
        ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(v.x - w / 2 - 1, y + 3, w + 2, 4);
        ctx.fillStyle = v.hp > 50 ? '#4cd964' : v.hp > 25 ? '#f5c542' : '#ff453a'; ctx.fillRect(v.x - w / 2, y + 4, w * clamp(v.hp / 100, 0, 1), 2);
      }
    }
    // spotted enemies: red markers even through the fog
    for (const s of g.ents.sp || []) {
      const [, x, y, kind] = s;
      if (!this.inView(x, y)) continue;
      const bob = Math.sin(this.t * 5) * 2;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.moveTo(x, y - 30 + bob + 1); ctx.lineTo(x - 8, y - 44 + bob + 1); ctx.lineTo(x + 8, y - 44 + bob + 1); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.moveTo(x, y - 31 + bob); ctx.lineTo(x - 7, y - 43 + bob); ctx.lineTo(x + 7, y - 43 + bob); ctx.closePath(); ctx.fill();
      if (kind) { ctx.fillStyle = '#fff'; ctx.fillRect(x - 2, y - 41 + bob, 4, 4); }
    }
    void viewer;
  }

  drawFlagLabels(ctx) {
    for (const f of this.game.flagList()) {
      if (!this.inView(f.x, f.y, 100)) continue;
      const col = f.owner === 0 ? '#ff8a72' : f.owner === 1 ? '#7fb0ff' : '#e6e9ec';
      ctx.font = '800 13px ui-monospace, Menlo, monospace'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillText(`${f.letter} · ${f.name}`, f.x + 1, f.y - 68);
      ctx.fillStyle = col; ctx.fillText(`${f.letter} · ${f.name}`, f.x, f.y - 69);
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
      ctx.lineWidth = 2; const rr = 8 + k * 28; ctx.strokeRect(p.x - rr, p.y - rr * 0.8, rr * 2, rr * 1.6);
      ctx.globalAlpha = clamp((4.5 - age) / 1, 0, 1);
      ctx.fillStyle = col.text;
      ctx.beginPath(); ctx.moveTo(p.x, p.y); ctx.lineTo(p.x - 7, p.y - 17); ctx.lineTo(p.x + 7, p.y - 17); ctx.closePath(); ctx.fill();
      ctx.font = '700 11px ui-monospace, monospace'; ctx.textAlign = 'center';
      ctx.fillStyle = 'rgba(0,0,0,0.7)'; ctx.fillText(g.nameOf(p.id), p.x + 1, p.y - 22);
      ctx.fillStyle = '#fff'; ctx.fillText(g.nameOf(p.id), p.x, p.y - 23);
    }
    ctx.globalAlpha = 1;
  }

  drawOffscreenMarkers(ctx) {
    const g = this.game;
    const marks = [];
    for (const f of g.flagList()) {
      const col = f.owner === 0 ? '#ff6a52' : f.owner === 1 ? '#5a9cff' : '#d8dce0';
      marks.push({ x: f.x, y: f.y, label: f.letter, col, pulse: f.contested });
    }
    for (const m of g.mcomList()) if (m.state !== 2) marks.push({ x: m.x, y: m.y, label: 'M', col: m.state === 1 ? '#ff3b2f' : '#ffb84a', pulse: m.state === 1 });
    for (const m of marks) {
      const p = this.worldToScreen(m.x, m.y);
      const pad = 40;
      if (p.x > pad && p.x < this.W - pad && p.y > pad && p.y < this.H - pad) continue;
      const cx = this.W / 2, cy = this.H / 2;
      const dx = p.x - cx, dy = p.y - cy;
      const k = Math.min((this.W / 2 - pad) / Math.abs(dx || 1e-6), (this.H / 2 - pad) / Math.abs(dy || 1e-6));
      const ex = cx + dx * k, ey = cy + dy * k, a = Math.atan2(dy, dx);
      ctx.save(); ctx.translate(ex, ey);
      const pulse = m.pulse ? 0.6 + 0.4 * Math.sin(this.t * 8) : 0.9;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(-13, -13, 26, 26);
      ctx.rotate(a); ctx.fillStyle = m.col; ctx.globalAlpha = pulse;
      ctx.beginPath(); ctx.moveTo(24, 0); ctx.lineTo(14, -7); ctx.lineTo(14, 7); ctx.closePath(); ctx.fill();
      ctx.rotate(-a); ctx.globalAlpha = 1;
      ctx.fillStyle = m.col; ctx.font = '800 14px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(m.label, 0, 1);
      ctx.restore();
    }
  }

  // ------------------------------------------------------------------ screen overlays
  drawOverlays(ctx, viewer, dt) {
    void dt;
    const g = this.game, W = this.W, H = this.H, now = performance.now();
    g.damageDirs = g.damageDirs.filter((d) => now - d.t < 900);
    for (const d of g.damageDirs) {
      const k = (now - d.t) / 900;
      ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(d.a);
      ctx.strokeStyle = `rgba(255,40,30,${0.7 * (1 - k)})`; ctx.lineWidth = 9;
      ctx.beginPath(); ctx.arc(0, 0, Math.min(W, H) * 0.36, -0.28, 0.28); ctx.stroke();
      ctx.restore();
    }
    if (g.alive && g.me && g.me.own && g.me.hp < 35) {
      const a = (0.25 + 0.1 * Math.sin(this.t * 5)) * (1 - g.me.hp / 35);
      const gr = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
      gr.addColorStop(0, 'rgba(160,0,0,0)'); gr.addColorStop(1, `rgba(160,0,0,${a + 0.25})`);
      ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    }
    if (viewer && viewer.scoped && g.alive) {
      const gr = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.7);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, viewer.scopeLvl ? 'rgba(0,0,0,0.5)' : 'rgba(0,0,0,0.24)');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    }
    const el = (now - g.flashRecv) / 1000;
    const full = g.flashFull - el, left = g.flashLeft - el;
    if (left > 0) {
      const a = full > 0 ? 1 : clamp(left / Math.max(0.6, g.flashLeft - g.flashFull), 0, 1) * 0.95;
      ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.fillRect(0, 0, W, H);
    }
    if (g.alive && g.me && g.me.own && !(g.ui.isOverlayOpen && g.ui.isOverlayOpen())) this.drawCrosshair(ctx, viewer, now);
  }

  drawCrosshair(ctx, viewer, now) {
    const g = this.game, me = g.me, inp = g.input;
    const mx = inp.mx, my = inp.my;
    const held = me.held;
    // vehicle: the reticle shows where the turret is really pointing
    if (me.veh) {
      const v = me.veh, def = VEHICLES[VEHICLE_LIST[v.ty]];
      const sd = def.seats[v.seat];
      ctx.save(); ctx.translate(mx, my);
      const hm = now - g.hitMarker < 170;
      const col = hm ? '#ffffff' : 'rgba(120,255,160,0.95)';
      ctx.strokeStyle = 'rgba(0,0,0,0.6)'; ctx.lineWidth = 4;
      for (const pass of [0, 1]) {
        ctx.strokeStyle = pass ? col : 'rgba(0,0,0,0.6)'; ctx.lineWidth = pass ? 2 : 4;
        ctx.strokeRect(-11, -11, 22, 22); ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(-6, 0); ctx.moveTo(16, 0); ctx.lineTo(6, 0); ctx.moveTo(0, -16); ctx.lineTo(0, -6); ctx.moveTo(0, 16); ctx.lineTo(0, 6); ctx.stroke();
      }
      if (v.rel > 0 || v.cd > 0.05) {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 20, -Math.PI / 2, -Math.PI / 2 + TAU * (v.rel > 0 ? v.rel : 1 - Math.min(1, v.cd / (sd.weapon === 'cannon' ? 2.2 : 0.4)))); ctx.stroke();
      }
      ctx.restore();
      if (sd.weapon && viewer) {
        // where the turret / gun points right now
        const ang = sd.aim === 'turret' ? g.turretAngle() : sd.aim === 'body' ? g.predVeh.a : v.sa;
        const ps = this.worldToScreen(viewer.x, viewer.y);
        ctx.strokeStyle = 'rgba(255,255,255,0.2)'; ctx.lineWidth = 1; ctx.setLineDash([4, 6]);
        ctx.beginPath(); ctx.moveTo(ps.x, ps.y - 12); ctx.lineTo(ps.x + Math.cos(ang) * 400 * this.scale, ps.y - 12 + Math.sin(ang) * 400 * this.scale); ctx.stroke(); ctx.setLineDash([]);
      }
      return;
    }
    const w = held < HELD_GREN_BASE ? WEAPON_LIST[held] : null;
    // grenade landing preview
    if (held >= HELD_GREN_BASE && held < HELD_GADGET_BASE && viewer) {
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
      ctx.setLineDash([4, 5]); ctx.strokeRect(lx - rad, ly - rad, rad * 2, rad * 2);
      ctx.setLineDash([]); ctx.fillStyle = 'rgba(255,255,255,0.9)'; ctx.fillRect(lx - 2, ly - 2, 5, 5);
      ctx.restore();
    }
    // underbarrel grenade landing point
    if (me.alt && viewer && w) {
      const ps = this.worldToScreen(viewer.x, viewer.y);
      const wm = this.screenToWorld(mx, my);
      const d = clamp(Math.hypot(wm.x - viewer.x, wm.y - viewer.y), 90, 900);
      const a = Math.atan2(my - ps.y, mx - ps.x);
      const lx = ps.x + Math.cos(a) * d * this.scale, ly = ps.y + Math.sin(a) * d * this.scale, rad = ALT.ugl.radius * this.scale;
      ctx.save(); ctx.strokeStyle = 'rgba(255,150,70,0.8)'; ctx.setLineDash([4, 5]); ctx.lineWidth = 1.5; ctx.strokeRect(lx - rad, ly - rad, rad * 2, rad * 2); ctx.restore();
    }
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
    const len = 8;
    const ticks = (color, lw) => {
      ctx.strokeStyle = color; ctx.lineWidth = lw; ctx.beginPath();
      ctx.moveTo(gp, 0); ctx.lineTo(gp + len, 0); ctx.moveTo(-gp, 0); ctx.lineTo(-gp - len, 0);
      ctx.moveTo(0, gp); ctx.lineTo(0, gp + len); ctx.moveTo(0, -gp); ctx.lineTo(0, -gp - len); ctx.stroke();
    };
    const gadget = held >= HELD_GADGET_BASE;
    if (!gadget && (!w || w.kind !== 'knife')) { ticks('rgba(0,0,0,0.6)', 4); ticks(col, 2); }
    ctx.fillStyle = col; ctx.fillRect(-1.5, -1.5, 3, 3);
    if (hm) { ctx.strokeStyle = g.hitKill ? '#ff453a' : '#fff'; ctx.lineWidth = 2; ctx.beginPath(); ctx.moveTo(-9, -9); ctx.lineTo(-4, -4); ctx.moveTo(9, -9); ctx.lineTo(4, -4); ctx.moveTo(-9, 9); ctx.lineTo(-4, 4); ctx.moveTo(9, 9); ctx.lineTo(4, 4); ctx.stroke(); }
    if (me.rel > 0) {
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 5; ctx.beginPath(); ctx.arc(0, 0, gp + 16, 0, TAU); ctx.stroke();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, gp + 16, -Math.PI / 2, -Math.PI / 2 + TAU * me.rel); ctx.stroke();
    }
    if (me.lk) {
      ctx.strokeStyle = me.lk[1] >= 1 ? '#ff3b2f' : '#ffd24a'; ctx.lineWidth = 3; ctx.strokeRect(-18, -18, 36, 36);
      ctx.fillStyle = ctx.strokeStyle; ctx.font = '800 11px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.fillText(me.lk[1] >= 1 ? 'LOCKED' : 'LOCKING', 0, 32);
    }
    ctx.restore();
  }
}
export { TILES };
