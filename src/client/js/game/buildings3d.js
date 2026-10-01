// Roofs retain the shared collision envelope; Blender modules add construction detail.
import * as THREE from '../../vendor/three/three.module.js';
import { assets, worldTex } from './assets.js';

function surface(faces, verticalScale = 32) {
  const positions = [], uv = [];
  for (const face of faces) {
    const verticalX = face.every((p) => p[0] === face[0][0]), verticalZ = face.every((p) => p[2] === face[0][2]);
    for (let i = 1; i < face.length - 1; i++) for (const p of [face[0], face[i], face[i + 1]]) {
      positions.push(...p);
      uv.push((verticalX ? p[2] : p[0]) / (verticalScale === 32 ? 32 : 16), (verticalX || verticalZ ? p[1] / verticalScale : p[2] / 32));
    }
  }
  const geo = new THREE.BufferGeometry();
  geo.setAttribute('position', new THREE.Float32BufferAttribute(positions, 3));
  geo.setAttribute('uv', new THREE.Float32BufferAttribute(uv, 2));
  geo.computeVertexNormals();
  return geo;
}

export class BuildingField {
  constructor(scene, map, pbr) {
    this.scene = scene; this.entries = []; this.geometries = []; this.materials = [];
    this.group = new THREE.Group(); scene.add(this.group);
    const material = (name, color, metalness = 0) => {
      const mat = pbr ? new THREE.MeshStandardMaterial({ map: worldTex(name, 'c'), normalMap: worldTex(name, 'n'), roughnessMap: worldTex(name, 'r'), color, roughness: .92, metalness, side: THREE.DoubleSide }) : new THREE.MeshLambertMaterial({ map: worldTex(name, 'c'), color, side: THREE.DoubleSide });
      this.materials.push(mat); return mat;
    };
    const roofs = ['#d5d1c6', '#c7c8bf', '#ccc6b9'].map((color) => material('roof', color));
    const fascia = material('wood', '#918d7e');
    const brick = material('brick', '#c4b6a5'), concrete = material('concrete', '#aba99d'), plaster = material('plaster', '#eeeade');
    const facades = [plaster, brick, concrete];
    const modelMaterials = new Map();
    const modelMaterial = (source) => {
      if (!modelMaterials.has(source)) {
        const mat = pbr ? source.clone() : new THREE.MeshLambertMaterial({ color: source.color, map: source.map, side: source.side });
        if (source.name === 'facade_plaster') { mat.map = worldTex('plaster', 'c'); if (pbr) { mat.normalMap = worldTex('plaster', 'n'); mat.normalScale.set(.3, .3); } }
        if (source.name === 'facade_brick' || source.name === 'facade_stone' || source.name === 'facade_timber') {
          const texture = source.name === 'facade_brick' ? 'brick' : source.name === 'facade_timber' ? 'wood' : 'concrete';
          mat.map = worldTex(texture, 'c');
          if (pbr) { mat.normalMap = worldTex(texture, 'n'); mat.normalScale.set(.4, .4); mat.roughnessMap = worldTex(texture, 'r'); }
        }
        this.materials.push(mat); modelMaterials.set(source, mat);
      }
      return modelMaterials.get(source);
    };
    const append = (batches, geometry, mat) => {
      const geo = geometry.index ? geometry.toNonIndexed() : geometry;
      let data = batches.get(mat);
      if (!data) { data = { position: [], normal: [], uv: [] }; batches.set(mat, data); }
      for (const name of ['position', 'normal', 'uv']) {
        const array = geo.attributes[name]?.array;
        if (array) for (const value of array) data[name].push(value);
      }
      if (geo !== geometry) geo.dispose();
      geometry.dispose();
    };
    const finish = (batches, group) => {
      for (const [mat, data] of batches) {
        const geo = new THREE.BufferGeometry();
        for (const name of ['position', 'normal', 'uv']) geo.setAttribute(name, new THREE.Float32BufferAttribute(data[name], name === 'uv' ? 2 : 3));
        geo.computeBoundingSphere(); this.geometries.push(geo);
        const mesh = new THREE.Mesh(geo, mat); mesh.castShadow = true; mesh.receiveShadow = true; group.add(mesh);
      }
    };
    for (const b of map.buildings) {
      const group = new THREE.Group(); this.group.add(group);
      const corners = new THREE.Group(); group.add(corners);
      const cornerTiles = [b.y * map.w + b.x, b.y * map.w + b.x + b.w - 1, (b.y + b.h - 1) * map.w + b.x, (b.y + b.h - 1) * map.w + b.x + b.w - 1];
      this.entries.push({ b, group, corners, cornerTiles });
      const batches = new Map(), cornerBatches = new Map();
      const facade = facades[b.id % facades.length];
      const add = (faces, mat) => append(batches, surface(faces, mat === brick ? 10.4 : 32), mat);
      const authored = (name, position, heading = 0, pitch = 0, scale = [16, 16, 16], into = batches) => {
        const source = assets.architecture?.getObjectByName(name);
        if (!source) return;
        source.updateMatrixWorld(true);
        const inverse = source.matrixWorld.clone().invert();
        const placement = new THREE.Matrix4().compose(new THREE.Vector3(...position), new THREE.Quaternion().setFromEuler(new THREE.Euler(0, -heading, pitch, 'YXZ')), new THREE.Vector3(...scale));
        source.traverse((node) => {
          if (!node.isMesh) return;
          const transform = placement.clone().multiply(inverse).multiply(node.matrixWorld);
          const geo = node.geometry.clone().applyMatrix4(transform);
          append(into, geo, modelMaterial(node.material));
        });
      };
      for (let y = b.y; y < b.y + b.h; y++) for (let x = b.x; x < b.x + b.w; x++) {
        const i = y * map.w + x;
        if (!map.headerBottom[i]) continue;
        const x0 = x * 32, x1 = x0 + 32, y0 = y * 32, y1 = y0 + 32, lo = b.base + map.headerBottom[i], hi = b.eave;
        add([[[x0, lo, y0], [x1, lo, y0], [x1, hi, y0], [x0, hi, y0]], [[x1, lo, y0], [x1, lo, y1], [x1, hi, y1], [x1, hi, y0]], [[x1, lo, y1], [x0, lo, y1], [x0, hi, y1], [x1, hi, y1]], [[x0, lo, y1], [x0, lo, y0], [x0, hi, y0], [x0, hi, y1]], [[x0, lo, y0], [x0, lo, y1], [x1, lo, y1], [x1, lo, y0]]], facade);
        authored('doorway', [(x + .5) * 32, b.base, (y + .5) * 32], x === b.x || x === b.x + b.w - 1 ? Math.PI / 2 : 0);
      }
      const { x0, x1, y0, y1, eave: z, ridge: r } = b;
      const a = [x0, z, y0], c = [x1, z, y0], d = [x1, z, y1], e = [x0, z, y1];
      if (b.flat) {
        add([[[x0, r, y0], [x1, r, y0], [x1, r, y1], [x0, r, y1]], [a, c, [x1, r, y0], [x0, r, y0]], [c, d, [x1, r, y1], [x1, r, y0]], [d, e, [x0, r, y1], [x1, r, y1]], [e, a, [x0, r, y0], [x0, r, y1]]], concrete);
      } else {
        const overhang = 3, edgeZ = z - overhang * b.slope;
        const aa = [x0 - overhang, edgeZ, y0 - overhang], cc = [x1 + overhang, edgeZ, y0 - overhang], dd = [x1 + overhang, edgeZ, y1 + overhang], ee = [x0 - overhang, edgeZ, y1 + overhang];
        const v = b.axis === 'y' ? [x0 - overhang, r, (y0 + y1) / 2] : [(x0 + x1) / 2, r, y0 - overhang];
        const w = b.axis === 'y' ? [x1 + overhang, r, (y0 + y1) / 2] : [(x0 + x1) / 2, r, y1 + overhang];
        add(b.axis === 'y' ? [[aa, cc, w, v], [v, w, dd, ee]] : [[aa, v, w, ee], [v, cc, dd, w]], roofs[b.id % roofs.length]);
        // Gables retain the original collision footprint under the roof overhang.
        const gv = b.axis === 'y' ? [x0, r, (y0 + y1) / 2] : [(x0 + x1) / 2, r, y0];
        const gw = b.axis === 'y' ? [x1, r, (y0 + y1) / 2] : [(x0 + x1) / 2, r, y1];
        add(b.axis === 'y' ? [[a, gv, e], [c, d, gw]] : [[a, c, gv], [e, gw, d]], facade);
        const edges = b.axis === 'y' ? [[aa, v], [v, ee], [cc, w], [w, dd], [aa, cc], [dd, ee]] : [[aa, v], [v, cc], [ee, w], [w, dd], [aa, ee], [cc, dd]];
        add(edges.map(([p, q]) => [p, q, [q[0], q[1] - 2.0, q[2]], [p[0], p[1] - 2.0, p[2]]]), fascia);
        const gutterEdges = b.axis === 'y' ? [[aa, cc], [dd, ee]] : [[ee, aa], [cc, dd]];
        for (const [p, q] of gutterEdges) {
          const distance = Math.hypot(q[0] - p[0], q[2] - p[2]), count = Math.ceil(distance / 16), heading = Math.atan2(q[2] - p[2], q[0] - p[0]);
          for (let i = 0; i < count; i++) {
            const t = (i + .5) / count;
            authored('eaves', [p[0] + (q[0] - p[0]) * t, p[1], p[2] + (q[2] - p[2]) * t], heading, 0, [distance / count, 16, 16]);
          }
        }
        const ridgeDistance = Math.hypot(w[0] - v[0], w[2] - v[2]), caps = Math.ceil(ridgeDistance / 16);
        for (let i = 0; i < caps; i++) {
          const t = (i + .5) / caps;
          authored('ridge_cap', [v[0] + (w[0] - v[0]) * t, r, v[2] + (w[2] - v[2]) * t], b.axis === 'y' ? -Math.PI / 2 : 0, 0, [16, 16, ridgeDistance / caps]);
        }
        const cx = x0 + (x1 - x0) * .7, cy = y0 + (y1 - y0) * .4;
        const offset = b.axis === 'y' ? cy - (y0 + y1) / 2 : cx - (x0 + x1) / 2;
        authored('chimney', [cx, r - Math.abs(offset) * b.slope - 3, cy]);
      }
      add([[a, e, d, c]], concrete);
      const positions = [[x0, y0, 0], [x1, y0, Math.PI / 2], [x1, y1, Math.PI], [x0, y1, -Math.PI / 2]];
      for (const [x, y, heading] of positions) for (let level = 0; level < b.storeys; level++) authored('corner', [x, b.base + level * 52, y], heading, 0, [16, 16, 16], cornerBatches);
      for (const [x, y, heading] of [positions[0], positions[2]]) for (let level = 0; level < b.storeys; level++) authored('downpipe', [x, b.base + level * 52, y], heading);
      finish(batches, group); finish(cornerBatches, corners);
    }
    this.map = map; this.sync();
  }
  sync() {
    for (const { b, group, corners, cornerTiles } of this.entries) {
      group.visible = b.active;
      corners.visible = cornerTiles.every((i) => this.map.chars[i] === b.wall || this.map.chars[i] === 'G');
    }
  }
  dispose() {
    this.scene.remove(this.group);
    for (const geo of this.geometries) geo.dispose();
    const textures = new Set();
    for (const mat of this.materials) {
      for (const key of ['map', 'normalMap', 'roughnessMap']) if (mat[key]?.userData.frontlineTransient) textures.add(mat[key]);
      mat.dispose();
    }
    for (const texture of textures) texture.dispose();
  }
}
