// Soft, camera-facing particle instances with independent fading and one draw call.
import * as THREE from '../../vendor/three/three.module.js';

let cloudTexture;
export function smokeTexture() {
  if (cloudTexture) return cloudTexture;
  const canvas = document.createElement('canvas');
  canvas.width = canvas.height = 128;
  const ctx = canvas.getContext('2d'), data = ctx.createImageData(128, 128);
  for (let y = 0; y < 128; y++) for (let x = 0; x < 128; x++) {
    const dx = (x - 63.5) / 63.5, dy = (y - 63.5) / 63.5, r = Math.hypot(dx, dy);
    const wisps = 0.78 + Math.sin(dx * 13 + Math.sin(dy * 9)) * Math.cos(dy * 11 - dx * 4) * 0.16;
    const i = (y * 128 + x) * 4;
    const shade = 220 + 35 * Math.max(0, 1 - r);
    data.data[i] = data.data[i + 1] = data.data[i + 2] = shade;
    data.data[i + 3] = 255 * Math.pow(Math.max(0, 1 - r * r), 1.8) * wisps;
  }
  ctx.putImageData(data, 0, 0);
  cloudTexture = new THREE.CanvasTexture(canvas);
  cloudTexture.colorSpace = THREE.SRGBColorSpace;
  return cloudTexture;
}

export function billboardCloud(capacity, options = {}) {
  const geometry = new THREE.PlaneGeometry(1, 1);
  const opacity = new THREE.InstancedBufferAttribute(new Float32Array(capacity), 1);
  opacity.setUsage(THREE.DynamicDrawUsage);
  geometry.setAttribute('particleOpacity', opacity);
  const material = new THREE.MeshBasicMaterial({ map: smokeTexture(), transparent: true, depthWrite: false, alphaTest: 0.003, ...options });
  material.onBeforeCompile = (shader) => {
    shader.vertexShader = shader.vertexShader.replace('#include <common>', '#include <common>\nattribute float particleOpacity;\nvarying float vParticleOpacity;')
      .replace('#include <begin_vertex>', '#include <begin_vertex>\nvParticleOpacity = particleOpacity;');
    shader.fragmentShader = shader.fragmentShader.replace('#include <common>', '#include <common>\nvarying float vParticleOpacity;')
      .replace('#include <color_fragment>', '#include <color_fragment>\ndiffuseColor.a *= vParticleOpacity;');
  };
  material.customProgramCacheKey = () => 'frontline-soft-particle-v1';
  const mesh = new THREE.InstancedMesh(geometry, material, capacity);
  mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
  mesh.frustumCulled = false;
  mesh.count = 0;
  mesh.setColorAt(0, new THREE.Color(1, 1, 1));
  mesh.renderOrder = 3;
  return mesh;
}

export function finishCloud(mesh, count) {
  mesh.count = count;
  mesh.instanceMatrix.needsUpdate = true;
  mesh.instanceColor.needsUpdate = true;
  mesh.geometry.attributes.particleOpacity.needsUpdate = true;
}
