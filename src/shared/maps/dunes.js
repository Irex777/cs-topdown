import { MapBuilder, mirrorObjects } from './builder.js';

// "Dune Sea" — open desert with rocky mesas, an oil field and an airstrip. Long sightlines, armour and helicopters rule here;
// infantry hide in the villages and behind the mesas. Five flags along the centre line.
const W = 177, H = 100, CX = 88;

function village(m, cx, cy, n = 5) {
  m.clearing(cx, cy, 5, ':');
  let placed = 0;
  for (let t = 0; t < 400 && placed < n; t++) {
    const w = 6 + m.ri(0, 4), h = 6 + m.ri(0, 3);
    const x = cx + m.ri(-16, 16 - w), y = cy + m.ri(-12, 12 - h);
    let ok = true;
    for (let j = y - 2; j < y + h + 2 && ok; j++) for (let i = x - 2; i < x + w + 2; i++) { const c = m.get(i, j); if (c !== '.' && c !== ',' && c !== ':') { ok = false; break; } }
    if (!ok || Math.hypot(x + w / 2 - cx, y + h / 2 - cy) < 8) continue;
    m.house(x, y, w, h, { door: m.rnd() < 0.5 ? 'NS' : 'EW', floor: ':', crates: m.ri(0, 2) });
    placed++;
  }
  m.cover(cx - 12, cy - 9, 24, 18, 12, 'XXoL');
}

function rig(m, x, y) {
  m.rect(x, y, 10, 8, ';');
  m.rect(x + 1, y + 1, 3, 2, 'M'); m.rect(x + 6, y + 1, 3, 2, 'M'); m.rect(x + 1, y + 5, 3, 2, 'M');
  m.set(x + 5, y + 4, 'o').set(x + 6, y + 4, 'o').set(x + 4, y + 6, 'o').set(x + 8, y + 6, 'X');
  m.box(x - 1, y - 1, 12, 10, 'L');
  m.set(x + 4, y - 1, ':').set(x + 5, y - 1, ':').set(x + 4, y + 8, ':').set(x + 5, y + 8, ':');
}

function build() {
  const m = new MapBuilder(W, H, '.', 88412);
  m.rect(0, 0, W, H, '.');
  // dune texture: alternate sand shades
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) if (Math.sin(x * 0.07 + y * 0.11) + Math.sin(x * 0.03 - y * 0.05) > 0.7) m.set(x, y, ',');

  // ---- mesas (indestructible rock) and scattered boulders
  m.blob(60, 24, 9, 6, '#', 0.3); m.blob(64, 76, 8, 5, '#', 0.3); m.blob(30, 50, 5, 9, '#', 0.28);
  m.blob(46, 40, 4, 3, '#', 0.3); m.blob(46, 62, 4, 3, '#', 0.3); m.blob(76, 46, 3, 3, '#', 0.3);
  m.blob(20, 14, 6, 4, '#', 0.3); m.blob(20, 86, 6, 4, '#', 0.3);

  // ---- roads
  m.road([[12, 50], [CX - 3, 50]], 6);
  m.road([[40, 50], [40, 22], [70, 22]], 4);
  m.road([[40, 50], [40, 78], [70, 78]], 4);
  m.road([[70, 22], [70, 78]], 4);

  // ---- red airbase / camp at the west edge
  m.rect(3, 34, 20, 32, ';');
  m.rect(5, 36, 16, 28, 't');
  m.wallLine(3, 34, 20, false, 'L', 5); m.wallLine(3, 65, 20, false, 'L', 5); m.wallLine(22, 34, 32, true, 'L', 9);
  m.house(4, 20, 10, 8, { door: 'S', floor: ':' });
  m.house(4, 72, 10, 8, { door: 'N', floor: ':' });
  m.rect(6, 8, 14, 9, '_');                                   // helipad
  m.rect(6, 84, 14, 9, '_');
  m.road([[12, 50], [CX - 3, 50]], 6);
  m.road([[24, 50], [40, 50]], 6);
  // ---- flags
  village(m, 40, 22, 4); village(m, 40, 78, 4);
  rig(m, 56, 44); rig(m, 56, 52);
  m.clearing(40, 50, 6, ';');
  m.mirrorH();
  // ---- centre: oasis
  m.blob(CX, 50, 11, 8, 'w', 0.25); m.blob(CX, 50, 6, 4, '~', 0.2);
  m.road([[CX - 20, 50], [CX + 20, 50]], 6, '_');
  m.bridge(CX - 10, CX + 10, 47, 6, true);
  m.forest(CX - 16, 36, 32, 8, 0.1); m.forest(CX - 16, 58, 32, 8, 0.1);
  m.clearing(CX, 30, 6, ':'); m.clearing(CX, 70, 6, ':');
  m.cover(CX - 14, 26, 28, 8, 8, 'XXoL'); m.cover(CX - 14, 66, 28, 8, 8, 'XXoL');
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.min(x, y, W - 1 - x, H - 1 - y);
    if (d < 2 || (d < 4 && m.rnd() < 0.5)) m.set(x, y, '#');
  }
  // ---- objects
  m.flag('West Camp', 40, 50, 0, 124).flag('North Village', 40, 22, -1, 124).flag('South Village', 40, 78, -1, 124);
  m.objects.flags[0].mirror = 'East Camp';
  m.objects.flags[1].mirror = 'North Oasis';
  m.objects.flags[2].mirror = 'South Oasis';
  m.objects.flags.push({ name: 'Oasis', x: CX, y: 50, owner: -1, r: 140, mid: true });
  m.vehicle('tank', 20, 40, 0, { team: 0 }).vehicle('tank', 20, 60, 0, { team: 0 }).vehicle('apc', 20, 46, 0, { team: 0 }).vehicle('jeep', 20, 54, 0, { team: 0 });
  m.vehicle('heli', 12, 12, 0, { team: 0 }).vehicle('heli', 12, 88, 0, { team: 0 });
  m.vehicle('quad', 20, 36, 0, { team: 0 }).vehicle('quad', 20, 64, 0, { team: 0 });
  m.vehicle('jeep', 44, 46, 0, { team: -1 }).vehicle('jeep', 44, 54, 0, { team: -1 }).vehicle('quad', 40, 26, 0, { team: -1 }).vehicle('quad', 40, 74, 0, { team: -1 });
  m.vehicle('tank', CX - 12, 28, 0, { team: -1, mid: true, respawn: 110 }).vehicle('tank', CX - 12, 72, 0, { team: -1, mid: true, respawn: 110 });
  m.seal(10, 50);
  const fin = m.finish();
  fin.objects = mirrorObjects(m.objects, W);
  return fin;
}

const built = build();
export default {
  id: 'dunes', name: 'Dune Sea', size: 'huge', best: '12v12 - 16v16', modes: ['conquest', 'rush', 'tdm'],
  desc: 'Open desert with mesas, oil rigs and an oasis. Long sightlines: armour and helicopters rule, infantry lurk in the villages.',
  theme: {
    grass: '#d3b273', grass2: '#c9a865', road: '#6a645c', concrete: '#b9ad94', sand: '#ddc590', deep: '#2f7fbf', shallow: '#66c2d6',
    brick: '#c98d5d', rock: '#a26e4c', crate: '#a9803f', metal: '#7a6b52', tree: '#6a8a3a', accent: '#ffb347', fog: [22, 16, 8],
  },
  rows: built.rows, objects: built.objects,
};
