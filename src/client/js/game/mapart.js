// Pre-renders a whole map into one canvas (floor, walls, crates, site markings) at 1 px = 1 world unit.
import { TILE } from '../../../shared/constants.js';

const shade = (hex, f) => {
  const n = parseInt(hex.slice(1), 16);
  const c = (v) => Math.max(0, Math.min(255, Math.round(v * f)));
  return `rgb(${c((n >> 16) & 255)},${c((n >> 8) & 255)},${c(n & 255)})`;
};

function rng(seed) {
  let s = seed >>> 0;
  return () => ((s = (s * 1664525 + 1013904223) >>> 0) / 4294967296);
}
function hashStr(str) { let h = 2166136261; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 16777619); } return h >>> 0; }

export function buildMapArt(map) {
  const th = map.theme;
  const c = document.createElement('canvas');
  c.width = map.width; c.height = map.height;
  const ctx = c.getContext('2d');
  const r = rng(hashStr(map.id));
  const S = TILE;
  const solidT = (x, y) => map.isOpaqueTile(x, y);
  const chAt = (x, y) => (map.inBounds(x, y) ? map.charAt(x, y) : '#');

  // --- backdrop (under the walls)
  ctx.fillStyle = shade(th.wall, 0.75);
  ctx.fillRect(0, 0, c.width, c.height);

  // --- floor
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    const ch = chAt(x, y);
    if (solidT(x, y)) continue;
    ctx.fillStyle = ch === ',' ? th.floor2 : th.floor;
    ctx.fillRect(x * S, y * S, S, S);
    const v = r();
    ctx.fillStyle = v < 0.5 ? `rgba(0,0,0,${(0.5 - v) * 0.12})` : `rgba(255,255,255,${(v - 0.5) * 0.10})`;
    ctx.fillRect(x * S, y * S, S, S);
  }
  // tile seams
  ctx.strokeStyle = 'rgba(0,0,0,0.06)'; ctx.lineWidth = 1;
  ctx.beginPath();
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    if (solidT(x, y)) continue;
    ctx.moveTo(x * S + 0.5, y * S); ctx.lineTo(x * S + 0.5, y * S + S);
    ctx.moveTo(x * S, y * S + 0.5); ctx.lineTo(x * S + S, y * S + 0.5);
  }
  ctx.stroke();
  // floor grit, cracks and stains
  for (let i = 0; i < map.w * map.h * 1.4; i++) {
    const x = Math.floor(r() * map.w), y = Math.floor(r() * map.h);
    if (solidT(x, y)) continue;
    const px = x * S + r() * S, py = y * S + r() * S, k = r();
    if (k < 0.55) { ctx.fillStyle = `rgba(0,0,0,${0.05 + r() * 0.1})`; ctx.fillRect(px, py, 1 + r() * 2, 1 + r() * 2); }
    else if (k < 0.8) { ctx.fillStyle = `rgba(255,255,255,${0.04 + r() * 0.08})`; ctx.fillRect(px, py, 1 + r() * 2, 1); }
    else if (k < 0.92) {
      ctx.strokeStyle = 'rgba(0,0,0,0.10)'; ctx.lineWidth = 1; ctx.beginPath(); ctx.moveTo(px, py);
      ctx.lineTo(px + (r() - 0.5) * 22, py + (r() - 0.5) * 22); ctx.lineTo(px + (r() - 0.5) * 30, py + (r() - 0.5) * 30); ctx.stroke();
    } else { ctx.fillStyle = `rgba(0,0,0,${0.03 + r() * 0.04})`; ctx.beginPath(); ctx.ellipse(px, py, 6 + r() * 14, 4 + r() * 10, r() * 3, 0, 7); ctx.fill(); }
  }

  // --- zones: bombsites and spawns
  const zoneOutline = (test, color) => {
    ctx.strokeStyle = color; ctx.lineWidth = 3; ctx.setLineDash([10, 8]);
    ctx.beginPath();
    for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
      if (!test(x, y)) continue;
      if (!test(x, y - 1)) { ctx.moveTo(x * S, y * S + 1.5); ctx.lineTo(x * S + S, y * S + 1.5); }
      if (!test(x, y + 1)) { ctx.moveTo(x * S, y * S + S - 1.5); ctx.lineTo(x * S + S, y * S + S - 1.5); }
      if (!test(x - 1, y)) { ctx.moveTo(x * S + 1.5, y * S); ctx.lineTo(x * S + 1.5, y * S + S); }
      if (!test(x + 1, y)) { ctx.moveTo(x * S + S - 1.5, y * S); ctx.lineTo(x * S + S - 1.5, y * S + S); }
    }
    ctx.stroke(); ctx.setLineDash([]);
  };
  const tint = (test, color) => { ctx.fillStyle = color; for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) if (test(x, y)) ctx.fillRect(x * S, y * S, S, S); };
  const isSite = (s) => (x, y) => map.inBounds(x, y) && map.site[y * map.w + x] === s;
  const isZone = (z) => (x, y) => map.inBounds(x, y) && map.zone[y * map.w + x] === z;
  tint(isSite(1), 'rgba(255,90,60,0.09)'); tint(isSite(2), 'rgba(255,90,60,0.09)');
  tint(isZone(1), 'rgba(240,165,55,0.10)'); tint(isZone(2), 'rgba(70,150,255,0.10)');
  zoneOutline(isSite(1), 'rgba(255,110,70,0.55)'); zoneOutline(isSite(2), 'rgba(255,110,70,0.55)');
  zoneOutline(isZone(1), 'rgba(240,165,55,0.45)'); zoneOutline(isZone(2), 'rgba(80,160,255,0.45)');
  ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
  for (const s of map.sites) {
    if (!s) continue;
    ctx.save();
    ctx.translate(s.x, s.y);
    ctx.fillStyle = 'rgba(255,110,70,0.20)';
    ctx.font = '900 150px system-ui, Arial, sans-serif';
    ctx.fillText(s.name, 0, 6);
    ctx.strokeStyle = 'rgba(255,110,70,0.22)'; ctx.lineWidth = 6;
    ctx.beginPath(); ctx.arc(0, 0, 118, 0, 7); ctx.stroke();
    ctx.restore();
  }
  for (let team = 0; team < 2; team++) {
    const p = map.spawnCenter[team];
    ctx.fillStyle = team === 0 ? 'rgba(240,165,55,0.20)' : 'rgba(80,160,255,0.20)';
    ctx.font = '900 46px system-ui, Arial, sans-serif';
    ctx.fillText(team === 0 ? 'T SPAWN' : 'CT SPAWN', p.x, p.y);
  }

  // --- ambient occlusion from walls onto the floor
  const grad = (x0, y0, x1, y1, a) => { const g = ctx.createLinearGradient(x0, y0, x1, y1); g.addColorStop(0, `rgba(0,0,0,${a})`); g.addColorStop(1, 'rgba(0,0,0,0)'); return g; };
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    if (solidT(x, y)) continue;
    const px = x * S, py = y * S;
    if (solidT(x, y - 1)) { ctx.fillStyle = grad(px, py, px, py + 12, 0.34); ctx.fillRect(px, py, S, 12); }
    if (solidT(x - 1, y)) { ctx.fillStyle = grad(px, py, px + 10, py, 0.26); ctx.fillRect(px, py, 10, S); }
    if (solidT(x + 1, y)) { ctx.fillStyle = grad(px + S, py, px + S - 8, py, 0.16); ctx.fillRect(px + S - 8, py, 8, S); }
    if (solidT(x, y + 1)) { ctx.fillStyle = grad(px, py + S, px, py + S - 8, 0.16); ctx.fillRect(px, py + S - 8, S, 8); }
  }

  // --- walls
  const wallEdge = shade(th.wall, 0.6);
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    if (chAt(x, y) !== '#') continue;
    const px = x * S, py = y * S;
    const open = [!solidT(x, y - 1), !solidT(x + 1, y), !solidT(x, y + 1), !solidT(x - 1, y)];
    if (!open.some(Boolean)) {
      // diagonal-only floor contact still counts as rim
      const diag = !solidT(x - 1, y - 1) || !solidT(x + 1, y - 1) || !solidT(x - 1, y + 1) || !solidT(x + 1, y + 1);
      ctx.fillStyle = diag ? th.wall : shade(th.wall, 0.82);
      ctx.fillRect(px, py, S, S);
      continue;
    }
    ctx.fillStyle = th.wallTop;
    ctx.fillRect(px, py, S, S);
    const v = r();
    ctx.fillStyle = v < 0.5 ? `rgba(0,0,0,${(0.5 - v) * 0.16})` : `rgba(255,255,255,${(v - 0.5) * 0.14})`;
    ctx.fillRect(px, py, S, S);
    // bevelled edges towards open floor
    ctx.fillStyle = wallEdge;
    if (open[0]) ctx.fillRect(px, py, S, 4);
    if (open[1]) ctx.fillRect(px + S - 4, py, 4, S);
    if (open[2]) ctx.fillRect(px, py + S - 5, S, 5);
    if (open[3]) ctx.fillRect(px, py, 4, S);
    ctx.fillStyle = 'rgba(255,255,255,0.10)';
    if (open[0]) ctx.fillRect(px, py + 4, S, 1);
    if (open[3]) ctx.fillRect(px + 4, py, 1, S);
    // brick/plate lines
    ctx.strokeStyle = 'rgba(0,0,0,0.10)'; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(px, py + S / 2 + 0.5); ctx.lineTo(px + S, py + S / 2 + 0.5);
    ctx.moveTo(px + ((y & 1) ? S / 2 : S / 4) + 0.5, py); ctx.lineTo(px + ((y & 1) ? S / 2 : S / 4) + 0.5, py + S / 2);
    ctx.stroke();
  }

  // --- props
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    const ch = chAt(x, y);
    const px = x * S, py = y * S;
    if (ch === 'X') {
      // drop shadow
      ctx.fillStyle = 'rgba(0,0,0,0.34)'; ctx.fillRect(px + 4, py + 5, S, S);
    } else if (ch === 'L') {
      ctx.fillStyle = 'rgba(0,0,0,0.28)'; ctx.fillRect(px + 3, py + 4, S, S);
    } else if (ch === 'o') {
      ctx.fillStyle = 'rgba(0,0,0,0.32)'; ctx.beginPath(); ctx.ellipse(px + S / 2 + 4, py + S / 2 + 5, 15, 15, 0, 0, 7); ctx.fill();
    }
  }
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    const ch = chAt(x, y);
    const px = x * S, py = y * S;
    if (ch === 'X') drawCrate(ctx, map, x, y, th, r);
    else if (ch === 'o') drawBarrel(ctx, px, py, th);
    else if (ch === 'L') drawBarrier(ctx, map, x, y);
    else if (ch === '=') drawFence(ctx, map, x, y);
  }

  // --- vignette on the map edges (subtle)
  return c;
}

function drawCrate(ctx, map, x, y, th, r) {
  const S = TILE, px = x * S, py = y * S;
  const nx = (dx, dy) => map.inBounds(x + dx, y + dy) && map.charAt(x + dx, y + dy) === 'X';
  const l = nx(-1, 0) ? 0 : 1, rr = nx(1, 0) ? 0 : 1, t = nx(0, -1) ? 0 : 1, b = nx(0, 1) ? 0 : 1;
  const metal = ((x * 7 + y * 13) % 5) === 0;
  const base = metal ? '#5f6d7c' : th.crate;
  ctx.fillStyle = shade(base, 0.62);
  ctx.fillRect(px + l * 1, py + t * 1, S - l - rr, S - t - b);
  ctx.fillStyle = base;
  ctx.fillRect(px + l * 3, py + t * 3, S - l * 3 - rr * 3, S - t * 3 - b * 3);
  ctx.fillStyle = 'rgba(255,255,255,0.14)';
  ctx.fillRect(px + l * 3, py + t * 3, S - l * 3 - rr * 3, 2);
  // planks / braces
  ctx.strokeStyle = shade(base, 0.7); ctx.lineWidth = 2;
  ctx.beginPath();
  if (metal) { ctx.moveTo(px + 6, py + 8); ctx.lineTo(px + S - 6, py + 8); ctx.moveTo(px + 6, py + S - 9); ctx.lineTo(px + S - 6, py + S - 9); }
  else { ctx.moveTo(px + 5, py + 5); ctx.lineTo(px + S - 5, py + S - 5); ctx.moveTo(px + S - 5, py + 5); ctx.lineTo(px + 5, py + S - 5); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(0,0,0,0.22)'; ctx.lineWidth = 1;
  ctx.strokeRect(px + 3.5, py + 3.5, S - 7, S - 7);
  ctx.fillStyle = shade(base, 0.5);
  for (const [cx, cy] of [[6, 6], [S - 7, 6], [6, S - 7], [S - 7, S - 7]]) ctx.fillRect(px + cx - 1, py + cy - 1, 3, 3);
  void r;
}

function drawBarrel(ctx, px, py, th) {
  const cx = px + TILE / 2, cy = py + TILE / 2;
  const g = ctx.createRadialGradient(cx - 4, cy - 4, 2, cx, cy, 16);
  g.addColorStop(0, '#8c96a3'); g.addColorStop(1, '#3f4752');
  ctx.fillStyle = g; ctx.beginPath(); ctx.arc(cx, cy, 15, 0, 7); ctx.fill();
  ctx.strokeStyle = 'rgba(0,0,0,0.5)'; ctx.lineWidth = 2; ctx.stroke();
  ctx.strokeStyle = th.accent; ctx.lineWidth = 2; ctx.beginPath(); ctx.arc(cx, cy, 9, 0, 7); ctx.stroke();
  ctx.fillStyle = 'rgba(255,255,255,0.18)'; ctx.beginPath(); ctx.arc(cx - 5, cy - 5, 4, 0, 7); ctx.fill();
}

function drawBarrier(ctx, map, x, y) {
  const S = TILE, px = x * S, py = y * S;
  const isL = (dx, dy) => map.inBounds(x + dx, y + dy) && map.charAt(x + dx, y + dy) === 'L';
  const horiz = isL(-1, 0) || isL(1, 0);
  const vert = isL(0, -1) || isL(0, 1);
  const w = horiz && !vert ? S : vert && !horiz ? 20 : 24;
  const h = vert && !horiz ? S : horiz && !vert ? 20 : 24;
  const rx = px + (S - w) / 2, ry = py + (S - h) / 2;
  ctx.fillStyle = '#9ba1a8'; ctx.fillRect(rx, ry, w, h);
  ctx.fillStyle = 'rgba(255,255,255,0.28)'; ctx.fillRect(rx, ry, w, 3);
  ctx.fillStyle = 'rgba(0,0,0,0.22)'; ctx.fillRect(rx, ry + h - 3, w, 3);
  ctx.strokeStyle = 'rgba(0,0,0,0.45)'; ctx.lineWidth = 1; ctx.strokeRect(rx + 0.5, ry + 0.5, w - 1, h - 1);
  // hazard stripes
  ctx.save(); ctx.beginPath(); ctx.rect(rx + 2, ry + 5, w - 4, h - 10); ctx.clip();
  ctx.fillStyle = 'rgba(240,190,30,0.9)';
  for (let i = -30; i < 60; i += 12) { ctx.beginPath(); ctx.moveTo(rx + i, ry + h); ctx.lineTo(rx + i + 6, ry + h); ctx.lineTo(rx + i + 6 + h, ry); ctx.lineTo(rx + i + h, ry); ctx.fill(); }
  ctx.restore();
}

function drawFence(ctx, map, x, y) {
  const S = TILE, px = x * S, py = y * S;
  const isF = (dx, dy) => map.inBounds(x + dx, y + dy) && map.charAt(x + dx, y + dy) === '=';
  const horiz = isF(-1, 0) || isF(1, 0);
  ctx.fillStyle = 'rgba(0,0,0,0.18)';
  if (horiz) ctx.fillRect(px, py + S / 2 - 1, S, 7); else ctx.fillRect(px + S / 2 - 1, py, 7, S);
  ctx.strokeStyle = '#2f353d'; ctx.lineWidth = 3;
  ctx.beginPath();
  if (horiz) { ctx.moveTo(px, py + S / 2); ctx.lineTo(px + S, py + S / 2); } else { ctx.moveTo(px + S / 2, py); ctx.lineTo(px + S / 2, py + S); }
  ctx.stroke();
  ctx.strokeStyle = 'rgba(160,175,190,0.55)'; ctx.lineWidth = 1;
  ctx.beginPath();
  if (horiz) { for (let i = -S; i < S * 2; i += 8) { ctx.moveTo(px + i, py + S / 2 - 6); ctx.lineTo(px + i + 12, py + S / 2 + 6); ctx.moveTo(px + i + 12, py + S / 2 - 6); ctx.lineTo(px + i, py + S / 2 + 6); } }
  else { for (let i = -S; i < S * 2; i += 8) { ctx.moveTo(px + S / 2 - 6, py + i); ctx.lineTo(px + S / 2 + 6, py + i + 12); ctx.moveTo(px + S / 2 + 6, py + i); ctx.lineTo(px + S / 2 - 6, py + i + 12); } }
  ctx.save(); ctx.beginPath(); ctx.rect(px, py, S, S); ctx.clip(); ctx.stroke(); ctx.restore();
  ctx.fillStyle = '#20252b'; ctx.fillRect(px + S / 2 - 3, py + S / 2 - 3, 6, 6);
}

/** Small preview of a map for the lobby. */
export function renderThumb(map, w, h) {
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  const ctx = c.getContext('2d');
  const sx = w / map.w, sy = h / map.h, th = map.theme;
  ctx.fillStyle = shade(th.wall, 0.55); ctx.fillRect(0, 0, w, h);
  for (let y = 0; y < map.h; y++) for (let x = 0; x < map.w; x++) {
    const ch = map.charAt(x, y);
    let col;
    if (ch === '#') col = th.wallTop;
    else if (ch === 'X') col = th.crate;
    else if (ch === 'o') col = '#4a525c';
    else if (ch === '=' || ch === 'L') col = '#7d848c';
    else if (ch === 'a' || ch === 'b') col = '#d9603f';
    else if (ch === 't') col = '#d9a03a';
    else if (ch === 'c') col = '#4a90d9';
    else col = th.floor;
    ctx.fillStyle = col;
    ctx.fillRect(Math.floor(x * sx), Math.floor(y * sy), Math.ceil(sx), Math.ceil(sy));
  }
  return c;
}
