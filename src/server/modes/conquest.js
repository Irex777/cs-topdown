// Conquest: hold more than half of the flags to bleed the enemy's tickets; every death costs a ticket.
import { T, CT, SPEC, RULES, otherTeam } from '../../shared/constants.js';

// Check current positions at deployment time; cached capture state can be one tick old.
export function flagHasEnemy(g, f, team) {
  for (const p of g.players.values()) {
    if (!p.alive || p.team === SPEC || p.team === team) continue;
    if (p.veh && g.vehicleById(p.veh)?.def.kind === 'air') continue;
    if (Math.hypot(p.x - f.x, p.y - f.y) <= f.r) return true;
  }
  return false;
}

export const conquest = {
  id: 'conquest',

  init(g) {
    const t = g.settings.tickets || 250;
    g.tix = [t, t];
    g.timer = RULES.matchTime;
    g.flags = g.map.flags.map((f) => ({
      id: f.id, name: f.name, x: f.x, y: f.y, r: f.r, owner: f.owner, cap: f.owner === T ? -1 : f.owner === CT ? 1 : 0,
      contested: false, n: [0, 0], by: new Set(), lastN: 0,
    }));
  },

  update(g, dt) {
    const flags = g.flags;
    for (const f of flags) {
      const n = [0, 0];
      const near = [[], []];
      for (const p of g.players.values()) {
        if (!p.alive || p.team === SPEC) continue;
        if (p.veh) { const v = g.vehicleById(p.veh); if (!v || v.def.kind === 'air') continue; }
        if (Math.abs(p.x - f.x) > f.r || Math.abs(p.y - f.y) > f.r) continue;
        if (Math.hypot(p.x - f.x, p.y - f.y) > f.r) continue;
        n[p.team]++; near[p.team].push(p);
      }
      f.n = n;
      f.contested = n[0] > 0 && n[1] > 0;
      if (f.contested || (n[0] === 0 && n[1] === 0)) continue;
      const team = n[0] > 0 ? T : CT;
      const cnt = n[team];
      const rate = Math.min(RULES.flagCapMax, RULES.flagCapRate * Math.pow(cnt, 0.8));
      const dir = team === T ? -1 : 1;
      for (const p of near[team]) f.by.add(p.id);
      f.cap = Math.max(-1, Math.min(1, f.cap + dir * rate * dt));
      if ((f.owner === CT && f.cap <= 0) || (f.owner === T && f.cap >= 0)) {
        // the enemy flag has been worn down to neutral
        f.owner = -1;
        g.broadcast({ t: 'flag', i: f.id, owner: -1, by: team, name: f.name });
        for (const id of f.by) { const p = g.players.get(id); if (p && p.team === team) g.addScore(p, RULES.score.neutralize, `Neutralized ${f.name}`); }
        f.by.clear();
        g.emit(['flagcap', f.id, -1], f.x, f.y, 6000);
      } else if (f.owner === -1 && Math.abs(f.cap) >= 0.999) {
        f.owner = team; f.cap = dir;
        g.broadcast({ t: 'flag', i: f.id, owner: team, by: team, name: f.name });
        for (const id of f.by) { const p = g.players.get(id); if (p && p.team === team) { g.addScore(p, RULES.score.capture, `Captured ${f.name}`); p.stats.captures++; } }
        f.by.clear();
        g.emit(['flagcap', f.id, team], f.x, f.y, 6000);
      }
    }
    // ticket bleed for the side that holds fewer than half of the flags
    const half = Math.floor(flags.length / 2);
    const own = [0, 0];
    for (const f of flags) if (f.owner === T || f.owner === CT) own[f.owner]++;
    for (const team of [T, CT]) {
      const excess = own[team] - half;
      if (excess > 0 && own[team] > own[otherTeam(team)]) g.tix[otherTeam(team)] = Math.max(0, g.tix[otherTeam(team)] - excess * RULES.bleedPerExcess * dt);
    }
    if (g.tix[0] <= 0 || g.tix[1] <= 0) g.endMatch(g.tix[0] <= 0 && g.tix[1] <= 0 ? -1 : g.tix[0] <= 0 ? CT : T);
    else if (g.timer <= 0) g.endMatch(g.tix[0] === g.tix[1] ? -1 : g.tix[0] > g.tix[1] ? T : CT);
  },

  spawnOptions(g, p) {
    const c = g.map.spawnCenter[p.team];
    const opts = [{ k: 'base', id: 0, name: 'Main Base', x: c.x, y: c.y, ok: true, why: '' }];
    for (const f of g.flags) {
      const contested = f.contested || flagHasEnemy(g, f, p.team);
      const ok = f.owner === p.team && !contested;
      opts.push({ k: 'flag', id: f.id, name: f.name, x: f.x, y: f.y, r: f.r, contested, ok, why: f.owner !== p.team ? 'Not captured' : contested ? 'Contested' : '' });
    }
    return opts;
  },

  onDeath(g, v) { if (v.team === T || v.team === CT) g.tix[v.team] = Math.max(0, g.tix[v.team] - 1); },

  snapshot(g, snap) {
    snap.tix = [Math.round(g.tix[0] * 10) / 10, Math.round(g.tix[1] * 10) / 10];
    snap.fl = g.flags.map((f) => [f.id, f.owner, Math.round(f.cap * 100), f.contested ? 1 : 0]);
  },
};
