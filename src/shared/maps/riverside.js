import { MapBuilder, mirrorObjects } from './builder.js';

// "Riverside" — a wide valley split by a river. Two bases on the far banks, farms and mills on either side, and a fortified
// bridge in the middle. Fords let tanks cross in the far north and south. Seven flags, jeeps, tanks, helicopters and boats.
const W = 169, H = 112, CX = 84;

// scatter small buildings over open grass in a rectangle (x0,y0,x1,y1), keeping a margin around each
function hamlet(m, x0, y0, x1, y1, n, sizes = [[7, 6], [8, 6], [6, 6], [9, 7]]) {
  let placed = 0;
  for (let tries = 0; tries < n * 40 && placed < n; tries++) {
    const [w, h] = sizes[m.ri(0, sizes.length - 1)];
    const x = m.ri(x0, x1 - w), y = m.ri(y0, y1 - h);
    let ok = true;
    for (let j = y - 2; j < y + h + 2 && ok; j++) for (let i = x - 2; i < x + w + 2; i++) { const c = m.get(i, j); if (c !== '.' && c !== ',') { ok = false; break; } }
    if (!ok) continue;
    m.house(x, y, w, h, { door: m.rnd() < 0.5 ? 'NS' : 'EW', crates: m.ri(0, 2) });
    placed++;
  }
}

function outpost(m, cx, cy) {
  m.clearing(cx, cy, 7, ';');
  m.clearing(cx, cy, 9, '.');
  m.clearing(cx, cy, 6, ';');
  // sandbag nests around the plaza, open on all four axes
  for (const [dx, dy, v] of [[-8, -4, true], [-8, 2, true], [8, -4, true], [8, 2, true]]) m.wallLine(cx + dx, cy + dy, 3, v, 'L');
  for (const [dx, dy] of [[-4, -8], [2, -8], [-4, 8], [2, 8]]) m.wallLine(cx + dx, cy + dy, 3, false, 'L');
  m.rect(cx - 2, cy - 2, 2, 1, 'M').rect(cx + 1, cy + 2, 2, 1, 'M');
  m.set(cx + 3, cy - 3, 'X').set(cx - 3, cy + 3, 'X').set(cx + 4, cy - 3, 'o').set(cx - 4, cy + 3, 'o');
  m.house(cx - 9, cy - 16, 8, 6, { door: 'S' });
  m.house(cx + 8, cy + 9, 8, 6, { door: 'N' });
}

function farm(m, cx, cy) {
  m.clearing(cx, cy, 6, ';');
  m.yard(cx - 14, cy - 10, 28, 20, 'SWEN');
  m.house(cx - 12, cy - 8, 12, 7, { door: 'S', crates: 2 });                 // barn
  m.house(cx + 3, cy - 8, 8, 6, { door: 'S' });
  m.house(cx + 4, cy + 3, 8, 6, { door: 'N' });
  m.clearing(cx, cy, 3, ';');
  // crop rows
  for (let k = 0; k < 4; k++) m.rect(cx - 12, cy + 2 + k * 2 - 0, 8, 1, ',');
  m.set(cx - 2, cy + 3, 'X').set(cx - 1, cy + 3, 'X').set(cx + 1, cy + 1, 'o');
}

function mill(m, cx, cy) {
  m.clearing(cx, cy, 6, ';');
  m.house(cx - 4, cy - 12, 12, 8, { door: 'S', crates: 3 });                 // the mill itself
  m.house(cx - 16, cy - 2, 8, 6, { door: 'E' });
  m.house(cx + 6, cy + 6, 9, 6, { door: 'W' });
  m.rect(cx + 8, cy - 2, 3, 2, 'M');
  m.wallLine(cx - 8, cy + 6, 6, false, 'L', 4);
  m.set(cx + 2, cy + 2, 'X').set(cx + 3, cy + 2, 'X').set(cx - 3, cy - 1, 'o');
}

function build() {
  const m = new MapBuilder(W, H, '.', 20240611);
  m.grass(0.14, '.');

  // ---- terrain (left half; mirrored afterwards)
  m.forest(20, 6, 18, 12, 0.30); m.forest(50, 4, 22, 16, 0.28); m.forest(52, 94, 22, 14, 0.28); m.forest(20, 96, 18, 12, 0.3);
  m.forest(56, 38, 14, 12, 0.14); m.forest(56, 62, 14, 12, 0.14); m.forest(8, 8, 10, 16, 0.2); m.forest(8, 88, 10, 16, 0.2);
  m.blob(60, 26, 6, 5, '#', 0.3); m.blob(62, 84, 6, 4, '#', 0.3); m.blob(28, 34, 4, 3, '#', 0.3); m.blob(28, 78, 4, 3, '#', 0.3);
  m.blob(66, 48, 3, 2, '#', 0.2); m.blob(66, 64, 3, 2, '#', 0.2);

  // ---- roads
  m.road([[21, 56], [83, 56]], 5);
  m.road([[34, 56], [34, 20], [48, 20]], 4);
  m.road([[34, 56], [34, 92], [48, 92]], 4);
  m.road([[48, 20], [48, 31], [83, 31]], 4);
  m.road([[48, 92], [48, 81], [83, 81]], 4);

  // ---- red base
  m.rect(3, 42, 20, 28, ';');
  m.rect(6, 45, 14, 22, 't');
  for (const y of [42, 69]) m.wallLine(3, y, 20, false, 'L', 6);
  m.wallLine(22, 42, 28, true, 'L', 7);
  m.house(6, 33, 10, 7, { door: 'S' });
  m.house(6, 72, 10, 7, { door: 'N' });
  m.set(10, 45, 'X').set(11, 45, 'X').set(16, 66, 'X').set(15, 66, 'X');
  m.paint(4, 27, 10, 6, '_', '.,');                              // helipad apron

  // ---- flag compounds
  outpost(m, 34, 56);
  farm(m, 44, 20);
  mill(m, 44, 92);
  // roads win over props that landed on them
  m.road([[21, 56], [83, 56]], 5);
  m.road([[34, 56], [34, 20], [48, 20]], 4);
  m.road([[34, 56], [34, 92], [48, 92]], 4);
  m.road([[48, 20], [48, 31], [83, 31]], 4);
  m.road([[48, 92], [48, 81], [83, 81]], 4);

  // ---- hamlets and cover between the objectives
  hamlet(m, 24, 62, 32, 86, 3); hamlet(m, 24, 28, 32, 50, 3);
  hamlet(m, 50, 34, 70, 52, 3); hamlet(m, 50, 62, 70, 78, 3);
  m.cover(36, 36, 30, 16, 26); m.cover(36, 62, 30, 16, 26); m.cover(50, 40, 26, 14, 14); m.cover(50, 60, 26, 14, 14);
  m.cover(60, 8, 20, 20, 12); m.cover(60, 84, 20, 20, 12);
  m.mirrorH();

  // ---- the river (symmetric around the centre column) and its crossings
  m.vriver(0, H - 1, (y) => ({ cx: CX, deep: 3 + Math.round((Math.sin(y * 0.16) + Math.sin(y * 0.33 + 1)) * 0.9) }), 2);
  m.rect(CX - 8, 8, 17, 4, 'w');           // north ford
  m.rect(CX - 8, 100, 17, 4, 'w');         // south ford
  m.bridge(CX - 12, CX + 12, 54, 5);
  m.bridge(CX - 12, CX + 12, 29, 4);
  m.bridge(CX - 12, CX + 12, 79, 4);
  // bridgeheads
  m.clearing(CX - 15, 56, 4, ';'); m.clearing(CX + 15, 56, 4, ';');
  m.paint(CX - 12, 50, 3, 12, '_', '.,T'); m.paint(CX + 10, 50, 3, 12, '_', '.,T');
  // central fortifications on the bridge
  for (const x of [CX - 6, CX + 6]) { m.set(x, 53, 'L'); m.set(x, 59, 'L'); }
  m.rect(CX - 1, 53, 3, 1, 'X'); m.rect(CX - 1, 59, 3, 1, 'X');
  m.set(CX, 56, '_');
  // riverside ruins at the bridge
  m.house(CX - 24, 44, 9, 6, { door: 'S' }); m.house(CX + 16, 44, 9, 6, { door: 'S' });
  m.house(CX - 24, 62, 9, 6, { door: 'N' }); m.house(CX + 16, 62, 9, 6, { door: 'N' });
  m.clearing(CX, 56, 3, '_'); m.rect(CX - 2, 54, 5, 5, '_');

  // ---- border cliffs
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.min(x, y, W - 1 - x, H - 1 - y);
    if (d < 2 || (d < 4 && m.rnd() < 0.55)) m.set(x, y, '#');
  }

  // ---- objects
  m.flag('West Outpost', 34, 56, 0, 130).flag('Farmstead', 44, 20, -1, 124).flag('Old Mill', 44, 92, -1, 124);
  m.objects.flags[0].mirror = 'East Outpost';
  m.objects.flags[1].mirror = 'Orchard';
  m.objects.flags[2].mirror = 'Quarry';
  m.objects.flags.push({ name: 'Bridge', x: CX, y: 56, owner: -1, r: 136, mid: true });
  // red base vehicles
  m.vehicle('tank', 20, 49, 0, { team: 0 }).vehicle('tank', 20, 63, 0, { team: 0 });
  m.vehicle('jeep', 20, 53, 0, { team: 0 }).vehicle('jeep', 20, 59, 0, { team: 0 });
  m.vehicle('heli', 9, 29, 0, { team: 0 });
  m.vehicle('quad', 20, 45, 0, { team: 0 }).vehicle('quad', 20, 67, 0, { team: 0 });
  // neutral vehicles at the flags
  m.vehicle('jeep', 38, 50, 0, { team: -1 }).vehicle('quad', 40, 22, 0, { team: -1 }).vehicle('jeep', 40, 90, 0, { team: -1 });
  m.vehicle('boat', 84, 41, 90, { team: -1, mid: true }).vehicle('boat', 84, 72, 90, { team: -1, mid: true });
  m.vehicle('apc', 72, 60, 0, { team: -1, respawn: 90 });
  m.seal(10, 56);
  const fin = m.finish();
  fin.objects = mirrorObjects(m.objects, W);
  return fin;
}

const built = build();
export default {
  id: 'riverside', name: 'Riverside', size: 'large', best: '8v8 - 16v16', modes: ['conquest', 'rush', 'tdm'],
  desc: 'A valley split by a river. Farms, mills, a fortified bridge and fords for tanks. Jeeps, tanks, APCs, helis and boats.',
  theme: {
    grass: '#6f9d4e', grass2: '#679347', road: '#5b6068', concrete: '#a39d92', sand: '#cdb98a', deep: '#2f6fb5', shallow: '#5fb0d8',
    brick: '#b5674a', rock: '#7c7a78', crate: '#b58a4a', metal: '#5a7ea6', tree: '#3f7f3a', accent: '#ffd95a', fog: [10, 14, 20],
  },
  rows: built.rows, objects: built.objects,
};
