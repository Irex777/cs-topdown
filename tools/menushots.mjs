// Screenshot every in-game menu screen: node tools/menushots.mjs [prefix] [WxH ...]   -> output/qa/menus/<prefix>-<WxH>-<screen>.png
import { spawn } from 'node:child_process';
import { mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { launch } from './browser.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const out = root + 'output/qa/menus/';
await mkdir(out, { recursive: true });
const prefix = process.argv[2] || 'shot';
const sizes = (process.argv.length > 3 ? process.argv.slice(3) : ['1440x900']).map((s) => s.split('x').map(Number));
const port = 4962;
const server = spawn(process.execPath, ['src/server/index.js'], { cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1' }, stdio: ['ignore', 'pipe', 'inherit'] });
let browser;
try {
  await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('server startup timeout')), 10000); server.stdout.on('data', (d) => { if (String(d).includes('ready')) { clearTimeout(t); resolve(); } }); });
  for (const [w, h] of sizes) {
    const session = await launch({ w, h }); browser = session.browser; const { page, errors } = session;
    const snap = async (name) => { await page.waitForTimeout(450); await page.screenshot({ path: `${out}${prefix}-${w}x${h}-${name}.png` }); console.log('shot', name); };
    await page.addInitScript(() => { localStorage.setItem('fl.q', '1'); localStorage.setItem('cs.name', 'Rook'); });
    await page.goto(`http://127.0.0.1:${port}/bf/`);
    await page.waitForFunction(() => window.app?.net.open);
    await page.waitForTimeout(1500);
    await snap('home');
    for (const v of ['play', 'loadout', 'customize', 'settings']) { await page.click(`[data-go="${v}"]`); await snap('home-' + v); }
    await page.click('[data-go="play"]');
    await page.evaluate(() => window.app.createRoom('Rook'));
    await page.waitForSelector('#startBtn'); await snap('lobby');
    await page.evaluate(() => window.app.net.send({ t: 'settings', settings: { ...window.app.room.settings, teamSize: 4, bots: true, name: 'Test' } }));
    await page.evaluate(async () => { await (await import('./js/game/assets.js')).loadAssets(); });
    await page.click('#startBtn');
    await page.waitForSelector('#dpGo'); await page.waitForFunction(() => !document.querySelector('#dpGo').disabled); await page.waitForTimeout(1800);
    await snap('deploy');
    const kit = async (sel, name) => { const el = await page.$(sel); if (el) { await el.click(); await snap(name); } };
    await kit('#dpKit [data-section="attachments"]', 'deploy-attachments');
    await kit('#dpKit [data-section="equipment"]', 'deploy-equipment');
    await kit('#dpKit [data-section="weapons"]', 'deploy-weapons');
    await page.click('#dpGo'); await page.waitForTimeout(1500);
    await page.keyboard.press('Escape'); await snap('pause'); await page.keyboard.press('Escape');
    await page.evaluate(() => window.app.hud.showScore(true)); await snap('scoreboard'); await page.evaluate(() => window.app.hud.showScore(false));
    await page.keyboard.press('l'); await snap('loadout-editor'); await page.keyboard.press('Escape');
    await page.evaluate(() => window.app.hud.onMatchOver({ winner: window.app.game.myTeam(), tix: [120, 0] })); await page.waitForTimeout(2600); await snap('endgame');
    if (errors.length) console.log(errors.join('\n'));
    await browser.close(); browser = null;
  }
} finally { if (browser) await browser.close(); server.kill(); }
