import { MapBuilder, mirrorObjects } from './builder.js';

// "Harbor Siege" — a port city on the bay. Dense blocks of buildings, container yards on the docks and a plaza in the
// middle. Everything can be levelled: tank shells open new streets, C4 brings buildings down. Boats patrol the bay.
const W = 161, H = 104, CX = 80;

/** fills a city block (x0..x1, y0..y1) with a grid of buildings separated by alleys, some lots left as yards */
function block(m, x0, y0, x1, y1) {
  for (let ly = y0; ly + 6 <= y1;) {
    const lh = Math.min(y1 - ly + 1, 7 + m.ri(0, 4));
    if (lh < 6) break;
    for (let lx = x0; lx + 6 <= x1;) {
      const lw = Math.min(x1 - lx + 1, 7 + m.ri(0, 5));
      if (lw < 6) break;
      const r = m.rnd();
      if (r < 0.86) m.house(lx, ly, lw, lh, { door: m.rnd() < 0.5 ? 'NS' : 'EW', crates: m.ri(0, 3) });
      else { m.cover(lx, ly, lw, lh, 5, 'XXoLM'); if (r > 0.94) m.rect(lx + 1, ly + 1, Math.max(1, lw - 3), 1, 'M'); }
      lx += lw + 2;
    }
    ly += lh + 2;
  }
}

function containers(m, x, y, cols, rows) {
  for (let j = 0; j < rows; j++) for (let i = 0; i < cols; i++) {
    if (m.rnd() < 0.15) continue;
    m.rect(x + i * 3, y + j * 3, 2, 1, 'M');
  }
}

function build() {
  const m = new MapBuilder(W, H, ';', 7031999);
  // ground: paved city with some grass and sand at the edges
  m.rect(0, 0, W, H, '.');
  m.paint(0, 0, W, H, ';', '.');
  m.blob(20, 12, 10, 6, '.', 0.3); m.blob(12, 44, 6, 8, ',', 0.3); m.blob(30, 4, 8, 3, ',', 0.3);

  // ---- street grid (left half)
  const ys = [16, 40, 64], xs = [22, 46, 70];
  for (const y of ys) m.road([[8, y], [CX - 4, y]], 5);
  for (const x of xs) m.road([[x, 8], [x, 84]], 5);
  m.road([[8, 84], [CX - 4, 84]], 5);
  // ---- blocks between the streets
  const gx = [4, 25, 49, 73], gy = [6, 19, 43, 67];
  for (let i = 0; i < 3; i++) for (let j = 0; j < 3; j++) {
    const x0 = xs[i] + 3, y0 = ys[j] + 3;
    const x1 = (i < 2 ? xs[i + 1] : CX - 6) - 3, y1 = (j < 2 ? ys[j + 1] : 82) - 3;
    if (x1 - x0 > 6 && y1 - y0 > 6) block(m, x0, y0, x1, y1);
  }
  void gx; void gy;

  // ---- the harbour: sea to the south with piers, container yards on the quay
  m.sea(86, H - 1, (x) => 92 + Math.round(Math.sin(x * 0.11) * 1.6 + Math.sin(x * 0.29) * 1.0), 3);
  for (const px of [16, 34, 58]) { m.rect(px, 80, 5, 20, '_'); m.wallLine(px - 1, 82, 16, true, 'L', 4); }
  containers(m, 8, 74, 3, 2); containers(m, 26, 76, 2, 2); containers(m, 40, 72, 5, 2); containers(m, 62, 74, 3, 2);
  m.paint(4, 70, 74, 14, ';', '.,');

  // ---- red base in the north-west corner
  m.rect(3, 22, 17, 24, ';');
  m.rect(5, 24, 13, 20, 't');
  m.wallLine(3, 22, 17, false, 'L', 5); m.wallLine(3, 45, 17, false, 'L', 5); m.wallLine(19, 22, 24, true, 'L', 8);
  m.rect(19, 30, 4, 6, '_'); m.rect(19, 39, 4, 4, '_');            // gates onto the street
  m.house(4, 6, 12, 8, { door: 'S' });
  m.set(7, 26, 'X').set(8, 26, 'X').set(14, 42, 'X');

  // ---- flag plazas
  m.clearing(30, 82, 6, ';'); containers(m, 24, 88, 0, 0);
  m.clearing(34, 28, 6, ';');
  m.clearing(56, 52, 6, ';');
  m.mirrorH();

  // ---- centre: plaza with a monument, canal-free crossing
  m.clearing(CX, 52, 9, ';');
  m.road([[CX, 8], [CX, 84]], 5);
  m.road([[8, 52], [W - 9, 52]], 5);
  for (const [dx, dy] of [[-7, -5], [7, -5], [-7, 5], [7, 5]]) { m.rect(CX + dx, 52 + dy, 3, 2, 'L'); }
  m.wallLine(CX - 10, 44, 6, false, 'L', 3); m.wallLine(CX + 5, 44, 6, false, 'L', 3); m.wallLine(CX - 10, 60, 6, false, 'L', 3); m.wallLine(CX + 5, 60, 6, false, 'L', 3);
  // border
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const d = Math.min(x, y, W - 1 - x);
    if (d < 2 || y < 2 || (d < 3 && m.rnd() < 0.5) || (y < 4 && m.rnd() < 0.5)) m.set(x, y, '#');
  }
  // the bay is bounded by the map edge

  // ---- objects
  m.flag('Fish Market', 30, 82, -1, 124).flag('Old Town', 34, 28, 0, 130).flag('Harbor Office', 56, 52, -1, 124);
  m.objects.flags[0].mirror = 'Cargo Terminal';
  m.objects.flags[1].mirror = 'Financial District';
  m.objects.flags[2].mirror = 'Customs House';
  m.objects.flags.push({ name: 'Central Plaza', x: CX, y: 52, owner: -1, r: 140, mid: true });
  // red base
  m.vehicle('tank', 18, 27, 0, { team: 0 }).vehicle('apc', 18, 41, 0, { team: 0 }).vehicle('jeep', 18, 32, 0, { team: 0 }).vehicle('jeep', 18, 36, 0, { team: 0 });
  m.vehicle('heli', 8, 14, 0, { team: 0 }).vehicle('quad', 18, 44, 0, { team: 0 });
  // the docks
  m.vehicle('boat', 26, 96, 0, { team: -1 }).vehicle('boat', 46, 96, 0, { team: -1 }).vehicle('boat', 70, 96, 0, { team: -1 });
  m.vehicle('jeep', 44, 50, 0, { team: -1 }).vehicle('quad', 30, 80, 0, { team: -1 });
  m.vehicle('tank', CX - 12, 40, 0, { team: -1, mid: true, respawn: 120 });
  m.seal(10, 34);
  const fin = m.finish();
  fin.objects = mirrorObjects(m.objects, W);
  return fin;
}

const built = build();
export default {
  id: 'harbor', name: 'Harbor Siege', size: 'large', best: '8v8 - 16v16', modes: ['conquest', 'rush', 'tdm'],
  desc: 'A port city on the bay: tight streets, container yards and a plaza. Level the skyline — boats patrol the water.',
  theme: {
    grass: '#6a9a4c', grass2: '#628f45', road: '#4d525a', concrete: '#9a9a96', sand: '#d2bf90', deep: '#28629f', shallow: '#58a9c9',
    brick: '#a9584a', rock: '#6f7378', crate: '#b08348', metal: '#4f7fa8', tree: '#3d7c38', accent: '#66c8ff', fog: [8, 12, 20],
  },
  elevation: true, rows: built.rows, objects: built.objects,
};
