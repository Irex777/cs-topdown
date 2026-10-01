// Native flight controls and rendered object heights in installed Chrome.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { launch } from './browser.mjs';
const root = fileURLToPath(new URL('../', import.meta.url)), out = root + 'output/qa/';
await mkdir(out, { recursive: true });
const port = 4990;
const server = spawn(process.execPath, ['src/server/index.js'], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), CS_DEBUG: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
let browser, page; const cases = [], maps = [];
const check = (name, value, detail = '') => { assert.ok(value, name + ': ' + detail); cases.push({ name, detail }); console.log('ok', name, detail); };
const wait = (fn) => page.waitForFunction(fn, null, { timeout: 10000 });
const dbg = (cmd, extra = {}) => page.evaluate(([cmd, extra]) => window.app.net.send({ t: 'dbg', cmd, ...extra }), [cmd, extra]);
const hold = async (key, ms) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); };
const read = () => page.evaluate(() => {
  const g = window.app.game, v = { ...g.vehiclesDrawn().find((v) => v.id === g.me.veh.id), def: g.vehDef() }, r = g.renderer, obj = r.pools.vehicles.map.get(v.id).obj;
  return { v, authoritative: g.me.veh, pred: { ...g.predVeh }, ground: g.map.heightAt(v.x, v.y), landing: g.map.landingHeight(v.x, v.y, v.def.r * .7) + 2, root: obj.position.y, cam: r.camera.position.toArray(), first: r.vehicleFirst, fps: g.stats.fps, shots: window.__shots || 0 };
});
try {
  await new Promise((resolve, reject) => { const t = setTimeout(() => reject(new Error('startup timeout')), 10000); server.stdout.on('data', (d) => { if (String(d).includes('ready')) { clearTimeout(t); resolve(); } }); });
  const session = await launch({ w: 1556, h: 950 }); browser = session.browser; page = session.page;
  await page.addInitScript(() => { localStorage.setItem('fl.q', '2'); localStorage.setItem('fl.qm', '1'); });
  await page.goto(`http://127.0.0.1:${port}/bf/`); await wait(() => window.app?.net.open);
  await page.evaluate(async () => (await import('./js/game/assets.js')).loadAssets());
  for (const id of ['riverside', 'harbor', 'dunes', 'dust', 'warehouse', 'foundry', 'pit']) {
    const mode = ['dust', 'warehouse', 'foundry', 'pit'].includes(id) ? 'tdm' : 'conquest';
    await page.evaluate(([map, mode]) => window.app.net.send({ t: 'create', name: 'HeightsQA', autostart: true, settings: { map, mode, teamSize: 1, bots: false, vehicles: true } }), [id, mode]);
    await page.waitForSelector('#dpGo'); await page.click('#dpGo'); await wait(() => window.app.game.alive); await dbg('god'); await page.waitForTimeout(1200);
    const models = await page.evaluate(async () => {
      const THREE = await import('./vendor/three/three.module.js');
      const g = window.app.game, blocks = g.renderer.blocks, matrix = new THREE.Matrix4(); let wallError = 0, treeError = 0, windowError = 0, walls = 0, trees = 0, windows = 0;
      for (const t of blocks.types.values()) for (let n = 0; n < t.n; n++) {
        if (!['B', 'G', 'T'].includes(t.ch[0])) continue;
        const i = t.tiles[n]; let highest = -Infinity;
        for (const mesh of t.meshes) { mesh.getMatrixAt(n, matrix); const box = mesh.geometry.boundingBox || (mesh.geometry.computeBoundingBox(), mesh.geometry.boundingBox); highest = Math.max(highest, box.clone().applyMatrix4(matrix).max.y); }
        const base = g.map.tileBase(i % g.map.w, Math.floor(i / g.map.w)), error = Math.abs(highest - base - g.map.top[i]);
        if (t.ch[0] === 'B') { walls++; wallError = Math.max(wallError, error); }
        else if (t.ch[0] === 'T') { trees++; treeError = Math.max(treeError, error); }
        else { windows++; windowError = Math.max(windowError, error); }
      }
      return { walls, trees, windows, wallError, treeError, windowError, storeys: [...new Set(g.map.buildings.map((b) => b.storeys))], fps: g.stats.fps };
    });
    check(id + ' rendered wall height matches physical height', models.walls > 0 && models.wallError < .01, JSON.stringify(models));
    check(id + ' tree models match varied collision heights', models.trees === 0 || models.treeError < .01);
    check(id + ' stacked window height matches each building', models.windows === 0 || models.windowError < .1);
    if (id === 'harbor') check('Harbor renders three different building heights', models.storeys.length === 3);
    maps.push({ id, models });
    if (mode === 'conquest') {
      const pad = await page.evaluate(() => window.app.game.vehiclesDrawn().find((v) => v.ty === 4 && v.team === window.app.game.myTeam()));
      await dbg('tp', pad); await page.waitForTimeout(400);
      check(id + ' landed aircraft displays a boarding prompt', await page.locator('#prompt').textContent().then((s) => /enter Attack Helicopter/i.test(s)));
      await page.keyboard.press('e'); await wait(() => !!window.app.game.me.veh); await page.waitForTimeout(450);
      await page.evaluate(() => { const g = window.app.game; g.lookKey = ''; g.vehicleCameraMode = 'chase'; const original = g.processEvents.bind(g); g.processEvents = (events, ...rest) => { window.__shots = (window.__shots || 0) + events.filter((e) => e[0] === 'vshot').length; return original(events, ...rest); }; });
      const landed = await read(); check(id + ' helicopter starts on its elevated landing pad', Math.abs(landed.v.z - landed.landing) < .1);
      if (!await page.evaluate(() => window.app.game.input.locked)) await page.locator('#game').click({ position: { x: 778, y: 475 } });
      await hold('Shift', 3400); await hold('Space', 1100); const high = await read();
      check(id + ' native Shift climbs and Space stops vertical motion', high.v.z > landed.v.z + 230 && Math.abs(high.pred.vz) < 2, JSON.stringify(high.pred));
      check(id + ' flight prediction, server and model altitude agree', Math.abs(high.v.z - high.authoritative.z) < 2 && Math.abs(high.root - high.v.z) < 2);
      await page.waitForTimeout(800); const hover = await read(); check(id + ' released controls maintain world altitude', Math.abs(hover.v.z - high.v.z) < 2);
      await hold('w', 650); await hold('Space', 1100); const moved = await read();
      check(id + ' forward flight keeps altitude across terrain', Math.hypot(moved.v.x - high.v.x, moved.v.y - high.v.y) > 30 && Math.abs(moved.v.z - high.v.z) < 2);
      await page.keyboard.press('v'); await wait(() => window.app.game.renderer.vehicleFirst); const cockpit = await read();
      check(id + ' cockpit follows flight altitude', Math.abs(cockpit.cam[1] - cockpit.v.z) < 55 && cockpit.cam[1] > cockpit.ground + 180);
      const before = cockpit.shots; await page.mouse.down(); await page.waitForTimeout(550); await page.mouse.up(); check(id + ' weapons fire from elevated flight', (await read()).shots > before);
      await page.screenshot({ path: out + 'height-' + id + '-cockpit.png' }); await page.keyboard.press('v');
      // Select a complete roof so the aircraft can land on its center.
      const roof = await page.evaluate(() => { const g = window.app.game, b = [...g.map.buildings].filter((b) => b.w >= 5 && b.h >= 5).sort((a, b) => b.storeys - a.storeys)[0]; const x = (b.x + b.w / 2) * 32, y = (b.y + b.h / 2) * 32; return { x, y, z: g.map.landingHeight(x, y, g.vehDef().r * .7) + 132, angle: 0 }; });
      await dbg('vehiclePose', roof); await page.waitForTimeout(400); await hold(id === 'dunes' ? 'c' : 'Control', 2600); await page.waitForTimeout(250); const onRoof = await read();
      check(id + ' native Ctrl/C lands on a roof', Math.abs(onRoof.v.z - onRoof.landing) < .1 && onRoof.v.z > onRoof.ground + 40 && Math.abs(onRoof.pred.vz) < .01, JSON.stringify(onRoof));
      check(id + ' helicopter HUD explains altitude controls', await page.locator('#vehbox').innerText().then((s) => /climb/i.test(s) && /descend/i.test(s)).catch(() => false));
      await page.screenshot({ path: out + 'height-' + id + '-rooftop.png' });
      await page.keyboard.press('e'); await wait(() => !window.app.game.me.veh); await page.waitForTimeout(1100);
      const feet = await page.evaluate(() => { const g = window.app.game; return { z: g.pred.z, surface: g.map.surfaceAt(g.pred.x, g.pred.y), ground: g.map.heightAt(g.pred.x, g.pred.y) }; });
      check(id + ' roof exit leaves infantry on the physical roof', Math.abs(feet.z - feet.surface) < .1 && feet.z > feet.ground + 40, JSON.stringify(feet));
    }
    await page.evaluate((id) => { const g = window.app.game; g.freecam = true; g.cam = { x: g.map.width * (id === 'harbor' ? .3 : .38), y: g.map.height * .4 }; g.camH = g.map.heightAt(g.cam.x, g.cam.y) + (id === 'harbor' ? 340 : 280); g.yaw = .8; g.elev = .32; }, id);
    await page.waitForTimeout(1000); await page.screenshot({ path: out + 'height-' + id + '-overview.png' });
    check(id + ' taller objects render at playable frame rate', await page.evaluate(() => window.app.game.stats.fps >= 35));
    await page.evaluate(() => window.app.leaveRoom()); await wait(() => !window.app.game.active);
  }
  const errors = session.errors.filter((e) => !/GL Driver|swiftshader|ReadPixels/i.test(e)); check('No vertical-world browser runtime errors', !errors.length, errors.join('\n'));
  await writeFile(out + 'height-browser-results.json', JSON.stringify({ passed: cases.length, cases, maps, errors, date: new Date().toISOString() }, null, 2));
  console.log(cases.length, 'native object-height and flight checks passed');
} catch (e) { console.error(e); if (page) { await page.screenshot({ path: out + 'height-failure.png' }).catch(() => {}); console.error('STATE', JSON.stringify(await read().catch(() => null))); } process.exitCode = 1; }
finally { if (browser) await browser.close(); server.kill('SIGINT'); }
