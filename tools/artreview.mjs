// Capture unobstructed art review views in a fresh, bot-free developer room.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch } from './browser.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const server = spawn(process.execPath, ['src/server/index.js'], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', PORT: '4811', CS_DEBUG: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
let browser;
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Server startup timeout')), 10000);
    server.stdout.on('data', (d) => { if (String(d).includes('ready')) { clearTimeout(timer); resolve(); } });
  });
  const session = await launch({ w: 1453, h: 850 }); browser = session.browser; const page = session.page;
  await page.addInitScript(() => { localStorage.setItem('fl.q', '2'); localStorage.setItem('fl.qm', '1'); });
  await page.goto('http://127.0.0.1:4811/bf/');
  await page.waitForFunction(() => window.app?.net.open);
  await page.evaluate(async () => { await (await import('./js/game/assets.js')).loadAssets(); });
  await page.evaluate(() => window.app.net.send({ t: 'create', name: 'ArtReview', autostart: true, settings: { map: 'riverside', mode: 'conquest', teamSize: 2, bots: false, vehicles: true } }));
  await page.waitForSelector('#dpGo'); await page.click('#dpGo');
  await page.waitForFunction(() => window.app.game.alive);
  await page.evaluate(() => window.app.net.send({ t: 'dbg', cmd: 'god' }));
  await page.waitForTimeout(8500); // let startup notices and terrain uploads settle
  const frame = async (name, x, y, yaw, pitch) => {
    await page.evaluate(([x, y]) => window.app.net.send({ t: 'dbg', cmd: 'tp', x, y }), [x, y]);
    await page.waitForTimeout(650);
    await page.evaluate(([yaw, pitch]) => { window.app.game.yaw = yaw; window.app.game.pitch = pitch; }, [yaw, pitch]);
    await page.waitForTimeout(1800);
    await page.screenshot({ path: root + 'output/qa/' + name + '.png' });
    console.log(name, await page.evaluate(() => { const g = window.app.game; return { fps: g.stats.fps, render: g.renderer.renderer.info.render, costly: [...g.renderer.blocks.types.values()].map((t) => ({ type: t.ch, instances: t.n, triangles: t.meshes.reduce((n, m) => n + (m.geometry.index?.count || m.geometry.attributes.position.count) / 3 * t.n, 0) })).sort((a, b) => b.triangles - a.triangles).slice(0, 5) }; }));
  };
  await frame('world-v2-houses', 15 * 32, 46 * 32, Math.atan2(-9.5, -4), .08);
  const tree = await page.evaluate(() => {
    const m = window.app.game.map;
    for (let ty = 15; ty >= 6; ty--) for (let tx = 20; tx < 38; tx++) if (m.chars[ty * m.w + tx] === 'T' && !m.isBlockedAt((tx + .5) * 32, (ty + 6.5) * 32)) return { x: (tx + .5) * 32, y: (ty + 6.5) * 32 };
  });
  await frame('world-v2-trees', tree.x, tree.y, -Math.PI / 2, .3);
  const tank = await page.evaluate(async () => {
    const g = window.app.game, { makeSoldier, soldierGun } = await import('./js/game/assets.js');
    const { VEHICLE_LIST } = await import('./shared/vehicles.js');
    const v = g.vehiclesDrawn().find((v) => VEHICLE_LIST[v.ty] === 'tank');
    const s = makeSoldier(1, 'assault'); soldierGun(s, 'ar7', 'reddot');
    s.root.position.set(v.x + 45, g.map.heightAt(v.x + 45, v.y + 55), v.y + 55); g.renderer.scene.add(s.root);
    return { x: v.x, y: v.y };
  });
  await frame('world-v2-tank', tank.x + 100, tank.y + 100, Math.atan2(-100, -100), .03);
  const jeep = await page.evaluate(async () => { const { VEHICLE_LIST } = await import('./shared/vehicles.js'); return window.app.game.vehiclesDrawn().find((v) => VEHICLE_LIST[v.ty] === 'jeep'); });
  await frame('world-v2-truck', jeep.x + 95, jeep.y + 65, Math.atan2(-65, -95), -.04);
  const house = await page.evaluate(() => { const g = window.app.game; return g.map.buildings.find((b) => b.storeys >= 2 && b.id % 3 === 1); });
  if (house) {
    await page.evaluate((b) => {
      const g = window.app.game, cx = (b.x0 + b.x1) / 2, cy = (b.y0 + b.y1) / 2, radius = Math.hypot(b.w, b.h) * 16 + 90;
      let best;
      for (let n = 0; n < 24; n++) {
        const angle = n * Math.PI / 12, x = cx + Math.cos(angle) * radius, y = cy + Math.sin(angle) * radius;
        let score = 0;
        for (let t = 0; t < .8; t += .04) {
          const tx = Math.floor((x + (cx - x) * t) / 32), ty = Math.floor((y + (cy - y) * t) / 32);
          if (tx < 0 || tx >= g.map.w || ty < 0 || ty >= g.map.h) { score += 100; continue; }
          const ch = g.map.chars[ty * g.map.w + tx];
          if (ch === 'T') score += 10; else if (ch === '#') score += 8;
        }
        if (!best || score < best.score) best = { x, y, score };
      }
      g.freecam = true; g.cam = { x: best.x, y: best.y }; g.camH = b.base + b.wallHeight * .8;
      g.yaw = Math.atan2(cy - best.y, cx - best.x); g.elev = Math.atan2(b.wallHeight * .27, radius);
    }, house);
    await page.waitForTimeout(1800); await page.screenshot({ path: root + 'output/qa/world-v2-brick-house.png' });
  }
  if (session.errors.length) throw new Error(session.errors.join('\n'));
  console.log('Captured world-v2 houses, oak canopy, armored truck and tank/infantry scale views');
} finally { if (browser) await browser.close(); server.kill(); }
