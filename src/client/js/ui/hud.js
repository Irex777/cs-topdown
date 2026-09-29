// In-game DOM UI: ticket bar, flags, health/ammo, squad, kill feed, chat, scoreboard, pause menu, banners, deploy screen.
import { PHASE, T, CT, SPEC, GREN_ORDER, GRENADE, TEAM_NAMES, RULES } from '../../shared/constants.js';
import { WEAPONS, WEAPON_LIST, GADGET_LIST, HELD_GREN_BASE, HELD_GADGET_BASE, CLASSES, ATTACH, resolveWeapon, ALT } from '../../shared/weapons.js';
import { VEHICLES, VEHICLE_LIST } from '../../shared/vehicles.js';
import { audio } from '../audio.js';
import { Minimap } from '../game/minimap.js';
import { DeployScreen } from './deploy.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TEAM_CLS = ['t', 'ct', 's'];
const GREN_HEX = { he: '#5b8a45', flash: '#eeeeee', smoke: '#9aa4ae', molo: '#e0622f' };
const KILL_NAMES = {
  he: 'FRAG', molo: 'FIRE', knife: 'KNIFE', vehicle: 'VEHICLE', barrel: 'BARREL', c4: 'C4', mine: 'MINE', claymore: 'CLAYMORE', rpg: 'RPG-7', smaw: 'SMAW', stinger: 'STINGER',
  cannon: 'TANK', apcgun: 'AUTOCANNON', hrocket: 'ROCKETS', ugl: '40MM', mk: 'MASTERKEY', world: 'X', ram: 'RAM', crash: 'CRASH',
};
const CLS_LETTER = { assault: 'A', engineer: 'E', support: 'S', recon: 'R' };
const CLS_COL = { assault: '#e0703a', engineer: '#e0b93a', support: '#4aa8e0', recon: '#7fd35a' };

export class HUD {
  constructor(game, net, app) {
    this.game = game; this.net = net; this.app = app;
    this.el = {};
    for (const id of ['hud', 'scoreT', 'scoreCT', 'barT', 'barCT', 'nameT', 'nameCT', 'roundTime', 'roundLabel', 'flagRow', 'objective', 'mates',
      'killfeed', 'scorefeed', 'banner', 'prompt', 'progress', 'progressLabel', 'progressFill', 'hpNum', 'hpBar', 'clsName', 'vehbox', 'clip', 'reserve', 'weaponName', 'weaponAtt',
      'slots', 'chatlog', 'chatbox', 'chatInput', 'chatTag', 'specbar', 'deathcard', 'netstat', 'score', 'pause', 'endgame', 'radar', 'left-col']) this.el[id] = $(id);
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
    // build the 10 health segments once
    this.el.hpBar.innerHTML = '<i></i>'.repeat(10);
  }

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
      const sub = { conquest: 'Capture and hold the flags. Bleed the enemy tickets dry.', rush: 'Crimson attacks: arm and destroy the M-COM stations. Azure defends.', tdm: 'First team to the kill target wins.' }[m.mode];
      this.banner(name, sub, 'g', 3600);
      this.maybeShowHints();
      audio.roundStart();
    });
    n.on('match_over', (m) => this.onMatchOver(m));
    n.on('flag', (m) => this.onFlag(m));
    n.on('mcom', (m) => this.onMcom(m));
    n.on('stage', (m) => this.banner('Stage cleared', `Stage ${m.stage + 1} of ${m.of} — the fight moves on`, m.stage ? 't' : 'g', 3200));
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
    div.innerHTML = '<span><kbd>WASD</kbd> move</span><span><kbd>Shift</kbd> sprint</span><span><kbd>LMB</kbd> fire</span><span><kbd>RMB</kbd> aim / scope</span><span><kbd>E</kbd> enter vehicle / arm</span><span><kbd>Q</kbd> spot</span><span><kbd>3</kbd><kbd>4</kbd> gadgets</span><span><kbd>F</kbd> alt fire</span><span><kbd>L</kbd> loadout</span><span><kbd>M</kbd> map</span>';
    this.el.hud.appendChild(div);
    setTimeout(() => div.remove(), 18000);
  }

  onKill(m) {
    const g = this.game;
    if (m.v === g.you) this.lastKillOnMe = m;
    const div = document.createElement('div');
    if (m.vt) {
      const kn = g.nameOf(m.k), kt = TEAM_CLS[g.teamOf(m.k)];
      div.className = 'kf' + (m.k === g.you ? ' me' : '');
      div.innerHTML = `<span class="${kt}">${esc(kn)}</span><span class="w">${esc(KILL_NAMES[m.w] || (WEAPONS[m.w] ? WEAPONS[m.w].name : 'X'))}</span><span class="${TEAM_CLS[m.vtm] || 's'}">${esc(VEHICLES[m.vt] ? VEHICLES[m.vt].name : 'Vehicle')}</span>`;
    } else {
      const kn = m.k ? g.nameOf(m.k) : '', vn = g.nameOf(m.v);
      const kt = m.k ? TEAM_CLS[g.teamOf(m.k)] : '', vt = TEAM_CLS[g.teamOf(m.v)];
      const w = KILL_NAMES[m.w] || (WEAPONS[m.w] ? WEAPONS[m.w].name : '');
      div.className = 'kf' + (m.k === g.you ? ' me' : '') + (m.v === g.you ? ' dead' : '');
      div.innerHTML = `${m.k ? `<span class="${kt}">${esc(kn)}</span>` : ''}${m.a ? `<span class="as">+ ${esc(g.nameOf(m.a))}</span>` : ''}<span class="w">${esc(w || 'X')}</span><span class="${vt}">${esc(vn)}</span>${m.tk ? '<span class="as">(TK)</span>' : ''}`;
    }
    this.el.killfeed.appendChild(div);
    while (this.el.killfeed.children.length > 7) this.el.killfeed.firstChild.remove();
    setTimeout(() => div.remove(), 7000);
  }

  onFlag(m) {
    const g = this.game;
    const mine = g.myTeam();
    const name = m.name;
    if (m.owner < 0) this.notice(`${TEAM_NAMES[m.by]} neutralized flag ${name}`);
    else {
      this.banner(m.owner === mine ? `Captured ${name}` : `Lost ${name}`, m.owner === mine ? 'Your team holds this flag' : `${TEAM_NAMES[m.owner]} took the flag`, m.owner === T ? 't' : 'ct', 2200);
    }
    this.cache.flags = null;
  }

  onMcom(m) {
    const g = this.game;
    const by = g.nameOf(m.by);
    if (m.ev === 'armed') { this.banner('M-COM armed', `${esc(by)} armed a station — disarm it before it blows!`, 't', 2400); this.notice(`${by} armed an M-COM`); }
    else if (m.ev === 'disarmed') { this.banner('M-COM disarmed', `${esc(by)} saved the station`, 'ct', 2200); }
    else if (m.ev === 'destroyed') this.banner('M-COM destroyed', '', 't', 2000);
  }

  onMatchOver(m) {
    const g = this.game;
    g.phase = PHASE.OVER;
    this.endOpen = true;
    this.deploy.hide();
    const winName = m.winner < 0 ? 'Nobody' : TEAM_NAMES[m.winner];
    const cls = m.winner === T ? 't' : m.winner === CT ? 'ct' : '';
    const mine = g.myTeam();
    const won = m.winner === mine;
    setTimeout(() => {
      if (!this.endOpen) return;
      this.el.endgame.classList.remove('hidden');
      this.el.endgame.innerHTML = `<div class="inner card-panel end-box"><h1 style="color:var(--${cls || 'text'})">${m.winner < 0 ? 'Draw' : won ? 'Victory' : mine === SPEC ? winName + ' win' : 'Defeat'}</h1>
        <div class="sc">${winName} win the match &nbsp;·&nbsp; tickets ${m.tix[0]} : ${m.tix[1] < 0 ? '∞' : m.tix[1]}</div>
        ${this.scoreTables(true)}
        <p style="color:var(--dim);margin-top:8px">${this.app.isHost() ? 'Returning to the lobby in a few seconds…' : 'Returning to the lobby…'}</p>
        <div class="row" style="justify-content:center;margin-top:12px"><button class="btn" id="endLeave">Leave room</button></div></div>`;
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
      const tc = TEAM_CLS[g.teamOf(m.from)] || 's';
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

  openPause() {
    this.pauseOpen = true;
    document.body.classList.add('menu-open');
    const el = this.el.pause;
    el.classList.remove('hidden');
    const g = this.game, mt = g.myTeam();
    el.innerHTML = `<div class="inner card-panel pause-box">
      <h2>Paused</h2>
      <div style="color:var(--dim);font-size:12px">The match keeps running while you're in this menu.</div>
      <div><span class="label">Team</span><div class="seg" id="pauseTeam">
        <button data-t="0" class="${mt === T ? 'on' : ''}">Crimson</button><button data-t="1" class="${mt === CT ? 'on' : ''}">Azure</button><button data-t="2" class="${mt === SPEC ? 'on' : ''}">Spectate</button></div></div>
      <div><span class="label">Squad</span><div class="seg" id="pauseSquad">${[0, 1, 2, 3, 4, 5, 6, 7].map((i) => `<button data-s="${i}" class="${g.mySquad() === i ? 'on' : ''}">${'ABCDEFGH'[i]}</button>`).join('')}</div></div>
      <div class="slider"><span>Volume</span><input type="range" id="volRange" min="0" max="100" value="${Math.round(audio.volume * 100)}" aria-label="Volume"></div>
      <div class="slider"><span>View size</span><input type="range" id="zoomRange" min="70" max="140" value="${Math.round(g.renderer.userZoom * 100)}" aria-label="View size"></div>
      <div class="ctrl-grid"><kbd>WASD</kbd><span>Move / drive</span><kbd>Shift</kbd><span>Sprint</span><kbd>C</kbd><span>Walk (silent)</span><kbd>LMB</kbd><span>Fire / use gadget</span>
      <kbd>RMB</kbd><span>Aim / scope / detonate C4</span><kbd>R</kbd><span>Reload</span><kbd>E</kbd><span>Enter / exit vehicle, arm M-COM</span><kbd>F</kbd><span>Alt fire (underbarrel)</span>
      <kbd>1-6</kbd><span>Weapons, gadgets, grenade</span><kbd>Q</kbd><span>Spot enemy</span><kbd>L</kbd><span>Loadout</span><kbd>M</kbd><span>Big map</span>
      <kbd>Space</kbd><span>Handbrake</span><kbd>1-4</kbd><span>Switch seat (in vehicle)</span><kbd>V</kbd><span>Ping</span><kbd>Tab</kbd><span>Scoreboard</span>
      <kbd>Enter</kbd><span>Team chat</span><kbd>Y</kbd><span>All chat</span></div>
      <div class="row"><button class="btn primary" id="resumeBtn" style="flex:1">Resume</button>
      ${this.app.isHost() ? '<button class="btn" id="endMatchBtn">End match</button>' : ''}
      <button class="btn danger" id="leaveBtn">Leave</button></div></div>`;
    $('resumeBtn').onclick = () => this.closePause();
    $('leaveBtn').onclick = () => { this.closePause(); this.app.leaveRoom(); };
    const em = $('endMatchBtn'); if (em) em.onclick = () => { this.net.send({ t: 'lobby' }); this.closePause(); };
    $('volRange').oninput = (e) => audio.setVolume(e.target.value / 100);
    $('zoomRange').oninput = (e) => g.renderer.setZoom(e.target.value / 100);
    $('pauseTeam').onclick = (e) => { const b = e.target.closest('button'); if (b) { this.net.send({ t: 'team', team: Number(b.dataset.t) }); this.closePause(); } };
    $('pauseSquad').onclick = (e) => { const b = e.target.closest('button'); if (b) { this.net.send({ t: 'a', a: 'squad', n: Number(b.dataset.s) }); this.closePause(); } };
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
    this.el.score.innerHTML = `<div class="inner card-panel"><div class="sb-head"><h2>${esc(g.map ? g.map.name : '')} · ${modeName}</h2><small>Room <b>${esc(s.code || '')}</b></small></div>${this.scoreTables(false)}</div>`;
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
      html += `<div class="sb-team ${TEAM_CLS[team]}"><h3><span>${TEAM_NAMES[team]}</span><span>${head}${team === SPEC ? '' : g.mode === 'tdm' ? ' kills' : ' tickets'}</span></h3><table class="sb-table"><tr><th>Player</th>${team === SPEC ? '' : '<th>Score</th><th>K</th><th>D</th><th>A</th><th>Rev</th><th>Cap</th>'}<th>Ping</th></tr>`;
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
        [...el.hpBar.children].forEach((c, i) => { c.className = v > i * 10 ? `on ${v <= 25 ? 'low' : v <= 50 ? 'mid' : ''}` : ''; });
      });
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
      el.specbar.innerHTML = `<small>SPECTATING</small><b>${esc(g.nameOf(me.id))}</b><small>Click or <kbd>Space</kbd> for next player${g.myTeam() === SPEC ? ' · <kbd>G</kbd> free camera' : ''}</small>`;
    }
  }

  renderTop(g, now) {
    const el = this.el;
    const mode = g.mode;
    const tix = g.tix;
    this.maxTix = Math.max(this.maxTix, tix[0] || 0, tix[1] || 0, 1);
    let s0, s1, bar0, bar1, label;
    if (mode === 'tdm') {
      s0 = tix[0]; s1 = tix[1]; bar0 = 1 - tix[0] / Math.max(1, g.target); bar1 = 1 - tix[1] / Math.max(1, g.target);
      label = `First to ${g.target}`;
    } else if (mode === 'rush') {
      s0 = Math.max(0, Math.ceil(tix[0])); s1 = '∞'; bar0 = tix[0] / this.maxTix; bar1 = 1;
      label = g.rush ? `Rush · Stage ${g.rush[0] + 1}/${g.rush[1]}` : 'Rush';
    } else {
      s0 = Math.max(0, Math.ceil(tix[0])); s1 = Math.max(0, Math.ceil(tix[1])); bar0 = tix[0] / this.maxTix; bar1 = tix[1] / this.maxTix;
      label = 'Conquest';
    }
    this.set('s0', s0, (v) => { el.scoreT.textContent = v; });
    this.set('s1', s1, (v) => { el.scoreCT.textContent = v; });
    el.barT.style.width = `${Math.max(0, Math.min(1, bar0)) * 100}%`;
    el.barCT.style.width = `${Math.max(0, Math.min(1, bar1)) * 100}%`;
    let left = Math.max(0, g.timer - (now - g.timerRecv) / 1000);
    const t = Math.ceil(left);
    this.set('time', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, (v) => { el.roundTime.textContent = v; });
    this.set('tlow', left < 60 ? 1 : 0, (v) => el.roundTime.classList.toggle('low', !!v));
    this.set('label', label, (v) => { el.roundLabel.textContent = v; });
    // flag chips
    const flags = g.flagList();
    const fk = flags.map((f) => `${f.id}${f.owner}${f.contested ? 1 : 0}`).join('|');
    this.set('flags', fk, () => {
      el.flagRow.innerHTML = flags.map((f) => `<div class="fchip ${f.owner === 0 ? 'r' : f.owner === 1 ? 'b' : ''} ${f.contested ? 'c' : ''}" title="${esc(f.name)}">${esc(f.letter)}</div>`).join('');
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

  renderMates(g) {
    const sq = g.mySquad();
    const team = g.me ? (g.roster.get(g.me.id) || {}).tm : g.myTeam();
    if (sq < 0 || team === SPEC || team === undefined) { this.el.mates.innerHTML = ''; return; }
    const latest = g.snaps[g.snaps.length - 1];
    const rows = [...g.roster.values()].filter((p) => p.tm === team && p.sq === sq).map((p) => {
      const tup = latest ? latest.players.get(p.id) : null;
      const hp = tup && p.al ? tup[4] : 0;
      const need = !p.al && g.corpses.some((c) => c.id === p.id) ? '<span class="rv">✚</span>' : '';
      const veh = p.vh ? '<span style="color:var(--dim);font-size:10px">▣</span>' : '';
      return `<div class="mate ${team === T ? 't' : ''} ${p.al ? '' : 'dead'}"><span class="cl" style="background:${CLS_COL[p.cl] || '#888'}">${CLS_LETTER[p.cl] || 'A'}</span><span class="nm">${esc(p.n)}</span>${need}${veh}<span class="hpbar"><i style="width:${p.vh ? 100 : hp}%"></i></span></div>`;
    }).join('');
    const html = `<div class="sqhead">Squad ${'ABCDEFGH'[sq] || ''}</div>${rows}`;
    if (html !== this.cache.matesHtml) { this.cache.matesHtml = html; this.el.mates.innerHTML = html; }
  }

  renderWeapon(g, me) {
    const el = this.el;
    const held = me.held;
    const gadIdx = held >= HELD_GADGET_BASE ? held - HELD_GADGET_BASE : -1;
    const gi = held >= HELD_GREN_BASE && held < HELD_GADGET_BASE ? held - HELD_GREN_BASE : -1;
    const w = held < HELD_GREN_BASE ? g.heldWeapon(me) : null;
    let clipTxt = '', resTxt = '', name = '', att = '';
    if (w && w.kind !== 'knife') {
      if (me.alt && me.altc) { clipTxt = me.altc[0]; resTxt = '/ ' + me.altc[1]; name = w.alt === 'ugl' ? '40 mm Grenade' : 'Masterkey'; }
      else { clipTxt = g.predictedClip(); resTxt = '/ ' + me.res; name = w.name; }
      if (w.att) att = [w.att.optic !== 'iron' && w.att.optic !== w.defOptic ? ATTACH.optic[w.att.optic] : null, ATTACH.barrel[w.att.barrel], ATTACH.under[w.att.under], ATTACH.mag[w.att.mag]].filter((a) => a && a.name && !['Standard Muzzle', 'None', 'Standard Ammo', 'Iron Sights'].includes(a.name)).map((a) => a.name).join(' · ');
      if (w.att && w.att.optic === w.defOptic && w.att.optic !== 'iron') att = ATTACH.optic[w.att.optic].name + (att ? ' · ' + att : '');
    } else if (w) name = w.name;
    else if (gi >= 0) { clipTxt = me.gr[gi]; name = GRENADE[GREN_ORDER[gi]].name; }
    else if (gadIdx >= 0) {
      const gd = GADGET_LIST[gadIdx];
      name = gd.name;
      if (gd.kind === 'launcher') { clipTxt = me.clip; resTxt = '/ ' + me.res; } else if (gd.charges > 0) clipTxt = me.clip;
    }
    this.set('clip', String(clipTxt), (v) => { el.clip.textContent = v; el.clip.classList.toggle('low', w && w.kind !== 'knife' && Number(v) <= Math.ceil(w.mag * 0.25)); });
    this.set('res', resTxt, (v) => { el.reserve.textContent = v; });
    this.set('wn', name, (v) => { el.weaponName.textContent = v; });
    this.set('att', att, (v) => { el.weaponAtt.textContent = v; });
    const key = [me.pw, me.sw, me.sel, me.gr.join(','), me.gsel, me.g.map((x) => (x ? x.join(':') : '-')).join(','), g.kit ? g.kit.primary.id + g.kit.secondary.id : ''].join('|');
    this.set('slots', key, () => {
      const parts = [];
      const kit = g.kit;
      const pn = me.pw >= 0 ? WEAPON_LIST[me.pw].name : '—';
      const sn = me.sw >= 0 ? WEAPON_LIST[me.sw].name : '—';
      parts.push(`<div class="slot ${me.sel === 'primary' ? 'sel' : ''}"><kbd>1</kbd>${esc(pn)}</div>`);
      parts.push(`<div class="slot ${me.sel === 'secondary' ? 'sel' : ''}"><kbd>2</kbd>${esc(sn)}</div>`);
      me.g.forEach((gd, i) => {
        if (!gd) return;
        const def = GADGET_LIST[gd[0]];
        const cnt = def.kind === 'launcher' ? gd[1] + gd[2] : def.charges > 0 ? gd[1] : '';
        parts.push(`<div class="slot ${me.sel === 'gadget' + i ? 'sel' : ''} ${def.charges > 0 && gd[1] + gd[2] === 0 ? 'empty' : ''}"><kbd>${3 + i}</kbd>${esc(def.name)}${cnt !== '' ? ' ×' + cnt : ''}</div>`);
      });
      const dots = GREN_ORDER.map((k, i) => Array.from({ length: me.gr[i] }, () => `<i style="background:${GREN_HEX[k]};${me.sel === 'grenade' && me.gsel === i ? 'outline:2px solid #fff' : ''}"></i>`).join('')).join('');
      parts.push(`<div class="slot ${me.sel === 'grenade' ? 'sel' : ''} ${dots ? '' : 'empty'}"><kbd>5</kbd><span class="gr">${dots || '—'}</span></div>`);
      parts.push(`<div class="slot ${me.sel === 'knife' ? 'sel' : ''}"><kbd>6</kbd>Knife</div>`);
      void kit;
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
    const ammo = v.mag ? `${v.ammo}/${v.mag}${v.rel > 0 ? ' reloading' : ''}` : (sd.weapon ? 'ready' : '');
    const html = `<h4>${esc(def.name)}</h4><div class="vhp"><i style="width:${Math.max(0, v.hp / v.mhp * 100)}%;background:${v.hp / v.mhp > 0.5 ? 'var(--good)' : v.hp / v.mhp > 0.25 ? '#f5c542' : 'var(--bad)'}"></i></div>${sd.weapon ? `<div class="seat me"><span>${esc(v.wn)}</span><b>${ammo}</b></div>` : ''}${seats}<div class="hint"><kbd>E</kbd> exit · <kbd>1-${def.seats.length}</kbd> seat${def.kind === 'wheeled' || def.kind === 'boat' ? ' · <kbd>Space</kbd> brake' : ''}</div>`;
    this.set('veh', html, (h) => { box.innerHTML = h; box.classList.remove('hidden'); });
  }

  updatePrompt(g, me) {
    const el = this.el;
    let text = '', prog = -1, plabel = '';
    if (me && me.own && g.alive) {
      const px = g.viewer() ? g.viewer().x : me.x, py = g.viewer() ? g.viewer().y : me.y;
      if (me.pl > 0) { prog = me.pl; plabel = me.plk === 'revive' ? 'Reviving…' : me.plk === 'disarm' ? 'Disarming M-COM…' : 'Arming M-COM…'; }
      else if (me.veh) text = 'Press <kbd>E</kbd> to exit';
      else {
        // vehicle to board?
        let near = null, nd = 40;
        for (const v of g.vehiclesDrawn()) {
          if (!v.def) continue;
          const d = Math.hypot(v.x - px, v.y - py) - v.def.r;
          const mine = v.team === g.myTeam() || v.team < 0 || v.occ === 0;
          if (d < nd && mine && v.occ !== (1 << v.def.seats.length) - 1) { nd = d; near = v; }
        }
        const mc = g.mcomList().find((m) => m.state !== 2 && Math.hypot(m.x - px, m.y - py) < 48);
        const corpse = (g.ents.cp || []).find((c) => Math.hypot(c[1] - px, c[2] - py) < 56);
        const gd = me.held >= HELD_GADGET_BASE ? GADGET_LIST[me.held - HELD_GADGET_BASE] : null;
        if (near) text = `Press <kbd>E</kbd> to enter ${esc(near.def.name)}`;
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
