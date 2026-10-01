import * as THREE from '../../vendor/three/three.module.js';
import { assets, worldTex } from './assets.js';

// Bodies arrive from the authoritative server. Interpolate transforms; never simulate a conflicting client world.
export class RigidField {
  constructor(scene) {
    this.group = new THREE.Group(); scene.add(this.group); this.objects = new Map(); this.materials = new Map(); this.batches = new Map();
    this.box = new THREE.BoxGeometry(1, 1, 1); this.dummy = new THREE.Object3D(); this.q = new THREE.Quaternion();
  }
  material(ch) {
    if (this.materials.has(ch)) return this.materials.get(ch);
    const family = { '#': 'rock', B: 'brick', R: 'roof', X: 'wood', T: 'wood', L: 'sandbag', M: 'metal', o: 'metal', '=': 'metal' }[ch] || 'concrete';
    const m = new THREE.MeshStandardMaterial({ map: worldTex(family, 'c'), normalMap: worldTex(family, 'n'), roughnessMap: worldTex(family, 'r'), roughness: .95, metalness: ['M', 'o', '='].includes(ch) ? .45 : 0 });
    if (ch === 'G') { m.color.set('#a6c6ca'); m.transparent = true; m.opacity = .45; m.metalness = .15; }
    this.materials.set(ch, m); return m;
  }
  whole(t) {
    const name = { X: 'crate', o: 'barrels', T: 'tree' }[t[1]], source = assets.props?.getObjectByName(name);
    const root = new THREE.Group();
    if (source) {
      const model = source.clone(true); model.position.set(0, 0, 0); root.add(model); model.updateMatrixWorld(true);
      const bounds = new THREE.Box3().setFromObject(model), size = bounds.getSize(new THREE.Vector3()), center = bounds.getCenter(new THREE.Vector3());
      const sx = t[1] === 'T' ? t[11] * .65 : t[9], sy = t[11], sz = t[1] === 'T' ? t[11] * .65 : t[10];
      model.scale.multiply(new THREE.Vector3(sx / size.x, sy / size.y, sz / size.z));
      model.position.set(-center.x * sx / size.x, -center.y * sy / size.y, -center.z * sz / size.z);
      model.traverse((o) => { if (o.isMesh) { o.castShadow = true; o.receiveShadow = true; } });
    } else { const mesh = new THREE.Mesh(this.box, this.material(t[1])); mesh.scale.set(t[9], t[11], t[10]); root.add(mesh); }
    this.group.add(root); return root;
  }
  update(tuples, age, dt) {
    const counts = new Map(), used = new Set();
    for (const t of tuples) {
      const [id, ch, x, y, z, qx, qy, qz, qw, sx, sy, sz, vx, vy, vz, whole] = t;
      this.q.set(-qx, -qz, -qy, qw).normalize();
      const extrapolate = Math.min(.06, Math.max(0, age));
      const position = new THREE.Vector3(x + vx * extrapolate, z + vz * extrapolate, y + vy * extrapolate);
      if (whole) {
        used.add(id); let obj = this.objects.get(id);
        if (!obj) { obj = this.whole(t); obj.position.copy(position); obj.quaternion.copy(this.q); this.objects.set(id, obj); }
        const k = 1 - Math.exp(-24 * dt); obj.position.lerp(position, k); obj.quaternion.slerp(this.q, k);
      } else {
        let batch = this.batches.get(ch);
        if (!batch) { batch = new THREE.InstancedMesh(this.box, this.material(ch), 192); batch.instanceMatrix.setUsage(THREE.DynamicDrawUsage); batch.frustumCulled = false; batch.castShadow = true; batch.receiveShadow = true; this.group.add(batch); this.batches.set(ch, batch); }
        const n = counts.get(ch) || 0;
        this.dummy.position.copy(position); this.dummy.quaternion.copy(this.q); this.dummy.scale.set(sx, sz, sy); this.dummy.updateMatrix(); batch.setMatrixAt(n, this.dummy.matrix); counts.set(ch, n + 1);
      }
    }
    for (const [ch, batch] of this.batches) { batch.count = counts.get(ch) || 0; batch.instanceMatrix.needsUpdate = true; }
    for (const [id, obj] of this.objects) if (!used.has(id)) { this.group.remove(obj); this.objects.delete(id); }
  }
  dispose() {
    this.group.removeFromParent(); this.box.dispose();
    for (const b of this.batches.values()) b.dispose();
    for (const m of this.materials.values()) { for (const t of [m.map, m.normalMap, m.roughnessMap]) t?.dispose(); m.dispose(); }
  }
}
