// Draws the effects simulated in fx.js with three.js: instanced cube particles, additive glow sprites, tracer streaks and
// expanding shock rings.
import * as THREE from '../../vendor/three/three.module.js';

const BOX = new THREE.BoxGeometry(1, 1, 1);
const D = new THREE.Object3D();
const C = new THREE.Color();
const colCache = new Map();
function parseCol(str) {
  let c = colCache.get(str);
  if (!c) {
    const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/.exec(str);
    c = m ? new THREE.Color().setRGB(m[1] / 255, m[2] / 255, m[3] / 255, THREE.SRGBColorSpace) : new THREE.Color(str);
    colCache.set(str, c);
  }
  return c;
}

function glowTexture() {
  const c = document.createElement('canvas');
  c.width = c.height = 64;
  const g = c.getContext('2d');
  const gr = g.createRadialGradient(32, 32, 0, 32, 32, 32);
  gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.3, 'rgba(255,230,170,0.7)'); gr.addColorStop(1, 'rgba(255,190,110,0)');
  g.fillStyle = gr; g.fillRect(0, 0, 64, 64);
  const t = new THREE.CanvasTexture(c);
  t.colorSpace = THREE.SRGBColorSpace;
  return t;
}

export class FX3D {
  constructor(scene, fx) {
    this.fx = fx;
    this.group = new THREE.Group();
    scene.add(this.group);
    const mk = (cap, mat) => { const m = new THREE.InstancedMesh(BOX, mat, cap); m.instanceMatrix.setUsage(THREE.DynamicDrawUsage); m.frustumCulled = false; m.count = 0; C.setRGB(1, 1, 1); m.setColorAt(0, C); this.group.add(m); return m; };
    this.cubes = mk(1600, new THREE.MeshLambertMaterial());
    this.cubes.castShadow = true;
    this.fires = mk(1200, new THREE.MeshBasicMaterial());
    this.puffs = mk(900, new THREE.MeshLambertMaterial({ transparent: true, opacity: 0.4, depthWrite: false }));
    this.puffs.renderOrder = 3;
    this.glowTex = glowTexture();
    this.sprites = [];
    this.tracers = [];
    this.rings = [];
    const ringGeo = new THREE.RingGeometry(0.9, 1, 32); ringGeo.rotateX(-Math.PI / 2);
    this.ringGeo = ringGeo;
  }

  sprite(i) {
    let s = this.sprites[i];
    if (!s) {
      s = new THREE.Sprite(new THREE.SpriteMaterial({ map: this.glowTex, blending: THREE.AdditiveBlending, depthWrite: false, transparent: true }));
      s.renderOrder = 4; this.group.add(s); this.sprites[i] = s;
    }
    s.visible = true;
    return s;
  }

  update() {
    const fx = this.fx;
    let nc = 0, nf = 0, np = 0, ns = 0;
    for (const p of fx.parts) {
      const k = p.t / p.life;
      switch (p.k) {
        case 'puff': {
          if (np >= 900) break;
          const s = Math.max(1, p.r + (p.grow || 0) * k);
          D.position.set(p.x, p.z + s / 2, p.y); D.rotation.set(0, 0, 0); D.scale.setScalar(s * (k > 0.6 ? 1 - (k - 0.6) * 2.2 : 1)); D.updateMatrix();
          this.puffs.setMatrixAt(np, D.matrix);
          this.puffs.setColorAt(np, parseCol(p.col));
          np++;
          break;
        }
        case 'fire': {
          if (nf >= 1200) break;
          const s = Math.max(2, p.r * (1 - k * 0.6));
          D.position.set(p.x, p.z + s / 2, p.y); D.rotation.set(0, p.t * 3, 0); D.scale.setScalar(s); D.updateMatrix();
          this.fires.setMatrixAt(nf, D.matrix);
          this.fires.setColorAt(nf, parseCol(k < 0.3 ? '#fff0a0' : k < 0.6 ? '#ff9a2a' : '#c23a12'));
          nf++;
          break;
        }
        case 'glow': case 'flash': {
          const s = this.sprite(ns++);
          const a = 1 - k;
          s.position.set(p.x, p.z + 4, p.y);
          const size = p.k === 'flash' ? p.r * 2.4 : p.r * 2;
          s.scale.set(size, size, 1);
          s.material.opacity = p.k === 'glow' ? a : Math.min(1, a * 1.6);
          break;
        }
        default: {
          if (nc >= 1600) break;
          const s = Math.max(1, p.r);
          D.position.set(p.x, p.z + s / 2, p.y); D.rotation.set(p.t * 4 + p.x, p.t * 3, 0); D.scale.setScalar(s * (k > 0.75 ? 1 - (k - 0.75) * 3 : 1)); D.updateMatrix();
          this.cubes.setMatrixAt(nc, D.matrix);
          this.cubes.setColorAt(nc, parseCol(p.col));
          nc++;
        }
      }
    }
    for (const [m, n] of [[this.cubes, nc], [this.fires, nf], [this.puffs, np]]) {
      m.count = n;
      m.instanceMatrix.needsUpdate = true;
      if (m.instanceColor) m.instanceColor.needsUpdate = true;
    }
    for (let i = ns; i < this.sprites.length; i++) this.sprites[i].visible = false;

    // tracers
    let nt = 0;
    for (const t of fx.tracers) {
      let m = this.tracers[nt];
      if (!m) { m = new THREE.Mesh(BOX, new THREE.MeshBasicMaterial({ color: 0xffe9a0, transparent: true, blending: THREE.AdditiveBlending, depthWrite: false })); m.renderOrder = 4; this.group.add(m); this.tracers[nt] = m; }
      nt++;
      const k = t.t / t.life;
      // the streak is a short bright dash travelling down the shot line
      const dx = t.x1 - t.x0, dy = t.y1 - t.y0, dz = t.z1 - t.z0;
      const len = Math.hypot(dx, dy, dz) || 1;
      const head = Math.min(1, 0.25 + k * 1.2), tail = Math.max(0, head - Math.min(0.5, 150 / len));
      const ax = t.x0 + dx * tail, ay = t.z0 + dz * tail, az = t.y0 + dy * tail;
      const bx = t.x0 + dx * head, by = t.z0 + dz * head, bz = t.y0 + dy * head;
      m.visible = true;
      m.position.set((ax + bx) / 2, (ay + by) / 2, (az + bz) / 2);
      m.lookAt(bx, by, bz);
      const th = t.big ? 2.6 : 1.5;
      m.scale.set(th, th, Math.hypot(bx - ax, by - ay, bz - az));
      m.material.opacity = (1 - k) * (t.own ? 0.95 : 0.8);
    }
    for (let i = nt; i < this.tracers.length; i++) this.tracers[i].visible = false;

    // rings
    let nr = 0;
    for (const r of fx.rings) {
      let m = this.rings[nr];
      if (!m) { m = new THREE.Mesh(this.ringGeo, new THREE.MeshBasicMaterial({ transparent: true, depthWrite: false, side: THREE.DoubleSide })); m.renderOrder = 2; this.group.add(m); this.rings[nr] = m; }
      nr++;
      const k = r.t / r.life;
      const rr = r.r0 + (r.r1 - r.r0) * (1 - Math.pow(1 - k, 2));
      m.visible = true;
      m.position.set(r.x, 3, r.y);
      m.scale.set(rr, 1, rr);
      m.material.color.copy(parseCol(r.color));
      m.material.opacity = (1 - k) * 0.85;
    }
    for (let i = nr; i < this.rings.length; i++) this.rings[i].visible = false;
  }
}
