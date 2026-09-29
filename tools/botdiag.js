// Bot behaviour diagnostics: accuracy, engagement time, idle/stuck time, deaths per minute.  node tools/botdiag.js [map] [seconds] [teamSize] [difficulty]
import { Room } from '../src/server/room.js';
import { SPEC } from '../src/shared/constants.js';

const map = process.argv[2] || 'riverside';
const seconds = Number(process.argv[3]) || 180;
const teamSize = Number(process.argv[4]) || 8;
const difficulty = process.argv[5] || 'normal';
const fake = { send() {}, sendRaw() {}, congested: () => false, leaveRoom() {} };
const room = new Room('BD', { map, teamSize, bots: true, mode: 'conquest', vehicles: false, difficulty, tickets: 999 }, null);
const spec = room.addHuman({ ...fake }, 'W'); room.assignTeam(spec, SPEC); room.rebalanceBots(true);
room.start();
const g = room.game;
const st = new Map();
const S = (p) => { let s = st.get(p.id); if (!s) { s = { shots: 0, clip: -1, alive: 0, moving: 0, stillNoTarget: 0, stillTarget: 0, target: 0, targetNoFire: 0, fireWithTarget: 0, stuck: 0, lastPos: null, still: 0, dmg0: 0 }; st.set(p.id, s); } return s; };
const WHY = {};
const ev = { shot: 0, hitm: 0, head: 0 };
const emit0 = g.emit.bind(g);
g.emit = (p2, ...r) => { if (p2[0] === 'shot') ev.shot++; else if (p2[0] === 'hitm') { ev.hitm++; if (p2[p2.length - 1]) ev.head++; } return emit0(p2, ...r); };
for (let i = 0; i < seconds * 60; i++) {
  room.tick();
  if (!room.game) break;
  for (const p of g.players.values()) {
    if (p.team === SPEC || !p.alive || p.veh || !p.bot) continue;
    const s = S(p);
    const w = p.weapon();
    const clip = w ? p.ammoOf(w).clip : 0;
    if (s.clip >= 0 && clip < s.clip && p.reloadT <= 0) s.shots += s.clip - clip;
    s.clip = clip;
    s.alive++;
    const spd = Math.hypot(p.vx, p.vy);
    const tgt = p.bot.visible;
    if (spd > 25) { s.moving++; s.still = 0; } else { s.still++; if (tgt) s.stillTarget++; else s.stillNoTarget++; if (s.still === 360) s.stuck++; }
    if (tgt) { WHY[p.bot.why] = (WHY[p.bot.why] || 0) + 1; s.target++; if (p.lastKeys & 1 << 4) s.fireWithTarget++; else s.targetNoFire++; }
  }
}
const ps = [...g.players.values()].filter((p) => p.team !== SPEC);
let A = 0, M = 0, SN = 0, ST = 0, T = 0, F = 0, shots = 0, stuck = 0;
for (const p of ps) { const s = st.get(p.id); if (!s) continue; A += s.alive; M += s.moving; SN += s.stillNoTarget; ST += s.stillTarget; T += s.target; F += s.fireWithTarget; shots += s.shots; stuck += s.stuck; }
const dmg = ps.reduce((a, p) => a + p.stats.damage, 0), kills = ps.reduce((a, p) => a + p.stats.kills, 0), deaths = ps.reduce((a, p) => a + p.stats.deaths, 0);
const pct = (x, y) => (y ? (100 * x / y).toFixed(1) + '%' : '-');
console.log(`${map} ${teamSize}v${teamSize} ${difficulty} ${seconds}s: kills ${kills} deaths ${deaths} shots ${shots} damage ${Math.round(dmg)} (${(dmg / Math.max(1, shots)).toFixed(1)} dmg/shot)`);
console.log(`events: shots ${ev.shot}, hit markers ${ev.hitm} (${pct(ev.hitm, ev.shot)}), headshots ${ev.head}`);
console.log(`bot time: moving ${pct(M, A)}, standing w/o target ${pct(SN, A)}, standing with target ${pct(ST, A)}, has target ${pct(T, A)}; while target visible: firing ${pct(F, T)}; stuck >6s events ${stuck}`);
console.log('why not firing:', JSON.stringify(WHY));
const per = ps.filter((p) => st.get(p.id)).map((p) => `${p.name}:${p.stats.kills}/${p.stats.deaths}`);
console.log(per.join('  '));
