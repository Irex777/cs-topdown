// Rush: the Crimson attackers arm and destroy M-COM stations stage by stage while Azure defends. Attackers have limited
// reinforcements; defenders respawn without limit until the last station falls.
import { T, CT, SPEC, RULES, TILE } from '../../shared/constants.js';
import { explode } from '../world.js';

/** Stages from the map data, or generated from the flags (nearest to the attackers first, two stations per stage). */
export function buildStages(map) {
  if (map.rush && map.mcoms.length) {
    return map.rush.map((s, i) => ({ mcoms: map.mcoms.filter((m) => m.stage === i).map((m) => ({ x: m.x, y: m.y })), attack: s.attack, defend: s.defend }));
  }
  const c0 = map.spawnCenter[T], c1 = map.spawnCenter[CT];
  const flags = [...map.flags].sort((a, b) => Math.hypot(a.x - c0.x, a.y - c0.y) - Math.hypot(b.x - c0.x, b.y - c0.y));
  const groups = [];
  for (let i = 0; i < flags.length; i += 2) groups.push(flags.slice(i, i + 2));
  return groups.map((grp, i) => ({
    mcoms: grp.map((f) => ({ x: f.x + 46, y: f.y + 30 })),
    attack: i === 0 ? [c0] : groups[i - 1].map((f) => ({ x: f.x, y: f.y })),
    defend: i === groups.length - 1 ? [c1] : groups[i + 1].map((f) => ({ x: f.x, y: f.y })),
  }));
}

export const rush = {
  id: 'rush',

  init(g) {
    g.stages = buildStages(g.map);
    g.stage = 0;
    g.tix = [Math.round((g.settings.tickets || 250) * 0.32), -1];
    g.timer = RULES.matchTime;
    g.flags = [];
    g.mcoms = [];
    let id = 0;
    g.stages.forEach((s, i) => { for (const m of s.mcoms) g.mcoms.push({ id: id++, stage: i, x: m.x, y: m.y, state: 0, timer: 0, by: 0 }); });
  },

  current(g) { return g.mcoms.filter((m) => m.stage === g.stage); },

  update(g, dt) {
    for (const m of g.mcoms) {
      if (m.state !== 1) continue;
      m.timer -= dt;
      if (Math.floor(m.timer) !== m._last) { m._last = Math.floor(m.timer); g.emit(['beep', Math.round(m.x), Math.round(m.y), Math.round(m.timer)], m.x, m.y, 1700); }
      if (m.timer <= 0) this.destroy(g, m);
    }
    if (g.tix[0] <= 0) g.endMatch(CT);
    else if (g.timer <= 0) g.endMatch(CT);
  },

  destroy(g, m) {
    m.state = 2;
    const by = g.players.get(m.by) || null;
    explode(g, { x: m.x, y: m.y, radius: 210, dmg: 260, veh: 500, tile: 520, owner: by, wid: 'c4', kind: 'c4' });
    g.broadcast({ t: 'mcom', ev: 'destroyed', id: m.id, by: m.by });
    if (by) g.addScore(by, RULES.score.mcom, 'M-COM destroyed');
    for (const p of g.players.values()) if (p.team === T && p !== by && p.alive) g.addScore(p, 25, 'Objective');
    if (this.current(g).every((q) => q.state === 2)) {
      g.stage++;
      g.tix[0] += 14;
      if (g.stage >= g.stages.length) { g.endMatch(T); return; }
      g.broadcast({ t: 'stage', stage: g.stage, of: g.stages.length });
      // anybody left behind in the old defenders' area is fine; new spawns are picked from the next spawn option
    }
  },

  spawnOptions(g, p) {
    const st = g.stages[Math.min(g.stage, g.stages.length - 1)];
    if (p.team === T) {
      if (g.stage === 0) { const c = g.map.spawnCenter[T]; return [{ k: 'base', id: 0, name: 'Main Base', x: c.x, y: c.y, ok: true, why: '' }]; }
      const a = st.attack[Math.floor(Math.random() * st.attack.length)];
      return [{ k: 'area', id: g.stage, name: 'Forward Base', x: a.x, y: a.y, r: 130, ok: true, why: '' }];
    }
    if (g.stage >= g.stages.length - 1) { const c = g.map.spawnCenter[CT]; return [{ k: 'base', id: 0, name: 'Main Base', x: c.x, y: c.y, ok: true, why: '' }]; }
    const d = st.defend[Math.floor(Math.random() * st.defend.length)];
    return [{ k: 'area', id: g.stage, name: 'Fallback Position', x: d.x, y: d.y, r: 130, ok: true, why: '' }];
  },

  onDeath(g, v) { if (v.team === T) g.tix[0] = Math.max(0, g.tix[0] - 1); },

  onUse(g, p, edge, dt) {
    let best = null, bd = 48;
    for (const m of g.mcoms) {
      if (m.stage !== g.stage || m.state === 2) continue;
      const d = Math.hypot(m.x - p.x, m.y - p.y);
      if (d < bd) { bd = d; best = m; }
    }
    if (!best || p.speed > 40) { p.useT = 0; return; }
    if (p.team === T && best.state === 0) {
      p.useKind = 'arm'; p.useT += dt;
      if (p.useT >= RULES.mcomArmTime) {
        best.state = 1; best.timer = RULES.mcomFuse; best.by = p.id; p.useT = 0;
        g.broadcast({ t: 'mcom', ev: 'armed', id: best.id, by: p.id });
        g.addScore(p, RULES.score.arm, 'M-COM armed');
      }
    } else if (p.team === CT && best.state === 1) {
      p.useKind = 'disarm'; p.useT += dt;
      if (p.useT >= RULES.mcomDisarmTime) {
        best.state = 0; p.useT = 0;
        g.broadcast({ t: 'mcom', ev: 'disarmed', id: best.id, by: p.id });
        g.addScore(p, RULES.score.disarm, 'M-COM disarmed');
      }
    } else p.useT = 0;
  },

  snapshot(g, snap) {
    snap.tix = [Math.round(g.tix[0]), g.tix[1]];
    snap.rs = [g.stage, g.stages.length];
    snap.mc = g.mcoms.filter((m) => m.stage === g.stage || m.state === 2 && m.stage === g.stage - 1).map((m) => [m.id, m.state, Math.round(m.timer * 10) / 10, m.stage]);
  },
};
export { SPEC, TILE };
