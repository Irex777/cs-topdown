// Diagnose how the first kill of each round happens.  node tools/firstkill.js [map] [matches]
import { Room } from '../src/server/room.js';
import { SPEC } from '../src/shared/constants.js';
import { angleDiff } from '../src/shared/gamemap.js';
const map = process.argv[2] || 'dust', matches = Number(process.argv[3]) || 8;
const fake = { send() {}, sendRaw() {}, congested: () => false, leaveRoom() {} };
const rows = [];
for (let m = 0; m < matches; m++) {
  const room = new Room('FK', { map, teamSize: 5, bots: true, rounds: 16, difficulty: 'normal' }, null);
  const w = room.addHuman({ ...fake }, 'W'); room.assignTeam(w, SPEC); room.rebalanceBots(true);
  let first = true;
  const orig = room.broadcast.bind(room);
  room.broadcast = (msg) => {
    if (msg.t === 'round_start') first = true;
    if (msg.t === 'kill' && first) {
      first = false;
      const g = room.game; const k = g.players.get(msg.k), v = g.players.get(msg.v);
      if (k && v && k.bot && v.bot) {
        const d = Math.hypot(k.x - v.x, k.y - v.y);
        // was the victim looking toward the killer?
        const vAim = Math.abs(angleDiff(Math.atan2(k.y - v.y, k.x - v.x), v.angle));
        rows.push({ kt: k.team, d, victimSaw: v.bot.visible && v.bot.target === k.id, vAim, kMoving: k.speed > 60, vMoving: v.speed > 60, t: g.time - g.roundStartedAt });
      }
    }
    orig(msg);
  };
  room.start();
  for (let i = 0; i < 60 * 60 * 25 && room.game; i++) room.tick();
}
const avg = (a, f) => (a.reduce((s, r) => s + f(r), 0) / (a.length || 1));
for (const kt of [0, 1]) {
  const r = rows.filter((x) => x.kt === kt);
  console.log(`first kills by ${['T', 'CT'][kt]}: n=${r.length} dist=${avg(r, (x) => x.d).toFixed(0)} victimHadSeenKiller=${(100 * avg(r, (x) => (x.victimSaw ? 1 : 0))).toFixed(0)}% victimFacing<0.9rad=${(100 * avg(r, (x) => (x.vAim < 0.9 ? 1 : 0))).toFixed(0)}% killerMoving=${(100 * avg(r, (x) => (x.kMoving ? 1 : 0))).toFixed(0)}% victimMoving=${(100 * avg(r, (x) => (x.vMoving ? 1 : 0))).toFixed(0)}% time=${avg(r, (x) => x.t).toFixed(0)}s`);
}
