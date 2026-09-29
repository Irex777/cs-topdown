// Bot AI. Bots drive the exact same movement/combat code as humans and only know what they can see or hear.
import { KEY, T, CT, SPEC, PHASE, RULES, TILE, GREN_ORDER } from '../../shared/constants.js';
import { WEAPONS, maxSpeedFor } from '../../shared/weapons.js';
import { canSee, viewParams } from '../../shared/vision.js';
import { angleDiff } from '../../shared/gamemap.js';
import { startReload, selectSlot } from '../combat.js';

export const BOT_NAMES = [
  'Viper', 'Ghost', 'Rook', 'Nova', 'Blitz', 'Echo', 'Dagger', 'Hex', 'Raven', 'Tango', 'Sable', 'Onyx', 'Flint', 'Jinx',
  'Kilo', 'Mako', 'Orbit', 'Pixel', 'Quill', 'Rex', 'Slate', 'Talon', 'Umber', 'Vex', 'Wolf', 'Yeti', 'Zed', 'Bishop',
];

const DIFF = {
  easy:   { react: 0.60, turn: 6,  sigma: 0.10,  burst: 0.55, nades: 0.25, aggr: 0.25, hold: 0.45 },
  normal: { react: 0.34, turn: 9,  sigma: 0.058, burst: 0.75, nades: 0.55, aggr: 0.45, hold: 0.7 },
  hard:   { react: 0.21, turn: 13, sigma: 0.032, burst: 0.9,  nades: 0.8,  aggr: 0.6,  hold: 0.85 },
  expert: { react: 0.12, turn: 19, sigma: 0.016, burst: 1.0,  nades: 1.0,  aggr: 0.75, hold: 1.0 },
};

const rnd = Math.random;
const pick = (a) => a[Math.floor(rnd() * a.length)];
const gauss = () => (rnd() + rnd() + rnd() - 1.5) * 1.15;
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const norm = (a) => { while (a > Math.PI) a -= Math.PI * 2; while (a < -Math.PI) a += Math.PI * 2; return a; };

/** Shared per-team planning: who attacks which site, who holds where, and what has been spotted. */
export class TeamMind {
  constructor(game) {
    this.g = game;
    this.contact = [null, null];        // last enemy contact reported by each team: {x,y,t,site}
    this.defuser = 0;
    this.awper = [false, false];
    this.eco = [false, false];
    this.style = 'default';
    this.mainSite = 0;
  }

  report(team, x, y) {
    const g = this.g;
    let site = -1, bd = 900;
    for (let s = 0; s < 2; s++) {
      const c = g.nav.siteCentre[s];
      if (!c) continue;
      const d = Math.hypot(c.x - x, c.y - y);
      if (d < bd) { bd = d; site = s; }
    }
    this.contact[team] = { x, y, t: g.time, site };
  }

  hotSite(team) {
    const c = this.contact[team];
    return c && this.g.time - c.t < 9 ? c.site : -1;
  }

  newRound() {
    const g = this.g, nav = g.nav;
    this.contact = [null, null]; this.defuser = 0; this.awper = [false, false];
    const bots = (team) => g.teamPlayers(team).filter((p) => p.bot && p.alive);
    // ----- economy read (T and CT)
    for (const team of [T, CT]) {
      const list = g.teamPlayers(team).filter((p) => p.alive || p.bot);
      const avg = list.length ? list.reduce((s, p) => s + p.money, 0) / list.length : 0;
      this.eco[team] = avg < 2100 && g.round > 1;
    }
    // ----- attackers
    const r = rnd();
    this.style = r < 0.4 ? 'rush' : r < 0.7 ? 'split' : 'default';
    this.mainSite = rnd() < 0.5 ? 0 : 1;
    const ts = bots(T);
    ts.sort(() => rnd() - 0.5);
    ts.forEach((p, i) => {
      let site = this.mainSite;
      if (this.style === 'split') site = i % 2;
      else if (this.style === 'default') site = i < Math.ceil(ts.length * 0.6) ? this.mainSite : 1 - this.mainSite;
      const spots = nav.siteSpots[site].length ? nav.siteSpots[site] : [nav.siteCentre[site]];
      p.bot.assign({ role: 'attack', site, spot: spots[i % spots.length], delay: this.style === 'default' ? rnd() * 7 : rnd() * 1.5 });
    });
    // ----- defenders
    const cts = bots(CT);
    cts.sort(() => rnd() - 0.5);
    const per = Math.max(1, Math.round(cts.length * 0.4));
    cts.forEach((p, i) => {
      let site, spot, role = 'defend';
      if (i < per) site = 0; else if (i < per * 2) site = 1; else { role = 'roam'; site = rnd() < 0.5 ? 0 : 1; }
      if (role === 'roam') spot = nav.midSpots.length ? pick(nav.midSpots) : nav.siteCentre[site];
      else {
        const opts = nav.siteSpots[site].concat(nav.lanes[site]);
        spot = opts.length ? opts[(i * 3 + (rnd() < 0.5 ? 0 : 1)) % opts.length] : nav.siteCentre[site];
      }
      p.bot.assign({ role, site, spot, delay: 0 });
    });
  }
}

export class BotBrain {
  constructor(game, p, difficulty = 'normal') {
    this.g = game; this.p = p;
    this.setDifficulty(difficulty);
    this.reset();
  }

  setDifficulty(d) { this.diff = d; this.d = DIFF[d] || DIFF.normal; }

  reset() {
    const p = this.p;
    this.aim = p.angle || 0;
    this.path = null; this.pathIdx = 0; this.goal = null; this.pathT = 0;
    this.target = 0; this.targetSince = 0; this.visible = false; this.lastSeen = null;
    this.heard = null;
    this.role = 'hold'; this.site = 0; this.spot = null; this.delay = 0; this.postSpot = null; this.watch = undefined;
    this.strafeDir = rnd() < 0.5 ? -1 : 1; this.strafeT = 0; this.strafeMove = false;
    this.errA = 0; this.errT = 0;
    this.stuckT = 0; this.lastX = p.x; this.lastY = p.y; this.nudgeT = 0; this.nudgeDir = 1;
    this.buyAt = 0; this.bought = false;
    this.nadeJob = null; this.nadeCd = 3 + rnd() * 3; this.smokedThisRound = false; this.floodedThisRound = false;
    this.burstLeft = 4; this.burstPause = 0; this.pulse = false; this.lastClip = 99;
    this.flashedUntil = 0;
    this.percT = 0; this.roundT = 0; this.wanderT = 0;
    this.searchUntil = 0; this.defusePick = 0;
    this.savedRound = false;
  }

  // ---------------------------------------------------------------- events from the game
  onSpawn() {
    this.reset();
    this.buyAt = this.g.time + 0.4 + rnd() * 2.2;
    this.aim = this.p.angle;
  }
  onRoundStart() { /* the team plan assigns roles afterwards */ }
  assign(o) {
    this.role = o.role; this.site = o.site; this.spot = o.spot; this.delay = o.delay || 0;
    this.watch = undefined; this.postSpot = null;
    if (this.spot) {
      const enemy = this.g.map.spawnCenter[this.p.team === T ? CT : T];
      this.watch = this.g.nav.watchAngle(this.spot.x, this.spot.y, enemy.x, enemy.y);
    }
  }
  onBombPlanted() { this.path = null; this.goal = null; this.postSpot = null; }
  onFlashed(dur) { this.flashedUntil = Math.max(this.flashedUntil, this.g.time + dur * 0.8); }
  onDeathSeen(v) {
    if (this.p.team === v.team && Math.hypot(v.x - this.p.x, v.y - this.p.y) < 900 && !this.visible) this.heard = { x: v.x, y: v.y, t: this.g.time };
  }
  onNadeThrown(g) { void g; }
  hear(x, y, kind) {
    if (this.visible) return;
    const d = Math.hypot(x - this.p.x, y - this.p.y);
    this.heard = { x, y, t: this.g.time, kind, d };
    this.g.mind.report(this.p.team === T ? CT : T, x, y);   // our own team now knows where the enemy is
  }

  // ---------------------------------------------------------------- main entry
  think(dt) {
    const g = this.g, p = this.p;
    const now = g.time;
    this.roundT += dt;
    const cmd = { keys: 0, angle: this.aim, aimDist: 300, ax: 0, ay: 0 };
    if (!this.bought && now >= this.buyAt) this.doBuy();
    const flashed = now < this.flashedUntil;

    // perception runs at ~15 Hz
    this.percT -= dt;
    if (this.percT <= 0) { this.percT = 0.066; if (!flashed) this.perceive(); else this.visible = false; }

    const w = p.weapon();
    const live = g.phase === PHASE.LIVE || g.mode === 'dm';
    const tq = this.visible && this.target ? g.players.get(this.target) : null;
    const engaged = !!(tq && tq.alive);

    // what we want to do this tick
    let mv = { mode: 'stop' };        // 'path' -> {goal}, 'manual' -> {ax, ay}, 'stop'
    let fire = false, aimAt = null, use = false, walk = false, scope = false, look;

    if (this.nadeJob && live) {
      const r = this.runNadeJob();
      if (r) aimAt = r.aimAt;
    } else if (engaged) {
      const res = this.fight(tq, w, dt, live);
      mv = res.mv; fire = res.fire; aimAt = res.aimAt; scope = res.scope;
      this.nadeCd -= dt;
      if (this.nadeCd <= 0 && live) { this.nadeCd = 2 + rnd() * 3; this.considerCombatNade(tq, Math.hypot(tq.x - p.x, tq.y - p.y)); }
    } else {
      if (this.lastSeen && now - this.lastSeen.t < 1.4) aimAt = { x: this.lastSeen.x, y: this.lastSeen.y };
      else if (this.heard && now - this.heard.t < 1.6) aimAt = { x: this.heard.x, y: this.heard.y };
      const obj = this.objective(dt);
      if (obj) {
        mv = obj.goal ? { mode: 'path', goal: obj.goal } : { mode: 'stop' };
        use = !!obj.use; walk = !!obj.walk; look = obj.look;
        if (obj.aimAt && !aimAt) aimAt = obj.aimAt;
      }
      if (w && w.kind !== 'knife' && !p.reloadT && p.ammoOf(w).clip < w.mag * 0.4 && p.ammoOf(w).reserve > 0) startReload(g, p);
      if ((p.sel === 'grenade' || p.sel === 'knife') && p.drawT <= 0) selectSlot(g, p, p.primary ? 'primary' : 'secondary');
      this.nadeCd -= dt;
      if (this.nadeCd <= 0 && live) { this.nadeCd = 2.5 + rnd() * 3; this.considerObjectiveNade(); }
    }
    if (flashed) mv = { mode: 'stop' };

    // ---- movement
    let mx = 0, my = 0;
    if (mv.mode === 'manual') { mx = mv.ax; my = mv.ay; }
    else if (mv.mode === 'path') { const d = this.pathDir(mv.goal, dt); if (d) { mx = d.x; my = d.y; } }
    else this.path = null;
    // stuck handling
    this.stuckT += dt;
    if (this.stuckT > 0.5) {
      if ((mx || my) && Math.hypot(p.x - this.lastX, p.y - this.lastY) < 5) { this.path = null; this.nudgeT = 0.5; this.nudgeDir = rnd() < 0.5 ? -1 : 1; this.pathT = 0; }
      this.lastX = p.x; this.lastY = p.y; this.stuckT = 0;
    }
    if (this.nudgeT > 0) {
      this.nudgeT -= dt;
      const a = Math.atan2(my, mx) + Math.PI / 2 * this.nudgeDir;
      mx = mx * 0.4 + Math.cos(a) * 0.9; my = my * 0.4 + Math.sin(a) * 0.9;
    }
    cmd.ax = mx; cmd.ay = my;

    // ---- aiming
    let desired;
    if (aimAt) {
      desired = Math.atan2(aimAt.y - p.y, aimAt.x - p.x);
      if (engaged) {
        this.errT -= dt;
        if (this.errT <= 0) { this.errT = 0.18 + rnd() * 0.2; this.errA = gauss() * this.d.sigma * (1 + Math.min(1, Math.hypot(aimAt.x - p.x, aimAt.y - p.y) / 900)); }
        desired += this.errA;
      }
    } else if (look !== undefined && look !== null && !(mx || my)) desired = look;
    else if (mx || my) desired = Math.atan2(my, mx);
    else desired = this.aim;
    const turn = this.d.turn * (engaged ? 1 : 0.55) * (flashed ? 0.15 : 1);
    this.aim = norm(this.aim + clamp(norm(desired - this.aim), -turn * dt, turn * dt));

    // ---- output
    let keys = 0;
    if (fire && !flashed) {
      if (w && !w.auto && w.kind !== 'knife') { this.pulse = !this.pulse; if (this.pulse) keys |= KEY.FIRE; }
      else keys |= KEY.FIRE;
    }
    if (this.nadeJob && this.nadeJob.fire) { keys |= KEY.FIRE; this.nadeJob.fire = false; }
    if (walk) keys |= KEY.WALK;
    if (use) keys |= KEY.USE;
    if (scope) keys |= KEY.SCOPE;
    cmd.keys = keys;
    cmd.angle = this.aim;
    cmd.aimDist = this.nadeJob ? this.nadeJob.dist : 300;
    return cmd;
  }

  /** Combat behaviour against a visible enemy. */
  fight(tq, w, dt, live) {
    const g = this.g, p = this.p, now = g.time;
    const dx = tq.x - p.x, dy = tq.y - p.y;
    const dist = Math.hypot(dx, dy);
    const toEnemy = Math.atan2(dy, dx);
    const kind = w ? w.kind : 'knife';
    const maxEff = kind === 'shotgun' ? 430 : kind === 'smg' ? 850 : kind === 'pistol' ? 800 : kind === 'sniper' ? 3000 : kind === 'knife' ? 60 : 1150;
    const reacted = now - this.targetSince >= this.d.react;
    const ammo = w ? p.ammoOf(w) : { clip: 0, reserve: 0 };
    const scope = !!(w && w.scope && dist > 380 && this.d.hold > 0.6);

    // burst discipline: count shots by watching the magazine
    if (ammo.clip < this.lastClip) {
      this.burstLeft--;
      if (this.burstLeft <= 0) { this.burstPause = 0.18 + rnd() * 0.3 * (1.6 - this.d.burst); this.burstLeft = 3 + Math.floor(rnd() * 4); }
    }
    this.lastClip = ammo.clip;
    if (this.burstPause > 0) this.burstPause -= dt;

    const angErr = Math.abs(angleDiff(toEnemy, this.aim));
    const tol = Math.atan2(10, Math.max(60, dist)) + 0.03;
    let fire = false;
    if (reacted && live && w && angErr < tol && p.drawT <= 0 && p.reloadT <= 0 && p.spawnProt <= 0) {
      if (kind === 'knife') fire = dist < 56;
      else if (ammo.clip > 0 && dist < maxEff) fire = !(w.auto && dist > 340 && this.burstPause > 0);
    }
    // dry magazine handling
    if (w && kind !== 'knife' && ammo.clip <= 0) {
      if (ammo.reserve > 0) { if (dist > 200 || p.sel !== 'primary') startReload(g, p); }
      else if (p.sel === 'primary' && p.secondary && p.ammoOf(WEAPONS[p.secondary]).clip > 0) selectSlot(g, p, 'secondary');
      else if (p.sel !== 'knife') selectSlot(g, p, 'knife');
    }
    // movement while fighting
    this.strafeT -= dt;
    if (this.strafeT <= 0) {
      this.strafeT = 0.3 + rnd() * 0.6;
      if (rnd() < 0.55) this.strafeDir = -this.strafeDir;
      this.strafeMove = rnd() > this.d.hold * 0.85;
    }
    const perp = toEnemy + Math.PI / 2 * this.strafeDir;
    let mv;
    if (kind === 'knife' || (kind === 'shotgun' && dist > 90)) mv = { mode: 'path', goal: { x: tq.x, y: tq.y } };
    else if (kind === 'sniper' || dist > 480) mv = this.strafeMove ? { mode: 'manual', ax: Math.cos(perp) * 0.8, ay: Math.sin(perp) * 0.8 } : { mode: 'stop' };
    else if (dist > 220) {
      if (fire && this.d.hold > 0.5) mv = { mode: 'stop' };
      else mv = { mode: 'manual', ax: Math.cos(perp) * 0.9 + Math.cos(toEnemy) * 0.15, ay: Math.sin(perp) * 0.9 + Math.sin(toEnemy) * 0.15 };
    } else mv = { mode: 'manual', ax: Math.cos(perp), ay: Math.sin(perp) };
    if (mv.mode === 'stop' && !fire && this.d.aggr > 0.55 && dist > 300 && p.hp > 45 && kind !== 'sniper') mv = { mode: 'path', goal: { x: tq.x, y: tq.y } };
    return { mv, fire, aimAt: { x: tq.x, y: tq.y }, scope };
  }

  // ---------------------------------------------------------------- perception
  perceive() {
    const g = this.g, p = this.p;
    const w = p.weapon();
    const view = viewParams(p.scoped, w ? w.scope : 0);
    let best = null, bd = Infinity;
    for (const q of g.players.values()) {
      if (!q.alive || q.team === p.team || q.team === SPEC) continue;
      const d = Math.hypot(q.x - p.x, q.y - p.y);
      if (d >= bd) continue;
      if (canSee(g.map, g.smokes, p.x, p.y, this.aim, view, q.x, q.y, 0)) { best = q; bd = d; }
    }
    if (best) {
      if (this.target !== best.id || !this.visible) {
        if (this.target !== best.id) this.targetSince = g.time;
        else if (!this.visible && g.time - this.lastSeen.t > 0.6) this.targetSince = g.time;
      }
      this.target = best.id;
      this.visible = true;
      this.lastSeen = { x: best.x, y: best.y, t: g.time, vx: best.vx, vy: best.vy };
      g.mind.report(p.team === T ? CT : T, best.x, best.y);
      g.mind.report(p.team, best.x, best.y);
      // remember that the enemy is somewhere here for the whole team's rotation logic
      this.searchUntil = g.time + 3 + rnd() * 2;
    } else {
      if (this.visible) this.targetSince = g.time;
      this.visible = false;
    }
  }

  // ---------------------------------------------------------------- objectives
  /** Returns {goal, use, look, aimAt, walk} or null to idle. */
  objective(dt) {
    const g = this.g, p = this.p, now = g.time;
    if (g.mode === 'dm') return this.wander(dt);
    if (g.phase === PHASE.FREEZE) return { look: this.watch };
    if (g.phase !== PHASE.LIVE) return null;
    // just lost sight of somebody: pre-aim the spot, then maybe go and look
    if (this.lastSeen && !this.visible && now - this.lastSeen.t < 2.4 && !p.hasBomb && p.planting === 0 && p.defusing === 0) {
      const age = now - this.lastSeen.t;
      const s = { x: this.lastSeen.x, y: this.lastSeen.y };
      if (age < 0.9) return { aimAt: s };
      if (this.d.aggr > 0.5 && p.hp > 50 && now < this.searchUntil) return { goal: s, aimAt: s };
    }
    return p.team === T ? this.objectiveT() : this.objectiveCT();
  }

  wander(dt) {
    const g = this.g, nav = g.nav, p = this.p;
    this.wanderT -= dt;
    if (!this.goal || this.wanderT <= 0) {
      const pool = [];
      for (let s = 0; s < 2; s++) { pool.push(...nav.siteSpots[s], ...nav.lanes[s]); }
      pool.push(...nav.midSpots);
      const spot = pick(pool.length ? pool : g.map.spawns[p.team]);
      this.goal = { x: spot.x, y: spot.y };
      this.wanderT = 6 + rnd() * 8;
      this.path = null;
    }
    if (Math.hypot(p.x - this.goal.x, p.y - this.goal.y) < 30) { this.wanderT = Math.min(this.wanderT, 0.8 + rnd()); return null; }
    return { goal: this.goal };
  }

  objectiveT() {
    const g = this.g, p = this.p, nav = g.nav, b = g.bomb;
    if (this.roundT < this.delay && !p.hasBomb) return { look: this.watch };
    if (b.state === 'planted') {
      // post-plant: hold a spot with sight of the bomb
      if (!this.postSpot) this.postSpot = nav.spotWithLos(b.x, b.y, 90, 300);
      const look = Math.atan2(b.y - p.y, b.x - p.x);
      if (Math.hypot(p.x - this.postSpot.x, p.y - this.postSpot.y) < 26) return { look };
      return { goal: this.postSpot };
    }
    if (b.state === 'dropped' && !p.hasBomb) {
      let nearest = null, nd = Infinity;
      for (const q of g.teamPlayers(T)) if (q.alive) { const d = Math.hypot(q.x - b.x, q.y - b.y); if (d < nd) { nd = d; nearest = q; } }
      if (nearest === p) return { goal: { x: b.x, y: b.y } };
    }
    const target = this.spot || nav.siteCentre[this.site];
    if (p.hasBomb) {
      const onSite = g.map.siteAt(p.x, p.y) === this.site + 1;
      const d = Math.hypot(p.x - target.x, p.y - target.y);
      if ((d < 40 || (onSite && d < 110)) && p.speed < 60) return { use: true, look: this.watch };   // plant
      return { goal: target };
    }
    if (Math.hypot(p.x - target.x, p.y - target.y) < 34) return { look: this.watch };
    return { goal: target };
  }

  objectiveCT() {
    const g = this.g, p = this.p, nav = g.nav, b = g.bomb, mind = g.mind;
    const now = g.time;
    if (b.state === 'planted') {
      if (now >= (this.defusePick || 0)) {
        this.defusePick = now + 1.5;
        let best = null, bl = Infinity;
        for (const q of g.teamPlayers(CT)) if (q.alive) { const l = Math.hypot(q.x - b.x, q.y - b.y) - (q.kit ? 120 : 0); if (l < bl) { bl = l; best = q; } }
        mind.defuser = best ? best.id : 0;
      }
      if (mind.defuser === p.id || p.defusing > 0) {
        const need = p.kit ? RULES.defuseTimeKit : RULES.defuseTime;
        const left = p.defusing > 0 ? need - p.defusing : need + nav.pathLength(p.x, p.y, b.x, b.y) / 190;
        if (b.timer < left + 0.3) return { goal: g.map.spawnCenter[CT] };     // too late: save the weapons
        if (Math.hypot(p.x - b.x, p.y - b.y) < 34) return { use: !this.visible, look: this.watch };
        return { goal: { x: b.x, y: b.y } };
      }
      if (!this.postSpot) this.postSpot = nav.spotWithLos(b.x, b.y, 110, 330);
      if (Math.hypot(p.x - this.postSpot.x, p.y - this.postSpot.y) < 28) return { look: Math.atan2(b.y - p.y, b.x - p.x) };
      return { goal: this.postSpot };
    }
    // rotate on intel from the rest of the team
    const hot = mind.hotSite(CT);
    if (hot >= 0 && hot !== this.site && (this.role === 'roam' || (this.d.aggr > 0.4 && rnd() < 0.015))) {
      const opts = nav.siteSpots[hot];
      if (opts && opts.length) {
        this.site = hot; this.spot = opts[p.id % opts.length]; this.role = 'defend';
        const enemy = g.map.spawnCenter[T];
        this.watch = nav.watchAngle(this.spot.x, this.spot.y, enemy.x, enemy.y);
      }
    }
    const spot = this.spot || nav.siteCentre[this.site];
    if (Math.hypot(p.x - spot.x, p.y - spot.y) < 34) return { look: this.watch };
    return { goal: spot };
  }

  // ---------------------------------------------------------------- navigation
  pathDir(goal, dt) {
    const p = this.p, nav = this.g.nav;
    this.pathT -= dt;
    const goalChanged = !this.goal || Math.hypot(this.goal.x - goal.x, this.goal.y - goal.y) > 30;
    if (goalChanged || (!this.path && this.pathT <= 0)) {
      this.goal = { x: goal.x, y: goal.y };
      this.path = nav.findPath(p.x, p.y, goal.x, goal.y);
      this.pathIdx = 0;
      this.pathT = 0.4;
    }
    if (!this.path) return null;
    while (this.pathIdx < this.path.length - 1 && Math.hypot(this.path[this.pathIdx].x - p.x, this.path[this.pathIdx].y - p.y) < 18) this.pathIdx++;
    const wp = this.path[this.pathIdx];
    const d = Math.hypot(wp.x - p.x, wp.y - p.y);
    if (d < 10 && this.pathIdx >= this.path.length - 1) return null;
    return { x: (wp.x - p.x) / d, y: (wp.y - p.y) / d };
  }

  // ---------------------------------------------------------------- grenades
  considerCombatNade(tq, dist) {
    const p = this.p, g = this.g;
    if (rnd() > this.d.nades) return;
    if (p.grenades.he > 0 && dist > 240 && dist < 560 && rnd() < 0.5) return this.startNade('he', tq.x, tq.y);
    if (p.grenades.flash > 0 && dist > 200 && dist < 520 && rnd() < 0.4) return this.startNade('flash', tq.x, tq.y);
    if (p.grenades.molo > 0 && dist > 260 && dist < 560 && rnd() < 0.4) return this.startNade('molo', tq.x, tq.y);
  }

  considerObjectiveNade() {
    const p = this.p, g = this.g, nav = g.nav, b = g.bomb;
    if (rnd() > this.d.nades || this.nadeJob) return;
    if (p.team === T && b.state !== 'planted' && p.grenades.smoke > 0 && !this.smokedThisRound && this.role === 'attack') {
      const site = nav.siteCentre[this.site];
      if (site) {
        const d = Math.hypot(site.x - p.x, site.y - p.y);
        if (d > 300 && d < 720) { this.smokedThisRound = true; return this.startNade('smoke', p.x + (site.x - p.x) * 0.72, p.y + (site.y - p.y) * 0.72); }
      }
    }
    if (p.team === T && b.state !== 'planted' && p.grenades.flash > 0 && this.role === 'attack') {
      const site = nav.siteCentre[this.site];
      if (site) {
        const d = Math.hypot(site.x - p.x, site.y - p.y);
        if (d > 260 && d < 520 && rnd() < 0.6) return this.startNade('flash', site.x, site.y);
      }
    }
    if (p.team === CT && b.state === 'planted' && p.grenades.molo > 0 && !this.floodedThisRound) {
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d > 220 && d < 600 && this.g.mind.defuser !== p.id) { this.floodedThisRound = true; return this.startNade('molo', b.x, b.y); }
    }
    if (p.team === CT && b.state === 'planted' && p.grenades.smoke > 0 && this.g.mind.defuser === p.id && !this.smokedThisRound) {
      const d = Math.hypot(b.x - p.x, b.y - p.y);
      if (d > 260 && d < 520) { this.smokedThisRound = true; return this.startNade('smoke', b.x + (p.x - b.x) * 0.2, b.y + (p.y - b.y) * 0.2); }
    }
  }

  startNade(type, tx, ty) {
    const p = this.p;
    const dist = Math.hypot(tx - p.x, ty - p.y);
    this.nadeJob = { type, tx, ty, dist, stage: 0, t: 0, fire: false, count: p.grenades[type] };
  }

  runNadeJob() {
    const g = this.g, p = this.p, job = this.nadeJob;
    job.t += 1 / 60;
    if (job.t > 2.2 || p.grenades[job.type] < job.count) { this.nadeJob = null; if (p.grenades[job.type] < job.count) { selectSlot(g, p, p.primary ? 'primary' : 'secondary'); } return null; }
    const res = { aimAt: { x: job.tx, y: job.ty }, stop: true };
    if (p.sel !== 'grenade' || p.gsel !== job.type) {
      if (((g.tick + p.id) & 7) === 0) selectSlot(g, p, 'grenade');
      return res;
    }
    if (p.drawT > 0) return res;
    const desired = Math.atan2(job.ty - p.y, job.tx - p.x);
    if (Math.abs(norm(desired - this.aim)) < 0.08) { job.fire = ((g.tick & 1) === 0); }
    return res;
  }

  // ---------------------------------------------------------------- shopping
  doBuy() {
    const g = this.g, p = this.p;
    this.bought = true;
    if (g.mode === 'dm') return this.buyDm();
    if (!g.canBuy(p)) return;
    const team = p.team, mind = g.mind;
    const hasPrimary = !!p.primary;
    const eco = mind.eco[team];
    const buy = (id) => g.buy(p, id, true);
    let m = p.money;
    if (!hasPrimary) {
      const rifle = team === T ? 'ak47' : (rnd() < 0.55 ? 'm4a4' : 'm4a1s');
      const mid = team === T ? 'galil' : 'famas';
      const smg = team === T ? 'mac10' : 'mp9';
      if (!eco && m >= 5750 && !mind.awper[team] && rnd() < (this.diff === 'expert' ? 0.35 : this.diff === 'hard' ? 0.22 : 0.1)) { if (buy('awp')) mind.awper[team] = true; }
      else if (!eco && m >= 3300) buy(rifle);
      else if (!eco && m >= 2700 && team === T) buy('ak47');
      else if (!eco && m >= 2900 && team === CT) buy('m4a1s');
      else if (!eco && m >= 2500 && rnd() < 0.5) buy(mid);
      else if (!eco && m >= 1700) buy(mid);
      else if (m >= 1450 && rnd() < 0.7) buy(smg);
      else if (m >= 1150 && rnd() < 0.5) buy(pick(['ump45', 'nova']));
    }
    m = p.money;
    if (m >= 1000 && p.armor < 100) buy('helmet');
    else if (m >= 650 && p.armor < 100) buy('kevlar');
    if (!p.primary && p.money >= 700 && rnd() < 0.5) buy('deagle');
    else if (!p.primary && p.money >= 500) buy(team === T ? 'tec9' : 'fiveseven');
    else if (!p.primary && p.money >= 300 && p.secondary === (team === T ? 'glock' : 'usp') && rnd() < 0.5) buy('p250');
    if (team === CT && p.money >= 400 && !p.kit && (!eco || rnd() < 0.3)) buy('kit');
    // utility
    const order = eco ? ['flash'] : team === T ? ['smoke', 'flash', 'he', 'molo'] : ['smoke', 'he', 'flash', 'molo'];
    for (const u of order) if (p.money >= 300 + (u === 'flash' ? -100 : 0) + 100 && rnd() < this.d.nades + 0.15) buy(u);
    if (p.primary) selectSlot(g, p, 'primary');
    p.lastBuys = p.buys.slice();
  }

  buyDm() {
    const g = this.g, p = this.p;
    const team = p.team;
    const rifles = team === T ? ['ak47', 'galil', 'sg553'] : ['m4a4', 'm4a1s', 'famas', 'aug'];
    const r = rnd();
    const primary = r < 0.6 ? pick(rifles) : r < 0.75 ? 'awp' : r < 0.9 ? pick(['mp7', 'ump45', 'p90']) : 'nova';
    g.buy(p, primary, true); g.buy(p, 'helmet', true);
    if (rnd() < 0.5) g.buy(p, 'he', true);
    if (rnd() < 0.4) g.buy(p, 'flash', true);
    selectSlot(g, p, 'primary');
  }
}
