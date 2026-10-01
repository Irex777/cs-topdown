// A new match resets both ends of the input stream; test the real spawn without relocation.
import assert from 'node:assert/strict';
import { Room } from '../src/server/room.js';
import { KEY, DT } from '../src/shared/constants.js';
const fake = () => ({ send() {}, sendRaw() {}, congested: () => false, leaveRoom() {} });
let checks = 0;
for (const [map, mode] of [['riverside', 'conquest'], ['harbor', 'rush'], ['dunes', 'conquest'], ['pit', 'tdm']]) {
  const room = new Room('SpawnQA', { map, mode, teamSize: 2, bots: false, vehicles: true }, null);
  const p = room.addHuman(fake(), 'QA'); room.assignTeam(p, 0); room.start();
  room.handle(p, { t: 'in', c: [[9000, KEY.UP, 0, 0, 0, 0]] });
  p.lastSeq = 8999;
  for (let match = 0; match < 5; match++) {
    room.game.startMatch();
    assert.equal(p.qSeq, 0, 'Queued input counter resets between matches');
    assert.equal(p.lastSeq, 0, 'Acknowledged input counter resets between matches');
    assert.equal(p.cmdQ.length, 0, 'Old match commands are discarded');
    const game = room.game;
    assert.ok(game.deploy(p, { k: 'base', id: 0 }), 'Fresh match deploy succeeds');
    const start = { x: p.x, y: p.y };
    for (let seq = 1; seq <= 60; seq++) {
      room.handle(p, { t: 'in', c: [[seq, KEY.UP, p.angle, game.time, 0, 0]] });
      game.update(DT);
    }
    assert.equal(p.lastSeq, 60, 'New input is acknowledged immediately');
    assert.ok(Math.hypot(p.x - start.x, p.y - start.y) > 45, 'Player walks forward from the actual spawn');
    checks += 6;
  }
  console.log('ok', map, 'five consecutive matches accept input and leave the spawn');
}
console.log(checks, 'spawn and match restart checks passed');
// Force the base's edge point on Harbor: the old exhausted-search fallback faced a crate.
const edgeRoom = new Room('EdgeSpawnQA', { map: 'harbor', mode: 'conquest', teamSize: 2, bots: false, vehicles: true }, null);
const edgePlayer = edgeRoom.addHuman(fake(), 'QA'); edgeRoom.assignTeam(edgePlayer, 0); edgeRoom.start();
const originalRandom = Math.random;
try {
  Math.random = () => .04;
  edgeRoom.game.deploy(edgePlayer, { k: 'base', id: 0 });
} finally { Math.random = originalRandom; }
const { x, y, angle } = edgePlayer;
assert.ok(edgeRoom.game.map.clearLineR(x, y, x + Math.cos(angle) * 110, y + Math.sin(angle) * 110, 13), 'A constrained base spawn faces an open route instead of a crate');
console.log('Forced base-edge spawn has a clear forward path');
