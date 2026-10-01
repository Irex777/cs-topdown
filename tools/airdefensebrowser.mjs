// Actual equipped sight models, native ADS input, and a second player piloting the AA target.
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { WebSocket } from 'ws';
import { WEAPONS, attachOptions } from '../src/shared/weapons.js';
import { launch } from './browser.mjs';
const root = fileURLToPath(new URL('../', import.meta.url)), out = root + 'output/qa/', port = 4961;
const server = spawn(process.execPath, ['src/server/index.js'], { cwd: root, env: { ...process.env, PORT: String(port), HOST: '127.0.0.1', CS_DEBUG: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
let browser, page, ws, last; const cases = [], messages = [];
const check = (name, value, detail = '') => { assert.ok(value, name + ': ' + detail); cases.push({ name, detail }); console.log('ok', name, detail); };
const pause = (ms) => new Promise((r) => setTimeout(r, ms));
const until = async (fn) => { const start = Date.now(); while (!fn()) { assert.ok(Date.now() - start < 12000, 'WS fixture timeout'); await pause(20); } };
const wait = (fn) => page.waitForFunction(fn, null, { timeout: 12000 });
const dbg = (cmd, extra = {}) => page.evaluate(([cmd, extra]) => window.app.net.send({ t: 'dbg', cmd, ...extra }), [cmd, extra]);
const send = (m) => ws.send(JSON.stringify(m));
const makeKit = async (id, optic = 'iron', stinger = false) => page.evaluate(async ([id, optic, stinger]) => {
  const { defaultLoadout } = await import('./shared/weapons.js');
  const cls = { vx9: 'engineer', mg60: 'support', dmr14: 'recon', sr50: 'recon' }[id] || (stinger ? 'engineer' : 'assault');
  const lo = defaultLoadout(cls), slot = id === 'p18' ? 'secondary' : 'primary';
  lo[slot] = { id, att: { optic, barrel: 'none', under: 'none', mag: 'std' } };
  if (stinger) lo.gadgets[1] = 'stinger';
  const d = window.app.hud.deploy; d.lo = lo; d.save(); d.renderKit(); d.selectSpawn(window.app.game.spawnOpts.find((o) => o.k === 'base'));
}, [id, optic, stinger]);
const deploy = async () => { await page.click('#dpGo'); await wait(() => window.app.game.alive && !window.app.hud.deploy.open); await dbg('god'); await page.waitForTimeout(200); if (!await page.evaluate(() => window.app.game.input.locked)) await page.locator('#game').click({ position: { x: 640, y: 360 } }); };
const restart = async () => {
  await page.mouse.up({ button: 'right' });
  await page.evaluate(() => { window.app.game.input.releaseLock(); window.app.net.send({ t: 'lobby' }); });
  await wait(() => window.app.room?.state === 'lobby'); await page.evaluate(() => window.app.net.send({ t: 'start' }));
  await page.waitForSelector('#dpGo'); await wait(() => !document.querySelector('#dpGo').disabled);
};
const sight = () => page.evaluate(async () => {
  const THREE = await import('./vendor/three/three.module.js'), g = window.app.game, vm = g.renderer.viewmodel;
  vm.scene.updateMatrixWorld(true); vm.camera.updateMatrixWorld(true);
  const ray = new THREE.Raycaster(), blockers = [];
  const visible = (o) => { while (o) { if (!o.visible) return false; o = o.parent; } return true; };
  const optic = g.heldWeapon(g.me)?.att?.optic;
  const samples = optic === 'iron' ? [[0, 0], [-3, -3], [3, -3], [0, -5]] : [[0, 0], [-5, -5], [5, -5], [0, -10]];
  for (const [x, y] of samples) {
    ray.setFromCamera(new THREE.Vector2(x / 640, -y / 360), vm.camera);
    const hits = ray.intersectObjects(vm.scene.children, true).filter((h) => visible(h.object) && !h.object.isSprite);
    const opaque = hits.find((h) => { const m = Array.isArray(h.object.material) ? h.object.material[h.face.materialIndex] : h.object.material; return m.opacity >= .9 && !(m.emissive?.r > .2); });
    if (opaque) blockers.push({ x, y, node: opaque.object.name });
  }
  const point = vm.meta?.adsV?.clone();
  if (point) { vm.model.localToWorld(point); point.project(vm.camera); }
  return { key: vm.key, ads: vm.ads, glb: !!vm.meta?.glb, visible: vm.visible, blockers, sightPixels: point ? [point.x * 640, -point.y * 360] : null, scoped: g.viewer().scoped, fps: g.stats.fps };
});
try {
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(new Error('startup timeout')), 10000); server.stdout.on('data', (d) => { if (String(d).includes('ready')) { clearTimeout(timer); resolve(); } }); });
  const session = await launch(); browser = session.browser; page = session.page;
  await page.addInitScript(() => { localStorage.setItem('fl.q', '2'); localStorage.setItem('fl.qm', '1'); });
  await page.goto(`http://127.0.0.1:${port}/bf/`); await wait(() => window.app?.net.open);
  await page.evaluate(async () => { const a = await (await import('./js/game/assets.js')).loadAssets(); window.__assets = a; window.app.net.send({ t: 'create', name: 'SightQA', autostart: true, settings: { map: 'riverside', mode: 'conquest', teamSize: 2, bots: false, vehicles: true } }); });
  await page.waitForSelector('#dpGo'); await wait(() => !document.querySelector('#dpGo').disabled);
  check('New Stinger and rebuilt sight assets load', await page.evaluate(() => !!window.__assets.weapons.stinger && !window.__assets.failed));
  const pairs = [];
  for (const id of ['ar7', 'br12', 'vx9', 'sg4', 'mg60', 'dmr14', 'p18']) for (const optic of attachOptions(WEAPONS[id], 'optic').filter((o) => ['iron', 'reddot', 'holo', 'acog'].includes(o))) pairs.push([id, optic]);
  pairs.push(['sr50', 'sniper']);
  for (let i = 0; i < pairs.length; i++) {
    if (i) await restart();
    const [id, optic] = pairs[i]; await makeKit(id, optic); await deploy();
    if (id === 'p18') await page.keyboard.press('2');
    await page.mouse.down({ button: 'right' });
    await wait(() => window.app.game.renderer.viewmodel.ads > .997 && window.app.game.renderer.viewmodel.draw === 0);
    const s = await sight();
    check(id + ' / ' + optic + ' equips and aims with native RMB', s.glb && s.scoped && s.key.includes(id));
    if (!['acog', 'sniper'].includes(optic)) {
      check(id + ' / ' + optic + ' leaves the center sight line open', !s.blockers.length, JSON.stringify(s));
      check(id + ' / ' + optic + ' aligns the model sight with the shot direction', Math.hypot(...s.sightPixels) < 1.5, JSON.stringify(s.sightPixels));
      if (['reddot', 'holo'].includes(optic)) {
        const dot = await page.evaluate(() => { const r = window.app.game.renderer, c = document.createElement('canvas'); c.width = c.height = 1; const ctx = c.getContext('2d', { willReadFrequently: true }); ctx.drawImage(r.ctx.canvas, Math.round(r.W * r.dpr / 2), Math.round(r.H * r.dpr / 2), 1, 1, 0, 0, 1, 1); return [...ctx.getImageData(0, 0, 1, 1).data]; });
        check(id + ' / ' + optic + ' renders a visible centered reticle', dot[0] > 180 && dot[1] < 130 && dot[2] < 130, JSON.stringify(dot));
      }
      const ammo = await page.evaluate(() => window.app.game.me.clip);
      await page.mouse.down(); await page.waitForTimeout(150); await page.mouse.up();
      await page.waitForFunction((ammo) => window.app.game.me.clip < ammo, ammo);
      check(id + ' / ' + optic + ' fires while aiming down sights', await page.evaluate(() => window.app.game.viewer().scoped));
      await page.waitForTimeout(300);
      await page.keyboard.down('d'); await page.waitForTimeout(250); await page.keyboard.up('d');
      const moving = await sight(); check(id + ' / ' + optic + ' retains its sight axis while strafing', Math.hypot(...moving.sightPixels) < 2);
    } else check(id + ' / ' + optic + ' has an unobstructed magnified view', !s.visible);
    if (['ar7', 'mg60', 'p18', 'sr50'].includes(id)) await page.screenshot({ path: out + `ads-${id}-${optic}.png` });
    await page.mouse.up({ button: 'right' });
  }
  await restart(); await makeKit('vx9', 'iron', true); await deploy(); await page.keyboard.press('4'); await wait(() => window.app.game.me.sel === 'gadget1');
  ws = new WebSocket(`ws://127.0.0.1:${port}/bf/ws`); ws.on('message', (d) => { const m = JSON.parse(d); if (m.t === 's') last = m; else messages.push(m); });
  await new Promise((r) => ws.on('open', r)); send({ t: 'hello', name: 'HeliPilot' }); await until(() => messages.some((m) => m.t === 'welcome'));
  send({ t: 'join', code: await page.evaluate(() => window.app.room.code), name: 'HeliPilot' }); await until(() => messages.some((m) => m.t === 'room'));
  send({ t: 'team', team: 1 }); await until(() => last && last.rsp === 0); send({ t: 'a', a: 'deploy', k: 'base', id: 0 }); await until(() => last?.al === 1);
  send({ t: 'dbg', cmd: 'enter', type: 'heli', seat: 0 }); await until(() => last?.me?.veh?.seat === 0);
  const origin = { x: 45.5 * 32, y: 56.5 * 32 }; await dbg('tp', origin); send({ t: 'dbg', cmd: 'vehiclePose', x: origin.x + 1000, y: origin.y, angle: 0, z: 550 }); await pause(250);
  await page.evaluate((v) => { const g = window.app.game; g.yaw = Math.atan2(v.y - g.me.y, v.x - g.me.x); g.pitch = Math.atan2(v.z + 26 - g.viewer().eye, Math.hypot(v.x - g.me.x, v.y - g.me.y)); }, last.me.veh);
  await page.mouse.down(); await page.waitForTimeout(180); await page.mouse.up(); check('Stinger cannot waste a round without lock', await page.evaluate(() => window.app.game.me.clip === 1));
  await page.mouse.down({ button: 'right' }); await wait(() => window.app.game.me.lk?.[1] >= 1);
  check('Native RMB acquires an elevated enemy helicopter', await page.evaluate(() => window.app.game.renderer.viewmodel.key.includes('stinger')));
  await until(() => last?.me?.veh?.threat === 'locking'); check('Pilot receives seeker warning', last.me.veh.threat === 'locking');
  await page.screenshot({ path: out + 'stinger-locked.png' });
  await page.mouse.down(); await page.waitForTimeout(80); await page.mouse.up(); await until(() => last?.me?.veh?.threat === 'incoming');
  check('Native LMB launches a guided missile and warns the pilot', await page.evaluate(() => window.app.game.me.clip === 0));
  send({ t: 'a', a: 'flares' }); await until(() => last?.me?.veh?.flares?.[0] === 3); await wait(() => (window.app.game.ents.cf || []).length === 6);
  check('Pilot flare action creates visible countermeasures and clears incoming warning', last.me.veh.threat === '');
  await page.waitForTimeout(250); await page.screenshot({ path: out + 'stinger-flare-decoys.png' });
  check('Flare particles render in world space', await page.evaluate(() => window.app.game.fx.flares.length === 6 && window.app.game.renderer.fx3d.sprites.filter((s) => s.visible).length >= 6));
  const hp = last.me.veh.hp; await page.waitForTimeout(4200); check('Countermeasures divert the missile and helicopter survives', last.me.veh.hp === hp);
  await page.mouse.up({ button: 'right' });
  await dbg('enter', { type: 'heli', seat: 0 }); await wait(() => window.app.game.me.veh?.seat === 0);
  await page.keyboard.press('z'); await wait(() => window.app.game.me.veh.flares?.[0] === 3);
  check('Pilot native Z input releases flares', await page.evaluate(() => document.querySelector('#vehbox').textContent.includes('Flares')));
  await page.keyboard.press('z'); await page.waitForTimeout(150); check('Native repeated Z respects cooldown', await page.evaluate(() => window.app.game.me.veh.flares[0] === 3));
  const errors = session.errors.filter((e) => !/GL Driver|swiftshader|ReadPixels/i.test(e)); check('No sight or anti-air browser runtime errors', !errors.length, errors.join('\n'));
  await writeFile(out + 'air-defense-browser-results.json', JSON.stringify({ passed: cases.length, cases, errors, date: new Date().toISOString() }, null, 2));
  console.log(cases.length, 'sight and anti-air browser checks passed');
} catch (e) { console.error(e); if (page) { await page.screenshot({ path: out + 'air-defense-failure.png' }).catch(() => {}); console.error('SIGHT', JSON.stringify(await sight().catch(() => null))); console.error('STATE', JSON.stringify(await page.evaluate(() => window.app.game.me).catch(() => null))); } process.exitCode = 1; }
finally { if (ws) ws.close(); if (browser) await browser.close(); server.kill(); }
