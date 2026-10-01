// In-game DOM UI: ticket bar, flags, health/ammo, squad, kill feed, chat, scoreboard, pause menu, banners, deploy screen.
import { PHASE, T, CT, SPEC, GREN_ORDER, GRENADE, TEAM_NAMES, RULES, SQUAD_NAMES } from '../../shared/constants.js';
import { WEAPONS, WEAPON_LIST, GADGET_LIST, HELD_GREN_BASE, HELD_GADGET_BASE, CLASSES, ATTACH, resolveWeapon, ALT } from '../../shared/weapons.js';
import { VEHICLES, VEHICLE_LIST, vehicleDistance } from '../../shared/vehicles.js';
import { audio } from '../audio.js';
import { Minimap } from '../game/minimap.js';
import { gunIcon } from '../game/viewmodel.js';
import { DeployScreen } from './deploy.js';
import { settingsHTML, bindSettings, controlsHTML } from './settings.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const GREN_HEX = { he: '#5b8a45', flash: '#eeeeee', smoke: '#9aa4ae', molo: '#e0622f' };
const KILL_NAMES = {
  he: 'FRAG', molo: 'FIRE', knife: 'KNIFE', vehicle: 'VEHICLE', barrel: 'BARREL', c4: 'C4', mine: 'MINE', claymore: 'CLAYMORE', rpg: 'RL-80', smaw: 'RL-80', stinger: 'AA',
  cannon: 'TANK', apcgun: 'AUTOCANNON', hrocket: 'ROCKETS', ugl: '40MM', mk: 'MASTERKEY', world: 'X', ram: 'RAM', crash: 'CRASH',
};
const CLS_LETTER = { assault: 'A', engineer: 'E', support: 'S', recon: 'R' };
const CLS_NAME = { assault: 'Assault', engineer: 'Engineer', support: 'Support', recon: 'Recon' };
const PT_CLS = ['e', 'f', 's'];     // visual team (0 enemy, 1 friendly, 2 neutral) -> css class
const CLS_COL = { assault: '#e0703a', engineer: '#e0b93a', support: '#4aa8e0', recon: '#7fd35a' };

export class HUD {
  constructor(game, net, app) {
    this.game = game; this.net = net; this.app = app;
    this.el = {};
    for (const id of ['hud', 'scoreF', 'scoreE', 'barF', 'barE', 'nameF', 'nameE', 'roundTime', 'roundLabel', 'flagRow', 'objective', 'mates', 'compass',
      'killfeed', 'scorefeed', 'banner', 'prompt', 'progress', 'progressLabel', 'progressFill', 'hpNum', 'hpFill', 'arNum', 'arFill', 'clsName', 'vehbox', 'clip', 'reserve', 'weaponName', 'weaponAtt',
      'weaponImg', 'fireMode', 'slots', 'chatlog', 'chatbox', 'chatInput', 'chatTag', 'specbar', 'deathcard', 'netstat', 'score', 'pause', 'endgame', 'radar', 'left-col']) this.el[id] = $(id);
    this.minimap = new Minimap(this.el.radar);
    this.deploy = new DeployScreen(app, game, net);
    this.scoreOpen = false; this.pauseOpen = false; this.chatOpen = false; this.chatTeam = true;
    this.cache = {};
    this.slow = 0;
    this.bannerTimer = 0;
    this.maxTix = 0;
    this.deathAt = 0;
    this.deployManual = false;
    game.ui = this;
    this.bindNet();
    this.bindChat();
    this.compassCtx = this.el.compass.getContext('2d');
  }

  tcls(team) { return PT_CLS[this.game.pt(team)]; }

  // ------------------------------------------------------------------ hooks called by ClientGame
  inputBlocked() { return this.pauseOpen || this.chatOpen || this.endOpen || this.deploy.open; }
  isOverlayOpen() { return this.pauseOpen || this.endOpen || this.deploy.open; }
  deployOpen() { return this.deploy.open; }
  onRespawn() {
    this.el.deathcard.classList.add('hidden');
    this.deployManual = false;
    if (this.deploy.open) this.deploy.hide();
  }
  onDeath() {
    const k = this.lastKillOnMe;
    this.deathAt = performance.now();
    if (k) {
      const w = KILL_NAMES[k.w] || (WEAPONS[k.w] ? WEAPONS[k.w].name : '');
      this.el.deathcard.innerHTML = k.k ? `<h3>YOU WERE KILLED</h3><p>by <b>${esc(this.game.nameOf(k.k))}</b>${w ? ' with ' + esc(w) : ''}</p>` : '<h3>YOU DIED</h3>';
    } else this.el.deathcard.innerHTML = '<h3>YOU DIED</h3>';
    this.el.deathcard.classList.remove('hidden');
    setTimeout(() => this.el.deathcard.classList.add('hidden'), 2600);
  }
  onSnapshot() { /* per-frame work happens in onFrame */ }
  onScore(pts, label) {
    const d = document.createElement('div');
    d.className = 'sf'; d.textContent = `+${pts} ${label}`;
    this.el.scorefeed.appendChild(d);
    while (this.el.scorefeed.children.length > 4) this.el.scorefeed.firstChild.remove();
    setTimeout(() => d.remove(), 1700);
  }

  toggleDeploy() {
    const g = this.game;
    if (g.myTeam() === SPEC || this.pauseOpen || this.chatOpen || this.endOpen) return;
    if (this.deploy.open) { if (g.alive || this.deploy.editOnly) { this.deploy.hide(); this.deployManual = false; } return; }
    this.deployManual = true;
    this.deploy.show(g.alive);
  }

  // ------------------------------------------------------------------ network messages
  bindNet() {
    const n = this.net, g = this.game;
    n.on('begin', (m) => {
      g.mode = m.mode; g.tix = m.tix;
      this.maxTix = Math.max(m.tix[0], m.tix[1], 1);
      g.corpses.length = 0; g.fx.clearAll(); g.pings.length = 0;
      this.lastKillOnMe = null;
      this.el.killfeed.innerHTML = '';
      this.closeEnd();
      const name = { conquest: 'Conquest', rush: 'Rush', tdm: 'Team Deathmatch' }[m.mode];
      const sub = { conquest: 'Capture and hold the flags. Bleed the enemy tickets dry.', rush: 'Vanguard attacks: arm and destroy the M-COM stations. Bulwark defends.', tdm: 'First team to the kill target wins.' }[m.mode];
      this.banner(name, sub, 'g', 3600);
      this.maybeShowHints();
      audio.roundStart();
    });
    n.on('match_over', (m) => this.onMatchOver(m));
    n.on('flag', (m) => this.onFlag(m));
    n.on('mcom', (m) => this.onMcom(m));
    n.on('stage', (m) => this.banner('Stage cleared', `Stage ${m.stage + 1} of ${m.of} — the fight moves on`, 'g', 3200));
    n.on('kill', (m) => this.onKill(m));
    n.on('chat', (m) => this.onChat(m));
    n.on('roster', (m) => { g.roster.clear(); for (const p of m.players) g.roster.set(p.id, p); g.hostId = m.host; this.rosterDirty = true; });
    n.on('ping', (m) => { g.pings.push({ id: m.id, x: m.x, y: m.y, team: m.team, t: performance.now() }); if (m.id !== g.you) audio.ping(); });
    n.on('toast', (m) => this.app.toast(m.text));
    n.on('kit', (m) => { g.kit = m.lo; this.cache.slots = null; });
    n.on('tiles', (m) => { if (g.map) g.applyTiles(m.c); });
  }

  maybeShowHints() {
    let seen = false;
    try { seen = localStorage.getItem('bf.hints') === '1'; } catch { /* ignore */ }
    if (seen || this.hintShown) return;
    this.hintShown = true;
    try { localStorage.setItem('bf.hints', '1'); } catch { /* ignore */ }
    const div = document.createElement('div');
    div.className = 'hintbar';
    div.innerHTML = '<span><kbd>WASD</kbd> move</span><span><kbd>Mouse</kbd> look / fire</span><span><kbd>RMB</kbd> aim</span><span><kbd>E</kbd> interact</span><span><kbd>Esc</kbd> controls & settings</span>';
    this.el.hud.appendChild(div);
    setTimeout(() => div.remove(), 8000);
  }

  /** kill-feed / death-card glyph for a damage source: the gun silhouette, or a short label */
  weaponGlyph(id) {
    const w = WEAPONS[id];
    if (w && w.kind !== 'knife') {
      const url = gunIcon(w.id, w.kind, null, 220, 90);
      if (url) return `<img class="kw" src="${url}" alt="${esc(w.name)}" title="${esc(w.name)}">`;
    }
    return `<span class="w">${esc(KILL_NAMES[id] || (w ? w.name : 'X'))}</span>`;
  }

  onKill(m) {
    const g = this.game;
    if (m.v === g.you) this.lastKillOnMe = m;
    const div = document.createElement('div');
    if (m.vt) {
      const kn = g.nameOf(m.k), kt = this.tcls(g.teamOf(m.k));
      div.className = 'kf' + (m.k === g.you ? ' me' : '');
      div.innerHTML = `<span class="${kt}">${esc(kn)}</span>${this.weaponGlyph(m.w)}<span class="${PT_CLS[g.pt(m.vtm)]}">${esc(VEHICLES[m.vt] ? VEHICLES[m.vt].name : 'Vehicle')}</span>`;
    } else {
      const kn = m.k ? g.nameOf(m.k) : '', vn = g.nameOf(m.v);
      const kt = m.k ? this.tcls(g.teamOf(m.k)) : '', vt = this.tcls(g.teamOf(m.v));
      div.className = 'kf' + (m.k === g.you ? ' me' : '') + (m.v === g.you ? ' dead' : '');
      div.innerHTML = `${m.k ? `<span class="${kt}">${esc(kn)}</span>` : ''}${m.a ? `<span class="as">+ ${esc(g.nameOf(m.a))}</span>` : ''}${this.weaponGlyph(m.w)}${m.hs ? '<span class="hs" title="Headshot">◉</span>' : ''}<span class="${vt}">${esc(vn)}</span>${m.tk ? '<span class="as">(TK)</span>' : ''}`;
    }
    this.el.killfeed.appendChild(div);
    while (this.el.killfeed.children.length > 6) this.el.killfeed.firstChild.remove();
    setTimeout(() => div.remove(), 7000);
  }

  onFlag(m) {
    const g = this.game;
    const mine = g.myTeam();
    const name = m.name;
    if (m.owner < 0) this.notice(`${TEAM_NAMES[m.by]} neutralized flag ${name}`);
    else {
      this.banner(m.owner === mine ? `Captured ${name}` : `Lost ${name}`, m.owner === mine ? 'Your team holds this flag' : `${TEAM_NAMES[m.owner]} took the flag`, this.tcls(m.owner), 2200);
    }
    this.cache.flags = null;
  }

  onMcom(m) {
    const g = this.game;
    const by = g.nameOf(m.by);
    if (m.ev === 'armed') { this.banner('M-COM armed', `${esc(by)} armed a station — disarm it before it blows!`, 'e', 2400); this.notice(`${by} armed an M-COM`); }
    else if (m.ev === 'disarmed') { this.banner('M-COM disarmed', `${esc(by)} saved the station`, 'f', 2200); }
    else if (m.ev === 'destroyed') this.banner('M-COM destroyed', '', 'e', 2000);
  }

  onMatchOver(m) {
    const g = this.game;
    g.phase = PHASE.OVER;
    this.endOpen = true;
    this.deploy.hide();
    // experience for the profile card on the main menu: match score plus a bonus for the win
    try { const rec = g.roster.get(g.you); const gain = (rec ? rec.s : 0) + (m.winner === g.myTeam() ? 150 : 40); localStorage.setItem('bf.xp', String((Number(localStorage.getItem('bf.xp')) || 0) + Math.max(0, Math.round(gain)))); } catch { /* ignore */ }
    const winName = m.winner < 0 ? 'Nobody' : TEAM_NAMES[m.winner];
    const mine = g.myTeam();
    const won = m.winner === mine;
    setTimeout(() => {
      if (!this.endOpen) return;
      this.el.endgame.classList.remove('hidden');
      const rec = g.roster.get(g.you), result = m.winner < 0 ? 'draw' : won ? 'win' : mine === SPEC ? 'draw' : 'lose';
      const stat = (v, l) => `<div><b>${v}</b><span>${l}</span></div>`;
      this.el.endgame.innerHTML = `<div class="inner end-box ${result}" role="dialog" aria-label="Match result"><div class="eb-head"><span class="eyebrow">Match complete</span><h1>${m.winner < 0 ? 'Draw' : won ? 'Victory' : mine === SPEC ? winName + ' win' : 'Defeat'}</h1>
        <p>${winName} win the match <i></i> tickets ${m.tix[0]} : ${m.tix[1] < 0 ? '∞' : m.tix[1]}</p></div>
        ${rec && mine !== SPEC ? `<div class="eb-stats">${stat(rec.s, 'Score')}${stat(rec.k, 'Kills')}${stat(rec.d, 'Deaths')}${stat(rec.a, 'Assists')}${stat(rec.rv, 'Revives')}${stat(rec.cp, 'Captures')}</div>` : ''}
        <div class="eb-tables">${this.scoreTables(true)}</div>
        <div class="eb-foot"><span>${this.app.isHost() ? 'Returning to the lobby in a few seconds…' : 'Returning to the lobby…'}</span><button class="btn" id="endLeave">Leave room</button></div></div>`;
      const b = $('endLeave'); if (b) b.onclick = () => this.app.leaveRoom();
    }, 2200);
    if (g.myTeam() === m.winner) audio.roundWin(); else audio.roundLose();
  }

  closeEnd() { this.endOpen = false; this.el.endgame.classList.add('hidden'); }

  onChat(m) {
    const g = this.game;
    const div = document.createElement('div');
    if (m.sys) { div.className = 'cl sys'; div.textContent = m.text; }
    else {
      div.className = 'cl';
      const tc = ['t', 'ct', 's'][g.pt(g.teamOf(m.from))];
      div.innerHTML = `${m.team >= 0 ? '<span class="tag">[TEAM]</span>' : ''}<b class="${tc}">${esc(m.name)}</b>: ${esc(m.text)}`;
      audio.chat();
    }
    this.el.chatlog.appendChild(div);
    while (this.el.chatlog.children.length > 7) this.el.chatlog.firstChild.remove();
    setTimeout(() => div.remove(), 11000);
  }

  // ------------------------------------------------------------------ banners / notices
  banner(title, sub, cls, ms = 2500) {
    const el = this.el.banner;
    el.innerHTML = `<div class="banner-in ${cls || ''}"><h2>${esc(title)}</h2>${sub ? `<p>${sub}</p>` : ''}</div>`;
    clearTimeout(this.bannerTimer);
    this.bannerTimer = setTimeout(() => { el.innerHTML = ''; }, ms);
  }

  notice(text) { this.onChat({ sys: 1, text }); }

  // ------------------------------------------------------------------ chat
  bindChat() {
    const inp = this.el.chatInput;
    inp.addEventListener('keydown', (e) => {
      e.stopPropagation();
      if (e.key === 'Enter') {
        const text = inp.value.trim();
        if (text) this.net.send({ t: 'chat', text, team: this.chatTeam ? 1 : 0 });
        this.closeChat();
      } else if (e.key === 'Escape') this.closeChat();
    });
  }

  openChat(team) {
    if (this.chatOpen) return;
    this.game.input.reset();
    this.chatOpen = true; this.chatTeam = team && this.game.myTeam() !== SPEC;
    this.el.chatTag.textContent = this.chatTeam ? 'TEAM' : 'ALL';
    this.el.chatbox.classList.remove('hidden');
    this.el.chatInput.value = '';
    this.el.chatInput.focus();
  }

  closeChat() {
    this.chatOpen = false;
    this.el.chatbox.classList.add('hidden');
    this.el.chatInput.blur();
  }

  // ------------------------------------------------------------------ menus
  toggleMenu() {
    if (this.chatOpen) { this.closeChat(); return; }
    if (this.endOpen) return;
    if (this.deploy.open && this.deploy.editOnly) { this.deploy.hide(); return; }
    this.pauseOpen ? this.closePause() : this.openPause();
  }

  openPause(tab = 'game') {
    this.game.input.reset();
    this.pauseOpen = true;
    document.body.classList.add('menu-open');
    const el = this.el.pause;
    el.classList.remove('hidden');
    const g = this.game, mt = g.myTeam();
    const tabs = [['game', 'Match'], ['settings', 'Settings'], ['controls', 'Controls']];
    const seg = (id, items) => `<div class="seg" id="${id}" role="group">${items.join('')}</div>`;
    const pane = tab === 'settings' ? settingsHTML(g) : tab === 'controls' ? controlsHTML() : `
      <section class="set-group"><h4>Team</h4>${seg('pauseTeam', [[0, TEAM_NAMES[0], T], [1, TEAM_NAMES[1], CT], [2, 'Spectate', SPEC]].map(([v, l, t]) => `<button data-t="${v}" class="${mt === t ? 'on' : ''}" aria-pressed="${mt === t}">${l}</button>`))}<p class="field-note">Changing team respawns you.</p></section>
      <section class="set-group"><h4>Squad</h4>${seg('pauseSquad', [0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<button data-s="${i}" class="${g.mySquad() === i ? 'on' : ''}" aria-pressed="${g.mySquad() === i}">${'ABCDEFGH'[i]}</button>`))}<p class="field-note">Squad mates share spawn points and supplies.</p></section>
      <section class="set-group"><h4>Loadout</h4><button class="btn" id="changeKit">Change loadout <kbd>L</kbd></button><p class="field-note">New kit applies the next time you spawn.</p></section>`;
    el.innerHTML = `<div class="inner pause-box" role="dialog" aria-label="Paused">
      <div class="pb-head"><div><h2>Paused</h2><p>The match keeps running while this menu is open.</p></div><button class="btn primary" id="resumeBtn">Resume <kbd>Esc</kbd></button></div>
      <div class="pb-tabs" role="tablist">${tabs.map(([k, l]) => `<button data-ptab="${k}" class="${tab === k ? 'on' : ''}" aria-pressed="${tab === k}">${l}</button>`).join('')}</div>
      <div class="pb-body">${pane}</div>
      <div class="pb-foot">${this.app.isHost() ? '<button class="btn" id="endMatchBtn">End match for everyone</button>' : '<span></span>'}<button class="btn danger" id="leaveBtn">Leave match</button></div></div>`;
    $('resumeBtn').onclick = () => this.closePause();
    $('leaveBtn').onclick = () => { this.closePause(); this.app.leaveRoom(); };
    const em = $('endMatchBtn'); if (em) em.onclick = () => { this.net.send({ t: 'lobby' }); this.closePause(); };
    el.querySelectorAll('[data-ptab]').forEach((b) => { b.onclick = () => this.openPause(b.dataset.ptab); });
    if (tab === 'settings') bindSettings(el, g);
    if (tab === 'game') {
      $('pauseTeam').onclick = (e) => { const b = e.target.closest('button'); if (b) { this.net.send({ t: 'team', team: Number(b.dataset.t) }); this.closePause(); } };
      $('pauseSquad').onclick = (e) => { const b = e.target.closest('button'); if (b) { this.net.send({ t: 'a', a: 'squad', n: Number(b.dataset.s) }); this.closePause(); } };
      $('changeKit').onclick = () => { this.closePause(); this.deploy.show(true); };
    }
    el.onclick = (e) => { if (e.target === el) this.closePause(); };
  }

  closePause() {
    this.pauseOpen = false;
    document.body.classList.remove('menu-open');
    this.el.pause.classList.add('hidden');
  }

  showScore(show) {
    this.scoreOpen = !!show;
    this.el.score.classList.toggle('hidden', !show);
    if (show) this.renderScore();
  }

  renderScore() {
    const g = this.game, s = this.app.room || {};
    const modeName = { conquest: 'Conquest', rush: 'Rush', tdm: 'Team Deathmatch' }[g.mode] || '';
    this.el.score.innerHTML = `<div class="inner score-box"><div class="sb-head"><h2>${esc(g.map ? g.map.name : '')}<span>${modeName}</span></h2><small>Room <b>${esc(s.code || '')}</b> · release <kbd>Tab</kbd> to close</small></div>${this.scoreTables(false)}</div>`;
  }

  scoreTables(final) {
    const g = this.game;
    const mine = g.myTeam();
    const order = mine === CT ? [CT, T, SPEC] : [T, CT, SPEC];
    let html = '';
    const players = [...g.roster.values()];
    for (const team of order) {
      const list = players.filter((p) => p.tm === team).sort((a, b) => b.s - a.s || b.k - a.k);
      if (team === SPEC && !list.length) continue;
      const tix = g.tix[team];
      const head = team === SPEC ? list.length : g.mode === 'tdm' ? tix : (tix < 0 ? '∞' : Math.max(0, Math.ceil(tix)));
      html += `<div class="sb-team ${['t', 'ct', 's'][g.pt(team)]}"><h3><span>${TEAM_NAMES[team]}</span><span>${head}${team === SPEC ? '' : g.mode === 'tdm' ? ' kills' : ' tickets'}</span></h3><table class="sb-table"><tr><th>Player</th>${team === SPEC ? '' : '<th>Score</th><th>Kills</th><th>Deaths</th><th>Assists</th><th>Revives</th><th>Captures</th>'}<th>Ping</th></tr>`;
      for (const p of list) {
        html += `<tr class="${p.id === g.you ? 'me' : ''} ${p.al || team === SPEC || final ? '' : 'dead'}"><td>${team === SPEC ? '' : `<span class="cls" style="background:${CLS_COL[p.cl] || '#888'}">${CLS_LETTER[p.cl] || 'A'}</span>`}${esc(p.n)}${p.b ? '<span class="bot">BOT</span>' : ''}${p.id === g.hostId ? '<span class="bot">HOST</span>' : ''}${p.sq >= 0 && team !== SPEC ? `<span class="bot">${'ABCDEFGH'[p.sq] || ''}</span>` : ''}</td>`;
        if (team !== SPEC) html += `<td>${p.s}</td><td>${p.k}</td><td>${p.d}</td><td>${p.a}</td><td>${p.rv}</td><td>${p.cp}</td>`;
        html += `<td>${p.b ? '-' : p.dc ? 'DC' : p.pg}</td></tr>`;
      }
      html += '</table></div>';
    }
    return html;
  }

  // ------------------------------------------------------------------ per-frame refresh
  set(key, value, fn) {
    if (this.cache[key] === value) return;
    this.cache[key] = value;
    fn(value);
  }

  onFrame(g, dt) {
    const now = performance.now();
    const me = g.me;
    const el = this.el;
    this.minimap.draw(g);
    this.slow -= dt;
    const slowTick = this.slow <= 0;
    if (slowTick) this.slow = 0.2;

    // ---- deploy screen opens by itself while dead
    const dead = !g.alive && g.myTeam() !== SPEC && g.phase === PHASE.LIVE && g.active;
    if (dead && !this.deploy.open && !this.endOpen && !this.pauseOpen && (now - this.deathAt > 1500 || !this.deathAt)) this.deploy.show(false);
    if (!dead && this.deploy.open && !this.deploy.editOnly) this.deploy.hide();
    if (g.myTeam() === SPEC && this.deploy.open) this.deploy.hide();
    this.deploy.update(dt);
    document.body.classList.toggle('deploying', this.deploy.open);

    this.renderTop(g, now);
    this.renderCompass(g);
    if (slowTick) {
      this.renderMates(g);
      if (this.scoreOpen) this.renderScore();
      el.netstat.textContent = `${g.stats.fps} fps · ${Math.round(this.net.rtt)} ms`;
    }

    // ---- own status
    const showStatus = !!me && g.alive;
    if (me) {
      this.set('hp', me.hp, (v) => {
        el.hpNum.textContent = v; el.hpNum.classList.toggle('low', v <= 25);
        el.hpFill.style.width = `${Math.max(0, Math.min(100, v))}%`; el.hpFill.className = v <= 25 ? 'low' : v <= 50 ? 'mid' : '';
      });
      const ar = me.ar || 0, maxAr = (CLASSES[me.cls] && CLASSES[me.cls].armor) || 50;
      this.set('ar', ar + '/' + maxAr, () => { el.arNum.textContent = ar; el.arFill.style.width = `${Math.max(0, Math.min(100, (ar / maxAr) * 100))}%`; });
      this.set('cls', me.cls, (v) => { el.clsName.textContent = (CLASSES[v] ? CLASSES[v].name : '').toUpperCase(); });
      this.renderWeapon(g, me);
      this.renderVehicle(g, me);
    }
    el.hud.querySelector('#statusbox').style.visibility = showStatus ? 'visible' : 'hidden';
    el.hud.querySelector('#weaponbox').style.visibility = showStatus && !(me && me.veh) ? 'visible' : 'hidden';

    this.updatePrompt(g, me);

    // ---- spectate bar
    const spec = !g.alive && me && !this.deploy.open;
    this.set('spec', spec ? me.id : 0, () => { el.specbar.classList.toggle('hidden', !spec); });
    if (spec && this.cache.specName !== g.nameOf(me.id)) {
      this.cache.specName = g.nameOf(me.id);
      el.specbar.innerHTML = `<small>SPECTATING</small><b>${esc(g.nameOf(me.id))}</b><small>Click or <kbd>Space</kbd> for next player${g.myTeam() === SPEC ? ' · <kbd>H</kbd> free camera' : ''}</small>`;
    }
  }

  /** ticket bars: the friendly side (blue) is always on the left, the enemy (red) on the right */
  renderTop(g, now) {
    const el = this.el;
    const mode = g.mode;
    const tix = g.tix;
    const mine = g.myTeam();
    const fT = mine === CT ? CT : T, eT = fT === T ? CT : T;        // spectators see Vanguard on the left
    this.maxTix = Math.max(this.maxTix, tix[0] || 0, tix[1] || 0, 1);
    const val = (t) => (tix[t] === undefined || tix[t] < 0 ? '∞' : Math.max(0, Math.ceil(tix[t])));
    let sF, sE, bF, bE, label;
    if (mode === 'tdm') {
      sF = tix[fT]; sE = tix[eT]; bF = tix[fT] / Math.max(1, g.target); bE = tix[eT] / Math.max(1, g.target);
      label = `Team Deathmatch · first to ${g.target}`;
    } else if (mode === 'rush') {
      sF = val(fT); sE = val(eT); bF = tix[fT] < 0 ? 1 : tix[fT] / this.maxTix; bE = tix[eT] < 0 ? 1 : tix[eT] / this.maxTix;
      label = g.rush ? `Rush · stage ${g.rush[0] + 1}/${g.rush[1]}` : 'Rush';
    } else {
      sF = val(fT); sE = val(eT); bF = tix[fT] / this.maxTix; bE = tix[eT] / this.maxTix;
      label = 'Conquest';
    }
    this.set('sF', sF, (v) => { el.scoreF.textContent = v; });
    this.set('sE', sE, (v) => { el.scoreE.textContent = v; });
    el.barF.style.width = `${Math.max(0, Math.min(1, bF)) * 100}%`;
    el.barE.style.width = `${Math.max(0, Math.min(1, bE)) * 100}%`;
    this.set('nF', mine === SPEC ? TEAM_NAMES[fT].toUpperCase() : 'FRIENDLY', (v) => { el.nameF.textContent = v; });
    this.set('nE', mine === SPEC ? TEAM_NAMES[eT].toUpperCase() : 'ENEMY', (v) => { el.nameE.textContent = v; });
    const left = Math.max(0, g.timer - (now - g.timerRecv) / 1000);
    const t = Math.ceil(left);
    this.set('time', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, (v) => { el.roundTime.textContent = v; });
    this.set('tlow', left < 60 ? 1 : 0, (v) => el.roundTime.classList.toggle('low', !!v));
    this.set('label', label, (v) => { el.roundLabel.textContent = v; });
    // flag icons
    const flags = g.flagList();
    const fk = flags.map((f) => `${f.id}${g.pt(f.owner)}${f.contested ? 1 : 0}`).join('|');
    this.set('flags', fk, () => {
      el.flagRow.innerHTML = flags.map((f) => { const po = g.pt(f.owner); return `<div class="fchip ${f.owner < 0 ? '' : po === 0 ? 'r' : 'b'} ${f.contested ? 'c' : ''}" title="${esc(f.name)}">${esc(f.letter)}</div>`; }).join('');
    });
    // objective line
    let obj = '';
    const mt = g.myTeam();
    if (mode === 'conquest') obj = 'Hold more than half of the flags';
    else if (mode === 'rush') {
      const ms = g.mcomList().filter((m) => m.state !== 2);
      const armed = ms.find((m) => m.state === 1);
      if (armed) obj = mt === T ? `M-COM armed · ${Math.ceil(armed.timer)}s — protect it!` : `M-COM armed · ${Math.ceil(armed.timer)}s — disarm it!`;
      else obj = mt === T ? 'Attack: arm the M-COM stations (hold E)' : mt === CT ? 'Defend the M-COM stations' : '';
    }
    this.set('obj', obj, (v) => { el.objective.textContent = v; el.objective.classList.toggle('hidden', !v); });
  }

  /** heading strip with cardinal points and the objectives on it */
  renderCompass(g) {
    const c = this.compassCtx, cv = this.el.compass;
    if (!c) return;
    const W = cv.width, H = cv.height, r = g.renderer;
    c.clearRect(0, 0, W, H);
    if (!g.alive || !g.me) return;
    const yaw = r && r.yaw !== undefined ? r.yaw : g.yaw;
    const bearing = yaw + Math.PI / 2;                       // 0 = north (up the map), clockwise
    const span = Math.PI * 0.62;                             // visible arc
    const X = (a) => { let d = a - bearing; d = Math.atan2(Math.sin(d), Math.cos(d)); return d; };
    const px = (d) => W / 2 + (d / (span / 2)) * (W / 2 - 12);
    c.font = '800 12px system-ui, sans-serif'; c.textAlign = 'center'; c.textBaseline = 'middle';
    for (let deg = 0; deg < 360; deg += 5) {
      const d = X(deg * Math.PI / 180);
      if (Math.abs(d) > span / 2) continue;
      const x = px(d), fade = 1 - Math.pow(Math.abs(d) / (span / 2), 2);
      c.globalAlpha = 0.35 + 0.65 * fade;
      const card = deg % 45 === 0, big = deg % 15 === 0;
      c.fillStyle = '#e8edf5';
      if (card) { c.font = '800 13px system-ui, sans-serif'; c.fillText(['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][deg / 45], x, 12); }
      else if (big) { c.fillRect(x - 0.5, 4, 1.5, 9); }
      else c.fillRect(x - 0.5, 8, 1, 5);
    }
    c.globalAlpha = 1;
    // objectives
    const v = g.viewer();
    if (v) {
      for (const f of g.flagList()) {
        const d = X(Math.atan2(f.x - v.x, -(f.y - v.y)));
        if (Math.abs(d) > span / 2) continue;
        const po = g.pt(f.owner);
        c.fillStyle = f.owner < 0 ? '#e6e9ec' : po === 0 ? '#e0523a' : '#3f86e8';
        const x = px(d); c.beginPath(); c.moveTo(x, 30); c.lineTo(x - 8, 20); c.lineTo(x + 8, 20); c.closePath(); c.fill();
        c.fillStyle = '#0b0e14'; c.font = '900 10px system-ui, sans-serif'; c.fillText(f.letter, x, 24);
      }
    }
    // centre caret
    c.fillStyle = '#ffb23a'; c.beginPath(); c.moveTo(W / 2, 20); c.lineTo(W / 2 - 5, 30); c.lineTo(W / 2 + 5, 30); c.closePath(); c.fill();
    c.strokeStyle = 'rgba(255,255,255,0.22)'; c.lineWidth = 1; c.beginPath(); c.moveTo(6, 15.5); c.lineTo(W - 6, 15.5); c.stroke();
  }

  renderMates(g) {
    const sq = g.mySquad();
    const team = g.me ? (g.roster.get(g.me.id) || {}).tm : g.myTeam();
    if (sq < 0 || team === SPEC || team === undefined) { this.el.mates.innerHTML = ''; return; }
    const latest = g.snaps[g.snaps.length - 1];
    const rows = [...g.roster.values()].filter((p) => p.tm === team && p.sq === sq).map((p) => {
      const tup = latest ? latest.players.get(p.id) : null;
      const hp = tup && p.al ? tup[4] : 0;
      const need = !p.al && g.corpses.some((c) => c.id === p.id) ? '<span class="rv">✚</span>' : '';
      const veh = p.vh ? '<span class="vh">▣</span>' : '';
      return `<div class="mate ${p.id === g.you ? 'me' : ''} ${p.al ? '' : 'dead'}"><span class="cl" style="background:${CLS_COL[p.cl] || '#888'}">${CLS_LETTER[p.cl] || 'A'}</span><span class="nm">${esc(p.n)}</span><span class="rl">${CLS_NAME[p.cl] || ''}</span>${need}${veh}<span class="hpbar"><i style="width:${p.vh ? 100 : hp}%"></i></span></div>`;
    }).join('');
    const html = `<div class="sqhead">${esc((SQUAD_NAMES[sq] || '').toUpperCase())}</div>${rows}`;
    if (html !== this.cache.matesHtml) { this.cache.matesHtml = html; this.el.mates.innerHTML = html; }
  }

  renderWeapon(g, me) {
    const el = this.el;
    const held = me.held;
    const gadIdx = held >= HELD_GADGET_BASE ? held - HELD_GADGET_BASE : -1;
    const gi = held >= HELD_GREN_BASE && held < HELD_GADGET_BASE ? held - HELD_GREN_BASE : -1;
    const w = held < HELD_GREN_BASE ? g.heldWeapon(me) : null;
    let clipTxt = '', resTxt = '', name = '', att = '', mode = '', img = '';
    if (w && w.kind !== 'knife') {
      clipTxt = g.predictedClip(); resTxt = '/' + me.res; name = w.name; mode = w.mode || '';
      img = gunIcon(w.id, w.kind, w.att, 420, 170);
      if (w.att) att = [ATTACH.optic[w.att.optic], ATTACH.barrel[w.att.barrel], ATTACH.under[w.att.under], ATTACH.mag[w.att.mag]].filter((a) => a && a.no).map((a) => a.name).join(' · ');
    } else if (w) { name = w.name; mode = 'MELEE'; }
    else if (gi >= 0) { clipTxt = me.gr[gi]; name = GRENADE[GREN_ORDER[gi]].name; }
    else if (gadIdx >= 0) {
      const gd = GADGET_LIST[gadIdx];
      name = gd.name;
      if (gd.kind === 'launcher') { clipTxt = me.clip; resTxt = '/' + me.res; img = gunIcon(gd.id, 'launcher', null, 420, 170); mode = gd.aa ? 'LOCK-ON' : 'ROCKET'; } else if (gd.charges > 0) clipTxt = me.clip;
    }
    this.set('clip', String(clipTxt), (v) => { el.clip.textContent = v; el.clip.classList.toggle('low', !!(w && w.kind !== 'knife' && Number(v) <= Math.ceil(w.mag * 0.25))); });
    this.set('res', resTxt, (v) => { el.reserve.textContent = v; });
    this.set('wn', name, (v) => { el.weaponName.textContent = v; });
    this.set('wmode', mode, (v) => { el.fireMode.textContent = v; });
    this.set('att', att, (v) => { el.weaponAtt.textContent = v; });
    this.set('wimg', img, (v) => { el.weaponImg.src = v || ''; el.weaponImg.style.display = v ? 'block' : 'none'; });
    const key = [me.pw, me.sw, me.sel, me.gr.join(','), me.gsel, me.g.map((x) => (x ? x.join(':') : '-')).join(','), g.kit ? g.kit.primary.id + g.kit.secondary.id : ''].join('|');
    this.set('slots', key, () => {
      const parts = [];
      const tile = (k, label, count, on, empty, sub) => `<div class="tile ${on ? 'sel' : ''} ${empty ? 'empty' : ''}"><kbd>${k}</kbd><span class="tl">${esc(label)}</span>${count !== '' ? `<b>${esc(count)}</b>` : ''}${sub || ''}</div>`;
      const pn = me.pw >= 0 ? WEAPON_LIST[me.pw].name : '—';
      const sn = me.sw >= 0 ? WEAPON_LIST[me.sw].name : '—';
      parts.push(tile('1', pn, '', me.sel === 'primary', false));
      parts.push(tile('2', sn, '', me.sel === 'secondary', false));
      me.g.forEach((gd, i) => {
        if (!gd) return;
        const def = GADGET_LIST[gd[0]];
        const cnt = def.kind === 'launcher' ? gd[1] + gd[2] : def.charges > 0 ? '×' + gd[1] : '';
        parts.push(tile(String(3 + i), def.name, cnt, me.sel === 'gadget' + i, def.charges > 0 && gd[1] + gd[2] === 0));
      });
      const total = me.gr.reduce((a, b) => a + b, 0);
      const dots = GREN_ORDER.map((k, i) => Array.from({ length: me.gr[i] }, () => `<i style="background:${GREN_HEX[k]};${me.sel === 'grenade' && me.gsel === i ? 'outline:2px solid #fff' : ''}"></i>`).join('')).join('');
      parts.push(tile('G', me.gsel >= 0 && GRENADE[GREN_ORDER[me.gsel]] ? GRENADE[GREN_ORDER[me.gsel]].name : 'Grenade', total ? '×' + total : '', me.sel === 'grenade', !total, `<span class="gr">${dots}</span>`));
      parts.push(tile('X', 'Knife', '', me.sel === 'knife', false));
      this.el.slots.innerHTML = parts.join('');
    });
  }

  renderVehicle(g, me) {
    const box = this.el.vehbox;
    if (!me.veh) { this.set('veh', '', () => box.classList.add('hidden')); return; }
    const v = me.veh, def = VEHICLES[VEHICLE_LIST[v.ty]];
    const seats = def.seats.map((s, i) => {
      const pid = v.seats[i];
      return `<div class="seat ${i === v.seat ? 'me' : ''}"><kbd>${i + 1}</kbd><span>${esc(s.name)}</span><b>${pid ? esc(g.nameOf(pid)) : '—'}</b></div>`;
    }).join('');
    const sd = def.seats[v.seat];
    const ammo = v.mag ? `${v.ammo}/${v.mag}${v.rel > 0 ? ' reloading' : ''}` : (sd.weapon ? v.cd > .05 ? `Reloading ${v.cd.toFixed(1)}s` : 'ready' : '');
    const flight = def.kind === 'air' ? `<div class="seat me"><span>Altitude above ground</span><b>${Math.max(0, (v.z - g.map.heightAt(v.x, v.y)) / 16).toFixed(1)} m</b></div><div class="seat"><span>Vertical speed</span><b>${((v.vz || 0) / 16).toFixed(1)} m/s</b></div>` : '';
    const countermeasures = def.kind === 'air' ? `<div class="seat me"><span>Flares <kbd>Z</kbd></span><b>${v.flares?.[0] || 0} / ${!v.flares?.[0] ? 'EMPTY' : v.flares?.[2] > 0 ? 'ACTIVE' : v.flares?.[1] > 0 ? v.flares[1].toFixed(1) + 's' : 'READY'}</b></div>${v.threat ? `<div class="seat me" style="color:#ff745f"><b>${v.threat === 'incoming' ? 'MISSILE INCOMING — Z FLARES' : 'ENEMY ACQUIRING LOCK'}</b></div>` : ''}` : '';
    const speed = `<div class="seat"><span>Speed</span><b>${(Math.hypot(v.vx, v.vy) / 16 * 3.6).toFixed(0)} km/h</b></div>`;
    const html = `<h4>${esc(def.name)}</h4>${speed}${flight}${countermeasures}<div class="vhp"><i style="width:${Math.max(0, v.hp / v.mhp * 100)}%;background:${v.hp / v.mhp > 0.5 ? 'var(--good)' : v.hp / v.mhp > 0.25 ? '#f5c542' : 'var(--bad)'}"></i></div>${sd.weapon ? `<div class="seat me"><span>${esc(v.wn)}</span><b>${ammo}</b></div>` : ''}${seats}<div class="hint"><kbd>E</kbd> exit · <kbd>1-${def.seats.length}</kbd> seat · <kbd>V</kbd> view<br>${v.seat === 0 ? `<kbd>W/S</kbd> drive · <kbd>A/D</kbd> ${def.kind === 'air' ? 'strafe' : 'steer'} · <kbd>Space</kbd> brake` : ''}${def.kind === 'air' && v.seat === 0 ? '<br><kbd>Shift</kbd> climb · <kbd>Ctrl / C</kbd> descend' : ''}${sd.weapon ? '<br><kbd>Mouse</kbd> aim · <kbd>LMB</kbd> fire · <kbd>RMB</kbd> zoom' : ''}</div>`;
    this.set('veh', html, (h) => { box.innerHTML = h; box.classList.remove('hidden'); });
  }

  updatePrompt(g, me) {
    const el = this.el;
    let text = '', prog = -1, plabel = '';
    if (me && me.own && g.alive) {
      const px = g.viewer() ? g.viewer().x : me.x, py = g.viewer() ? g.viewer().y : me.y;
      if (me.pl > 0) { prog = me.pl; plabel = me.plk === 'revive' ? 'Reviving…' : me.plk === 'disarm' ? 'Disarming M-COM…' : 'Arming M-COM…'; }
      else if (me.veh) text = '';
      else {
        // vehicle to board?
        let near = null, nd = 40;
        for (const v of g.vehiclesDrawn()) {
          const def = VEHICLES[VEHICLE_LIST[v.ty]];
          if (!def || Math.abs(v.z - (g.viewer()?.z ?? me.z)) > 48) continue;
          const d = vehicleDistance({ ...v, def }, px, py);
          const mine = v.team === g.myTeam() || v.team < 0 || v.occ === 0;
          if (d < nd && mine && v.occ !== (1 << def.seats.length) - 1) { nd = d; near = { ...v, def }; }
        }
        const mc = g.mcomList().find((m) => m.state !== 2 && Math.hypot(m.x - px, m.y - py) < 48);
        const corpse = (g.ents.cp || []).find((c) => Math.hypot(c[1] - px, c[2] - py) < 56);
        const gd = me.held >= HELD_GADGET_BASE ? GADGET_LIST[me.held - HELD_GADGET_BASE] : null;
        if (gd?.aa) text = me.rel > 0 ? 'Reloading Stinger…' : me.lk?.[1] >= 1 ? 'Target locked — <kbd>LMB</kbd> launch' : me.lk ? 'Hold <kbd>RMB</kbd> — acquiring aircraft' : 'Hold <kbd>RMB</kbd> on an enemy helicopter to lock';
        else if (near) text = `Press <kbd>E</kbd> to enter ${esc(near.def.name)}`;
        else if (mc && g.myTeam() === T && mc.state === 0) text = 'Hold <kbd>E</kbd> to arm the M-COM';
        else if (mc && g.myTeam() === CT && mc.state === 1) text = 'Hold <kbd>E</kbd> to disarm the M-COM';
        else if (corpse && gd && gd.id === 'defib') text = `Hold <kbd>LMB</kbd> to revive ${esc(g.nameOf(corpse[0]))}`;
        else if (corpse && CLASSES.assault && me.cls === 'assault') text = `<kbd>3</kbd> defibrillator — revive ${esc(g.nameOf(corpse[0]))}`;
      }
    }
    this.set('prompt', text, (v) => { el.prompt.style.display = v ? 'block' : 'none'; el.prompt.innerHTML = v; });
    this.set('progVis', prog >= 0 ? plabel : '', (v) => { el.progress.classList.toggle('hidden', !v); el.progressLabel.textContent = v; });
    if (prog >= 0) el.progressFill.style.width = `${Math.round(prog * 100)}%`;
  }
}
export { RULES, ALT, resolveWeapon };
