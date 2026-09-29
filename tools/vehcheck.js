// Vehicle sizing check: static (does each spawn fit, can a vehicle of that radius drive out and reach the flags) and dynamic
// (headless bot match, counts vehicles that sit still for 6 s with a bot driver).   node tools/vehcheck.js [seconds] [teamSize]
import { Room } from '../src/server/room.js';
import { MAP_DEFS, createMap } from '../src/shared/maps/index.js';
import { VEHICLES } from '../src/shared/vehicles.js';
import { TILE, SPEC } from '../src/shared/constants.js';

const seconds = Number(process.argv[2]) || 200;
const teamSize = Number(process.argv[3]) || 10;
let bad = 0;

/** does a circle of radius r at (x,y) touch a blocked tile? */
function touches(map, mask, x, y, r) {
  const x0 = Math.floor((x - r) / TILE), x1 = Math.floor((x + r) / TILE), y0 = Math.floor((y - r) / TILE), y1 = Math.floor((y + r) / TILE);
  for (let ty = y0; ty <= y1; ty++) for (let tx = x0; tx <= x1; tx++) {
    if (tx < 0 || ty < 0 || tx >= map.w || ty >= map.h) return true;
    if (!mask[ty * map.w + tx]) continue;
    const cx = Math.max(tx * TILE, Math.min(x, (tx + 1) * TILE)), cy = Math.max(ty * TILE, Math.min(y, (ty + 1) * TILE));
    if ((cx - x) ** 2 + (cy - y) ** 2 < r * r) return true;
  }
  return false;
}

/** flood fill on a 8 px lattice (so two-tile-wide streets are found even though their centre line is off the tile grid) over the points where a circle of radius r fits */
function reach(map, mask, sx, sy, r) {
  const K = 4, H = TILE / K, W = map.w * K, Hh = map.h * K;
  const ok = (cx, cy) => cx >= 0 && cy >= 0 && cx < W && cy < Hh && !touches(map, mask, (cx + 0.5) * H, (cy + 0.5) * H, r);
  const seen = new Uint8Array(W * Hh);
  const q = [];
  let st = null;
  for (let d = 0; d < 12 && !st; d++) for (let dy = -d; dy <= d && !st; dy++) for (let dx = -d; dx <= d; dx++) if (ok(sx * K + dx, sy * K + dy)) { st = [sx * K + dx, sy * K + dy]; break; }
  if (!st) return { seen: null, start: false };
  q.push(st); seen[st[1] * W + st[0]] = 1;
  while (q.length) {
    const [x, y] = q.pop();
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
      const nx = x + dx, ny = y + dy;
      if (!ok(nx, ny) || seen[ny * W + nx]) continue;
      seen[ny * W + nx] = 1; q.push([nx, ny]);
    }
  }
  const at = (x, y) => { for (let dy = -1; dy <= 0; dy++) for (let dx = -1; dx <= 0; dx++) { const cx = Math.floor(x / H) + dx, cy = Math.floor(y / H) + dy; if (cx >= 0 && cy >= 0 && cx < W && cy < Hh && seen[cy * W + cx]) return true; } return false; };
  return { seen: { at }, start: true };
}

console.log('== static: spawn clearance and radius-aware reachability');
for (const def of MAP_DEFS) {
  const map = createMap(def.id);
  if (!map.vehSpawns.length) continue;
  const issues = [];
  let n = 0;
  for (const v of map.vehSpawns) {
    const vd = VEHICLES[v.type];
    if (vd.kind === 'air') continue;
    n++;
    const mask = vd.kind === 'boat' ? map.blockBoat : map.blockInf;
    const tag = `${v.type}@${Math.floor(v.x / TILE)},${Math.floor(v.y / TILE)}`;
    if (touches(map, mask, v.x, v.y, vd.r)) issues.push(`${tag} overlaps a wall (r=${vd.r})`);
    if (vd.kind === 'boat') continue;
    const { seen, start } = reach(map, mask, Math.floor(v.x / TILE), Math.floor(v.y / TILE), vd.r);
    if (!start) { issues.push(`${tag} has no room to move`); continue; }
    const far = map.flags.filter((f) => !seen.at(f.x, f.y));
    if (far.length && far.length >= map.flags.length - 1) issues.push(`${tag} can reach ${map.flags.length - far.length}/${map.flags.length} flags`);
    else if (far.length) issues.push(`${tag} cannot reach ${far.map((f) => f.name).join(',')}`);
  }
  console.log(`${def.name}: ${n} ground vehicles, ${issues.length ? issues.length + ' issue(s)' : 'ok'}`);
  for (const s of issues) console.log('   -', s);
  bad += issues.length;
}

console.log('\n== dynamic: bot-driven vehicles standing still');
for (const id of ['riverside', 'harbor', 'dunes']) {
  const fake = { send() {}, sendRaw() {}, congested: () => false, leaveRoom() {} };
  const room = new Room('TEST', { map: id, teamSize, bots: true, difficulty: 'hard', mode: 'conquest', vehicles: true }, null);
  const spec = room.addHuman({ ...fake, player: null, room: null }, 'Watcher');
  room.assignTeam(spec, SPEC);
  room.rebalanceBots(true);
  room.start();
  const track = new Map();
  const stuck = new Map();
  const events = [];
  let driven = 0;
  for (let i = 0; i < seconds * 60 && room.game; i++) {
    room.tick();
    if (i % 120 !== 0) continue;
    const g = room.game;
    for (const v of g.vehicles) {
      const drv = v.seats[0] > 0 ? g.players.get(v.seats[0]) : null;
      if (v.dead || !drv || !drv.isBot || v.def.kind === 'air') { track.delete(v.id); continue; }
      driven++;
      const t = track.get(v.id);
      if (t && Math.hypot(v.x - t.x, v.y - t.y) < 10) {
        t.n++;
        if (t.n === 3) {                                                    // 3 samples x 2 s = 6 s without moving
          stuck.set(v.id, (stuck.get(v.id) || 0) + 1);
          const near = [];
          for (let dy = -2; dy <= 2; dy++) { let row = ''; for (let dx = -3; dx <= 3; dx++) row += g.map.chars[(Math.floor(v.y / TILE) + dy) * g.map.w + Math.floor(v.x / TILE) + dx] || ' '; near.push(row); }
          events.push(`${v.type}@${Math.floor(v.x / TILE)},${Math.floor(v.y / TILE)} t=${Math.round(g.time)} why=${drv.bot.why || '?'} hp=${Math.round(v.hp)} seat=${v.seats.map((q) => (q > 0 ? 'x' : '-')).join('')}\n      ${near.join('\n      ')}`);
        }
      } else track.set(v.id, { x: v.x, y: v.y, n: 0 });
    }
  }
  const g = room.game;
  const names = [...stuck.entries()].map(([vid, c]) => { const v = g && g.vehicles.find((q) => q.id === vid); return `${v ? v.type : vid}x${c}`; });
  console.log(`${id}: ${driven} driven samples, stuck episodes: ${stuck.size ? names.join(' ') : 'none'}`);
  if (process.argv[4] === '-v') for (const e of events) console.log('    ' + e);
}
process.exit(bad ? 1 : 0);
