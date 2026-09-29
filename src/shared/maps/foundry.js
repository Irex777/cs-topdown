import { MapBuilder } from './builder.js';

// "Foundry" — CT at the top, T at the bottom. Sites in the top corners, four ways up: two side lanes with a jog, and an
// offset mid so there is no straight sightline from spawn to spawn.
function build() {
  const m = new MapBuilder(60, 48, '#');

  // ---- bases
  m.rect(22, 3, 16, 7);  m.rect(23, 4, 14, 5, 'c');           // CT
  m.rect(20, 38, 20, 7); m.rect(22, 39, 16, 5, 't');          // T
  // ---- sites
  m.rect(3, 3, 15, 14);  m.rect(5, 5, 11, 10, 'a');           // A (top-left)
  m.rect(42, 3, 15, 14); m.rect(44, 5, 11, 10, 'b');          // B (top-right)
  // ---- CT rotations
  m.rect(18, 5, 4, 4);                                        // CT -> A
  m.rect(38, 5, 4, 4);                                        // CT -> B
  // ---- mid: ramp from T (west), plaza, doors into CT (east)
  m.rect(21, 24, 6, 14);
  m.rect(18, 18, 24, 6);
  m.rect(34, 10, 6, 8);
  // ---- west lane (with a jog) up to A
  m.rect(14, 40, 6, 3);
  m.rect(8, 30, 6, 13);
  m.rect(8, 26, 10, 4);
  m.rect(12, 17, 6, 10);
  m.rect(17, 19, 2, 4);                                       // plaza <-> west lane
  // ---- east lane (with a jog) up to B
  m.rect(40, 40, 6, 3);
  m.rect(46, 30, 6, 13);
  m.rect(42, 26, 10, 4);
  m.rect(42, 17, 6, 10);
  m.rect(41, 19, 2, 4);                                       // plaza <-> east lane

  // ---- cover: A site
  m.rect(8, 8, 2, 2, 'X').rect(9, 10, 1, 1, 'X');
  m.rect(12, 6, 1, 3, 'L');
  m.rect(6, 12, 3, 1, 'L');
  m.rect(13, 12, 2, 2, 'X');
  m.rect(4, 5, 1, 1, 'o');
  // ---- cover: B site (mirrored feel, not identical)
  m.rect(50, 8, 2, 2, 'X').rect(50, 10, 1, 1, 'X');
  m.rect(47, 6, 1, 3, 'L');
  m.rect(51, 12, 3, 1, 'L');
  m.rect(44, 12, 2, 2, 'X');
  m.rect(55, 5, 1, 1, 'o');
  // ---- plaza & mid
  m.rect(29, 20, 2, 2, 'X');
  m.rect(24, 18, 1, 2, 'L').rect(37, 22, 1, 2, 'L');
  m.rect(21, 30, 1, 3, 'L');
  m.rect(24, 34, 2, 2, 'X');
  m.rect(36, 13, 2, 1, 'L');
  // ---- lanes
  m.rect(10, 34, 2, 2, 'X');
  m.rect(9, 27, 2, 1, 'X');
  m.rect(14, 22, 1, 2, 'L');
  m.rect(48, 34, 2, 2, 'X');
  m.rect(49, 28, 2, 1, 'X');
  m.rect(45, 21, 1, 2, 'L');
  // ---- bases
  m.rect(29, 6, 2, 2, 'X');
  m.rect(29, 41, 2, 2, 'X').rect(25, 40, 1, 1, 'o').rect(34, 40, 1, 1, 'o');
  m.speckle(21, 0.1);
  return m.rows();
}

export default {
  id: 'foundry', name: 'Foundry', desc: 'Four lanes and an offset mid: side lanes with a jog, a plaza in the middle.',
  size: 'medium', best: '3v3 - 5v5',
  theme: { floor: '#8a7a6a', floor2: '#7f7060', wall: '#3d3a3a', wallTop: '#5c5654', crate: '#a0632f', accent: '#ff7a2f', ambient: '#ffd7b0', fog: [12, 9, 8] },
  rows: build(),
};
