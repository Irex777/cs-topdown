import assert from 'node:assert/strict';
import { stepVehicle, VEHICLES } from '../src/shared/vehicles.js';
import { KEY } from '../src/shared/constants.js';
const road = { moveCircle: (x, y, dx, dy) => ({ x: x + dx, y: y + dy }), gradientAt: () => ({ x: 0, y: 0 }), charAt: () => '_' };
const state = () => ({ x: 1000, y: 1000, a: 0, vx: 0, vy: 0 });
let count = 0;
const check = (v, name) => { assert.ok(v, name); count++; console.log('ok', name); };
const drive = (s, def, keys, n, map = road) => { for (let i = 0; i < n; i++) stepVehicle(map, s, def, keys, 0); return s; };
for (const id of ['quad', 'jeep', 'apc', 'tank']) {
  const def = VEHICLES[id], s = state();
  drive(s, def, KEY.UP, 1); const initial = s.vx;
  drive(s, def, KEY.UP, 179); const speed = Math.hypot(s.vx, s.vy);
  check(initial < 1 && speed > 70 && speed <= def.maxSpeed, id + ' builds engine force progressively and respects its speed limit');
  // tracks bite the ground: a tank sheds speed much faster than a wheeled vehicle once the throttle is released (it felt like driving on ice at 65%)
  drive(s, def, 0, 30); check(s.vx > speed * (def.kind === 'tracked' ? .4 : .65), id + ' retains coasting momentum');
  drive(s, def, KEY.DOWN, 1); check(s.vx > 0, id + ' reverse input brakes before changing direction');
  drive(s, def, KEY.DOWN, 150); check(s.vx < -10, id + ' can reverse after braking');
  drive(s, def, KEY.BRAKE, 60); check(Math.hypot(s.vx, s.vy) < 1, id + ' service brake stops the vehicle');
  const stationary = drive(state(), def, KEY.RIGHT, 90);
  check(def.kind === 'tracked' ? Math.abs(stationary.a) > .5 : stationary.a === 0, id + ' uses its physical steering type at rest');
  const corner = drive(state(), def, KEY.UP, 180), old = { ...corner };
  drive(corner, def, KEY.UP | KEY.RIGHT, 1);
  const bearing = Math.atan2(corner.vy, corner.vx);
  check(corner.a > old.a && corner.a < old.a + .01 && Math.abs(bearing - corner.a) > .00001, id + ' steering builds yaw smoothly while velocity retains inertia');
  drive(corner, def, KEY.UP | KEY.RIGHT, 45); const steering = corner.steer;
  drive(corner, def, KEY.UP, 1); check(corner.steer > steering * .85, id + ' steering recentres progressively');
  drive(corner, def, KEY.UP, 120); check(Math.abs(corner.steer) < .01 && Math.abs(corner.yawRate) < .02, id + ' steering settles after releasing the wheel');
  const server = state(), client = state();
  for (let i = 0; i < 360; i++) {
    const keys = i < 100 ? KEY.UP : i < 200 ? KEY.UP | KEY.RIGHT : i < 240 ? KEY.BRAKE : KEY.DOWN | KEY.LEFT;
    stepVehicle(road, server, def, keys, 0); stepVehicle(road, client, def, keys, 0);
  }
  check(JSON.stringify(server) === JSON.stringify(client), id + ' server and client share deterministic handling');
}
const jeep = VEHICLES.jeep;
const paved = drive(state(), jeep, KEY.UP | KEY.RIGHT, 100);
const sandy = drive(state(), jeep, KEY.UP | KEY.RIGHT, 100, { ...road, charAt: () => ':' });
check(Math.hypot(sandy.vx, sandy.vy) < Math.hypot(paved.vx, paved.vy) && Math.abs(sandy.a) < Math.abs(paved.a), 'Sand reduces tire traction and turning response');
const uphill = drive(state(), jeep, KEY.UP, 180, { ...road, gradientAt: () => ({ x: .2, y: 0 }) });
const flat = drive(state(), jeep, KEY.UP, 180);
check(uphill.vx < flat.vx, 'An uphill route loads the engine');
const light = drive(state(), VEHICLES.quad, KEY.UP, 60), heavy = drive(state(), VEHICLES.tank, KEY.UP, 60);
// the tank's throttle and steering respond promptly now, so the difference is smaller than with the old sluggish response; it must still be clearly slower off the line
check(light.x - 1000 > (heavy.x - 1000) * 1.25, 'Tank mass produces a different acceleration curve from the quad');
console.log(count, 'vehicle handling checks passed');
