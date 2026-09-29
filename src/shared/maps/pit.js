import { MapBuilder } from './builder.js';

// "Pit" — small, tight, rotationally symmetric. Built for 1v1 to 3v3.
function build() {
  const W = 46, H = 32;
  const m = new MapBuilder(W, H, '#');
  // spawns (T left, CT right)
  m.rect(2, 10, 8, 12);
  m.rect(3, 11, 6, 10, 't');
  // corridors from T base
  m.rect(10, 13, 6, 6);                 // door to centre
  m.rect(4, 3, 4, 8);                   // north branch out of spawn
  m.rect(4, 3, 20, 4);                  // north lane
  // centre
  m.rect(16, 9, 14, 14);
  m.rect(16, 7, 6, 2);
  // A site (top centre-right)
  m.rect(24, 2, 14, 8);
  m.rect(27, 3, 8, 5, 'a');
  // cover
  m.rect(19, 12, 2, 2, 'X').rect(19, 18, 2, 2, 'X');
  m.rect(24, 14, 2, 4, 'L');
  m.rect(22, 10, 1, 1, 'o').rect(22, 21, 1, 1, 'o');
  m.rect(12, 15, 1, 2, 'L');
  m.rect(9, 5, 1, 2, 'X').rect(14, 4, 1, 2, 'L');
  m.rect(30, 4, 2, 2, 'X').rect(33, 7, 2, 1, 'L');
  m.rect(6, 15, 2, 2, 'X');
  m.speckle(5, 0.1);
  const half = m.rows();
  const mm = new MapBuilder(W, H, '#');
  half.forEach((r, y) => { for (let x = 0; x < W; x++) mm.set(x, y, r[x]); });
  // rotate the left half onto the right; tiles that are already open on the far side stay open
  for (let y = 0; y < H; y++) for (let x = 0; x < W; x++) {
    const c = half[y][x];
    if (c === '#') continue;
    const rx = W - 1 - x, ry = H - 1 - y;
    const swap = { t: 'c', a: 'b' }[c] || c;
    mm.set(rx, ry, swap);
  }
  return mm.rows();
}

export default {
  id: 'pit', name: 'Pit', desc: 'Small close-quarters arena. Great for 1v1 to 3v3.',
  size: 'small', best: '1v1 - 3v3',
  theme: { floor: '#4a5566', floor2: '#425060', wall: '#252c38', wallTop: '#3a4556', crate: '#5b6b7d', accent: '#38d0e0', ambient: '#bfe6ff', fog: [6, 8, 14] },
  rows: build(),
};
