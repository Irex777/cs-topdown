// Render the runtime soldier GLB (game loader, team tints, weapons in hand) from several angles -> output/qa/soldier-*.png
import { fileURLToPath } from 'node:url';
import { launch } from './browser.mjs';
const root = fileURLToPath(new URL('../', import.meta.url));
const { browser, page, errors } = await launch({ w: 1500, h: 900 });
try {
  await page.goto('http://127.0.0.1:3000/bf/');
  await page.evaluate(async () => {
    const THREE = await import('./vendor/three/three.module.js');
    const A = await import('./js/game/assets.js'); await A.loadAssets();
    document.body.replaceChildren(); document.body.style.margin = '0';
    const renderer = new THREE.WebGLRenderer({ antialias: true }); renderer.setSize(1500, 900);
    renderer.shadowMap.enabled = true; renderer.toneMapping = THREE.ACESFilmicToneMapping; renderer.toneMappingExposure = 1.1; renderer.outputColorSpace = THREE.SRGBColorSpace;
    document.body.append(renderer.domElement);
    const scene = new THREE.Scene(); scene.background = new THREE.Color('#9aa39c'); scene.environment = A.makeEnvironment(renderer);
    scene.add(new THREE.HemisphereLight(0xe4ebef, 0x7a7d70, 1.6));
    const sun = new THREE.DirectionalLight(0xfff1dc, 3); sun.position.set(40, 80, 50); sun.castShadow = true; sun.shadow.mapSize.set(2048, 2048);
    Object.assign(sun.shadow.camera, { left: -40, right: 40, top: 40, bottom: -40, far: 300 }); scene.add(sun);
    const ground = new THREE.Mesh(new THREE.PlaneGeometry(400, 400).rotateX(-Math.PI / 2), new THREE.MeshStandardMaterial({ color: '#7d8270', roughness: 1 })); ground.receiveShadow = true; scene.add(ground);
    const camera = new THREE.PerspectiveCamera(32, 1500 / 900, 1, 2000);
    let group;
    window.shot = (team, cls, gun, views) => {
      if (group) scene.remove(group);
      group = new THREE.Group(); scene.add(group);
      const s = A.makeSoldier(team, cls); A.soldierGun(s, gun, ''); group.add(s.root);
      const out = [];
      for (const v of views) {
        const [az, el, dist, ty, fov] = v;
        camera.fov = fov || 32; camera.updateProjectionMatrix();
        const a = az * Math.PI / 180, e = el * Math.PI / 180;
        camera.position.set(Math.cos(a) * Math.cos(e) * dist, ty + Math.sin(e) * dist, Math.sin(a) * Math.cos(e) * dist);
        camera.lookAt(0, ty, 0); renderer.render(scene, camera);
        out.push(renderer.domElement.toDataURL('image/png'));
      }
      return out;
    };
  });
  const { writeFile } = await import('node:fs/promises');
  const sets = [
    ['friend-ar7', 1, 'assault', 'ar7', [[35, 8, 52, 15], [-55, 8, 52, 15], [90, 6, 52, 15], [180, 10, 52, 15], [50, 10, 18, 27, 30]]],
    ['enemy-sr50', 0, 'recon', 'sr50', [[35, 8, 52, 15]]],
    ['friend-mg60', 1, 'support', 'mg60', [[35, 8, 52, 15]]],
    ['friend-vx9', 1, 'engineer', 'vx9', [[35, 8, 52, 15], [-70, 8, 52, 15]]],
    ['friend-p18', 1, 'assault', 'p18', [[35, 8, 52, 15]]],
    ['friend-rpg', 1, 'support', 'rpg', [[35, 8, 52, 15]]],
  ];
  for (const [name, team, cls, gun, views] of sets) {
    const shots = await page.evaluate(([t, c, g, v]) => window.shot(t, c, g, v), [team, cls, gun, views]);
    for (let i = 0; i < shots.length; i++) await writeFile(root + `output/qa/soldier-${name}-${i}.png`, Buffer.from(shots[i].split(',')[1], 'base64'));
  }
  if (errors.length) console.log(errors.join('\n'));
} finally { await browser.close(); }
