// Runs every automated check: map validation, mechanics, headless simulations, fuzzing, lag compensation and the WebSocket integration test.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const steps = [
  ['map validation', ['tools/preview-maps.js']],
  ['game mechanics', ['tools/mechanics.js']],
  ['bot simulation (riverside conquest, 8v8)', ['tools/sim.js', 'riverside', '300', '8']],
  ['bot simulation (harbor rush, 6v6)', ['tools/sim.js', 'harbor', '300', '6', 'normal', 'rush']],
  ['bot simulation (pit deathmatch, 3v3)', ['tools/sim.js', 'pit', '120', '3', 'normal', 'tdm']],
  ['fuzz / invariants', ['tools/fuzz.js']],
  ['lag compensation', ['tools/lagcomp.js']],
  ['CS: map validation', ['tools/cs/preview-maps.js']],
  ['CS: bot simulation (dust, 5v5)', ['tools/cs/sim.js', 'dust', '300', '5']],
  ['CS: fuzz / invariants', ['tools/cs/fuzz.js']],
  ['CS: lag compensation', ['tools/cs/lagcomp.js']],
  ['integration (real server)', ['tools/integration.js']],
];
let failed = 0;
for (const [name, args] of steps) {
  process.stdout.write(`\n=== ${name}\n`);
  const r = spawnSync(process.execPath, args, { cwd: root, stdio: 'inherit' });
  if (r.status !== 0) { failed++; console.log(`>>> FAILED: ${name}`); }
}
console.log(failed ? `\n${failed} step(s) failed` : '\nAll checks passed');
process.exit(failed ? 1 : 0);
