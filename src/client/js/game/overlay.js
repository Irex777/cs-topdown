// Everything drawn on the 2D layer above the 3D scene: name tags, objective markers, pings, spot markers, floating
// score text, damage indicators, screen effects and the crosshair. World positions are projected through the camera.
import { SPEC, GREN_ORDER, HE_RADIUS, SMOKE_RADIUS, FIRE_RADIUS, GREN_MAX_DIST, GREN_MIN_DIST } from '../../shared/constants.js';
import { WEAPON_LIST, HELD_GREN_BASE, HELD_GADGET_BASE, ALT } from '../../shared/weapons.js';
import { VEHICLES, VEHICLE_LIST } from '../../shared/vehicles.js';

const TAU = Math.PI * 2;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
export const TEAM_COL = {
  0: { body: '#c4472f', dark: '#8c2e20', helm: '#7a281c', text: '#ff8a72' },
  1: { body: '#3f7fd8', dark: '#264f8f', helm: '#213f73', text: '#7fb0ff' },
  2: { body: '#888', dark: '#555', helm: '#666', text: '#c8ccd2' },
};
const FONT = 'ui-monospace, Menlo, Consolas, monospace';
const LABEL_RANGE = 1500;

export class Overlay {
  constructor(renderer) { this.r = renderer; }

  draw(ctx, viewer, dt) {
    const r = this.r, g = r.game;
    ctx.setTransform(r.dpr, 0, 0, r.dpr, 0, 0);
    ctx.clearRect(0, 0, r.W, r.H);
    this.flagLabels(ctx);
    this.labels(ctx, viewer);
    this.pings(ctx);
    this.floaters(ctx);
    this.offscreen(ctx);
    this.screenFx(ctx, viewer, dt);
    if (g.alive && g.me && g.me.own && !(g.ui.isOverlayOpen && g.ui.isOverlayOpen())) this.crosshair(ctx, viewer, performance.now());
    if (g.playing() && !g.input.locked && !g.input.lockDenied) {
      ctx.fillStyle = 'rgba(0,0,0,0.55)'; ctx.fillRect(r.W / 2 - 170, 148, 340, 34);
      this.text(ctx, 'CLICK TO CAPTURE THE MOUSE', r.W / 2, 170, '#ffd95a', 13, 800);
    }
  }

  text(ctx, str, x, y, col, size = 10, weight = 700) {
    ctx.font = `${weight} ${size}px ${FONT}`; ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(0,0,0,0.75)'; ctx.fillText(str, x + 1, y + 1);
    ctx.fillStyle = col; ctx.fillText(str, x, y);
  }

  bar(ctx, x, y, w, k) {
    ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(x - w / 2 - 1, y, w + 2, 5);
    ctx.fillStyle = k > 0.5 ? '#4cd964' : k > 0.25 ? '#f5c542' : '#ff453a';
    ctx.fillRect(x - w / 2, y + 1, w * clamp(k, 0, 1), 3);
  }

  // ------------------------------------------------------------------ world-anchored labels
  flagLabels(ctx) {
    const r = this.r, g = r.game;
    for (const f of g.flagList()) {
      const p = r.project(f.x, f.y, 92);
      if (!p || p.dist > 2600) continue;
      const col = f.owner === 0 ? '#ff8a72' : f.owner === 1 ? '#7fb0ff' : '#e6e9ec';
      const near = p.dist < 1300;
      // big lettered badge
      ctx.save(); ctx.translate(p.x, p.y);
      const s = clamp(1500 / p.dist, 0.6, 1.5);
      ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(-14 * s, -14 * s, 28 * s, 28 * s);
      ctx.fillStyle = col; ctx.fillRect(-11 * s, -11 * s, 22 * s, 22 * s);
      ctx.fillStyle = '#0b0e14'; ctx.font = `800 ${Math.round(16 * s)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(f.letter, 0, 1);
      ctx.restore(); ctx.textBaseline = 'alphabetic';
      if (near) this.text(ctx, f.name, p.x, p.y - 22 * s, col, 12, 800);
      if (f.contested) { ctx.strokeStyle = `rgba(255,220,80,${0.5 + 0.4 * Math.sin(r.t * 8)})`; ctx.lineWidth = 3; ctx.strokeRect(p.x - 17 * s, p.y - 17 * s, 34 * s, 34 * s); }
    }
    for (const m of g.mcomList()) {
      const p = r.project(m.x, m.y, 44);
      if (!p || p.dist > 2600) continue;
      const armed = m.state === 1, dead = m.state === 2;
      const s = clamp(1500 / p.dist, 0.6, 1.4);
      ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillRect(p.x - 16 * s, p.y - 12 * s, 32 * s, 24 * s);
      ctx.fillStyle = dead ? '#666' : armed ? (Math.floor(r.t * (m.timer < 10 ? 8 : 3)) % 2 ? '#ff3b2f' : '#8a1d16') : '#ffb84a';
      ctx.fillRect(p.x - 13 * s, p.y - 9 * s, 26 * s, 18 * s);
      ctx.fillStyle = '#0b0e14'; ctx.font = `800 ${Math.round(12 * s)}px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(dead ? 'X' : armed ? String(Math.ceil(m.timer)) : 'M', p.x, p.y + 1);
      ctx.textBaseline = 'alphabetic';
    }
  }

  labels(ctx, viewer) {
    const r = this.r, g = r.game;
    const myTeam = g.me ? (g.roster.get(g.me.id) || {}).tm : g.myTeam();
    for (const p of g.soldiers()) {
      if (p.own) continue;
      const mate = p.team === myTeam;
      if (!mate && g.myTeam() !== SPEC) continue;
      const s = r.project(p.x, p.y, 40);
      if (!s || s.dist > LABEL_RANGE) continue;
      const col = TEAM_COL[p.team] || TEAM_COL[2];
      const rec = g.roster.get(p.id);
      const sq = mate && rec && g.mySquad() >= 0 && rec.sq === g.mySquad();
      const name = g.nameOf(p.id);
      ctx.globalAlpha = clamp((LABEL_RANGE - s.dist) / 500, 0.35, 1);
      this.text(ctx, name, s.x, s.y, sq ? '#7dff9a' : col.text, 11);
      if (sq) { ctx.fillStyle = '#7dff9a'; ctx.beginPath(); ctx.moveTo(s.x, s.y - 11); ctx.lineTo(s.x - 5, s.y - 18); ctx.lineTo(s.x + 5, s.y - 18); ctx.closePath(); ctx.fill(); }
      if (p.hp > 0) this.bar(ctx, s.x, s.y + 3, 30, p.hp / 100);
      ctx.globalAlpha = 1;
    }
    for (const v of g.vehiclesDrawn()) {
      const def = VEHICLES[VEHICLE_LIST[v.ty]];
      if (!def) continue;
      const mate = v.team === myTeam;
      if (!mate && v.team >= 0) continue;
      const s = r.project(v.x, v.y, def.kind === 'air' ? 96 : def.r + 34);
      if (!s || s.dist > 1800) continue;
      const col = v.team >= 0 ? TEAM_COL[v.team] : TEAM_COL[2];
      this.text(ctx, def.name, s.x, s.y, col.text, 11);
      this.bar(ctx, s.x, s.y + 3, 40, v.hp / 100);
    }
    // spotted enemies stay marked through walls
    for (const sp of g.ents.sp || []) {
      const [, x, y, kind] = sp;
      const s = r.project(x, y, 60);
      if (!s) continue;
      const bob = Math.sin(r.t * 5) * 3;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.beginPath(); ctx.moveTo(s.x, s.y + bob + 2); ctx.lineTo(s.x - 9, s.y - 14 + bob); ctx.lineTo(s.x + 9, s.y - 14 + bob); ctx.closePath(); ctx.fill();
      ctx.fillStyle = '#ff3b3b'; ctx.beginPath(); ctx.moveTo(s.x, s.y + bob); ctx.lineTo(s.x - 7, s.y - 12 + bob); ctx.lineTo(s.x + 7, s.y - 12 + bob); ctx.closePath(); ctx.fill();
      if (kind) { ctx.fillStyle = '#fff'; ctx.fillRect(s.x - 2, s.y - 10 + bob, 4, 4); }
    }
    void viewer;
  }

  pings(ctx) {
    const r = this.r, g = r.game, now = performance.now();
    g.pings = g.pings.filter((p) => now - p.t < 4500);
    for (const p of g.pings) {
      const age = (now - p.t) / 1000;
      const s = r.project(p.x, p.y, 34);
      if (!s) continue;
      const col = TEAM_COL[p.team] || TEAM_COL[2];
      const fade = clamp((4.5 - age) / 1, 0, 1);
      const k = (age * 1.4) % 1;
      ctx.globalAlpha = (1 - k) * fade; ctx.strokeStyle = col.text; ctx.lineWidth = 2;
      const rr = 10 + k * 26; ctx.strokeRect(s.x - rr, s.y - rr, rr * 2, rr * 2);
      ctx.globalAlpha = fade; ctx.fillStyle = col.text;
      ctx.beginPath(); ctx.moveTo(s.x, s.y); ctx.lineTo(s.x - 8, s.y - 18); ctx.lineTo(s.x + 8, s.y - 18); ctx.closePath(); ctx.fill();
      this.text(ctx, g.nameOf(p.id), s.x, s.y - 24, '#fff', 11);
      ctx.globalAlpha = 1;
    }
  }

  floaters(ctx) {
    const r = this.r;
    for (const f of r.game.fx.floaters) {
      const k = f.t / f.life;
      const s = r.project(f.x, f.y, 46 + k * 40);
      if (!s) continue;
      ctx.globalAlpha = 1 - k * k;
      this.text(ctx, f.text, s.x, s.y, f.color, 15, 800);
    }
    ctx.globalAlpha = 1;
  }

  /** edge-of-screen arrows for objectives that are out of view */
  offscreen(ctx) {
    const r = this.r, g = r.game;
    const marks = [];
    for (const f of g.flagList()) marks.push({ x: f.x, y: f.y, label: f.letter, col: f.owner === 0 ? '#ff6a52' : f.owner === 1 ? '#5a9cff' : '#d8dce0', pulse: f.contested });
    for (const m of g.mcomList()) if (m.state !== 2) marks.push({ x: m.x, y: m.y, label: 'M', col: m.state === 1 ? '#ff3b2f' : '#ffb84a', pulse: m.state === 1 });
    const W = r.W, H = r.H, pad = 44;
    for (const m of marks) {
      const p = r.project(m.x, m.y, 40, true);
      if (!p) continue;
      if (!p.behind && p.x > pad && p.x < W - pad && p.y > pad && p.y < H - pad) continue;
      const cx = W / 2, cy = H / 2;
      let dx = p.x - cx, dy = p.y - cy;
      if (p.behind) { dx = -dx; dy = -dy; if (Math.abs(dx) < 1 && Math.abs(dy) < 1) dy = H; }
      const k = Math.min((W / 2 - pad) / Math.abs(dx || 1e-6), (H / 2 - pad) / Math.abs(dy || 1e-6));
      const ex = cx + dx * k, ey = cy + dy * k, a = Math.atan2(dy, dx);
      ctx.save(); ctx.translate(ex, ey);
      const pulse = m.pulse ? 0.6 + 0.4 * Math.sin(r.t * 8) : 0.9;
      ctx.fillStyle = 'rgba(0,0,0,0.6)'; ctx.fillRect(-13, -13, 26, 26);
      ctx.rotate(a); ctx.fillStyle = m.col; ctx.globalAlpha = pulse;
      ctx.beginPath(); ctx.moveTo(25, 0); ctx.lineTo(15, -7); ctx.lineTo(15, 7); ctx.closePath(); ctx.fill();
      ctx.rotate(-a); ctx.globalAlpha = 1;
      ctx.fillStyle = m.col; ctx.font = `800 14px ${FONT}`; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(m.label, 0, 1);
      ctx.restore();
    }
    ctx.textBaseline = 'alphabetic';
  }

  // ------------------------------------------------------------------ screen effects
  screenFx(ctx, viewer, dt) {
    void dt;
    const r = this.r, g = r.game, W = r.W, H = r.H, now = performance.now();
    // damage direction arcs: relative to where the camera looks
    g.damageDirs = g.damageDirs.filter((d) => now - d.t < 900);
    for (const d of g.damageDirs) {
      const k = (now - d.t) / 900;
      ctx.save(); ctx.translate(W / 2, H / 2); ctx.rotate(d.a - r.yaw);
      ctx.strokeStyle = `rgba(255,40,30,${0.7 * (1 - k)})`; ctx.lineWidth = 9;
      ctx.beginPath(); ctx.arc(0, 0, Math.min(W, H) * 0.36, -0.28 - Math.PI / 2, 0.28 - Math.PI / 2); ctx.stroke();
      ctx.restore();
    }
    if (g.alive && g.me && g.me.own && g.me.hp < 35) {
      const a = (0.25 + 0.1 * Math.sin(r.t * 5)) * (1 - g.me.hp / 35);
      const gr = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.35, W / 2, H / 2, Math.max(W, H) * 0.75);
      gr.addColorStop(0, 'rgba(160,0,0,0)'); gr.addColorStop(1, `rgba(160,0,0,${a + 0.25})`);
      ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    }
    if (viewer && viewer.scoped && g.alive) {
      const gr = ctx.createRadialGradient(W / 2, H / 2, Math.min(W, H) * 0.32, W / 2, H / 2, Math.max(W, H) * 0.7);
      gr.addColorStop(0, 'rgba(0,0,0,0)'); gr.addColorStop(1, viewer.scopeLvl ? 'rgba(0,0,0,0.55)' : 'rgba(0,0,0,0.2)');
      ctx.fillStyle = gr; ctx.fillRect(0, 0, W, H);
    }
    const el = (now - g.flashRecv) / 1000;
    const full = g.flashFull - el, left = g.flashLeft - el;
    if (left > 0) {
      const a = full > 0 ? 1 : clamp(left / Math.max(0.6, g.flashLeft - g.flashFull), 0, 1) * 0.95;
      ctx.fillStyle = `rgba(255,255,255,${a})`; ctx.fillRect(0, 0, W, H);
    }
  }

  // ------------------------------------------------------------------ crosshair & aiming aids
  /** where a ground point `d` px ahead of the viewer along `ang` lands on screen, and how many px one world px is there */
  ground(viewer, ang, d, z = 0) {
    const r = this.r;
    const p = r.project(viewer.x + Math.cos(ang) * d, viewer.y + Math.sin(ang) * d, z);
    return p ? { x: p.x, y: p.y, k: r.focal / p.dist } : null;
  }

  crosshair(ctx, viewer, now) {
    const r = this.r, g = r.game, me = g.me;
    const mx = r.W / 2, my = r.H / 2 + r.crossDY;
    const held = me.held;
    if (me.veh) {
      const v = me.veh, def = VEHICLES[VEHICLE_LIST[v.ty]];
      const sd = def.seats[v.seat];
      ctx.save(); ctx.translate(mx, my);
      const hm = now - g.hitMarker < 170;
      const col = hm ? '#ffffff' : 'rgba(120,255,160,0.95)';
      for (const pass of [0, 1]) {
        ctx.strokeStyle = pass ? col : 'rgba(0,0,0,0.6)'; ctx.lineWidth = pass ? 2 : 4;
        ctx.strokeRect(-11, -11, 22, 22); ctx.beginPath(); ctx.moveTo(-16, 0); ctx.lineTo(-6, 0); ctx.moveTo(16, 0); ctx.lineTo(6, 0); ctx.moveTo(0, -16); ctx.lineTo(0, -6); ctx.moveTo(0, 16); ctx.lineTo(0, 6); ctx.stroke();
      }
      if (v.rel > 0 || v.cd > 0.05) {
        ctx.strokeStyle = '#fff'; ctx.lineWidth = 3; ctx.beginPath(); ctx.arc(0, 0, 20, -Math.PI / 2, -Math.PI / 2 + TAU * (v.rel > 0 ? v.rel : 1 - Math.min(1, v.cd / (sd.weapon === 'cannon' ? 2.2 : 0.4)))); ctx.stroke();
      }
      ctx.restore();
      if (sd.weapon && viewer) {
        // where the turret / gun really points right now
        const ang = sd.aim === 'turret' ? g.turretAngle() : sd.aim === 'body' ? g.predVeh.a : v.sa;
        const pt = this.ground(viewer, ang, clamp(g.aimDist, 200, 900), 14);
        if (pt) {
          ctx.strokeStyle = 'rgba(255,255,255,0.75)'; ctx.lineWidth = 2;
          ctx.beginPath(); ctx.moveTo(pt.x, pt.y - 7); ctx.lineTo(pt.x + 7, pt.y); ctx.lineTo(pt.x, pt.y + 7); ctx.lineTo(pt.x - 7, pt.y); ctx.closePath(); ctx.stroke();
        }
      }
      return;
    }
    const w = held < HELD_GREN_BASE ? WEAPON_LIST[held] : null;
    if (held >= HELD_GREN_BASE && held < HELD_GADGET_BASE && viewer) {
      const type = GREN_ORDER[held - HELD_GREN_BASE];
      const d = clamp(g.aimDist, GREN_MIN_DIST, GREN_MAX_DIST);
      const pt = this.ground(viewer, g.angle, d);
      if (pt) {
        const rad = (type === 'he' ? HE_RADIUS : type === 'smoke' ? SMOKE_RADIUS : type === 'molo' ? FIRE_RADIUS : 60) * pt.k;
        this.landing(ctx, pt, rad, type === 'he' ? 'rgba(255,110,60,0.85)' : type === 'molo' ? 'rgba(255,140,40,0.85)' : 'rgba(255,255,255,0.75)');
      }
    }
    if (me.alt && viewer && w) {
      const d = clamp(g.aimDist, 90, 900);
      const pt = this.ground(viewer, g.angle, d);
      if (pt) this.landing(ctx, pt, ALT.ugl.radius * pt.k, 'rgba(255,150,70,0.85)');
    }
    const gap = clamp(Math.tan(me.sp || 0) * r.focal * 0.9, 5, 160);
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
    if (me.pl > 0) {
      const c = me.plk === 'revive' ? '#5dff9a' : '#f5a742';
      ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 6; ctx.beginPath(); ctx.arc(0, 0, gp + 30, 0, TAU); ctx.stroke();
      ctx.strokeStyle = c; ctx.lineWidth = 4; ctx.beginPath(); ctx.arc(0, 0, gp + 30, -Math.PI / 2, -Math.PI / 2 + TAU * clamp(me.pl, 0, 1)); ctx.stroke();
    }
    if (me.lk) {
      ctx.strokeStyle = me.lk[1] >= 1 ? '#ff3b2f' : '#ffd24a'; ctx.lineWidth = 3; ctx.strokeRect(-18, -18, 36, 36);
      ctx.fillStyle = ctx.strokeStyle; ctx.font = `800 11px ${FONT}`; ctx.textAlign = 'center'; ctx.fillText(me.lk[1] >= 1 ? 'LOCKED' : 'LOCKING', 0, 32);
    }
    ctx.restore();
  }

  landing(ctx, pt, rad, color) {
    ctx.save();
    ctx.strokeStyle = color; ctx.lineWidth = 2; ctx.setLineDash([5, 5]);
    ctx.beginPath(); ctx.ellipse(pt.x, pt.y, Math.max(6, rad), Math.max(4, rad * 0.55), 0, 0, TAU); ctx.stroke();
    ctx.setLineDash([]); ctx.fillStyle = '#fff'; ctx.fillRect(pt.x - 2, pt.y - 2, 5, 5);
    ctx.restore();
  }
}
