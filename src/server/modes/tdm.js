// Team Deathmatch: first team to the kill target wins.
import { T, CT, RULES } from '../../shared/constants.js';

export const tdm = {
  id: 'tdm',

  init(g) {
    g.tix = [0, 0];
    g.target = g.settings.tickets ? Math.round(g.settings.tickets / 2.5) : RULES.tdmKills;
    g.timer = 12 * 60;
    g.flags = [];
  },

  update(g) {
    if (g.tix[0] >= g.target || g.tix[1] >= g.target) g.endMatch(g.tix[0] > g.tix[1] ? T : CT);
    else if (g.timer <= 0) g.endMatch(g.tix[0] === g.tix[1] ? -1 : g.tix[0] > g.tix[1] ? T : CT);
  },

  spawnOptions(g, p) {
    const c = g.map.spawnCenter[p.team];
    return [{ k: 'base', id: 0, name: 'Main Base', x: c.x, y: c.y, ok: true, why: '' }];
  },

  onKill(g, victim, killer) { g.tix[killer.team]++; },

  snapshot(g, snap) { snap.tix = [g.tix[0], g.tix[1]]; snap.tg = g.target; },
};
