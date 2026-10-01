// Thin Rapier layer for the server's rigid-body world (debris, props, grenades). Metres, z up.
// Collision groups keep the old cannon-es meaning: two colliders touch when A.group & B.mask and B.group & A.mask.
// A body exposes position / velocity / quaternion / sleepState like the previous engine, so callers read it the same way.
import RAPIER from '@dimforge/rapier3d-compat';

await RAPIER.init();

export const SLEEPING = 2;
const pack = (group, mask) => (((group & 0xffff) << 16) | (mask & 0xffff)) >>> 0;
const FRICTION = 0.65, RESTITUTION = 0.08;
// Maps a y-up heightfield into the z-up world with rows along +x and columns along +y: local x -> world y, local y -> world z, local z -> world x.
// That orientation splits terrain cells along the same diagonal as the shared map, and matches the elevation array layout.
const TERRAIN_ROT = { x: 0.5, y: 0.5, z: 0.5, w: 0.5 };

export class RigidBody {
  constructor(rb, mass = 0) { this.rb = rb; this.mass = mass; this.userData = null; this.onImpact = null; this.cached = null; this.handles = []; }
  get position() { return this.rb.translation(); }
  get velocity() { return this.rb.linvel(); }
  get angularVelocity() { return this.rb.angvel(); }
  get quaternion() { return this.rb.rotation(); }
  get sleeping() { return this.rb.isSleeping(); }
  get sleepState() { return this.rb.isSleeping() ? SLEEPING : 0; }
  wakeUp() { this.rb.wakeUp(); }
  /** impulse in kg·m/s applied at the centre of mass */
  applyImpulse(i) { this.rb.applyImpulse(i, true); }
  setVelocity(x, y, z) { this.rb.setLinvel({ x, y, z }, true); }
  setAngularVelocity(x, y, z) { this.rb.setAngvel({ x, y, z }, true); }
  dampAngular(k) { const a = this.rb.angvel(); this.rb.setAngvel({ x: a.x * k, y: a.y * k, z: a.z * k }, true); }
  /** drive a kinematic body: its velocity follows from the movement, so it pushes dynamic bodies */
  moveKinematic(x, y, z, angleZ) { this.rb.setNextKinematicTranslation({ x, y, z }); this.rb.setNextKinematicRotation({ x: 0, y: 0, z: Math.sin(angleZ / 2), w: Math.cos(angleZ / 2) }); }
}

export class RigidWorld {
  constructor(gravityZ = -9.81) {
    this.world = new RAPIER.World({ x: 0, y: 0, z: gravityZ });
    this.world.integrationParameters.numSolverIterations = 6;
    this.queue = new RAPIER.EventQueue(true);
    this.owner = new Map();       // collider handle -> RigidBody
    this.watched = new Set();     // bodies that report impacts
    this.bodies = new Set();
    this.terrain = null;
  }

  collider(desc, body, group, mask) {
    desc.setFriction(FRICTION).setRestitution(RESTITUTION).setCollisionGroups(pack(group, mask));
    const c = this.world.createCollider(desc, body.rb);
    this.owner.set(c.handle, body); body.handles.push(c.handle);
    return c;
  }

  shapeDesc(s) {
    let d;
    if (s.ball !== undefined) d = RAPIER.ColliderDesc.ball(s.ball);
    else d = RAPIER.ColliderDesc.cuboid(s.box[0], s.box[1], s.box[2]);
    if (s.offset) d.setTranslation(s.offset[0], s.offset[1], s.offset[2]);
    if (s.rotation) d.setRotation(s.rotation);
    return d;
  }

  /** a free body. o: { mass, box:[hx,hy,hz] | ball, position:[x,y,z], velocity, angular, linearDamping, angularDamping, group, mask, ccd, onImpact } */
  dynamic(o) {
    const desc = RAPIER.RigidBodyDesc.dynamic().setTranslation(o.position[0], o.position[1], o.position[2]).setLinearDamping(o.linearDamping || 0).setAngularDamping(o.angularDamping || 0).setCanSleep(true);
    if (o.velocity) desc.setLinvel(o.velocity[0], o.velocity[1], o.velocity[2]);
    if (o.angular) desc.setAngvel({ x: o.angular[0], y: o.angular[1], z: o.angular[2] });
    if (o.ccd) desc.setCcdEnabled(true);
    const body = new RigidBody(this.world.createRigidBody(desc), o.mass);
    const cd = this.shapeDesc(o.ball !== undefined ? { ball: o.ball } : { box: o.box }).setMass(o.mass);
    if (o.onImpact) { cd.setActiveEvents(RAPIER.ActiveEvents.COLLISION_EVENTS); body.onImpact = o.onImpact; this.watched.add(body); }
    body.main = this.collider(cd, body, o.group, o.mask);
    this.bodies.add(body);
    return body;
  }

  /** an immovable body made of one or more shapes. shapes: [{ box:[hx,hy,hz] | ball, offset?, rotation? }] */
  fixed(o) {
    const body = new RigidBody(this.world.createRigidBody(RAPIER.RigidBodyDesc.fixed().setTranslation(o.position[0], o.position[1], o.position[2])), 0);
    for (const s of o.shapes) this.collider(this.shapeDesc(s), body, o.group, o.mask);
    this.bodies.add(body);
    return body;
  }

  /** a body moved by the game each tick (players, vehicles) */
  kinematic(o) {
    const body = new RigidBody(this.world.createRigidBody(RAPIER.RigidBodyDesc.kinematicPositionBased().setTranslation(...o.position)), 0);
    this.collider(this.shapeDesc(o.shape), body, o.group, o.mask);
    this.bodies.add(body);
    return body;
  }

  remove(body) {
    if (!this.bodies.delete(body)) return;
    this.watched.delete(body);
    for (const h of body.handles) this.owner.delete(h);
    this.world.removeRigidBody(body.rb);
  }

  /** terrain in chunks of `chunk` x `chunk` tiles, so a crater only rebuilds the few chunks it touches.
   * heights(i, j) in metres for sample i in 0..nx, j in 0..ny on a grid of `cell` metres, origin at the world origin */
  setTerrain(nx, ny, cell, heights, chunk = 16) {
    if (this.terrain) for (const c of this.terrain.colliders.values()) this.world.removeCollider(c, false);
    this.terrain = { nx, ny, cell, heights, chunk, cols: Math.ceil(nx / chunk), rows: Math.ceil(ny / chunk), colliders: new Map() };
    for (let cy = 0; cy < this.terrain.rows; cy++) for (let cx = 0; cx < this.terrain.cols; cx++) this.buildChunk(cx, cy);
  }

  buildChunk(cx, cy) {
    const t = this.terrain, key = cy * t.cols + cx;
    const i0 = cx * t.chunk, j0 = cy * t.chunk, ci = Math.min(t.nx, i0 + t.chunk) - i0, cj = Math.min(t.ny, j0 + t.chunk) - j0;
    const data = new Float32Array((ci + 1) * (cj + 1));
    for (let j = 0; j <= cj; j++) for (let i = 0; i <= ci; i++) data[j * (ci + 1) + i] = t.heights(i0 + i, j0 + j);   // column-major: rows (x) vary fastest
    const desc = RAPIER.ColliderDesc.heightfield(ci, cj, data, { x: cj * t.cell, y: 1, z: ci * t.cell }).setRotation(TERRAIN_ROT).setTranslation((i0 + ci / 2) * t.cell, (j0 + cj / 2) * t.cell, 0)
      .setFriction(FRICTION).setRestitution(RESTITUTION).setCollisionGroups(pack(1, 2));
    const old = t.colliders.get(key);
    if (old) this.world.removeCollider(old, false);
    t.colliders.set(key, this.world.createCollider(desc));
  }

  /** rebuild the chunks that contain the given terrain samples ([x + y * (nx + 1)] indices) */
  refreshTerrain(indices) {
    const t = this.terrain, w = t.nx + 1, chunks = new Set();
    for (const idx of indices) {
      const i = idx % w, j = Math.floor(idx / w);
      const xs = [Math.min(t.cols - 1, Math.floor(i / t.chunk))], ys = [Math.min(t.rows - 1, Math.floor(j / t.chunk))];
      if (i > 0 && i % t.chunk === 0) xs.push(i / t.chunk - 1);     // a sample on a chunk border belongs to both neighbours
      if (j > 0 && j % t.chunk === 0) ys.push(j / t.chunk - 1);
      for (const y of ys) for (const x of xs) chunks.add(y * t.cols + x);
    }
    for (const key of chunks) this.buildChunk(key % t.cols, Math.floor(key / t.cols));
  }

  /** advance by dt; bodies with onImpact are told the impact speed along the contact normal and what they hit */
  step(dt) {
    const w = this.world;
    w.timestep = dt;
    for (const b of this.watched) b.cached = b.rb.linvel();
    w.step(this.queue);
    this.queue.drainCollisionEvents((h1, h2, started) => {
      if (!started) return;
      const a = this.owner.get(h1), b = this.owner.get(h2);
      if (!a || !b || (!a.onImpact && !b.onImpact)) return;
      const va = a.cached || a.rb.linvel(), vb = b.cached || b.rb.linvel();
      const dx = va.x - vb.x, dy = va.y - vb.y, dz = va.z - vb.z;
      let speed = Math.hypot(dx, dy, dz);
      w.contactPair(w.getCollider(h1), w.getCollider(h2), (manifold, flipped) => {
        const n = manifold.normal(), s = flipped ? -1 : 1;
        speed = Math.abs((dx * n.x + dy * n.y + dz * n.z) * s);
      });
      if (a.onImpact) a.onImpact(speed, b);
      if (b.onImpact) b.onImpact(speed, a);
    });
  }
}
