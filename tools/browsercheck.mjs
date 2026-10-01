// End-to-end UX checks against an isolated, real WebSocket server.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { launch } from './browser.mjs';

const root = fileURLToPath(new URL('../', import.meta.url));
const out = new URL('../output/qa/', import.meta.url);
await mkdir(out, { recursive: true });
const port = 4800 + Math.floor(Math.random() * 200);
const server = spawn(process.execPath, ['src/server/index.js'], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), CS_DEBUG: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
const cases = [];
let browser, page, errors;
const check = (name, value, details = '') => { assert.ok(value, name + (details ? ': ' + details : '')); cases.push({ name, details }); console.log('  ok ', name, details); };
const wait = async (fn, timeout = 7000) => page.waitForFunction(fn, null, { timeout });
const read = async () => page.evaluate(() => { const g = window.app.game, dp = window.app.hud.deploy; return { me: g.me, pred: g.pred, yaw: g.yaw, pitch: g.pitch, fps: g.stats.fps, quality: g.renderer.quality, locked: g.input.locked, deployment: { selected: dp.sel, options: g.spawnOpts, timer: g.respawnIn, editOnly: dp.editOnly } }; });
const hold = async (key, ms = 450) => { await page.keyboard.down(key); await page.waitForTimeout(ms); await page.keyboard.up(key); };
const shot = async (name) => page.screenshot({ path: fileURLToPath(new URL(name + '.png', out)) });
const dbg = async (cmd, extra = {}) => page.evaluate(([cmd, extra]) => window.app.net.send({ t: 'dbg', cmd, ...extra }), [cmd, extra]);
try {
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Test server startup timeout')), 10000);
    server.stdout.on('data', (d) => { if (String(d).includes('ready')) { clearTimeout(timer); resolve(); } });
    server.on('exit', () => { clearTimeout(timer); reject(new Error('Test server exited')); });
  });
  ({ browser, page, errors } = await launch());
  await page.goto(`http://127.0.0.1:${port}/bf/`);
  await wait(() => window.app && window.app.net.open);
  await page.evaluate(async () => { const m = await import('./js/game/assets.js'); await m.loadAssets(); window.__qaAssets = m.assets; });
  const assets = await page.evaluate(() => { const a = window.__qaAssets; const hasMat = (root, name) => { let found = false; root.traverse((o) => { if (!o.isMesh) return; const mats = Array.isArray(o.material) ? o.material : [o.material]; if (mats.some((m) => m.name === name && m.map)) found = true; }); return found; }; return { ready: a.ready, failed: a.failed, weapons: Object.keys(a.weapons).length, vehicles: Object.keys(a.vehicles).length, skin: hasMat(a.soldier, 'uniform'), sleeves: hasMat(a.hands, 'sleeve') }; });
  check('All generated textures and Blender models load', assets.ready && !assets.failed && assets.weapons === 10 && assets.vehicles === 6 && assets.skin && assets.sleeves, JSON.stringify(assets));
  const scale = await page.evaluate(async () => {
    const THREE = await import('./vendor/three/three.module.js');
    const { makeVehicle, makeSoldier, VEH_SCALE } = await import('./js/game/assets.js');
    const soldier = makeSoldier(1, 'assault').root;
    const infantryHeight = new THREE.Box3().setFromObject(soldier).getSize(new THREE.Vector3()).y;
    const vehicles = Object.fromEntries(Object.keys(VEH_SCALE).map((id) => {
      const model = makeVehicle(id, 1), group = new THREE.Group();
      for (const [part, node] of Object.entries(model.parts)) {
        if (part === 'turret') node.position.y = model.mount.ty;
        if (part === 'rotor') node.position.y = model.mount.ry;
        if (part === 'gun') node.position.set(model.mount.gx, model.mount.gy, model.mount.gz);
        group.add(node);
      }
      return [id, new THREE.Box3().setFromObject(group).getSize(new THREE.Vector3()).toArray()];
    }));
    let foliage = false;
    window.__qaAssets.props.getObjectByName('tree').traverse((o) => { if (o.isMesh && o.material.map && o.material.alphaTest >= .4 && !o.material.transparent) foliage = true; });
    return { infantryHeight, vehicles, consistent: Object.values(VEH_SCALE).every((s) => s === 16), foliage, architecture: !!window.__qaAssets.architecture?.getObjectByName('window') };
  });
  check('Vehicles use consistent metre scale relative to infantry', scale.consistent && scale.infantryHeight > 27 && scale.infantryHeight < 33 && scale.vehicles.tank[1] > scale.infantryHeight && scale.vehicles.jeep[0] > 60, JSON.stringify(scale));
  check('Generated foliage uses cutout leaves and houses load framed windows', scale.foliage && scale.architecture);
  await shot('menu');
  await page.click('[data-go="play"]');
  await page.click('#quickBtn');
  check('Quick play guides an unnamed player to nickname', await page.locator('#nameInput').evaluate((el) => document.activeElement === el));
  await page.fill('#nameInput', 'FieldQA');
  await page.click('#mpBack');
  await page.click('[data-go="settings"]');
  check('Fresh players receive intended controls', await page.evaluate(() => window.app.game.fov === 90 && window.app.game.sens === 0.0012));
  await page.selectOption('#gfxQ', '2');
  await page.locator('#fovRange').fill('100');
  await page.locator('#sensRange').fill('16');
  check('Settings update and persist', await page.evaluate(() => window.app.game.fov === 100 && window.app.game.sens === .0016 && localStorage.getItem('fl.q') === '2'));
  await shot('settings');
  await page.click('#mpBack');
  await page.click('[data-go="loadout"]');
  for (const cls of ['engineer', 'support', 'recon', 'assault']) {
    await page.click(`#mpKit [data-cls="${cls}"]`);
    check('Loadout class ' + cls, await page.evaluate((cls) => JSON.parse(localStorage.getItem('bf.loadout')).cls === cls, cls));
  }
  await page.click('#mpKit [data-gren="smoke"]');
  check('Smoke grenade selection persists in the loadout', await page.evaluate(() => JSON.parse(localStorage.getItem('bf.loadout')).gren === 'smoke'));
  await shot('loadout');
  await page.click('#mpBack');
  await page.click('[data-go="customize"]');
  check('Arsenal shows weapon and attachment previews', await page.locator('.sheet.weapons .sheet-card').count() === 9 && await page.locator('.sheet.atts .sheet-card').count() === 12);
  await shot('arsenal');
  await page.click('#mpBack');
  for (const [width, height] of [[900, 600], [1920, 1080], [1280, 720]]) {
    await page.setViewportSize({ width, height });
    const layout = await page.locator('.mm-nav').boundingBox();
    check(`Menu usable at ${width}×${height}`, layout.x >= 0 && layout.y >= 0 && layout.x + layout.width <= width && layout.y + layout.height <= height);
    await shot(`menu-${width}`);
  }
  await page.click('#fmPlay');
  await page.waitForSelector('#dpGo');
  await shot('deploy');
  await page.click('#dpGo');
  await wait(() => window.app.game.alive && window.app.game.me?.own);
  await dbg('god');
  await page.waitForTimeout(1400);
  check('Deploy enters a live first-person match', (await read()).me.hp === 100);
  // Moving bots/vehicles can block a random spawn. Use clear terrain for speed measurements.
  const movementPatch = await page.evaluate(() => {
    const g = window.app.game, candidates = [];
    for (let y = 4; y < g.map.h - 4; y++) for (let x = 4; x < g.map.w - 4; x++) {
      let clear = true;
      for (let dy = -4; dy <= 4 && clear; dy++) for (let dx = -4; dx <= 4; dx++) {
        const i = (y + dy) * g.map.w + x + dx;
        if (g.map.solid[i] || g.map.water[i]) { clear = false; break; }
      }
      if (clear) candidates.push({ x: (x + .5) * 32, y: (y + .5) * 32 });
    }
    candidates.sort((a, b) => Math.hypot(a.x - g.me.x, a.y - g.me.y) - Math.hypot(b.x - g.me.x, b.y - g.me.y));
    return candidates.find((p) => g.vehiclesDrawn().every((v) => Math.hypot(v.x - p.x, v.y - p.y) > 180));
  });
  assert.ok(movementPatch, 'Clear terrain is available for movement checks');
  await dbg('tp', movementPatch);
  await page.waitForFunction((p) => Math.hypot(window.app.game.pred.x - p.x, window.app.game.pred.y - p.y) < 5, movementPatch);
  if (!(await read()).locked) await page.locator('#game').click({ position: { x: 640, y: 360 } });
  await wait(() => window.app.game.input.locked);
  check('Mouse capture succeeds', (await read()).locked);
  await page.waitForTimeout(150);
  const start = await read();
  await page.mouse.move(665, 375, { steps: 5 });
  const looked = await read();
  check('Mouse look changes yaw and pitch', Math.abs(looked.yaw - start.yaw) > .001 && Math.abs(looked.pitch - start.pitch) > .001);
  await page.keyboard.down('w'); await page.waitForTimeout(400);
  const moved = await read();
  await page.keyboard.up('w');
  check('W moves relative to the view', Math.hypot(moved.pred.x - start.pred.x, moved.pred.y - start.pred.y) > 10);
  const walkSpeed = Math.hypot(moved.pred.vx, moved.pred.vy);
  await page.keyboard.down('Shift');
  await page.keyboard.down('w'); await page.waitForTimeout(450);
  const sprintSpeed = await page.evaluate(() => Math.hypot(window.app.game.pred.vx, window.app.game.pred.vy));
  await page.keyboard.up('w');
  await page.keyboard.up('Shift');
  check('Forward sprint increases movement speed', sprintSpeed > walkSpeed * 1.1, `${walkSpeed.toFixed(1)} → ${sprintSpeed.toFixed(1)}`);
  const side0 = await read();
  await hold('d', 400);
  const side1 = await read();
  check('D strafes', Math.hypot(side1.pred.x - side0.pred.x, side1.pred.y - side0.pred.y) > 10);
  await page.keyboard.down('Space');
  await wait(() => window.app.game.pred.z - window.app.game.map.heightAt(window.app.game.pred.x, window.app.game.pred.y) > 5, 2000);
  check('Space jumps', await page.evaluate(() => window.app.game.pred.z - window.app.game.map.heightAt(window.app.game.pred.x, window.app.game.pred.y) > 5));
  await page.keyboard.up('Space');
  await page.waitForTimeout(550);
  await page.keyboard.down('c');
  await wait(() => window.app.game.pred.cf > .6);
  check('C crouches and lowers the camera', (await read()).pred.cf > .6);
  await page.keyboard.up('c');
  await page.waitForTimeout(300);
  await page.mouse.down({ button: 'right' });
  await wait(() => window.app.game.renderer.scopeK > .5);
  check('RMB aims down sights', await page.evaluate(() => window.app.game.input.right && window.app.game.renderer.scopeK > .5));
  await shot('aim-down-sights');
  await page.mouse.up({ button: 'right' });
  const clip = (await read()).me.clip;
  await page.mouse.down(); await page.waitForTimeout(250); await page.mouse.up();
  await wait(() => window.app.game.me.clip < 30);
  check('LMB fires and consumes ammunition', (await read()).me.clip < clip);
  await page.keyboard.press('r');
  await wait(() => window.app.game.me.rel > 0);
  await wait(() => window.app.game.me.rel === 0 && window.app.game.me.clip === 30);
  check('R completes a reload', (await read()).me.clip === 30);
  await page.keyboard.press('2'); await wait(() => window.app.game.me.sel === 'secondary');
  check('2 selects the sidearm', (await read()).me.sel === 'secondary');
  await page.keyboard.press('1'); await wait(() => window.app.game.me.sel === 'primary');
  await page.keyboard.press('g'); await wait(() => window.app.game.me.sel === 'grenade');
  check('G equips a grenade', (await read()).me.sel === 'grenade');
  await page.keyboard.press('1'); await wait(() => window.app.game.me.sel === 'primary');
  await page.keyboard.down('Tab');
  check('Tab opens the scoreboard', await page.locator('#score').isVisible());
  await page.keyboard.up('Tab');
  check('Tab release closes the scoreboard', !await page.locator('#score').isVisible());
  await page.keyboard.press('m');
  check('M opens the tactical map', await page.evaluate(() => window.app.game.bigmap));
  await page.keyboard.press('m');
  await page.keyboard.down('w');
  await page.keyboard.press('Enter');
  await page.waitForSelector('#chatInput:visible');
  await page.keyboard.up('w');
  await page.keyboard.press('Escape');
  check('Chat focus does not leave movement held', await page.evaluate(() => !window.app.game.input.down.has('KeyW') && !window.app.hud.chatOpen));
  await page.keyboard.press('Escape');
  await page.waitForSelector('#pause:visible');
  const pauseClip = (await read()).me.clip;
  await page.keyboard.press('2'); await page.keyboard.press('e'); await page.keyboard.press('r');
  await page.waitForTimeout(150);
  check('Pause menu blocks weapon and interaction actions', (await read()).me.sel === 'primary' && (await read()).me.clip === pauseClip && await page.evaluate(() => window.app.game.input.pending === 0));
  await shot('pause');
  await page.keyboard.press('Escape');
  await page.keyboard.press('l');
  await page.waitForSelector('#dpClose');
  check('L opens the loadout editor during a match', await page.evaluate(() => window.app.hud.deploy.editOnly));
  await page.keyboard.press('l');
  check('L closes the loadout editor', !await page.locator('#deploy').isVisible());
  await page.waitForTimeout(500);
  await dbg('enter', { type: 'tank', seat: 0 });
  await wait(() => !!window.app.game.me.veh);
  check('Tank model and vehicle camera render', await page.evaluate(async () => window.app.game.me.veh.ty === (await import('./shared/vehicles.js')).VEHICLE_LIST.indexOf('tank')), JSON.stringify((await read()).me.veh));
  await shot('tank');
  await hold('w', 650);
  check('Vehicle throttle reaches the simulation', await page.evaluate(() => Math.hypot(window.app.game.predVeh.vx, window.app.game.predVeh.vy) > 2));
  await page.keyboard.press('2');
  await wait(() => window.app.game.me.veh.seat === 1);
  check('Vehicle seat switching works', (await read()).me.veh.seat === 1);
  await page.keyboard.press('e');
  await wait(() => !window.app.game.me.veh);
  check('E exits the vehicle', !(await read()).me.veh);
  await page.keyboard.press('e'); await wait(() => !!window.app.game.me.veh);
  check('E re-enters from outside the enlarged hull', !!(await read()).me.veh);
  await page.keyboard.press('e'); await wait(() => !window.app.game.me.veh);
  await page.waitForTimeout(1000);
  await shot('first-person');
  for (const quality of [0, 1, 2]) {
    await page.keyboard.press('Escape'); await page.click('#pause [data-ptab="settings"]'); await page.waitForSelector('#gfxQ');
    await page.selectOption('#gfxQ', String(quality));
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
    check('Graphics quality ' + quality + ' renders', (await read()).quality === quality);
    await shot('quality-' + quality);
  }
  check('Generated ground and brick surfaces are active', await page.evaluate(() => {
    const r = window.app.game.renderer, a = window.__qaAssets;
    return !!(a.tex.ground_c && a.tex.brick_n.image.src.includes('brick-generated-n') && r.ground.pbr && r.terrain.detailImages?.grass && [...r.ground.chunks.values()].every((c) => c.canvas.width === 512));
  }));
  const resources = await page.evaluate(() => {
    const r = window.app.game.renderer;
    window.__worldDisposals = [];
    const owned = [...Object.values(r.blocks.resources).flatMap((set) => [...set]), ...r.buildings.geometries, ...r.buildings.materials];
    for (const resource of owned) { const state = { disposed: false }; window.__worldDisposals.push(state); resource.addEventListener('dispose', () => { state.disposed = true; }); }
    return { ...r.renderer.info.memory };
  });
  for (let cycle = 0; cycle < 2; cycle++) {
    await page.keyboard.press('Escape'); await page.click('#pause [data-ptab="settings"]'); await page.waitForSelector('#gfxQ');
    await page.selectOption('#gfxQ', '0');
    await page.selectOption('#gfxQ', '2');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(1000);
  }
  const afterResources = await page.evaluate(() => ({ ...window.app.game.renderer.renderer.info.memory }));
  check('Repeated graphics switches release world GPU resources', await page.evaluate(() => window.__worldDisposals.every((s) => s.disposed)) && afterResources.textures <= resources.textures + 3, JSON.stringify({ before: resources, after: afterResources }));
  await page.evaluate(() => { window.app.game.pitch = -0.14; });
  await page.waitForTimeout(150);
  await shot('environment');
  check('Pitched roofs and Blender windows are active', await page.evaluate(() => {
    const r = window.app.game.renderer;
    return r.buildings.entries.filter((e) => e.group.visible).length > 10 && r.blocks.specs.G.prop === 'window' && r.blocks.specs.T.prop === 'tree';
  }));
  await dbg('tp', { x: 18 * 32, y: 42 * 32 });
  await page.waitForTimeout(600);
  await page.evaluate(() => { window.app.game.yaw = Math.atan2(-5.5, -7); window.app.game.pitch = .04; });
  await page.waitForTimeout(250); await shot('houses');
  const treeView = await page.evaluate(() => {
    const m = window.app.game.map;
    for (let ty = 15; ty >= 6; ty--) for (let tx = 20; tx < 38; tx++) {
      if (m.chars[ty * m.w + tx] !== 'T') continue;
      const x = (tx + .5) * 32, y = (ty + 6.5) * 32;
      if (!m.isBlockedAt(x, y)) return { x, y };
    }
  });
  assert.ok(treeView, 'Tree visual review position exists');
  await dbg('tp', treeView); await page.waitForTimeout(600);
  await page.evaluate(() => { window.app.game.yaw = -Math.PI / 2; window.app.game.pitch = .3; });
  await page.waitForTimeout(250); await shot('trees');
  await dbg('tp', movementPatch);
  await page.waitForFunction((p) => Math.hypot(window.app.game.pred.x - p.x, window.app.game.pred.y - p.y) < 5, movementPatch);
  if (!(await read()).locked) {
    await page.locator('#game').click({ position: { x: 640, y: 360 } });
    await wait(() => window.app.game.input.locked);
  }
  await page.keyboard.press('g'); await wait(() => window.app.game.me.sel === 'grenade');
  await page.waitForTimeout(600); // let the equip animation complete before throwing
  const smokeCount = await page.evaluate(() => window.app.game.me.gr[2]);
  await page.mouse.down(); await page.waitForTimeout(100); await page.mouse.up();
  await wait(() => window.app.game.ents.sm.length > 0);
  await page.waitForTimeout(1400);
  check('Thrown smoke grenade creates a fading cloud', await page.evaluate((smokeCount) => {
    const g = window.app.game, cloud = g.renderer.smoke;
    return g.me.gr[2] < smokeCount && cloud.count > 0 && cloud.geometry.attributes.particleOpacity.array[0] > 0 && cloud.material.map && !cloud.material.depthWrite;
  }, smokeCount));
  // Frame the surroundings for visual inspection after the native mouse-look checks.
  await page.evaluate(() => { window.app.game.pitch = -0.14; });
  await page.waitForTimeout(150);
  await shot('smoke');
  await page.keyboard.press('1'); await wait(() => window.app.game.me.sel === 'primary');
  await page.evaluate(() => { const g = window.app.game; g.fx.explosion(g.me.x + 90, g.me.y, 100); });
  await page.waitForTimeout(150);
  check('Explosion fire and dust render with soft particles', await page.evaluate(() => window.app.game.renderer.fx3d.puffs.count > 0 && window.app.game.renderer.fx3d.fires.count > 0));
  await shot('explosion');
  const rebuilt = await page.evaluate(() => {
    const g = window.app.game, i = g.map.chars.findIndex((ch, i) => ch === 'B' && Math.hypot((i % g.map.w) * 32 - g.me.x, Math.floor(i / g.map.w) * 32 - g.me.y) < 500);
    if (i < 0) return false;
    g.map.setTile(i % g.map.w, Math.floor(i / g.map.w), 'r');
    return !g.renderer.blocks.slot.has(i) && g.map.chars[i] === 'r';
  });
  check('Destroyed wall updates the rendered cover', rebuilt);
  check('Destroyed supports remove the rendered roof', await page.evaluate(() => {
    const g = window.app.game, b = g.map.buildings.find((b) => b.active);
    for (const i of b.supports.slice(0, Math.ceil(b.supports.length * .31))) g.map.setTile(i % g.map.w, Math.floor(i / g.map.w), 'r');
    return !b.active && !g.renderer.buildings.entries.find((e) => e.b === b).group.visible;
  }));
  await page.waitForTimeout(1600);
  await shot('effects');
  const fps = (await read()).fps;
  check('Gameplay frame rate is playable on the test machine', fps >= 30, `${fps} fps`);
  await dbg('kill');
  await wait(() => !window.app.game.alive);
  await page.waitForSelector('#dpGo');
  await wait(() => window.app.game.respawnIn <= 0, 12000);
  await page.click('#dpGo'); await wait(() => window.app.game.alive);
  check('Death and redeploy complete', (await read()).me.hp === 100);
  // Check the other large maps/modes with the same real client and asset pipeline.
  await page.evaluate(() => window.app.leaveRoom());
  for (const [map, mode] of [['harbor', 'rush'], ['dunes', 'conquest'], ['pit', 'tdm']]) {
    await page.evaluate(([map, mode]) => window.app.net.send({ t: 'create', name: 'FieldQA', autostart: true, settings: { map, mode, teamSize: 3, bots: true, vehicles: true } }), [map, mode]);
    await page.waitForSelector('#dpGo'); await page.click('#dpGo');
    await wait(() => window.app.game.alive);
    await page.waitForTimeout(1700);
    check(`${map} / ${mode} deploy and render`, await page.evaluate(([map, mode]) => window.app.game.map.id === map && window.app.game.mode === mode, [map, mode]));
    await shot(map + '-' + mode);
    await page.evaluate(() => window.app.leaveRoom());
  }
  const realErrors = errors.filter((e) => !/GL Driver|swiftshader|ReadPixels/i.test(e));
  check('No browser runtime, asset or WebGL errors', realErrors.length === 0, realErrors.join('\n'));
  const report = { passed: cases.length, cases, assets, fps, errors: realErrors, viewport: '1280×720, 900×600, 1920×1080', browser: 'Chrome', date: new Date().toISOString() };
  await writeFile(new URL('browser-results.json', out), JSON.stringify(report, null, 2));
  console.log(`Browser UX: ${cases.length} checks passed`);
} catch (error) {
  if (page) { await shot('failure').catch(() => {}); console.error('STATE', JSON.stringify(await read().catch(() => null))); }
  console.error(error);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill();
}
