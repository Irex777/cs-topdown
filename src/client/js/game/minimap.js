// Radar: static map picture plus live dots for allies, enemies spotted by the team, bomb and smokes.
import { HELD_GREN_BASE } from '../../../shared/weapons.js';
import { SPEC } from '../../../shared/constants.js';
import { renderThumb } from './mapart.js';
import { TEAM_COL } from './render.js';

const TAU = Math.PI * 2;

export class Minimap {
  constructor(canvas) {
    this.canvas = canvas;
    this.ctx = canvas.getContext('2d');
    this.map = null;
    this.base = null;
    this.big = false;
    this.w = 0; this.h = 0;
  }

  setMap(map, art) {
    this.map = map;
    this.art = art;
    this.base = null;
    this.layout(false);
  }

  layout(big) {
    if (!this.map) return;
    this.big = big;
    const dpr = Math.min(window.devicePixelRatio || 1, 2);
    const maxW = big ? Math.min(window.innerWidth * 0.7, 1000) : 210;
    const maxH = big ? window.innerHeight * 0.72 : 210;
    const k = Math.min(maxW / this.map.w, maxH / this.map.h);
    this.w = Math.round(this.map.w * k); this.h = Math.round(this.map.h * k);
    this.canvas.parentElement.classList.toggle('radar-big', big);
    this.canvas.style.width = this.w + 'px'; this.canvas.style.height = this.h + 'px';
    this.canvas.width = this.w * dpr; this.canvas.height = this.h * dpr;
    this.dpr = dpr;
    if (big && this.art) {
      // the big map shows the real painted map, scaled down
      const c = document.createElement('canvas');
      c.width = this.w * dpr; c.height = this.h * dpr;
      const cx = c.getContext('2d');
      cx.imageSmoothingQuality = 'high';
      cx.drawImage(this.art, 0, 0, c.width, c.height);
      this.base = c;
    } else this.base = renderThumb(this.map, this.w * dpr, this.h * dpr);
  }

  draw(game) {
    if (!this.map) return;
    if (game.bigmap !== this.big || !this.base) this.layout(game.bigmap);
    const ctx = this.ctx, d = this.dpr;
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.drawImage(this.base, 0, 0);
    ctx.fillStyle = 'rgba(5,8,14,0.35)';
    ctx.fillRect(0, 0, this.canvas.width, this.canvas.height);
    const sx = (this.w * d) / this.map.width, sy = (this.h * d) / this.map.height;
    const S = (x) => x * sx, Sy = (y) => y * sy;
    const now = performance.now();

    // site labels
    ctx.font = `800 ${Math.round(14 * d * (this.big ? 1.5 : 1))}px system-ui, sans-serif`;
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const s of this.map.sites) {
      if (!s) continue;
      ctx.fillStyle = 'rgba(255,255,255,0.35)'; ctx.fillText(s.name, S(s.x), Sy(s.y));
    }
    // smokes
    for (const sm of game.ents.sm) {
      ctx.fillStyle = 'rgba(210,215,220,0.55)'; ctx.beginPath(); ctx.arc(S(sm[1]), Sy(sm[2]), Math.max(2, sm[3] * sx), 0, TAU); ctx.fill();
    }
    for (const f of game.ents.fi) {
      ctx.fillStyle = 'rgba(255,120,40,0.6)'; ctx.beginPath(); ctx.arc(S(f[1]), Sy(f[2]), Math.max(2, f[3] * sx), 0, TAU); ctx.fill();
    }
    // bomb
    const b = game.bombInfo;
    if (b && (b[0] === 3 || b[0] === 2)) {
      const on = Math.floor(now / 350) % 2 === 0;
      ctx.fillStyle = b[0] === 3 ? (on ? '#ff3b2f' : '#7a1d16') : '#f5c542';
      ctx.beginPath(); ctx.arc(S(b[1]), Sy(b[2]), 4.5 * d * (this.big ? 1.3 : 1), 0, TAU); ctx.fill();
      ctx.strokeStyle = '#fff'; ctx.lineWidth = d; ctx.stroke();
    }
    // players
    const latest = game.snaps[game.snaps.length - 1];
    const viewerRoster = game.me ? game.roster.get(game.me.id) : null;
    const viewTeam = viewerRoster ? viewerRoster.tm : game.myTeam();
    if (latest) {
      for (const [id, t] of latest.players) {
        const team = game.teamOf(id);
        const mate = team === viewTeam || game.myTeam() === SPEC && team === viewTeam;
        const x = S(t[1]), y = Sy(t[2]);
        const col = TEAM_COL[team] || TEAM_COL[2];
        const isMe = game.me && id === game.me.id;
        if (isMe) {
          const p = game.alive && game.me.own ? game.viewer() : null;
          const px = p ? S(p.x) : x, py = p ? Sy(p.y) : y, a = p ? game.angle : t[3];
          ctx.save(); ctx.translate(px, py); ctx.rotate(a);
          ctx.fillStyle = '#fff'; ctx.beginPath(); ctx.moveTo(7 * d, 0); ctx.lineTo(-5 * d, -5 * d); ctx.lineTo(-3 * d, 0); ctx.lineTo(-5 * d, 5 * d); ctx.closePath(); ctx.fill();
          ctx.restore();
          continue;
        }
        if (!mate) game.spotted.set(id, { x: t[1], y: t[2], t: now });
        ctx.fillStyle = mate ? col.body : '#ff453a';
        ctx.strokeStyle = 'rgba(0,0,0,0.7)'; ctx.lineWidth = d;
        ctx.beginPath(); ctx.arc(x, y, (mate ? 4 : 4.5) * d * (this.big ? 1.3 : 1), 0, TAU); ctx.fill(); ctx.stroke();
        if (mate) {
          ctx.strokeStyle = col.text; ctx.lineWidth = 1.5 * d;
          ctx.beginPath(); ctx.moveTo(x, y); ctx.lineTo(x + Math.cos(t[3]) * 8 * d, y + Math.sin(t[3]) * 8 * d); ctx.stroke();
          if (t[6] & 16) { ctx.fillStyle = '#ff3b2f'; ctx.fillRect(x - 2 * d, y - 9 * d, 4 * d, 4 * d); }
        }
      }
      // fading memory of enemies that were spotted recently but are hidden now
      for (const [id, s] of game.spotted) {
        const age = (now - s.t) / 1000;
        if (age > 2.5) { game.spotted.delete(id); continue; }
        if (latest.players.has(id)) continue;
        ctx.globalAlpha = 1 - age / 2.5;
        ctx.fillStyle = '#ff453a'; ctx.beginPath(); ctx.arc(S(s.x), Sy(s.y), 4 * d, 0, TAU); ctx.fill();
        ctx.globalAlpha = 1;
      }
    }
    // pings
    for (const p of game.pings) {
      const age = (now - p.t) / 1000;
      if (age > 4.5) continue;
      const col = TEAM_COL[p.team] || TEAM_COL[2];
      ctx.strokeStyle = col.text; ctx.lineWidth = 2 * d; ctx.globalAlpha = 1 - (age % 1);
      ctx.beginPath(); ctx.arc(S(p.x), Sy(p.y), (4 + (age % 1) * 12) * d, 0, TAU); ctx.stroke(); ctx.globalAlpha = 1;
    }
    void HELD_GREN_BASE;
  }
}
