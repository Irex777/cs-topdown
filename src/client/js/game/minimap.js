// Radar (local zoomed view around the player) and the big tactical map (M): terrain thumbnail plus live markers.
import { SPEC, T, CT } from '../../shared/constants.js';
import { GADGET_LIST } from '../../shared/weapons.js';
import { VEHICLES, VEHICLE_LIST } from '../../shared/vehicles.js';
import { TEAM_COL } from './render.js';

const RADAR_SPAN = 2400;      // world px across the radar

export class Minimap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.map = null;
    this.terrain = null;
    this.big = false;
    this.w = 0; this.h = 0;
    this.spotted = new Map();
  }

  setMap(map, terrain) {
    this.map = map;
    this.terrain = terrain;
    this.spotted.clear();
    this.layout(false);
  }

  layout(big) {
    if (!this.map) return;
    this.big = big;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    if (big) {
      const maxW = Math.min(window.innerWidth * 0.78, 1240), maxH = window.innerHeight * 0.78;
      const k = Math.min(maxW / this.map.w, maxH / this.map.h);
      this.w = Math.round(this.map.w * k); this.h = Math.round(this.map.h * k);
    } else { this.w = 224; this.h = 224; }
    this.canvas.parentElement.classList.toggle('radar-big', big);
    this.canvas.style.width = this.w + 'px'; this.canvas.style.height = this.h + 'px';
    this.canvas.width = this.w * dpr; this.canvas.height = this.h * dpr;
    this.dpr = dpr;
  }

  draw(game) {
    if (!this.map || !this.terrain || !this.terrain.thumb) return;
    if (game.bigmap !== this.big) this.layout(game.bigmap);
    const ctx = this.ctx, d = this.dpr, W = this.canvas.width, H = this.canvas.height;
    const v = game.viewer();
    const map = this.map;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.fillStyle = '#0a0d12'; ctx.fillRect(0, 0, W, H);
    // world -> canvas transform
    let s, ox, oy;
    if (this.big) { s = W / map.width; ox = 0; oy = 0; }
    else {
      s = W / RADAR_SPAN;
      const cx = v ? v.x : map.width / 2, cy = v ? v.y : map.height / 2;
      ox = W / 2 - cx * s; oy = H / 2 - cy * s;
    }
    const thumb = this.terrain.thumb, S = this.terrain.thumbS;
    ctx.save();
    // the radar turns with the camera: up is where you are looking
    let rot = 0;
    if (!this.big) { ctx.beginPath(); ctx.rect(0, 0, W, H); ctx.clip(); rot = -Math.PI / 2 - game.yaw; ctx.translate(W / 2, H / 2); ctx.rotate(rot); ctx.translate(-W / 2, -H / 2); }
    ctx.drawImage(thumb, 0, 0, thumb.width, thumb.height, ox, oy, map.width * s, map.height * s);
    ctx.fillStyle = 'rgba(5,8,14,0.28)'; ctx.fillRect(-W, -H, W * 3, H * 3);
    const label = (str, x, y) => { ctx.save(); ctx.translate(x, y); ctx.rotate(-rot); ctx.fillText(str, 0, 0); ctx.restore(); };
    void S;
    const X = (x) => x * s + ox, Y = (y) => y * s + oy;
    const k = d * (this.big ? 1.25 : 1);
    const now = performance.now();
    const myTeam = game.me ? (game.roster.get(game.me.id) || {}).tm : game.myTeam();

    // flags
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const f of game.flagList()) {
      const col = f.owner === 0 ? '#e0523a' : f.owner === 1 ? '#3f86e8' : '#d8dce0';
      const r = 8 * k;
      ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(X(f.x) - r, Y(f.y) - r, r * 2, r * 2);
      ctx.fillStyle = col; ctx.fillRect(X(f.x) - r + 2, Y(f.y) - r + 2, r * 2 - 4, r * 2 - 4);
      if (f.contested) { ctx.strokeStyle = '#ffd24a'; ctx.lineWidth = 2 * d; ctx.strokeRect(X(f.x) - r - 2, Y(f.y) - r - 2, r * 2 + 4, r * 2 + 4); }
      ctx.fillStyle = '#0b0e14'; ctx.font = `800 ${Math.round(11 * k)}px ui-monospace, monospace`;
      label(f.letter, X(f.x), Y(f.y) + 1);
    }
    for (const m of game.mcomList()) {
      if (m.state === 2) continue;
      const on = m.state === 1 && Math.floor(now / 250) % 2 === 0;
      ctx.fillStyle = m.state === 1 ? (on ? '#ff3b2f' : '#7a1d16') : '#ffb84a';
      const r = 7 * k; ctx.fillRect(X(m.x) - r, Y(m.y) - r, r * 2, r * 2);
      ctx.fillStyle = '#0b0e14'; ctx.font = `800 ${Math.round(10 * k)}px ui-monospace, monospace`; label('M', X(m.x), Y(m.y) + 1);
    }
    // smokes, fires
    for (const sm of game.ents.sm) { ctx.fillStyle = 'rgba(210,215,220,0.55)'; const r = Math.max(2, sm[3] * s); ctx.fillRect(X(sm[1]) - r, Y(sm[2]) - r, r * 2, r * 2); }
    for (const f of game.ents.fi) { ctx.fillStyle = 'rgba(255,120,40,0.6)'; const r = Math.max(2, f[3] * s); ctx.fillRect(X(f[1]) - r, Y(f[2]) - r, r * 2, r * 2); }
    // deployables: beacons and sensors of my team
    for (const g of game.ents.gd) {
      const def = GADGET_LIST[g[1]];
      if (!def || (def.id !== 'beacon' && def.id !== 'sensor')) continue;
      ctx.fillStyle = def.id === 'beacon' ? '#7dff9a' : '#7fe08a'; const r = 4 * k;
      ctx.fillRect(X(g[2]) - r, Y(g[3]) - r, r * 2, r * 2);
    }
    // revive requests
    for (const c of game.ents.cp) { ctx.fillStyle = '#5dff9a'; const r = 2 * k; ctx.fillRect(X(c[1]) - r * 2, Y(c[2]) - r / 2, r * 4, r); ctx.fillRect(X(c[1]) - r / 2, Y(c[2]) - r * 2, r, r * 4); }
    // vehicles
    for (const veh of game.vehiclesDrawn()) {
      const def = VEHICLES[VEHICLE_LIST[veh.ty]];
      if (!def) continue;
      const mate = veh.team === myTeam;
      const col = veh.team < 0 ? '#c8ccd2' : mate ? (veh.team === 0 ? '#ff8a72' : '#7fb0ff') : '#ff453a';
      ctx.save(); ctx.translate(X(veh.x), Y(veh.y)); ctx.rotate(veh.a);
      ctx.fillStyle = col; ctx.strokeStyle = 'rgba(0,0,0,0.8)'; ctx.lineWidth = d;
      const L = (def.kind === 'air' ? 7 : 6) * k, Wd = (def.kind === 'air' ? 5 : 3.5) * k;
      if (def.kind === 'air') { ctx.beginPath(); ctx.moveTo(L, 0); ctx.lineTo(-L * 0.7, -Wd); ctx.lineTo(-L * 0.3, 0); ctx.lineTo(-L * 0.7, Wd); ctx.closePath(); ctx.fill(); ctx.stroke(); }
      else { ctx.fillRect(-L, -Wd, L * 2, Wd * 2); ctx.strokeRect(-L, -Wd, L * 2, Wd * 2); }
      ctx.restore();
    }
    // soldiers
    for (const p of game.soldiers()) {
      if (p.own) continue;
      const mate = p.team === myTeam && myTeam !== SPEC;
      const col = TEAM_COL[p.team] || TEAM_COL[2];
      const x = X(p.x), y = Y(p.y);
      const r = (mate ? 3.6 : 4) * k;
      const sq = mate && game.mySquad() >= 0 && (game.roster.get(p.id) || {}).sq === game.mySquad();
      if (!mate) this.spotted.set(p.id, { x: p.x, y: p.y, t: now });
      ctx.fillStyle = mate ? (sq ? '#7dff9a' : col.body) : '#ff453a';
      ctx.strokeStyle = 'rgba(0,0,0,0.75)'; ctx.lineWidth = d;
      ctx.fillRect(x - r, y - r, r * 2, r * 2); ctx.strokeRect(x - r, y - r, r * 2, r * 2);
      if (mate) { ctx.strokeStyle = sq ? '#7dff9a' : col.text; ctx.lineWidth = 1.5 * d; ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(p.a) * 8 * k, y + Math.sin(p.a) * 8 * k); ctx.stroke(); }
    }
    for (const sp of game.ents.sp) {
      const x = X(sp[1]), y = Y(sp[2]), r = 5 * k;
      ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.moveTo(x, y - r); ctx.lineTo(x + r, y); ctx.lineTo(x, y + r); ctx.lineTo(x - r, y); ctx.closePath(); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = d; ctx.stroke();
    }
    for (const [id, sp] of this.spotted) {
      const age = (now - sp.t) / 1000;
      if (age > 2.2) { this.spotted.delete(id); continue; }
      if (game.snaps.length && game.snaps[game.snaps.length - 1].players.has(id)) continue;
      ctx.globalAlpha = 1 - age / 2.2; ctx.fillStyle = '#ff453a'; const r = 3.5 * k; ctx.fillRect(X(sp.x) - r, Y(sp.y) - r, r * 2, r * 2); ctx.globalAlpha = 1;
    }
    // pings
    for (const p of game.pings) {
      const age = (now - p.t) / 1000;
      if (age > 4.5) continue;
      const col = TEAM_COL[p.team] || TEAM_COL[2];
      ctx.strokeStyle = col.text; ctx.lineWidth = 2 * d; ctx.globalAlpha = 1 - (age % 1);
      const r = (4 + (age % 1) * 12) * d; ctx.strokeRect(X(p.x) - r, Y(p.y) - r, r * 2, r * 2); ctx.globalAlpha = 1;
    }
    // the viewer
    if (v) {
      const x = X(v.x), y = Y(v.y);
      // view cone
      ctx.fillStyle = 'rgba(255,255,255,0.10)';
      const range = Math.min(v.view.range, 1100) * s;
      ctx.beginPath(); ctx.moveTo(x, y);
      const half = Math.min(Math.PI, v.view.fov / 2);
      ctx.arc(x, y, range, v.angle - half, v.angle + half); ctx.closePath(); ctx.fill();
      ctx.save(); ctx.translate(x, y); ctx.rotate(v.angle);
      ctx.fillStyle = '#fff'; ctx.strokeStyle = '#000'; ctx.lineWidth = d;
      ctx.beginPath(); ctx.moveTo(8 * k, 0); ctx.lineTo(-5 * k, -5 * k); ctx.lineTo(-3 * k, 0); ctx.lineTo(-5 * k, 5 * k); ctx.closePath(); ctx.fill(); ctx.stroke();
      ctx.restore();
    }
    ctx.restore();
    ctx.strokeStyle = 'rgba(255,255,255,0.25)'; ctx.lineWidth = d; ctx.strokeRect(0.5, 0.5, W - 1, H - 1);
    void T; void CT;
  }
}
