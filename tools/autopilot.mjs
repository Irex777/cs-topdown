// Soak test: drives the real browser client with a simple autopilot for N seconds and reports errors/stats.
// Usage: CS_URL=http://localhost:3100 node tools/autopilot.mjs [seconds] [map] [mode]
import { launch } from './browser.mjs';

const url = process.env.CS_URL || 'http://localhost:3100';
const seconds = Number(process.argv[2]) || 120;
const map = process.argv[3] || 'pit';
const mode = process.argv[4] || 'defuse';
const { browser, page, errors } = await launch({ w: 1280, h: 720 });
await page.goto(url + (process.env.CS_QUERY || '/'));
await page.fill('#nameInput', 'Auto');
await page.click('#createBtn');
await page.waitForTimeout(600);
await page.click(`.map-card[data-map="${map}"]`);
await page.click(`.seg[data-key="mode"] button[data-v="${mode}"]`);
await page.click('.seg[data-key="teamSize"] button[data-v="3"]');
await page.waitForTimeout(400);
await page.click('#startBtn');
await page.waitForTimeout(800);

await page.evaluate(() => {
  const g = window.app.game, inp = g.input;
  window.__stats = { frames: 0, kills: 0, deaths: 0, respawns: 0, rounds: new Set(), maxErr: 0, shots: 0, buys: 0 };
  let wp = null, wpT = 0, lastAlive = true, buyTried = -1;
  const keysFor = (dx, dy) => {
    inp.down.clear();
    if (dy < -8) inp.down.add('KeyW'); if (dy > 8) inp.down.add('KeyS'); if (dx < -8) inp.down.add('KeyA'); if (dx > 8) inp.down.add('KeyD');
  };
  window.app.net.on('kill', (m) => { if (m.k === g.you) window.__stats.kills++; if (m.v === g.you) window.__stats.deaths++; });
  const loop = () => {
    requestAnimationFrame(loop);
    const s = window.__stats; s.frames++;
    s.rounds.add(g.round);
    s.maxErr = Math.max(s.maxErr, Math.hypot(g.errX, g.errY));
    if (g.alive && !lastAlive) s.respawns++;
    lastAlive = g.alive;
    if (!g.alive || !g.me || !g.me.own) { inp.left = false; return; }
    // buy something at the start of each round
    if (g.phase === 1 && buyTried !== g.round && g.me.buy) {
      buyTried = g.round;
      const money = g.money;
      const pick = money >= 3100 ? 'ak47' : money >= 1800 ? 'galil' : money >= 650 ? 'kevlar' : null;
      const item = g.myTeam() === 1 ? (money >= 3100 ? 'm4a4' : money >= 2050 ? 'famas' : pick) : pick;
      if (item) { window.app.net.send({ t: 'a', a: 'buy', item }); s.buys++; }
      if (g.me.gr) window.app.net.send({ t: 'a', a: 'buy', item: 'smoke' });
    }
    const v = g.viewer();
    // nearest visible enemy
    let best = null, bd = 1e9;
    const latest = g.snaps[g.snaps.length - 1];
    if (latest) for (const id of latest.players.keys()) {
      const t = g.teamOf(id); if (t === g.myTeam()) continue;
      const p = g.interpolated(id); if (!p) continue;
      const d = Math.hypot(p.x - v.x, p.y - v.y);
      if (d < bd && g.visiblePoint(p.x, p.y)) { bd = d; best = p; }
    }
    if (best) {
      const sp = g.renderer.worldToScreen(best.x, best.y);
      inp.mx = sp.x; inp.my = sp.y; inp.left = true; s.shots++;
      keysFor(Math.sin(performance.now() / 400) * 20, 0);
      if (g.me.clip === 0) window.app.net.send({ t: 'a', a: 'reload' });
    } else {
      inp.left = false;
      wpT -= 1 / 60;
      if (!wp || wpT < 0 || Math.hypot(wp.x - v.x, wp.y - v.y) < 40) {
        wp = { x: v.x + (Math.random() - 0.5) * 900, y: v.y + (Math.random() - 0.5) * 900 }; wpT = 3;
      }
      keysFor(wp.x - v.x, wp.y - v.y);
      const sp = g.renderer.worldToScreen(wp.x, wp.y); inp.mx = sp.x; inp.my = sp.y;
      if (Math.random() < 0.005) window.app.net.send({ t: 'a', a: 'reload' });
    }
    if (Math.random() < 0.003) window.dispatchEvent(new KeyboardEvent('keydown', { code: 'KeyE' }));
  };
  loop();
});
const t0 = Date.now();
let last = '';
while ((Date.now() - t0) / 1000 < seconds) {
  await page.waitForTimeout(5000);
  const s = await page.evaluate(() => ({ ...window.__stats, rounds: [...window.__stats.rounds].join(','), score: window.app.game.score, phase: window.app.game.phase, alive: window.app.game.alive, fps: window.app.game.stats.fps }));
  const line = JSON.stringify(s);
  if (line !== last) console.log(`[${Math.round((Date.now() - t0) / 1000)}s]`, line);
  last = line;
}
await page.screenshot({ path: process.env.CS_SHOT || '/tmp/autopilot.png' });
console.log('page errors:', errors.length ? '\n' + errors.join('\n') : 'none');
await browser.close();
process.exit(errors.length ? 1 : 0);
