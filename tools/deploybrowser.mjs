// Visual and native interaction checks for the deployment workspace and consecutive matches.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { launch } from './browser.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const out = root + 'output/qa/';
await mkdir(out, { recursive: true });
const port = 4950;
const server = spawn(process.execPath, ['src/server/index.js'], { cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'inherit'] });
let browser, page;
const cases = [];
const check = (name, value, detail = '') => { assert.ok(value, name + ': ' + detail); cases.push({ name, detail }); console.log('ok', name, detail); };
const wait = (fn) => page.waitForFunction(fn, null, { timeout: 10000 });
try {
  await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('startup timeout')), 10000); server.stdout.on('data', (d) => { if (String(d).includes('ready')) { clearTimeout(t); resolve(); } }); });
  const session = await launch(); browser = session.browser; page = session.page;
  await page.addInitScript(() => localStorage.setItem('fl.q', '2'));
  await page.goto(`http://127.0.0.1:${port}/bf/`); await wait(() => window.app?.net.open);
  await page.fill('#nameInput', 'DeploymentQA');
  await page.evaluate(async () => { await (await import('./js/game/assets.js')).loadAssets(); window.app.net.send({ t: 'create', name: 'DeploymentQA', autostart: true, settings: { map: 'riverside', mode: 'conquest', teamSize: 2, bots: false, vehicles: true } }); });
  await page.waitForSelector('#dpGo'); await page.waitForFunction(() => !document.querySelector('#dpGo').disabled);
  check('Hidden nickname field loses focus when match starts', await page.evaluate(() => !window.app.game.input.isTyping()));
  await page.waitForTimeout(2200);
  for (const [width, height] of [[1556, 1064], [1920, 1080], [1280, 720], [900, 600], [560, 860]]) {
    await page.setViewportSize({ width, height }); await page.waitForTimeout(250);
    const layout = await page.evaluate(() => {
      const root = document.querySelector('#deploy'), dp = root.querySelector('.dp');
      const rect = dp.getBoundingClientRect();
      const go = document.querySelector('#dpGo').getBoundingClientRect();
      const map = document.querySelector('#dpMap').getBoundingClientRect();
      return { x: rect.x, right: rect.right, goBottom: go.bottom, mapWidth: map.width, mapHeight: map.height, overflow: root.scrollWidth > window.innerWidth };
    });
    check('Deployment layout at ' + width + '×' + height, layout.x >= 0 && layout.right <= width && !layout.overflow && layout.mapWidth > 150 && layout.mapHeight > 100 && (width <= 760 || layout.goBottom <= height), JSON.stringify(layout));
    await page.screenshot({ path: out + `deploy-${width}.png` });
  }
  await page.setViewportSize({ width: 1556, height: 1064 });
  for (const cls of ['engineer', 'support', 'recon', 'assault']) {
    await page.click(`#dpKit [data-cls="${cls}"]`);
    check('Combat role ' + cls + ' updates the saved kit and summary', await page.evaluate((cls) => window.app.hud.deploy.lo.cls === cls && document.querySelector('#dpSummary').textContent.toLowerCase().includes(cls), cls));
  }
  await page.click('#dpKit [data-tab="secondary"]');
  check('Sidearm selection renders its weapon', await page.locator('#dpKit .wcard').count() > 0);
  await page.click('#dpKit [data-tab="primary"]');
  await page.click('#dpKit [data-section="attachments"]');
  for (const slot of ['optic', 'barrel', 'under', 'mag']) {
    await page.click(`#dpKit [data-slot="${slot}"]`);
    const choices = page.locator(`#dpKit [data-att^="primary:${slot}:"]`);
    const expected = (await choices.last().getAttribute('data-att')).split(':')[2];
    await choices.last().click();
    check(slot + ' can be equipped and persisted', await page.evaluate(([slot, expected]) => JSON.parse(localStorage.getItem('bf.loadout')).primary.att[slot] === expected && window.app.hud.deploy.lo.primary.att[slot] === expected, [slot, expected]));
  }
  await page.screenshot({ path: out + 'deploy-attachments.png' });
  await page.click('#dpKit [data-section="equipment"]');
  await page.click('#dpKit [data-gren="smoke"]');
  check('Equipment tab saves grenade choice', await page.evaluate(() => window.app.hud.deploy.lo.gren === 'smoke'));
  await page.screenshot({ path: out + 'deploy-equipment.png' });
  await page.click('#dpKit [data-section="weapons"]');
  check('Unavailable spawns are disabled buttons', await page.evaluate(() => [...document.querySelectorAll('.sp-btn.off')].every((b) => b.disabled)));
  const flag = await page.evaluate(() => { const d = window.app.hud.deploy, o = window.app.game.spawnOpts.find((o) => o.k === 'flag' && o.ok); return { id: o.id, ...d.toCanvas(o.x, o.y) }; });
  await page.locator('#dpMap').click({ position: { x: flag.x, y: flag.y } });
  check('Map click selects an available flag and updates the footer', await page.evaluate((id) => window.app.hud.deploy.sel.k === 'flag' && window.app.hud.deploy.sel.id === id && document.querySelector('#dpDestination').textContent.includes('West Outpost'), flag.id));
  await page.click('#dpSpawns [data-spk="base:0"]');
  check('Spawn list restores main base selection', await page.evaluate(() => window.app.hud.deploy.sel.k === 'base' && document.querySelector('#dpDestination').textContent.includes('Main Base')));
  for (let match = 0; match < 3; match++) {
    if (match) {
      await page.evaluate(() => { window.app.game.input.releaseLock(); window.app.net.send({ t: 'lobby' }); });
      await wait(() => window.app.room?.state === 'lobby');
      await page.evaluate(() => window.app.net.send({ t: 'start' }));
      await page.waitForSelector('#dpGo'); await page.waitForFunction(() => !document.querySelector('#dpGo').disabled);
    }
    await page.click('#dpGo'); await wait(() => window.app.game.alive && !window.app.hud.deploy.open);
    const start = await page.evaluate(() => ({ x: window.app.game.me.x, y: window.app.game.me.y }));
    await page.keyboard.down('w'); await page.waitForTimeout(850); await page.keyboard.up('w');
    const end = await page.evaluate(() => ({ x: window.app.game.me.x, y: window.app.game.me.y, locked: window.app.game.input.locked }));
    const d = Math.hypot(end.x - start.x, end.y - start.y);
    check('Match ' + (match + 1) + ' moves from actual spawn immediately', d > 45, d.toFixed(1) + ' units');
    check('Match ' + (match + 1) + ' captures mouse after Deploy', end.locked);
    await page.keyboard.down('w'); await page.waitForTimeout(1200); await page.keyboard.up('w');
  }
  check('No deployment browser errors', !session.errors.length, session.errors.join('\n'));
  await writeFile(out + 'deploy-browser-results.json', JSON.stringify({ passed: cases.length, cases, errors: session.errors, date: new Date().toISOString() }, null, 2));
  console.log(cases.length, 'deployment browser checks passed');
} finally { if (browser) await browser.close(); server.kill('SIGINT'); }
