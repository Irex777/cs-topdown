// Soak test: drives the real browser client with a simple autopilot for N seconds and reports errors/stats.
// Usage: CS_URL=http://localhost:3100 node tools/autopilot.mjs [seconds] [map] [mode]
import { launch } from './browser.mjs';

const url = process.env.CS_URL || 'http://localhost:3100';
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
  const keysFor = (dx, dy) => {
    inp.down.clear();
    if (dy < -8) inp.down.add('KeyW'); if (dy > 8) inp.down.add('KeyS'); if (dx < -8) inp.down.add('KeyA'); if (dx > 8) inp.down.add('KeyD');
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
      const sp = g.renderer.worldToScreen(best.x, best.y);
      inp.mx = sp.x; inp.my = sp.y; inp.left = true; s.shots++;
      keysFor(Math.sin(performance.now() / 400) * 20, 0);
    } else {
      inp.left = false;
      wpT -= 1 / 60;
      if (!wp || wpT < 0 || Math.hypot(wp.x - v.x, wp.y - v.y) < 40) { wp = { x: v.x + (Math.random() - 0.5) * 900, y: v.y + (Math.random() - 0.5) * 900 }; wpT = 3; }
      keysFor(wp.x - v.x, wp.y - v.y);
      const sp = g.renderer.worldToScreen(wp.x, wp.y); inp.mx = sp.x; inp.my = sp.y;
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
console.log('page errors:', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
