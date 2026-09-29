// Main-menu key art: a voxel city in ruins at golden hour with a helicopter, tanks, soldiers, smoke and embers.
import * as THREE from '../../vendor/three/three.module.js';
import { VoxelModel } from '../game/voxel.js';
import { voxelGeometry, VOXEL_MAT, soldierGeo, vehicleGeo } from '../game/models3d.js';
import { Sky, MOODS } from '../game/sky.js';

const rng = (seed) => () => { seed = (seed + 0x6d2b79f5) | 0; let t = Math.imul(seed ^ (seed >>> 15), 1 | seed); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };

/** a broken concrete building: floors, window bands, columns, ragged top */
function ruinModel(seed, w, d, h, u) {
  const m = new VoxelModel(u), r = rng(seed);
  const walls = ['#b9a68b', '#ad9a80', '#a08d74', '#c2b298'], brick = ['#9c5540', '#8a4a37'], dark = '#241f1c';
  const brickB = r() < 0.4;
  const cutBase = h * (0.55 + r() * 0.35);
  for (let x = 0; x < w; x++) for (let y = 0; y < d; y++) {
    const edge = x === 0 || y === 0 || x === w - 1 || y === d - 1;
    const colTop = cutBase + Math.sin(x * 0.8 + seed) * 3 + Math.cos(y * 0.6 + seed * 2) * 3 - (r() < 0.12 ? 8 : 0);
    for (let z = 0; z < h; z++) {
      if (z > colTop) continue;
      const floor = z % 7 === 0;
      const palette = brickB ? brick : walls;
      const col = palette[(x * 3 + y * 5 + z) % palette.length];
      if (floor) { if (r() < 0.86) m.box(x, y, z, x + 1, y + 1, z + 1, '#8f8072'); continue; }
      if (edge) {
        const band = z % 7;
        const win = band >= 3 && band <= 5 && ((edge && (x === 0 || x === w - 1) ? y : x) % 4) < 2 && z > 6;
        if (win) { if (r() < 0.5) m.box(x, y, z, x + 1, y + 1, z + 1, dark); continue; }
        m.box(x, y, z, x + 1, y + 1, z + 1, col);
      } else if (x % 6 === 3 && y % 6 === 3) m.box(x, y, z, x + 1, y + 1, z + 1, '#9a8f84');
    }
  }
  // rebar sticking out of the broken top
  for (let i = 0; i < 6; i++) { const x = 1 + Math.floor(r() * (w - 2)), y = 1 + Math.floor(r() * (d - 2)); const z0 = Math.floor(cutBase); m.box(x, y, z0, x + 1, y + 1, z0 + 3 + Math.floor(r() * 4), '#3b3a3d'); }
  return m;
}

const cloudTexture = () => {
  const c = document.createElement('canvas'); c.width = 96; c.height = 14;
  const x = c.getContext('2d'), r = rng(9);
  x.clearRect(0, 0, 96, 14);
  for (let i = 0; i < 46; i++) { const cx = Math.floor(r() * 90), cy = 3 + Math.floor(r() * 8), w = 6 + Math.floor(r() * 22), h = 1 + Math.floor(r() * 3); x.fillStyle = `rgba(255,${210 + Math.floor(r() * 40)},${170 + Math.floor(r() * 50)},${0.35 + r() * 0.5})`; x.fillRect(cx, cy, w, h); }
  const t = new THREE.CanvasTexture(c); t.magFilter = THREE.NearestFilter; t.minFilter = THREE.NearestFilter; t.colorSpace = THREE.SRGBColorSpace;
  return t;
};

export class MenuScene {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.scene = new THREE.Scene();
    const m = MOODS.sunset;
    this.scene.fog = new THREE.Fog(new THREE.Color('#c98266'), 380, 3300);
    this.scene.background = new THREE.Color('#c98266');
    this.camera = new THREE.PerspectiveCamera(46, 1, 1, 6000);
    this.sky = new Sky(this.scene); this.sky.set({ ...m, sunDir: [-0.9, 0.16, -0.62] });
    this.hemi = new THREE.HemisphereLight(0xffd9bd, 0x6b5b55, 1.7); this.scene.add(this.hemi);
    this.sun = new THREE.DirectionalLight(0xffa964, 3.6); this.sun.position.set(-900, 220, -620); this.scene.add(this.sun);
    this.fireLight = new THREE.PointLight(0xff7a2a, 900, 380, 1.6); this.fireLight.position.set(-170, 26, -140); this.scene.add(this.fireLight);
    this.t = 0; this.raf = 0; this.mouse = { x: 0, y: 0 }; this.smooth = { x: 0, y: 0 };
    this.build();
    this.resize();
    this.onResize = () => this.resize();
    window.addEventListener('resize', this.onResize);
    this.onMove = (e) => { this.mouse.x = e.clientX / window.innerWidth - 0.5; this.mouse.y = e.clientY / window.innerHeight - 0.5; };
    window.addEventListener('mousemove', this.onMove);
    this.last = 0;
  }

  mesh(geo, x, y, z, ry = 0, s = 1) { const m = new THREE.Mesh(geo, VOXEL_MAT); m.position.set(x, y, z); m.rotation.y = ry; m.scale.setScalar(s); this.scene.add(m); return m; }

  build() {
    const S = this.scene, r = rng(7);
    // ground: a wide dusty plane with rubble
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(9000, 9000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x6e5a4c }));
    ground.position.y = -0.5; S.add(ground);
    // road strip toward the horizon
    const road = new THREE.Mesh(new THREE.PlaneGeometry(90, 4000).rotateX(-Math.PI / 2), new THREE.MeshLambertMaterial({ color: 0x4d4642 }));
    road.position.set(30, 0, -1900); S.add(road);
    const dash = new THREE.InstancedMesh(new THREE.BoxGeometry(2, 0.3, 14), new THREE.MeshBasicMaterial({ color: 0xc9b98c }), 60);
    const dm = new THREE.Matrix4(); for (let i = 0; i < 60; i++) { dm.makeTranslation(30, 0.2, 60 - i * 34); dash.setMatrixAt(i, dm); } S.add(dash);

    // skyline of ruins: far ones are big and hazy, near ones frame the shot
    const specs = [];
    for (let i = 0; i < 26; i++) {
      const side = i % 2 ? 1 : -1;
      const row = Math.floor(i / 2);
      specs.push({ x: side * (190 + r() * 330) + (side > 0 ? 40 : 0), z: -250 - row * 130 - r() * 60, w: 12 + Math.floor(r() * 10), d: 12 + Math.floor(r() * 10), h: 26 + Math.floor(r() * 40), seed: 100 + i, u: 6 });
    }
    specs.push({ x: -60, z: -900, w: 26, d: 20, h: 90, seed: 400, u: 6 }, { x: 260, z: -1000, w: 30, d: 22, h: 110, seed: 401, u: 6 }, { x: -320, z: -1100, w: 34, d: 24, h: 100, seed: 402, u: 6 }, { x: 60, z: -1250, w: 28, d: 28, h: 130, seed: 403, u: 6 });
    for (const sp of specs) {
      const g = voxelGeometry(ruinModel(sp.seed, sp.w, sp.d, sp.h, sp.u));
      g.translate(-sp.w * sp.u / 2, 0, -sp.d * sp.u / 2);
      this.mesh(g, sp.x, 0, sp.z, r() * 3.14);
    }
    // rubble piles
    const rub = new VoxelModel(3), rr = rng(21);
    for (let i = 0; i < 260; i++) { const x = Math.floor((rr() - 0.5) * 22), y = Math.floor((rr() - 0.5) * 22), hgt = Math.max(0, 5 - Math.floor(Math.hypot(x, y) * 0.5)); for (let z = 0; z <= hgt; z++) if (rr() < 0.8) rub.box(x, y, z, x + 1, y + 1, z + 1, ['#8d7f70', '#a08d74', '#7b6d60', '#9c5540', '#4a4541'][Math.floor(rr() * 5)]); }
    const rubGeo = voxelGeometry(rub);
    for (const [x, z, s] of [[-120, 30, 0.9], [130, 20, 0.8], [-50, -60, 1.1], [170, -90, 1.2], [-200, -90, 1.4], [40, -160, 1.3], [-15, 20, 0.45], [95, 50, 0.5]]) this.mesh(rubGeo, x, 0, z, rr() * 6, s);

    // foreground: three soldiers seen from behind, looking at the city
    const facing = [-Math.PI / 2 + 0.55, -Math.PI / 2 + 0.1, -Math.PI / 2 - 0.5];
    const cls = ['assault', 'support', 'recon'], kinds = ['rifle', 'lmg', 'sniper'];
    [[-10, 30], [18, 42], [46, 28]].forEach(([x, z], i) => {
      const s = this.mesh(soldierGeo(1, cls[i], kinds[i], 0), x, i === 1 ? 2 : 0, z, -facing[i], 1.08);
      s.userData.base = s.position.y; this.soldiers = (this.soldiers || []).concat(s);
    });
    // a low sandbag/concrete wall
    const wall = new VoxelModel(3);
    for (let x = 0; x < 34; x++) for (let z = 0; z < 4; z++) if (rr() < 0.94) wall.box(x, 0, z, x + 1, 3, z + 1, ['#8f8578', '#a49a8c', '#7d7468'][(x + z) % 3]);
    const wg = voxelGeometry(wall); wg.translate(-51, 0, 0);
    this.mesh(wg, 20, 0, 14, 0.08, 0.8);

    // vehicles: a friendly tank on the right, a burning enemy tank on the left, a helicopter overhead
    const tank = new THREE.Group(); tank.position.set(215, 0, -120); tank.rotation.y = Math.PI * 0.9; tank.scale.setScalar(1.5); S.add(tank);
    for (const p of ['body', 'turret', 'gun']) tank.add(new THREE.Mesh(vehicleGeo('tank', 1, p), VOXEL_MAT));
    const wreck = new THREE.Group(); wreck.position.set(-170, 0, -150); wreck.rotation.y = 0.5; wreck.scale.setScalar(1.6); S.add(wreck);
    for (const p of ['body', 'turret']) { const mm = new THREE.Mesh(vehicleGeo('tank', 0, p), VOXEL_MAT); wreck.add(mm); if (p === 'turret') mm.rotation.y = 0.9; }
    this.heli = new THREE.Group(); S.add(this.heli);
    this.heliBody = new THREE.Mesh(vehicleGeo('heli', 1, 'body'), VOXEL_MAT); this.heli.add(this.heliBody);
    this.rotor = new THREE.Mesh(vehicleGeo('heli', 1, 'rotor'), VOXEL_MAT); this.rotor.position.y = 24; this.heli.add(this.rotor);
    this.heli.scale.setScalar(2.3);
    // enemy helicopter in the distance
    this.heli2 = new THREE.Group(); S.add(this.heli2);
    const b2 = new THREE.Mesh(vehicleGeo('heli', 0, 'body'), VOXEL_MAT); this.heli2.add(b2);
    this.rotor2 = new THREE.Mesh(vehicleGeo('heli', 0, 'rotor'), VOXEL_MAT); this.rotor2.position.y = 24; this.heli2.add(this.rotor2);
    this.heli2.scale.setScalar(1.3);

    // blocky clouds catching the sun
    const ct = cloudTexture();
    for (let i = 0; i < 9; i++) {
      const m = new THREE.Mesh(new THREE.PlaneGeometry(1500, 220), new THREE.MeshBasicMaterial({ map: ct, transparent: true, depthWrite: false, fog: false, opacity: 0.85 }));
      m.position.set((i - 4) * 520 + (i % 2) * 130, 480 + (i % 3) * 120, -3000 - (i % 4) * 100);
      m.rotation.x = -0.1; S.add(m);
    }

    // smoke + fire + embers
    this.puffs = []; this.pmax = 260;
    this.smoke = new THREE.InstancedMesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial({ color: 0xffffff }), this.pmax);
    this.smoke.instanceMatrix.setUsage(THREE.DynamicDrawUsage); this.smoke.frustumCulled = false;
    this.smoke.setColorAt(0, new THREE.Color(1, 1, 1)); S.add(this.smoke);
    this.emitters = [
      { x: -170, y: 30, z: -150, rate: 9, size: 9, fire: true }, { x: -420, y: 6, z: -520, rate: 6, size: 16 }, { x: 330, y: 6, z: -700, rate: 5, size: 20 },
      { x: 20, y: 6, z: -380, rate: 4, size: 14 }, { x: -110, y: 6, z: -300, rate: 3, size: 12 },
    ];
    this.emitAcc = this.emitters.map(() => 0);
    this.embers = new THREE.Points(new THREE.BufferGeometry(), new THREE.PointsMaterial({ color: 0xffb060, size: 2.6, sizeAttenuation: true, transparent: true, opacity: 0.9, depthWrite: false, fog: false }));
    const ep = new Float32Array(120 * 3); this.emberSeed = []; for (let i = 0; i < 120; i++) { ep[i * 3] = (r() - 0.5) * 500; ep[i * 3 + 1] = r() * 200; ep[i * 3 + 2] = -r() * 300 + 60; this.emberSeed.push(r()); }
    this.embers.geometry.setAttribute('position', new THREE.BufferAttribute(ep, 3)); S.add(this.embers);
  }

  resize() {
    const w = window.innerWidth, h = window.innerHeight;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 1.5));
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h; this.camera.updateProjectionMatrix();
  }

  start() { if (this.raf) return; this.last = performance.now(); const loop = (now) => { this.raf = requestAnimationFrame(loop); if (now - this.last < 30) return; const dt = Math.min(0.1, (now - this.last) / 1000); this.last = now; this.frame(dt); }; this.raf = requestAnimationFrame(loop); }
  stop() { cancelAnimationFrame(this.raf); this.raf = 0; }

  dispose() {
    this.stop();
    window.removeEventListener('resize', this.onResize); window.removeEventListener('mousemove', this.onMove);
    this.renderer.dispose();
    try { this.renderer.forceContextLoss(); } catch { /* ignore */ }
  }

  frame(dt) {
    this.t += dt;
    const t = this.t;
    this.smooth.x += (this.mouse.x - this.smooth.x) * 0.06; this.smooth.y += (this.mouse.y - this.smooth.y) * 0.06;
    // slow drift of the camera plus a little mouse parallax
    this.camera.position.set(Math.sin(t * 0.09) * 12 + this.smooth.x * 22, 24 + Math.sin(t * 0.13) * 1.2 - this.smooth.y * 6, 130);
    this.camera.lookAt(this.smooth.x * 10, 62 + this.smooth.y * -6, -260);
    // helicopters
    const hx = -380 + ((t * 16 + 200) % 800), hy = 150 + Math.sin(t * 0.7) * 6;
    this.heli.position.set(hx, hy, -330); this.heli.rotation.set(0.04, 0, -0.09 + Math.sin(t * 0.9) * 0.02); this.rotor.rotation.y = t * 24;
    const h2 = 420 - ((t * 6) % 900);
    this.heli2.position.set(h2, 240 + Math.sin(t * 0.5) * 8, -1000); this.heli2.rotation.y = Math.PI; this.rotor2.rotation.y = t * 20;
    // soldiers breathe
    if (this.soldiers) this.soldiers.forEach((s, i) => { s.position.y = s.userData.base + Math.sin(t * 1.4 + i) * 0.25; });
    this.fireLight.intensity = 800 + Math.sin(t * 17) * 90 + Math.sin(t * 9.3) * 70;
    this.updateSmoke(dt);
    // embers drift up and to the right
    const pos = this.embers.geometry.attributes.position;
    for (let i = 0; i < pos.count; i++) { let y = pos.getY(i) + dt * (10 + this.emberSeed[i] * 16); let x = pos.getX(i) + dt * 6; if (y > 210) { y = 0; x = (this.emberSeed[i] - 0.5) * 500; } pos.setY(i, y); pos.setX(i, x + Math.sin(t + i) * 0.05); }
    pos.needsUpdate = true;
    this.renderer.render(this.scene, this.camera);
  }

  updateSmoke(dt) {
    const P = this.puffs, r = Math.random;
    this.emitters.forEach((e, k) => {
      this.emitAcc[k] += dt * e.rate;
      while (this.emitAcc[k] >= 1 && P.length < this.pmax) {
        this.emitAcc[k] -= 1;
        const fire = e.fire && r() < 0.35;
        P.push({ x: e.x + (r() - 0.5) * e.size, y: e.y + r() * 4, z: e.z + (r() - 0.5) * e.size, vx: 4 + r() * 6, vy: (fire ? 22 : 12) + r() * 10, vz: (r() - 0.5) * 3, life: 0, max: fire ? 1.3 : 9 + r() * 5, s0: fire ? e.size * 0.45 : e.size * 0.5, s1: fire ? e.size * 0.15 : e.size * 2.3, fire, rot: r() * 3 });
      }
      if (this.emitAcc[k] > 4) this.emitAcc[k] = 0;
    });
    const m = new THREE.Matrix4(), q = new THREE.Quaternion(), pos = new THREE.Vector3(), sc = new THREE.Vector3(), col = new THREE.Color(), eul = new THREE.Euler();
    let n = 0;
    for (let i = P.length - 1; i >= 0; i--) {
      const p = P[i]; p.life += dt;
      if (p.life >= p.max) { P.splice(i, 1); continue; }
      p.x += p.vx * dt; p.y += p.vy * dt; p.z += p.vz * dt;
    }
    for (const p of P) {
      const k = p.life / p.max, s = p.s0 + (p.s1 - p.s0) * k;
      pos.set(p.x, p.y, p.z); eul.set(p.rot + k, p.rot * 2 + k * 0.6, 0); q.setFromEuler(eul); sc.set(s, s, s);
      m.compose(pos, q, sc); this.smoke.setMatrixAt(n, m);
      if (p.fire) col.setRGB(1, 0.55 - k * 0.35, 0.12 - k * 0.1).multiplyScalar(1.4 - k);
      else col.setRGB(0.12, 0.1, 0.1).lerp(new THREE.Color(0.9, 0.6, 0.45), Math.min(1, k * 1.15));   // dark smoke fades into the sunset haze
      this.smoke.setColorAt(n, col);
      n++;
    }
    this.smoke.count = n;
    this.smoke.instanceMatrix.needsUpdate = true;
    if (this.smoke.instanceColor) this.smoke.instanceColor.needsUpdate = true;
  }
}
