// Sky dome and per-map mood (sun, haze, sky colours). The default look is the golden-hour ruined city of the key art.
import * as THREE from '../../vendor/three/three.module.js';

export const MOODS = {
  sunset: {
    top: '#28345f', mid: '#a5566a', low: '#f0894f', horizon: '#ffc27a', fog: '#e8a071', fogNear: 420, fogFar: 2200,
    hemiSky: 0xffd9bd, hemiGround: 0x6b5b55, hemi: 1.75, sun: 0xffa964, sunI: 3.1, sunDir: [-0.82, 0.46, -0.42], glow: '#ffd08a',
  },
  dusk: {
    top: '#1b2246', mid: '#6b4a78', low: '#d0688a', horizon: '#ffae8a', fog: '#b98096', fogNear: 380, fogFar: 2000,
    hemiSky: 0xd8c4ff, hemiGround: 0x584a5e, hemi: 1.6, sun: 0xff9a7a, sunI: 2.6, sunDir: [0.7, 0.36, -0.5], glow: '#ffb59a',
  },
  day: {
    top: '#4f86c8', mid: '#8dbbe6', low: '#bfdcf2', horizon: '#e6f0f5', fog: '#cfe0ec', fogNear: 650, fogFar: 2500,
    hemiSky: 0xdcecff, hemiGround: 0x8a8570, hemi: 1.9, sun: 0xfff1d6, sunI: 2.7, sunDir: [-0.55, 1, -0.4], glow: '#fff4d0',
  },
  noon: {
    top: '#3f78c0', mid: '#7fb0e2', low: '#bddaf5', horizon: '#eaf3fa', fog: '#dbe8f1', fogNear: 600, fogFar: 2500,
    hemiSky: 0xe6f0ff, hemiGround: 0x9a9075, hemi: 1.85, sun: 0xfff6e0, sunI: 2.9, sunDir: [-0.35, 1, -0.3], glow: '#fff8de',
  },
};
const MOOD_OF = { riverside: 'sunset', harbor: 'dusk', dunes: 'noon' };
export const moodFor = (mapId) => MOODS[MOOD_OF[mapId] || 'sunset'];

export class Sky {
  constructor(scene) {
    const geo = new THREE.SphereGeometry(3900, 24, 16);
    this.colors = new Float32Array(geo.attributes.position.count * 3);
    geo.setAttribute('color', new THREE.BufferAttribute(this.colors, 3));
    this.mesh = new THREE.Mesh(geo, new THREE.MeshBasicMaterial({ vertexColors: true, side: THREE.BackSide, fog: false, depthWrite: false }));
    this.mesh.renderOrder = -10; this.mesh.frustumCulled = false;
    scene.add(this.mesh);
    // sun glow
    const c = document.createElement('canvas'); c.width = c.height = 128;
    const x = c.getContext('2d'), gr = x.createRadialGradient(64, 64, 2, 64, 64, 64);
    gr.addColorStop(0, 'rgba(255,255,255,1)'); gr.addColorStop(0.18, 'rgba(255,255,255,0.75)'); gr.addColorStop(0.5, 'rgba(255,255,255,0.18)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    x.fillStyle = gr; x.fillRect(0, 0, 128, 128);
    this.glow = new THREE.Sprite(new THREE.SpriteMaterial({ map: new THREE.CanvasTexture(c), blending: THREE.AdditiveBlending, depthWrite: false, transparent: true, fog: false }));
    this.glow.scale.set(1500, 1500, 1); this.glow.renderOrder = -9;
    scene.add(this.glow);
    this.dir = new THREE.Vector3(0, 1, 0);
  }

  set(mood) {
    const pos = this.mesh.geometry.attributes.position, col = this.colors;
    const stops = [[-0.15, new THREE.Color(mood.horizon)], [0.02, new THREE.Color(mood.horizon)], [0.14, new THREE.Color(mood.low)], [0.42, new THREE.Color(mood.mid)], [1, new THREE.Color(mood.top)]];
    const tmp = new THREE.Color();
    for (let i = 0; i < pos.count; i++) {
      const y = pos.getY(i) / 3900;
      let k = 0; while (k < stops.length - 2 && y > stops[k + 1][0]) k++;
      const [y0, c0] = stops[k], [y1, c1] = stops[k + 1];
      const t = Math.max(0, Math.min(1, (y - y0) / (y1 - y0)));
      tmp.copy(c0).lerp(c1, t * t * (3 - 2 * t));
      col[i * 3] = tmp.r; col[i * 3 + 1] = tmp.g; col[i * 3 + 2] = tmp.b;
    }
    this.mesh.geometry.attributes.color.needsUpdate = true;
    this.dir.set(mood.sunDir[0], mood.sunDir[1], mood.sunDir[2]).normalize();
    this.glow.material.color.set(mood.glow);
  }

  /** keep the dome centred on the camera */
  follow(camPos) {
    this.mesh.position.copy(camPos);
    this.glow.position.copy(camPos).addScaledVector(this.dir, 3600);
  }
}
