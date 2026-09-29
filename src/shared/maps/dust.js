import { MapBuilder } from './builder.js';

// "Dust" — a classic three-lane layout: Long A on the right, Mid in the centre, B tunnels on the left.
function build() {
  const m = new MapBuilder(72, 56, '#');

  // ---------------- spawns
  m.rect(26, 44, 20, 9);                 // T base
  m.rect(28, 46, 16, 6, 't');
  m.rect(24, 4, 24, 9);                  // CT base
  m.rect(26, 5, 20, 7, 'c');

  // ---------------- T west route -> B tunnels
  m.rect(13, 46, 13, 5);                 // exit west out of T base
  m.rect(7, 36, 8, 15);                  // lower tunnel hub
  m.rect(9, 24, 4, 13);                  // upper tunnel (narrow)
  // ---------------- T east route -> Long A
  m.rect(46, 46, 14, 5);
  m.rect(58, 22, 10, 29);                // long
  // ---------------- Mid
  m.rect(31, 31, 10, 14);                // T ramp up to mid
  m.rect(24, 21, 24, 11);                // mid plaza
  m.rect(32, 13, 8, 9);                  // mid doors -> CT
  // ---------------- B site (top-left) and B window corridor
  m.rect(3, 4, 18, 22);
  m.rect(21, 25, 4, 4);                  // window nook next to mid
  m.rect(20, 6, 4, 5);                   // CT -> B connector
  // ---------------- A site (top-right)
  m.rect(54, 4, 15, 18);
  m.rect(48, 6, 6, 5);                   // CT -> A connector
  m.rect(48, 23, 7, 4);                  // short A: mid -> A
  m.rect(51, 17, 4, 7);

  // ---------------- site floors
  m.rect(6, 7, 12, 14, 'b');
  m.rect(57, 6, 11, 12, 'a');

  // ---------------- cover: B site
  m.rect(10, 11, 2, 2, 'X').rect(11, 13, 1, 1, 'X');
  m.rect(14, 15, 2, 1, 'X');
  m.rect(5, 8, 1, 2, 'X');
  m.rect(16, 7, 2, 2, '#');
  m.rect(6, 20, 4, 1, 'L');
  m.rect(14, 19, 1, 3, 'L');
  m.rect(8, 15, 1, 1, 'o');
  // window between B and mid (see-through, not walkable)
  m.rect(22, 25, 1, 4, '=');
  // ---------------- cover: A site
  m.rect(61, 9, 3, 2, 'X').rect(62, 11, 1, 1, 'X');
  m.rect(66, 15, 2, 2, 'X');
  m.rect(57, 12, 1, 2, 'X');
  m.rect(59, 16, 3, 1, 'L');
  m.rect(65, 7, 1, 1, 'o');
  // ---------------- cover: long A
  m.rect(62, 35, 2, 2, 'X');
  m.rect(65, 29, 1, 2, 'X');
  m.rect(60, 41, 2, 1, 'L');
  m.rect(64, 44, 2, 2, 'X');
  m.rect(59, 24, 1, 3, 'L');
  m.rect(58, 31, 1, 2, '#');
  // ---------------- cover: mid
  m.rect(30, 24, 2, 2, '#').rect(40, 24, 2, 2, '#');
  m.rect(35, 26, 2, 2, 'X');
  m.rect(26, 29, 3, 1, 'L').rect(43, 29, 3, 1, 'L');
  m.rect(34, 17, 1, 3, 'L');
  m.rect(37, 17, 1, 3, 'L');
  // ---------------- cover: T base + ramps
  m.rect(33, 49, 2, 2, 'X').rect(38, 47, 1, 2, 'X');
  m.rect(35, 38, 2, 2, 'X');
  m.rect(32, 34, 1, 2, 'L');
  m.rect(10, 41, 2, 2, 'X').rect(8, 46, 2, 1, 'L');
  m.rect(50, 48, 2, 2, 'X');
  // ---------------- cover: tunnels
  m.rect(9, 30, 1, 2, 'L');
  m.rect(12, 33, 1, 2, 'L');
  // ---------------- cover: CT base
  m.rect(31, 8, 2, 2, 'X').rect(39, 6, 2, 2, 'X');
  m.rect(50, 24, 1, 2, 'L');

  m.speckle(7, 0.1);
  return m.rows();
}

export default {
  id: 'dust', name: 'Dust', desc: 'Long A, mid doors and the B tunnels. The classic 5v5 layout.',
  size: 'large', best: '4v4 - 5v5',
  theme: { floor: '#c8b07c', floor2: '#bda36c', wall: '#8a7650', wallTop: '#a89060', crate: '#9a6b35', accent: '#e8a13a', ambient: '#ffe9b0', fog: [16, 12, 8] },
  rows: build(),
};
