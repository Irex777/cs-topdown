// Review the actual runtime GLBs with neutral lighting at reference-sheet angles.
import { fileURLToPath } from 'node:url';
import { writeFile } from 'node:fs/promises';
import { launch } from './browser.mjs';
const root=fileURLToPath(new URL('../',import.meta.url));
const {browser,page,errors}=await launch({w:1200,h:800});
const report=[];
try {
  await page.goto('http://127.0.0.1:3000/bf/');
  await page.evaluate(async()=>{
    const THREE=await import('./vendor/three/three.module.js');
    const A=await import('./js/game/assets.js');await A.loadAssets();
    document.body.replaceChildren();document.body.style.margin='0';
    const renderer=new THREE.WebGLRenderer({antialias:true});renderer.setSize(1200,800);
    renderer.shadowMap.enabled=true;renderer.shadowMap.type=THREE.PCFShadowMap;
    renderer.toneMapping=THREE.ACESFilmicToneMapping;renderer.toneMappingExposure=1.15;
    renderer.outputColorSpace=THREE.SRGBColorSpace;document.body.append(renderer.domElement);
    const scene=new THREE.Scene();scene.background=new THREE.Color('#c2c4c2');scene.environment=A.makeEnvironment(renderer);
    scene.add(new THREE.HemisphereLight(0xe4ebef,0x85877e,2.0));
    const light=new THREE.DirectionalLight(0xfff6e6,3);light.position.set(120,150,100);light.castShadow=true;light.shadow.mapSize.set(2048,2048);light.shadow.camera.left=-220;light.shadow.camera.right=220;light.shadow.camera.top=220;light.shadow.camera.bottom=-220;light.shadow.camera.far=500;light.shadow.normalBias=.10;scene.add(light);
    const fill=new THREE.DirectionalLight(0xe2eaff,1.0);fill.position.set(-80,70,-120);scene.add(fill);
    const plane=new THREE.Mesh(new THREE.PlaneGeometry(1200,1200).rotateX(-Math.PI/2),new THREE.MeshStandardMaterial({color:'#b5b7b2',roughness:1}));plane.receiveShadow=true;plane.position.y=-.4;scene.add(plane);
    const camera=new THREE.PerspectiveCamera(38,1.5,.1,2000);let current;
    window.reviewVehicle=(id)=>{
      if(current)scene.remove(current);current=new THREE.Group();scene.add(current);
      const v=A.makeVehicle(id,1),m=v.mount;
      for(const [part,node] of Object.entries(v.parts)) {
        if(part==='turret')node.position.set(m.tx,m.ty,m.tz);
        else if(part==='gun')node.position.set(m.gx,m.gy,m.gz);
        else if(part==='cannon')node.position.set(m.cx,m.cy,m.cz);
        else if(part==='rotor')node.position.y=m.ry;
        else if(part.startsWith('wheel_')) {const w=v.wheels.find((w)=>w.name===part);node.position.set(w.x,w.y,w.z);}
        current.add(node);
      }
      const box=new THREE.Box3().setFromObject(current),size=box.getSize(new THREE.Vector3()),center=box.getCenter(new THREE.Vector3());
      const radius=Math.max(size.x,size.z,size.y)*.93;
      camera.position.copy(center).add(new THREE.Vector3(.86,.37,1.0).normalize().multiplyScalar(radius*1.6));camera.lookAt(center.x,center.y*.82,center.z);
      renderer.render(scene,camera);
      let meshes=0;
      current.traverse((node)=>{if(!node.isMesh)return;meshes++;if(!node.material.map||!node.material.normalMap||!node.material.roughnessMap||!node.material.metalnessMap)throw new Error(id+' missing baked surface maps on '+node.name);});
      return {id,dimensions:size.toArray(),triangles:renderer.info.render.triangles,draws:renderer.info.render.calls,meshes};
    };
  });
  for(const id of ['jeep','tank','apc','quad','heli','boat']) {
    const result=await page.evaluate((id)=>window.reviewVehicle(id),id);report.push(result);console.log(result);
    await page.screenshot({path:root+`output/qa/reference-model-${id}.png`});
  }
  if(errors.length)throw new Error(errors.join('\n'));
  await writeFile(root+'output/qa/reference-model-results.json',JSON.stringify({models:report,errors,date:new Date().toISOString()},null,2));
}finally{await browser.close();}
