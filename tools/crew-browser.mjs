// A native mouse-controlled gunner with a second WebSocket player driving the truck.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { launch } from './browser.mjs';
import { inspectMountedSight } from './vehicle-visibility.mjs';
const root = fileURLToPath(new URL('../', import.meta.url)), out = root + 'output/qa/', port = 4960;
const server = spawn(process.execPath, ['src/server/index.js'], { cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', CS_DEBUG: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
let browser, page, ws, driveTimer, last; const messages = [], cases = [];
const check = (name, value, detail = '') => { assert.ok(value, name + ': ' + detail); cases.push({ name, detail }); console.log('ok', name, detail); };
const pause = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const until = async (fn) => { const start = Date.now(); while (!fn()) { assert.ok(Date.now() - start < 10000, 'WebSocket fixture timeout'); await pause(25); } };
const send = (m) => ws.send(JSON.stringify(m));
const wait = (fn) => page.waitForFunction(fn, null, { timeout: 10000 });
const dbg = (cmd, extra = {}) => page.evaluate(([cmd, extra]) => window.app.net.send({ t: 'dbg', cmd, ...extra }), [cmd, extra]);
const read = () => page.evaluate(() => { const g = window.app.game, r = g.renderer; return { me: g.me, yaw: g.yaw, pitch: g.vehiclePitch, aim: r.vehicleAim, impact: r.weaponImpact, cam: r.camera.position.toArray(), first: r.vehicleFirst, locked: g.input.locked, angle: g.gunnerAngle(), shots: window.__shots || 0, fps: g.stats.fps }; });
try {
  await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('server startup timeout')), 10000); server.stdout.on('data', (d) => { if (String(d).includes('ready')) { clearTimeout(t); resolve(); } }); });
  const session = await launch(); browser = session.browser; page = session.page;
  await page.addInitScript(() => { localStorage.setItem('fl.q', '2'); localStorage.setItem('fl.qm', '1'); });
  await page.goto(`http://127.0.0.1:${port}/bf/`); await wait(() => window.app?.net.open);
  await page.evaluate(async () => { await (await import('./js/game/assets.js')).loadAssets(); window.app.net.send({ t: 'create', name: 'CrewQA', autostart: true, settings: { map: 'riverside', mode: 'conquest', teamSize: 3, bots: false, vehicles: true } }); });
  await page.waitForSelector('#dpGo'); await page.waitForFunction(() => !document.querySelector('#dpGo').disabled);
  const flag = await page.evaluate(() => window.app.game.spawnOpts.find((o) => o.k === 'flag' && o.ok));
  await page.click(`[data-spk="flag:${flag.id}"]`);
  ws = new WebSocket(`ws://127.0.0.1:${port}/bf/ws`);
  ws.on('message', (d) => { const m = JSON.parse(d); if (m.t === 's') last = m; else messages.push(m); });
  await new Promise((resolve) => ws.on('open', resolve)); send({ t: 'hello', name: 'Crew Driver' }); await until(() => messages.some((m) => m.t === 'welcome'));
  const code = await page.evaluate(() => window.app.room.code); send({ t: 'join', code, name: 'Crew Driver' }); await until(() => messages.some((m) => m.t === 'room'));
  send({ t: 'team', team: 1 }); await until(() => last && last.rsp <= .05); await pause(120); send({ t: 'a', a: 'deploy', k: 'base', id: 0 }); await until(() => last?.al === 1);
  send({ t: 'dbg', cmd: 'tp', x: flag.x, y: flag.y });
  await page.waitForFunction((id) => window.app.game.spawnOpts.some((o) => o.k === 'flag' && o.id === id && !o.ok && o.why === 'Contested'), flag.id);
  await page.waitForFunction((id) => document.querySelector(`[data-spk="flag:${id}"]`)?.disabled && document.querySelector('#dpGo').disabled, flag.id);
  check('Enemy-only capture pressure disables the flag in the actual deployment UI', await page.locator(`[data-spk="flag:${flag.id}"]`).isDisabled());
  check('The selected contested flag stays selected and Deploy is disabled', await page.evaluate((id) => window.app.hud.deploy.sel.id === id && window.app.hud.deploy.sel.k === 'flag' && document.querySelector('#dpGo').disabled && document.querySelector('#dpInfo').textContent.includes('Contested'), flag.id));
  await page.evaluate((id) => window.app.net.send({ t: 'a', a: 'deploy', k: 'flag', id }), flag.id); await page.waitForTimeout(300);
  check('A stale spawn request leaves the player in deployment', await page.evaluate(() => !window.app.game.alive && window.app.hud.deploy.open));
  await page.screenshot({ path: out + 'contested-deploy.png' });
  send({ t: 'dbg', cmd: 'tp', x: 5000, y: 2100 });
  await page.waitForFunction((id) => window.app.game.spawnOpts.some((o) => o.k === 'flag' && o.id === id && o.ok) && !document.querySelector('#dpGo').disabled, flag.id);
  check('Clearing the contested zone restores the selected spawn', await page.evaluate((id) => window.app.hud.deploy.sel.id === id, flag.id));
  await page.click('#dpGo'); await wait(() => window.app.game.alive); await dbg('god');
  send({ t: 'team', team: 0 }); await until(() => last?.al === 0 && last.rsp <= .05); await pause(120); send({ t: 'a', a: 'deploy', k: 'base', id: 0 }); await until(() => last?.al === 1); send({ t: 'dbg', cmd: 'god' });
  await dbg('enter', { type: 'jeep', seat: 0 }); await wait(() => !!window.app.game.me.veh);
  await dbg('vehiclePose', { x: 45.5 * 32, y: 56.5 * 32, angle: 0 }); await page.waitForTimeout(350);
  await page.evaluate(() => window.app.game.vehicleCameraMode = 'chase'); await page.keyboard.press('2'); await wait(() => window.app.game.me.veh?.seat === 1); await page.waitForTimeout(300);
  check('Switching from driver chase view automatically opens the gunner sight', (await read()).first);
  const vehicle = (await read()).me.veh;
  send({ t: 'dbg', cmd: 'tp', x: vehicle.x, y: vehicle.y }); await pause(150); send({ t: 'a', a: 'seat', n: 0 }); await until(() => last?.me?.veh?.seat === 0);
  if (!(await read()).locked) await page.locator('#game').click({ position: { x: 640, y: 360 } });
  await page.evaluate(() => { const g = window.app.game, original = g.processEvents.bind(g); g.processEvents = (events, ...rest) => { window.__shots = (window.__shots || 0) + events.filter((e) => e[0] === 'vshot').length; return original(events, ...rest); }; });
  let seq = last.ack || 0, keys = 1;
  driveTimer = setInterval(() => { send({ t: 'in', c: [[++seq, keys, 0, last.st, 400, 0]] }); }, 1000 / 60);
  const initial = await read(); await page.mouse.move(685, 325, { steps: 10 }); await page.waitForTimeout(800); const looking = await read();
  check('Gunner mouse controls both axes while another player drives', Math.abs(looking.yaw - initial.yaw) > .035 && looking.pitch > initial.pitch + .025);
  check('Driver movement reaches the gunner camera', Math.hypot(looking.me.veh.x - initial.me.veh.x, looking.me.veh.y - initial.me.veh.y) > 15);
  check('Mounted camera remains above the truck cabin', await page.evaluate(() => { const g = window.app.game; return g.renderer.camera.position.y - g.viewer().z > 34; }));
  const movingSight = await inspectMountedSight(page);
  check('Driving and steering leave the gunner target area unobstructed', !movingSight.blocked.length && movingSight.shields.length === 1 && !movingSight.shields[0], JSON.stringify(movingSight));
  keys = 1 | 8; await page.waitForTimeout(900); const turning = await read();
  check('Truck steering does not pull the gunner mouse direction', Math.abs(turning.me.veh.a - looking.me.veh.a) > .08 && Math.abs(turning.yaw - looking.yaw) < .025);
  const shots = turning.shots; await page.mouse.down(); await page.waitForTimeout(650); await page.mouse.up();
  check('The gunner fires while the driver turns', (await read()).shots > shots);
  keys = 512; await page.waitForTimeout(900); keys = 0;
  await page.mouse.move(685, 410, { steps: 12 }); await page.waitForTimeout(450);
  const aim = (await read()).aim; await page.mouse.down({ button: 'right' }); await page.waitForTimeout(300); const zoom = await read();
  check('Weapon zoom retains the gunner world target', Math.hypot(zoom.aim.x - aim.x, zoom.aim.y - aim.y, zoom.aim.z - aim.z) < 8);
  await page.mouse.up({ button: 'right' }); await page.waitForTimeout(200);
  const projected = await page.evaluate(() => { const r = window.app.game.renderer, p = r.weaponImpact; return p ? r.project(p.x, p.y, p.z) : null; });
  check('The physical bullet impact converges on the center reticle', projected && Math.hypot(projected.x - 640, projected.y - 360) < 14, JSON.stringify(projected));
  await page.screenshot({ path: out + 'jeep-moving-gunner.png' });
  await page.keyboard.press('v'); await wait(() => !window.app.game.renderer.vehicleFirst); await page.keyboard.press('v'); await wait(() => window.app.game.renderer.vehicleFirst);
  check('Gunner camera switching preserves mouse capture', (await read()).locked);
  clearInterval(driveTimer); driveTimer = null;
  for (const [width, height] of [[1280, 720], [1262, 1207], [800, 900]]) {
    await page.setViewportSize({ width, height });
    for (const pitch of [-1.15, -.08, 1.15]) {
      await page.evaluate((pitch) => { const g = window.app.game; g.vehiclePitch = pitch; g.vehicleCameraMode = 'first'; }, pitch);
      await page.waitForTimeout(250);
      const normal = await inspectMountedSight(page);
      check(`Clear mounted sight at ${width}x${height}, pitch ${pitch}`, !normal.blocked.length, JSON.stringify(normal));
      await page.mouse.down({ button: 'right' }); await page.waitForTimeout(350);
      const zoomed = await inspectMountedSight(page);
      check(`Clear zoomed sight at ${width}x${height}, pitch ${pitch}`, !zoomed.blocked.length && !zoomed.gunVisible, JSON.stringify(zoomed));
      if (width === 1262 && pitch === -.08) await page.screenshot({ path: out + 'jeep-clear-gunner-zoom.png' });
      await page.mouse.up({ button: 'right' });
    }
    if (width === 1262) {
      await page.evaluate(() => window.app.game.vehiclePitch = -.08); await page.waitForTimeout(250);
      await page.screenshot({ path: out + 'jeep-clear-gunner.png' });
    }
  }
  await page.keyboard.press('v'); await wait(() => !window.app.game.renderer.vehicleFirst);
  check('The protective shield remains visible from the chase camera', await page.evaluate(() => window.app.game.renderer.pools.vehicles.map.get(window.app.game.me.veh.id).glb.viewOccluders.every((node) => node.visible)));
  const errors = session.errors.filter((e) => !/GL Driver|swiftshader|ReadPixels/i.test(e)); check('No crew browser runtime errors', !errors.length, errors.join('\n'));
  await writeFile(out + 'crew-browser-results.json', JSON.stringify({ passed: cases.length, cases, errors, date: new Date().toISOString() }, null, 2));
  console.log(cases.length, 'contested deployment and moving gunner browser checks passed');
} catch (e) { console.error(e); if (page) { await page.screenshot({ path: out + 'crew-failure.png' }).catch(() => {}); console.error('STATE', JSON.stringify(await read().catch(() => null))); console.error('WS', JSON.stringify({ me: last?.me, rsp: last?.rsp, alive: last?.al, messages: messages.slice(-3) })); } process.exitCode = 1; }
finally { if (driveTimer) clearInterval(driveTimer); if (ws) ws.close(); if (browser) await browser.close(); server.kill(); }
