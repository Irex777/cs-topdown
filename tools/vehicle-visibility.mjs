// Check the rendered geometry, rather than inferring visibility from a camera mode.
export async function inspectMountedSight(page) {
  return page.evaluate(async () => {
    const THREE = await import('./vendor/three/three.module.js');
    const g = window.app.game, r = g.renderer;
    const vehicle = r.pools.vehicles.map.get(g.me.veh.id);
    const meshes = [];
    vehicle.obj.traverse((node) => {
      if (!node.isMesh) return;
      for (let parent = node; parent; parent = parent.parent) if (!parent.visible) return;
      meshes.push(node);
    });
    const ray = new THREE.Raycaster(), blocked = [];
    for (const x of [-.4, -.2, 0, .2, .4]) for (const y of [-.3, -.15, 0, .15, .3]) {
      ray.setFromCamera({ x, y }, r.camera);
      const hits = ray.intersectObjects(meshes, false);
      if (hits.length) blocked.push({ x, y, mesh: hits[0].object.name });
    }
    return { blocked, visibleMeshes: meshes.length, shields: vehicle.glb?.viewOccluders.map((node) => node.visible), gunVisible: vehicle.parts.gun.visible };
  });
}
