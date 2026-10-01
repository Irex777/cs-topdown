import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { launch } from './browser.mjs';
const root = fileURLToPath(new URL('../', import.meta.url)), port = 4918;
const server = spawn(process.execPath, ['src/server/index.js'], { cwd: root, env: { ...process.env, HOST: '127.0.0.1', PORT: String(port), CS_DEBUG: '1' }, stdio: ['ignore', 'pipe', 'inherit'] });
let browser; const results = [];
const check = (name, ok, details = '') => { assert.ok(ok, name + ' ' + JSON.stringify(details)); results.push({ name, details }); console.log('ok', name, details); };
try {
  await new Promise((resolve, reject) => { const timer = setTimeout(() => reject(Error('server timeout')), 10000); server.stdout.on('data', (d) => { if (String(d).includes('ready')) { clearTimeout(timer); resolve(); } }); });
  const session = await launch({ w: 1453, h: 850 }); browser = session.browser; const page = session.page;
  await page.addInitScript(() => { localStorage.setItem('fl.q', '2'); localStorage.setItem('fl.qm', '1'); });
  await page.goto(`http://127.0.0.1:${port}/bf/`); await page.waitForFunction(() => window.app?.net.open);
  await page.evaluate(async () => { await (await import('./js/game/assets.js')).loadAssets(); window.app.net.send({ t: 'create', name: 'PhysicsQA', autostart: true, settings: { map: 'riverside', mode: 'conquest', teamSize: 2, bots: false, vehicles: true } }); });
  await page.waitForSelector('#dpGo'); await page.click('#dpGo'); await page.waitForFunction(() => window.app.game.alive);
  await page.evaluate(() => window.app.net.send({ t: 'dbg', cmd: 'god' }));
  const dbg = (cmd, more) => page.evaluate(([cmd, more]) => window.app.net.send({ t: 'dbg', cmd, ...more }), [cmd, more]);
  await page.locator('#game').click({ position: { x: 726, y: 425 } }); await page.waitForFunction(() => window.app.game.input.locked);
  const audio = await page.evaluate(async () => { const { audio } = await import('./js/battlefield-audio.js'); audio.unlock(); await audio.loading; return { samples: [...audio.buffers.values()].reduce((n, a) => n + a.length, 0), errors: audio.loadErrors, state: audio.ctx.state }; });
  check('All recorded sounds decode after native input', audio.samples === 58 && !audio.errors.length && audio.state === 'running', audio);
  const prop = await page.evaluate(() => {
    const g = window.app.game, m = g.map;
    for (let y = 6; y < m.h - 6; y++) for (let x = 6; x < m.w - 6; x++) if (m.charAt(x, y) === 'X') {
      const cx = (x + .5) * 32, cy = (y + .5) * 32;
      if (g.vehiclesDrawn().some((v) => Math.hypot(v.x - cx, v.y - cy) < 150)) continue;
      for (const angle of [0, Math.PI / 2, Math.PI, -Math.PI / 2]) {
        const px = cx - Math.cos(angle) * 40, py = cy - Math.sin(angle) * 40;
        if (!m.isBlockedAt(px, py) && m.clearLineR(px - Math.cos(angle) * 15, py - Math.sin(angle) * 15, px, py, 11, m.blockFoot)) return { x: px, y: py, cx, cy, angle };
      }
    }
  }); check('Reachable crate exists', !!prop);
  await dbg('tp', prop); await page.waitForTimeout(500); await page.evaluate((p) => { window.app.game.yaw = p.angle; window.app.game.pitch = -.1; }, prop);
  await page.keyboard.down('e'); await page.waitForTimeout(200); await page.keyboard.up('e'); await page.waitForFunction(() => window.app.game.me.hb);
  check('Native E grabs a crate', await page.evaluate(() => !!window.app.game.me.hb));
  await page.waitForTimeout(500);
  check('Held crate uses the Blender mesh', await page.evaluate(() => window.app.game.renderer.rigids.objects.has(window.app.game.me.hb)));
  await page.screenshot({ path: root + 'output/qa/physics-carry.png' });
  const heldId = await page.evaluate(() => window.app.game.me.hb), beforeThrowClip = await page.evaluate(() => window.app.game.me.clip);
  await page.mouse.down(); await page.waitForFunction(() => !window.app.game.me.hb);
  const thrown = await page.evaluate((id) => window.app.game.ents.rb.find((t) => t[0] === id), heldId);
  check('Native fire throws instead of leaving the prop held', !!thrown && Math.hypot(...thrown.slice(12, 15)) > 35, thrown?.slice(12, 15));
  await page.waitForTimeout(350); await page.mouse.up(); await page.waitForTimeout(100);
  check('Holding the throw click does not also fire the rifle', await page.evaluate((clip) => window.app.game.me.clip === clip && !window.app.game.shots.fired.length, beforeThrowClip));
  await page.waitForTimeout(1000);
  const building = await page.evaluate(() => window.app.game.map.buildings.find((b) => b.active && b.storeys >= 2));
  await dbg('tp', { x: building.x0 - 90, y: building.y0 - 90 }); await page.waitForTimeout(350);
  await page.evaluate((b) => { const g = window.app.game; g.yaw = Math.atan2((b.y0 + b.y1) / 2 - g.pred.y, (b.x0 + b.x1) / 2 - g.pred.x); g.pitch = .04; }, building);
  await dbg('boom', { x: building.x0 + 20, y: building.y0 + 20, r: 240, tile: 2500 });
  await page.waitForFunction((id) => window.app.game.map.buildings.find((b) => b.id === id)?.collapsed, building.id);
  await page.waitForTimeout(1000);
  const destruction = await page.evaluate(() => { const g = window.app.game; return { bodies: g.ents.rb.length, panels: g.ents.rb.filter((t) => t[1] === 'R').length, colliderCount: g.map.dynamicBodies.length, instances: [...g.renderer.rigids.batches.values()].reduce((n, b) => n + b.count, 0), finite: g.ents.rb.every((t) => t.slice(2, 15).every(Number.isFinite)), fps: g.stats.fps }; });
  check('Explosion creates physical fragments and roof panels', destruction.bodies > 10 && destruction.panels > 0, destruction);
  check('Physical rubble reaches collision and instanced rendering', destruction.colliderCount > 10 && destruction.instances > 10 && destruction.finite);
  await page.screenshot({ path: root + 'output/qa/physics-collapse.png' });
  await page.waitForTimeout(4000); check('Destruction remains playable', await page.evaluate(() => window.app.game.stats.fps >= 35));
  // Render the actual new mixer offline to a measurable and reviewable stereo reel.
  const reel = await page.evaluate(async () => {
    const { audio } = await import('./js/battlefield-audio.js'); const original = audio.ctx, master = audio.master, verb = audio.reverb;
    window.app.game.stop(); audio.worldActive = true; const ctx = new window.OfflineAudioContext(2, 44100 * 8, 44100); audio.ctx = ctx; audio.master = ctx.createGain(); audio.master.gain.value = .7;
    const limiter = ctx.createDynamicsCompressor(); limiter.threshold.value = -12; limiter.ratio.value = 8; audio.master.connect(limiter); limiter.connect(ctx.destination); audio.reverb = ctx.createGain(); audio.reverb.gain.value = .1; audio.reverb.connect(audio.master);
    const ready = audio.ready; audio.ready = () => true; audio.setListener(0, 0, 0, 26, null);
    audio.play('rifle', null, .8, 1, 4000, 0); audio.play('reload', null, .45, 1, 4000, 1); audio.play('footstep_concrete', null, .3, 1, 1000, 2.5);
    audio.play('impactGlass_heavy', { x: 0, y: 100, z: 26 }, .7, 1, 4000, 3.2); audio.play('cannon', { x: 160, y: 0, z: 26 }, .9, .85, 4000, 4);
    audio.play('explosion', { x: 300, y: -100, z: 0 }, 1.1, .7, 6000, 5); audio.play('impactMining', { x: 100, y: 0, z: 30 }, .7, .75, 4000, 6.3);
    const rendered = await ctx.startRendering(), left = rendered.getChannelData(0), right = rendered.getChannelData(1);
    let peak = 0, power = 0, stereo = 0; const pcm = new Uint8Array(left.length * 4); const view = new DataView(pcm.buffer);
    for (let i = 0; i < left.length; i++) { peak = Math.max(peak, Math.abs(left[i]), Math.abs(right[i])); power += left[i] ** 2 + right[i] ** 2; stereo += Math.abs(left[i] - right[i]); view.setInt16(i * 4, Math.round(Math.max(-1, Math.min(1, left[i])) * 32767), true); view.setInt16(i * 4 + 2, Math.round(Math.max(-1, Math.min(1, right[i])) * 32767), true); }
    audio.ctx = original; audio.master = master; audio.reverb = verb; audio.ready = ready; audio.stopWorld();
    return { peak, rms: Math.sqrt(power / left.length / 2), stereo: stereo / left.length, pcm: Array.from(pcm) };
  });
  check('Recorded mixer produces finite stereo audio without clipping', reel.peak > .05 && reel.peak < 1 && reel.rms > .01 && reel.stereo > .0001, { peak: reel.peak, rms: reel.rms, stereo: reel.stereo });
  const pcm = Buffer.from(reel.pcm), header = Buffer.alloc(44); header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8); header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(2, 22); header.writeUInt32LE(44100, 24); header.writeUInt32LE(176400, 28); header.writeUInt16LE(4, 32); header.writeUInt16LE(16, 34); header.write('data', 36); header.writeUInt32LE(pcm.length, 40); await writeFile(root + 'output/qa/battlefield-audio-reel.wav', Buffer.concat([header, pcm]));
  check('Audio voices and loops clean up on match exit', await page.evaluate(async () => { const { audio } = await import('./js/battlefield-audio.js'); audio.stopWorld(); await new Promise((r) => setTimeout(r, 100)); return !audio.loops.size && !audio.voices.size; }));
  check('No browser runtime errors', !session.errors.length, session.errors);
  await writeFile(root + 'output/qa/physics-browser-results.json', JSON.stringify(results, null, 2)); console.log(results.length, 'physics/audio browser checks passed');
} finally { if (browser) await browser.close(); server.kill('SIGTERM'); }
