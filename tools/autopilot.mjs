// Soak test: drives the real browser client with a simple autopilot for N seconds and reports errors/stats.
// Usage: CS_URL=http://localhost:3100/bf/ node tools/autopilot.mjs [seconds] [map] [mode]
import { launch } from './browser.mjs';

const url = process.env.CS_URL || 'http://localhost:3100/bf/';
const seconds = Number(process.argv[2]) || 120;
const map = process.argv[3] || 'riverside';
const mode = process.argv[4] || 'conquest';
const { browser, page, errors } = await launch({ w: 1280, h: 720 });
await page.goto(url);
await page.fill('#nameInput', 'Auto');
await page.waitForTimeout(400);
await page.evaluate(([map, mode]) => window.app.net.send({ t: 'create', name: 'Auto', autostart: true, settings: { mode, map, teamSize: 4, bots: true, vehicles: true } }), [map, mode]);
await page.waitForTimeout(2500);

await page.evaluate(() => {
  const g = window.app.game, inp = g.input;
  window.__stats = { frames: 0, kills: 0, deaths: 0, deploys: 0, shots: 0, maxErr: 0, seat: 0 };
  let wp = null, wpT = 0, lastAlive = false, deployT = 0;
  // third-person controls: the view yaw is the aim, W walks toward it, A/D strafe
  const keysFor = (forward, strafe) => {
    inp.down.clear();
    if (forward) inp.down.add('KeyW');
    if (strafe) inp.down.add(strafe > 0 ? 'KeyD' : 'KeyA');
  };
  window.app.net.on('kill', (m) => { if (m.k === g.you) window.__stats.kills++; if (m.v === g.you) window.__stats.deaths++; });
  const loop = () => {
    requestAnimationFrame(loop);
    const s = window.__stats; s.frames++;
    s.maxErr = Math.max(s.maxErr, Math.hypot(g.errX || 0, g.errY || 0));
    if (g.alive && !lastAlive) s.deploys++;
    lastAlive = g.alive;
    if (!g.alive || !g.me || !g.me.own) {
      inp.left = false;
      const btn = document.getElementById('dpGo');
      if (btn && performance.now() - deployT > 2000 && btn.offsetParent) { deployT = performance.now(); btn.click(); }
      return;
    }
    const v = g.viewer();
    let best = null, bd = 1e9;
    for (const p of g.soldiers()) {
      if (p.id === g.you || p.team === g.myTeam()) continue;
      const d = Math.hypot(p.x - v.x, p.y - v.y);
      if (d < bd && d < 700 && g.visiblePoint(p.x, p.y)) { bd = d; best = p; }
    }
    if (best) {
      g.yaw = Math.atan2(best.y - v.y, best.x - v.x);
      inp.left = true; s.shots++;
      keysFor(false, Math.sin(performance.now() / 400));
    } else {
      inp.left = false;
      wpT -= 1 / 60;
      if (!wp || wpT < 0 || Math.hypot(wp.x - v.x, wp.y - v.y) < 40) { wp = { x: v.x + (Math.random() - 0.5) * 900, y: v.y + (Math.random() - 0.5) * 900 }; wpT = 3; }
      g.yaw = Math.atan2(wp.y - v.y, wp.x - v.x);
      keysFor(true, 0);
    }
    if (Math.random() < 0.002) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
    if (Math.random() < 0.004) window.app.net.send({ t: 'a', a: 'reload' });
  };
  loop();
});
const t0 = Date.now();
let last = '';
while ((Date.now() - t0) / 1000 < seconds) {
  await page.waitForTimeout(5000);
  const s = await page.evaluate(() => ({ ...window.__stats, phase: window.app.game.phase, alive: window.app.game.alive, fps: window.app.game.stats && window.app.game.stats.fps }));
  const line = JSON.stringify(s);
  if (line !== last) console.log(`[${Math.round((Date.now() - t0) / 1000)}s]`, line);
  last = line;
}
await page.screenshot({ path: process.env.CS_SHOT || '/tmp/autopilot.png' });
const real = errors.filter((e) => !/GL Driver|swiftshader/i.test(e));   // software-GL notices are not bugs
console.log('page errors:', real.length ? '\n' + real.join('\n') : 'none');
await browser.close();
process.exit(real.length ? 1 : 0);
