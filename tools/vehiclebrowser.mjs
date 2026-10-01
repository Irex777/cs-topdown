// Native-input vehicle camera, driving, zoom and shooting checks in a real room.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { launch } from './browser.mjs';
import { inspectMountedSight } from './vehicle-visibility.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const port = 4930;
const server = spawn(process.execPath, ['src/server/index.js'], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), CS_DEBUG: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
let browser, page; const cases = [];
const check = (name, value, detail = '') => { assert.ok(value, name + ' ' + detail); cases.push({ name, detail }); console.log('ok', name, detail); };
const wait = (fn) => page.waitForFunction(fn, null, { timeout: 7000 });
const dbg = (cmd, extra = {}) => page.evaluate(([cmd, extra]) => window.app.net.send({ t: 'dbg', cmd, ...extra }), [cmd, extra]);
const read = () => page.evaluate(() => {
  const g = window.app.game, r = g.renderer, v = g.me.veh;
  return { v, yaw: g.yaw, pitch: g.vehiclePitch, first: r.vehicleFirst, cam: r.camera.position.toArray(), fov: r.camera.fov, horizontalFov: 2 * Math.atan(Math.tan(r.camera.fov * Math.PI / 360) * r.camera.aspect) * 180 / Math.PI, aim: r.vehicleAim, wheelCount: r.pools.vehicles.map.get(v.id)?.glb?.wheels.length || 0, wheelAngle: r.pools.vehicles.map.get(v.id)?.parts.wheel_0?.rotation.z || 0, chassis: r.pools.vehicles.map.get(v.id)?.pose, dist: g.aimDist, height: g.aimHeight, fps: g.stats.fps, speed: Math.hypot(g.predVeh.vx, g.predVeh.vy), heading: g.predVeh.a, pred: { ...g.predVeh }, shots: window.__shots || 0 };
});
const hold = async (key, ms) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); };
let mouseX = 640, mouseY = 360;
const look = async (dx, dy) => { mouseX += dx; mouseY += dy; await page.mouse.move(mouseX, mouseY, { steps: 8 }); await page.waitForTimeout(120); };
try {
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('startup timeout')), 10000); server.stdout.on('data', (d) => { if (String(d).includes('ready')) { clearTimeout(timer); resolve(); } }); });
  const session = await launch(); browser = session.browser; page = session.page;
  await page.addInitScript(() => { localStorage.setItem('fl.q', '2'); localStorage.setItem('fl.qm', '1'); });
  await page.goto(`http://127.0.0.1:${port}/bf/`); await wait(() => window.app?.net.open);
  await page.evaluate(async () => { await (await import('./js/game/assets.js')).loadAssets(); window.app.net.send({ t: 'create', name: 'VehicleQA', autostart: true, settings: { map: 'riverside', mode: 'conquest', teamSize: 2, bots: false, vehicles: true } }); });
  await page.waitForSelector('#dpGo'); await page.click('#dpGo'); await wait(() => window.app.game.alive); await dbg('god');
  await page.waitForTimeout(1800);
  await page.evaluate(() => { const g = window.app.game; const original = g.processEvents.bind(g); g.processEvents = (events, ...rest) => { window.__shots = (window.__shots || 0) + events.filter((e) => e[0] === 'vshot').length; return original(events, ...rest); }; });
  const pose = async (type) => {
    await dbg('vehiclePose', type === 'boat' ? { x: 84.5 * 32, y: 41.5 * 32, angle: Math.PI / 2 } : { x: 45.5 * 32, y: 56.5 * 32, angle: 0 });
    await page.evaluate(() => { const g = window.app.game; g.lookKey = ''; g.vehicleCameraMode = 'chase'; });
    await page.waitForTimeout(350);
  };
  for (const type of ['quad', 'jeep', 'apc', 'tank', 'heli', 'boat']) {
    await dbg('enter', { type, seat: 0 }); await wait(() => !!window.app.game.me.veh); const originalPose = (await read()).v; await pose(type);
    if (!await page.evaluate(() => window.app.game.input.locked)) { await page.locator('#game').click({ position: { x: 640, y: 360 } }); await wait(() => window.app.game.input.locked); }
    const start = await read();
    check(type + ' usable chase camera', !start.first && start.cam[1] >= 10);
    check(type + ' chase camera uses the 90 degree setting', Math.abs(start.horizontalFov - 90) < 1);
    if (type === 'quad') {
      await page.evaluate(() => window.app.game.fov = 110); await page.waitForTimeout(500);
      check('Vehicle camera respects custom FOV', Math.abs((await read()).horizontalFov - 110) < 1);
      await page.evaluate(() => window.app.game.fov = 90); await page.waitForTimeout(500);
    }
    await look(0, -65); const up = await read();
    check(type + ' mouse up raises viewing pitch', up.pitch > start.pitch + .025);
    await look(0, 65); await look(65, 0); const turned = await read();
    await page.waitForTimeout(1600); const idle = await read();
    check(type + ' mouse aim stays put while stationary', Math.abs(idle.yaw - turned.yaw) < .025);
    await pose(type);
    if (['quad', 'jeep', 'apc', 'tank'].includes(type)) {
      const rest = await read(); await hold('d', 600); const turning = await read();
      check(type + ' steering at rest matches the chassis', type === 'tank' ? Math.abs(turning.heading - rest.heading) > .2 : Math.abs(turning.heading - rest.heading) < .002);
      check(type + ' Blender wheels are articulated', turning.wheelCount === (type === 'tank' ? 14 : type === 'apc' ? 8 : 4));
      await pose(type);
    }
    const before = await read(); await hold('w', 850); const forward = await read();
    check(type + ' W accelerates', forward.speed > 20 && Math.hypot(forward.pred.x - before.pred.x, forward.pred.y - before.pred.y) > 8);
    if (['quad', 'jeep', 'apc', 'tank'].includes(type)) {
      check(type + ' wheels rotate under native throttle', Math.abs(forward.wheelAngle - before.wheelAngle) > .1);
      check(type + ' chassis shows acceleration weight transfer', Math.abs(forward.chassis.pitch) > .001);
      await page.waitForTimeout(300); const coasting = await read();
      check(type + ' retains momentum after throttle release', coasting.speed > forward.speed * .65);
    }
    await page.keyboard.down('w'); await hold('d', 650); await page.keyboard.up('w'); const steer = await read();
    check(type + ' D steers or strafes', Math.abs(steer.heading - before.heading) > .08 || Math.abs(steer.pred.y - forward.pred.y) > 8);
    await hold('Space', 900); const stopped = await read();
    check(type + ' Space brakes', stopped.speed < Math.max(15, steer.speed * .15), `${steer.speed.toFixed(1)} -> ${stopped.speed.toFixed(1)}`);
    await pose(type); await hold('s', 850); const reverse = await read();
    check(type + ' S reverses', type === 'boat' ? reverse.pred.y < 41.5 * 32 - 8 : reverse.pred.x < 45.5 * 32 - 8);
    await pose(type);
    await page.keyboard.press('v'); await wait(() => window.app.game.renderer.vehicleFirst);
    check(type + ' V switches to first person', (await read()).first);
    check(type + ' first person uses the 90 degree setting', Math.abs((await read()).horizontalFov - 90) < 1);
    await page.keyboard.press('v'); await wait(() => !window.app.game.renderer.vehicleFirst);
    check(type + ' V restores chase camera', !(await read()).first);
    if (type === 'tank' || type === 'apc' || type === 'heli') {
      const aim = (await read()).aim;
      await page.mouse.down({ button: 'right' }); await page.waitForTimeout(400); const zoom = await read();
      check(type + ' RMB weapon zoom', zoom.first && zoom.fov < 60);
      check(type + ' zoom preserves crosshair target', Math.hypot(zoom.aim.x - aim.x, zoom.aim.y - aim.y, zoom.aim.z - aim.z) < 8);
      await page.mouse.up({ button: 'right' }); await page.waitForTimeout(350);
      const n = (await read()).shots; await page.keyboard.down('w'); await page.mouse.down(); await page.waitForTimeout(700); await page.mouse.up(); await page.keyboard.up('w');
      check(type + ' weapon fires while driving', (await read()).shots > n);
      await page.screenshot({ path: root + 'output/qa/' + type + '-driving.png' });
    }
    if (type !== 'quad') {
      await page.keyboard.press('2'); await wait(() => window.app.game.me.veh.seat === 1);
      await page.waitForTimeout(200);
      const sight = await inspectMountedSight(page);
      check(type + ' gunner has a clear weapon view', (await read()).first && !sight.blocked.length, JSON.stringify(sight));
      const n = (await read()).shots; await look(40, -30); await page.mouse.down(); await page.waitForTimeout(280); await page.mouse.up();
      check(type + ' gunner mouse aims and LMB shoots', (await read()).shots > n);
      await page.mouse.down({ button: 'right' }); await page.waitForTimeout(300);
      const zoomSight = await inspectMountedSight(page);
      check(type + ' gunner zoom works without weapon obstruction', (await read()).fov < 60 && !zoomSight.blocked.length && !zoomSight.gunVisible, JSON.stringify(zoomSight)); await page.mouse.up({ button: 'right' });
      await page.screenshot({ path: root + 'output/qa/' + type + '-gunner.png' });
    }
    await dbg('vehiclePose', { x: originalPose.x, y: originalPose.y, angle: originalPose.a }); await page.waitForTimeout(150);
    await page.keyboard.press('e'); await wait(() => !window.app.game.me.veh);
  }
  const errors = session.errors.filter((e) => !/GL Driver|swiftshader|ReadPixels/i.test(e));
  check('No vehicle browser runtime errors', errors.length === 0, errors.join('\n'));
  await writeFile(root + 'output/qa/vehicle-browser-results.json', JSON.stringify({ passed: cases.length, cases, errors, date: new Date().toISOString() }, null, 2));
  console.log(cases.length, 'native vehicle browser checks passed');
} catch (error) { if (page) { console.error('STATE', JSON.stringify(await read())); await page.screenshot({ path: root + 'output/qa/vehicle-failure.png' }); } console.error(error); process.exitCode = 1; }
finally { if (browser) await browser.close(); server.kill(); }
