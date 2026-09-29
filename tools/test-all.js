// Runs every automated check: map validation, headless simulation, fuzzing and the WebSocket integration test.
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const steps = [
  ['map validation', ['tools/preview-maps.js']],
  ['bot simulation (dust, 5v5)', ['tools/sim.js', 'dust', '300', '5']],
  ['fuzz / invariants', ['tools/fuzz.js']],
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
