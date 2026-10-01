// Post-processing check: identical frames with the chain on and off in several scenes; measures how different they really are.
//   node tools/postcheck.mjs   (Q=1 or Q=2 picks the graphics level; writes output/qa/post-<scene>-{on,off}.png and prints metrics)
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { mkdir } from 'node:fs/promises';
import { launch } from './browser.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
await mkdir(root + 'output/qa', { recursive: true });
const port = 4971, quality = process.env.Q || '2';
const server = spawn(process.execPath, ['src/server/index.js'], { cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', CS_DEBUG: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
let browser;
try {
  await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('server startup timeout')), 10000); server.stdout.on('data', (d) => { if (String(d).includes('ready')) { clearTimeout(t); resolve(); } }); });
  const s = await launch({ w: 1280, h: 720 }); browser = s.browser; const { page, errors } = s;
  await page.addInitScript((q) => { localStorage.setItem('fl.q', q); localStorage.setItem('fl.qm', '1'); localStorage.setItem('cs.name', 'PostQA'); }, quality);
  await page.goto(`http://127.0.0.1:${port}/bf/`);
  await page.waitForFunction(() => window.app?.net.open);
  await page.evaluate(async () => { await (await import('./js/game/assets.js')).loadAssets(); window.app.net.send({ t: 'create', name: 'PostQA', autostart: true, settings: { map: 'riverside', mode: 'conquest', teamSize: 2, bots: false, vehicles: true } }); });
  await page.waitForSelector('#dpGo'); await page.click('#dpGo');
  await page.waitForFunction(() => window.app.game.alive);
  await page.evaluate(() => window.app.net.send({ t: 'dbg', cmd: 'god' }));
  await page.waitForTimeout(5000);
  const post = (on) => page.evaluate(async (on) => {
    const r = window.app.game.renderer;
    if (on) { await r.post.configure(r.quality); } else { r.post.want = 0; r.post.dispose(); }
    await new Promise((res) => requestAnimationFrame(() => requestAnimationFrame(res)));
    return r.post.active;
  }, on);
  const scenes = {
    street: async () => {},
    lookUp: async () => { await page.evaluate(() => { window.app.game.pitch = 0.5; }); },
    sun: async () => { await page.evaluate(() => { const g = window.app.game; g.yaw = Math.atan2(-0.4, -0.55) + Math.PI; g.pitch = 0.18; }); },
    explosion: async () => { await page.evaluate(() => { const g = window.app.game, me = g.me; window.app.net.send({ t: 'dbg', cmd: 'boom', x: me.x + Math.cos(g.yaw) * 160, y: me.y + Math.sin(g.yaw) * 160 }); }); await page.waitForTimeout(350); },
  };
  const report = {};
  for (const [name, setup] of Object.entries(scenes)) {
    await setup();
    await page.waitForTimeout(600);
    const a = await post(true); await page.screenshot({ path: `${root}output/qa/post-${name}-on.png` });
    const b = await post(false); await page.screenshot({ path: `${root}output/qa/post-${name}-off.png` });
    report[name] = { onActive: a, offActive: b };
  }
  console.log(JSON.stringify({ quality, report, errors }));
  if (errors.length) throw new Error('browser errors');
} finally { if (browser) await browser.close(); server.kill(); }
