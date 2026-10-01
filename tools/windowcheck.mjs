// Stand outside a window tile and look in: the interior has to be visible through the glass.  node tools/windowcheck.mjs -> output/qa/window-*.png
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { launch } from './browser.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const port = 4973;
const server = spawn(process.execPath, ['src/server/index.js'], { cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', CS_DEBUG: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
let browser;
try {
  await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('server startup timeout')), 10000); server.stdout.on('data', (d) => { if (String(d).includes('ready')) { clearTimeout(t); resolve(); } }); });
  const s = await launch({ w: 1280, h: 720 }); browser = s.browser; const { page, errors } = s;
  await page.addInitScript((q) => { localStorage.setItem('fl.q', q); localStorage.setItem('fl.qm', '1'); localStorage.setItem('cs.name', 'WinQA'); }, process.env.Q || '2');
  await page.goto(`http://127.0.0.1:${port}/bf/`); await page.waitForFunction(() => window.app?.net.open);
  await page.evaluate(async () => { await (await import('./js/game/assets.js')).loadAssets(); window.app.net.send({ t: 'create', name: 'WinQA', autostart: true, settings: { map: 'riverside', mode: 'conquest', teamSize: 2, bots: false, vehicles: false } }); });
  await page.waitForSelector('#dpGo'); await page.click('#dpGo'); await page.waitForFunction(() => window.app.game.alive);
  await page.evaluate(() => window.app.net.send({ t: 'dbg', cmd: 'god' }));
  const spot = await page.evaluate(() => {
    const m = window.app.game.map;
    for (let ty = 2; ty < m.h - 2; ty++) for (let tx = 2; tx < m.w - 2; tx++) {
      if (m.chars[ty * m.w + tx] !== 'G') continue;
      for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]]) {
        const ox = tx + dx, oy = ty + dy, ix = tx - dx, iy = ty - dy;
        const open = (x, y) => !m.isBlockedTile(x, y) && !'BGM'.includes(m.chars[y * m.w + x]);
        if (open(ox, oy) && open(ox + dx, oy + dy) && open(ix, iy) && open(ix - dx, iy - dy)) return { x: (tx + .5 + dx * 2.2) * 32, y: (ty + .5 + dy * 2.2) * 32, yaw: Math.atan2(-dy, -dx), tx, ty };
      }
    }
    return null;
  });
  if (!spot) throw new Error('no window with an open interior found');
  await page.evaluate((s) => { window.app.net.send({ t: 'dbg', cmd: 'tp', x: s.x, y: s.y }); }, spot);
  await page.waitForTimeout(800);
  await page.evaluate((s) => { window.app.game.yaw = s.yaw; window.app.game.pitch = 0.02; }, spot);
  await page.waitForTimeout(1500);
  await page.screenshot({ path: root + 'output/qa/window-view-q' + (process.env.Q || '2') + '.png' });
  console.log(JSON.stringify({ spot, errors }));
} finally { if (browser) await browser.close(); server.kill(); }
