import { MapBuilder } from './builder.js';

// "Warehouse" — vertically symmetric: T on the left, CT on the right, sites A (top) / B (bottom) on the right.
function build() {
  const m = new MapBuilder(64, 44, '#');
  // ---- spawns
  m.rect(3, 15, 11, 14);               // T base
  m.rect(4, 16, 9, 12, 't');
  m.rect(50, 15, 11, 14);              // CT base
  m.rect(51, 16, 9, 12, 'c');
  // ---- central hall between the bases
  m.rect(14, 17, 4, 10);               // T door
  m.rect(18, 12, 28, 20);              // hall
  m.rect(46, 17, 4, 10);               // CT door
  // ---- top lane (above hall) and connectors
  m.rect(6, 4, 40, 4);                 // top corridor
  m.rect(6, 8, 4, 8);                  // T base -> top corridor
  m.rect(24, 8, 4, 4);                 // hall <-> top corridor
  m.rect(36, 8, 4, 4);
  // ---- A site (top-right)
  m.rect(46, 2, 15, 11);
  m.rect(49, 4, 9, 7, 'a');
  m.rect(52, 13, 5, 2);                // CT base -> A
  // ---- extra flank from T base along the top-left
  m.rect(3, 4, 3, 12);
  // ---- hall cover
  m.rect(22, 15, 2, 2, 'X').rect(40, 15, 2, 2, 'X');
  m.rect(30, 17, 4, 1, 'L').rect(30, 21, 1, 2, 'X');
  m.rect(26, 20, 1, 4, 'L').rect(37, 20, 1, 4, 'L');
  m.rect(31, 14, 2, 2, '#');
  m.rect(20, 19, 1, 2, 'o');
  m.rect(43, 19, 1, 2, 'o');
  // ---- corridor cover
  m.rect(14, 5, 1, 2, 'L').rect(30, 5, 1, 2, 'X').rect(41, 4, 1, 2, 'L');
  // ---- A site cover
  m.rect(51, 6, 2, 2, 'X').rect(55, 8, 2, 2, 'X').rect(49, 9, 1, 2, 'L');
  m.rect(57, 4, 1, 2, 'o');
  // ---- base cover
  m.rect(8, 21, 2, 2, 'X').rect(53, 21, 2, 2, 'X');
  m.rect(15, 21, 1, 1, 'o');
  m.speckle(11, 0.1);
  // mirror the upper half to make the lower half (B side); swap site letter
  const top = m.rows().slice(0, 22);
  const mm = new MapBuilder(64, 44, '#');
  top.forEach((r, y) => { for (let x = 0; x < 64; x++) mm.set(x, y, r[x]); });
  mm.mirrorV({ a: 'b' });
  return mm.rows();
}

export default {
  id: 'warehouse', name: 'Warehouse', desc: 'Symmetric industrial map with a big central hall and two flank corridors.',
  size: 'medium', best: '3v3 - 5v5',
  theme: { floor: '#7d838c', floor2: '#737982', wall: '#454b55', wallTop: '#606773', crate: '#7a5c34', accent: '#f0c419', ambient: '#dfe8ff', fog: [8, 10, 16] },
  rows: build(),
};
