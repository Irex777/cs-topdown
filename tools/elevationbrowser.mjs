// Real Chrome input and surface verification for every battlefield map.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { launch } from './browser.mjs';
const root = fileURLToPath(new URL('../', import.meta.url)), out = root + 'output/qa/';
await mkdir(out, { recursive: true });
const port = 4970;
const server = spawn(process.execPath, ['src/server/index.js'], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), CS_DEBUG: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
let browser, page; const cases = [], maps = [];
const check = (name, value, detail = '') => { assert.ok(value, name + ': ' + detail); cases.push({ name, detail }); console.log('ok', name, detail); };
const wait = (fn) => page.waitForFunction(fn, null, { timeout: 10000 });
const dbg = (cmd, extra = {}) => page.evaluate(([cmd, extra]) => window.app.net.send({ t: 'dbg', cmd, ...extra }), [cmd, extra]);
const read = () => page.evaluate(() => { const g = window.app.game, r = g.renderer; return { me: g.me, pred: { ...g.pred }, ground: g.map.heightAt(g.pred.x, g.pred.y), cam: r.camera.position.toArray(), fps: g.stats.fps }; });
try {
  await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('startup timeout')), 10000); server.stdout.on('data', (d) => { if (String(d).includes('ready')) { clearTimeout(t); resolve(); } }); });
  const session = await launch({ w: 1556, h: 950 }); browser = session.browser; page = session.page;
  await page.addInitScript(() => { localStorage.setItem('fl.q', '2'); localStorage.setItem('fl.qm', '1'); });
  await page.goto(`http://127.0.0.1:${port}/bf/`); await wait(() => window.app?.net.open);
  await page.evaluate(async () => (await import('./js/game/assets.js')).loadAssets());
  for (const id of ['riverside', 'harbor', 'dunes', 'dust', 'warehouse', 'foundry', 'pit']) {
    const mode = ['dust', 'warehouse', 'foundry', 'pit'].includes(id) ? 'tdm' : 'conquest';
    await page.evaluate(([map, mode]) => window.app.net.send({ t: 'create', name: 'ElevationQA', autostart: true, settings: { map, mode, teamSize: 1, bots: false, vehicles: true } }), [id, mode]);
    await page.waitForSelector('#dpGo'); await page.waitForFunction(() => !document.querySelector('#dpGo').disabled);
    await page.click('#dpGo'); await wait(() => window.app.game.alive); await dbg('god'); await page.waitForTimeout(1000);
    const spawn = await read(); check(id + ' spawn and eye stand above the ground', Math.abs(spawn.pred.z - spawn.ground) < .1 && spawn.cam[1] > spawn.ground + 20);
    const lane = await page.evaluate(() => {
      const g = window.app.game, m = g.map;
      for (let y = 3; y < m.h - 7; y++) for (let x = 3; x < m.w - 7; x++) {
        const sx = (x + .5) * 32, sy = (y + .5) * 32;
        for (const [dx, dy] of [[200, 0], [0, 200]]) if (Math.abs(m.heightAt(sx + dx, sy + dy) - m.heightAt(sx, sy)) > 4 && Math.abs(m.heightAt(sx + dx * .35, sy + dy * .35) - m.heightAt(sx, sy)) > 2 && !m.waterAt(sx, sy) && m.clearLineR(sx, sy, sx + dx, sy + dy, 13, m.blockFoot) && g.vehiclesDrawn().every((v) => Math.hypot(v.x - sx, v.y - sy) > 250)) return { x: sx, y: sy, angle: Math.atan2(dy, dx) };
      }
    }); check(id + ' has a clear slope for native controls', !!lane);
    await dbg('tp', lane); await page.waitForFunction((p) => Math.hypot(window.app.game.pred.x - p.x, window.app.game.pred.y - p.y) < 3, lane);
    await page.evaluate((a) => { const g = window.app.game; g.yaw = g.angle = a; g.pitch = 0; g.lookKey = 'foot'; }, lane.angle);
    await page.waitForTimeout(250); const start = await read();
    await page.keyboard.down('w'); await page.waitForTimeout(1000); await page.keyboard.up('w'); await page.waitForTimeout(150); const end = await read();
    const delta = Math.hypot(end.pred.x - start.pred.x, end.pred.y - start.pred.y);
    check(id + ' W climbs or descends the slope', delta > 60 && Math.abs(end.ground - start.ground) > 1, delta.toFixed(1) + ' units / altitude ' + (end.ground - start.ground).toFixed(1));
    check(id + ' client prediction agrees with terrain and server', Math.abs(end.pred.z - end.ground) < .1 && Math.abs(end.me.z - end.ground) < 1 && end.cam[1] > end.ground + 20);
    await page.keyboard.down('Space'); await wait(() => { const g = window.app.game; return g.pred.z - g.map.heightAt(g.pred.x, g.pred.y) > 10; });
    check(id + ' jump clears elevated ground', (await read()).pred.z > (await read()).ground + 10); await page.keyboard.up('Space');
    await page.waitForFunction(() => { const g = window.app.game; return Math.abs(g.pred.z - g.map.heightAt(g.pred.x, g.pred.y)) < .1; }, null, { timeout: 2000 });
    check(id + ' jump lands back on the slope', Math.abs((await read()).pred.z - (await read()).ground) < .1);
    const surface = await page.evaluate(() => {
      const g = window.app.game, r = g.renderer; let vertices = 0, error = 0, seam = 0; const shared = new Map();
      for (const e of r.ground.chunks.values()) { const mesh = e.mesh, p = mesh.geometry.attributes.position; for (let i = 0; i < p.count; i++) { const x = mesh.position.x + p.getX(i), y = mesh.position.z + p.getZ(i), z = p.getY(i); vertices++; error = Math.max(error, Math.abs(z - g.map.heightAt(x, y))); const key = x + ':' + y; if (shared.has(key)) seam = Math.max(seam, Math.abs(z - shared.get(key))); shared.set(key, z); } }
      const ray = r.aimGround, rayError = ray ? Math.abs(ray.z - g.map.heightAt(ray.x, ray.y)) : -1;
      let markers = true; for (const e of r.pools.flags.map.values()) for (const obj of [e.rim, e.zone]) { const p = obj.geometry.attributes.position; for (let i = 0; i < p.count; i++) if (Math.abs(obj.position.y + p.getY(i) - g.map.heightAt(obj.position.x + p.getX(i) * obj.scale.x, obj.position.z + p.getZ(i) * obj.scale.z) - (obj === e.rim ? 1.4 : 1.2)) > .01) markers = false; }
      return { vertices, error, seam, rayError, markers };
    });
    check(id + ' rendered vertices match shared collision without seams', surface.vertices > 100 && surface.error < .001 && surface.seam < .001, JSON.stringify(surface));
    check(id + ' objective rings follow slopes', surface.markers);
    await page.screenshot({ path: out + 'elevation-' + id + '-foot.png' });
    if (mode !== 'tdm') {
      await dbg('enter', { type: 'tank', seat: 0 }); await wait(() => !!window.app.game.me.veh);
      const driveLane = await page.evaluate(() => {
        const g = window.app.game, m = g.map;
        for (let y = 4; y < m.h - 10; y++) for (let x = 4; x < m.w - 10; x++) for (const [dx, dy] of [[240, 0], [0, 240]]) {
          const sx = (x + .5) * 32, sy = (y + .5) * 32;
          const angle = Math.atan2(dy, dx);
          const clearHull = Array.from({ length: 16 }, (_, i) => {
            const px = sx + dx * i / 15, py = sy + dy * i / 15, hull = m.moveHull(px, py, 0, 0, 114, 65, angle, m.blockInf);
            return Math.hypot(hull.x - px, hull.y - py) < .01 && !m.waterAt(px, py) && g.vehiclesDrawn().every((v) => v.id === g.me.veh.id || Math.hypot(v.x - px, v.y - py) > 140);
          }).every(Boolean);
          if (clearHull && Math.abs(m.heightAt(sx + dx, sy + dy) - m.heightAt(sx, sy)) > 3) return { x: sx, y: sy, angle };
        }
      }); check(id + ' has a vehicle-sized sloping route', !!driveLane);
      await dbg('vehiclePose', driveLane); await page.waitForTimeout(350);
      await page.evaluate(() => { const g = window.app.game; g.lookKey = ''; g.vehicleCameraMode = 'chase'; });
      await page.keyboard.down('w');
      await page.waitForFunction(() => { const v = window.app.game.predVeh; return Math.hypot(v.vx, v.vy) > 30; }, null, { timeout: 3000 });
      await page.keyboard.up('w');
      const vehicle = await page.evaluate(() => { const g = window.app.game, r = g.renderer, v = g.vehiclesDrawn().find((v) => v.id === g.me.veh.id), root = r.pools.vehicles.map.get(v.id).obj, c = r.camera.position; return { base: g.map.heightAt(v.x, v.y), chassis: v.z, serverChassis: g.me.veh.z, root: root.position.y, me: g.me.z, camera: c.y - g.map.heightAt(c.x, c.z), tilt: root.children[0]?.rotation.toArray(), speed: Math.hypot(g.predVeh.vx, g.predVeh.vy), aim: r.vehicleAim }; });
      check(id + ' vehicle body, passenger and chase camera follow terrain', Math.abs(vehicle.root - vehicle.chassis) < .1 && vehicle.chassis >= vehicle.base - .1 && Math.abs(vehicle.me - vehicle.serverChassis) < 2 && vehicle.camera >= 7.9 && vehicle.speed > 25, JSON.stringify(vehicle));
      await page.keyboard.press('v'); await wait(() => window.app.game.renderer.vehicleFirst);
      check(id + ' first-person vehicle camera stays above terrain', await page.evaluate(() => { const r = window.app.game.renderer, p = r.camera.position; return p.y > window.app.game.map.heightAt(p.x, p.z) + 10; }));
      await page.keyboard.press('v'); await page.screenshot({ path: out + 'elevation-' + id + '-tank.png' });
      await page.keyboard.press('e'); await wait(() => !window.app.game.me.veh);
    }
    // A fixed overview exposes hills, level foundations, and banks for visual inspection.
    await page.evaluate((id) => { const g = window.app.game; const u = id === 'riverside' ? .38 : id === 'dunes' ? .39 : .35, v = id === 'riverside' ? .24 : .4; g.freecam = true; g.cam = { x: g.map.width * u, y: g.map.height * v }; g.camH = g.map.heightAt(g.cam.x, g.cam.y) + 280; g.yaw = .8; g.elev = .38; }, id);
    await page.waitForTimeout(1400); await page.screenshot({ path: out + 'elevation-' + id + '-overview.png' });
    const fps = (await read()).fps; check(id + ' terrain renders at playable frame rate', fps >= 35, fps.toFixed(1) + ' fps');
    maps.push({ id, surface, fps });
    await page.evaluate(() => window.app.leaveRoom()); await wait(() => !window.app.game.active);
  }
  const errors = session.errors.filter((e) => !/GL Driver|swiftshader|ReadPixels/i.test(e)); check('No terrain browser runtime errors', !errors.length, errors.join('\n'));
  await writeFile(out + 'elevation-browser-results.json', JSON.stringify({ passed: cases.length, cases, maps, errors, date: new Date().toISOString() }, null, 2));
  console.log(cases.length, 'native all-map elevation checks passed');
} catch (e) { console.error(e); if (page) { await page.screenshot({ path: out + 'elevation-failure.png' }).catch(() => {}); console.error('STATE', JSON.stringify(await read().catch(() => null))); } process.exitCode = 1; }
finally { if (browser) await browser.close(); server.kill('SIGINT'); }
