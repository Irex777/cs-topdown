// In-game DOM UI: score bar, health/ammo, kill feed, chat, buy menu, scoreboard, pause menu, banners.
import { PHASE, T, CT, SPEC, RULES, GRENADE, GREN_ORDER, armorCost, TEAM_NAMES } from '../../../shared/constants.js';
import { WEAPON_LIST, WEAPONS, HELD_GREN_BASE } from '../../../shared/weapons.js';
import { audio } from '../audio.js';
import { Minimap } from '../game/minimap.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const TEAM_CLS = ['t', 'ct', 's'];
const GREN_HEX = { he: '#5b8a45', flash: '#eeeeee', smoke: '#9aa4ae', molo: '#e0622f' };
const KILL_NAMES = { he: 'HE', molo: 'FIRE', bomb: 'C4', knife: 'KNIFE' };
const REASONS = {
  bomb: 'The bomb detonated', defused: 'The bomb was defused', elim: 'Enemy team eliminated', time: 'Time ran out',
};

const BUY_COLS = [
  { key: 'Pistols', items: (team) => ['p250', team === T ? 'tec9' : 'fiveseven', 'deagle'] },
  { key: 'SMGs', items: (team) => [team === T ? 'mac10' : 'mp9', 'mp7', 'ump45', 'p90'] },
  { key: 'Rifles', items: (team) => [team === T ? 'galil' : 'famas', team === T ? 'ak47' : 'm4a4', team === T ? 'sg553' : 'm4a1s', team === T ? null : 'aug'] },
  { key: 'Sniper & Heavy', items: () => ['ssg08', 'awp', 'nova', 'xm1014'] },
  { key: 'Equipment', items: (team) => ['kevlar', 'helmet', team === CT ? 'kit' : null] },
  { key: 'Grenades', items: () => ['he', 'flash', 'smoke', 'molo'] },
];
const EQUIP = {
  kevlar: { name: 'Kevlar Vest', price: armorCost.kevlar },
  helmet: { name: 'Kevlar + Helmet', price: armorCost.helmet },
  kit: { name: 'Defuse Kit', price: armorCost.kit },
};

export class HUD {
  constructor(game, net, app) {
    this.game = game; this.net = net; this.app = app;
    this.el = {};
    for (const id of ['hud', 'scoreT', 'scoreCT', 'aliveT', 'aliveCT', 'roundTime', 'roundLabel', 'bombStatus', 'money', 'moneyDelta', 'mates',
      'killfeed', 'banner', 'prompt', 'progress', 'progressLabel', 'progressFill', 'hpNum', 'arNum', 'helmIcon', 'clip', 'reserve', 'weaponName', 'slots',
      'chatlog', 'chatbox', 'chatInput', 'chatTag', 'specbar', 'deathcard', 'netstat', 'buy', 'score', 'pause', 'endgame', 'radar', 'left-col']) this.el[id] = $(id);
    this.minimap = new Minimap(this.el.radar);
    this.buyOpen = false; this.scoreOpen = false; this.pauseOpen = false; this.chatOpen = false; this.chatTeam = true;
    this.buyCat = -1;
    this.cache = {};
    this.roundActive = false;
    this.lastAliveHtml = '';
    this.slow = 0;
    this.bannerTimer = 0;
    this.lastHover = null;
    game.ui = this;
    this.bindNet();
    this.bindChat();
    this.el.buy.addEventListener('click', (e) => this.onBuyClick(e));
    this.el.buy.addEventListener('mouseover', (e) => { const b = e.target.closest('[data-item]'); if (b) this.showStats(b.dataset.item); });
    window.addEventListener('keydown', (e) => this.onKeyBuy(e));
  }

  // ------------------------------------------------------------------ hooks called by ClientGame
  inputBlocked() { return this.pauseOpen || this.chatOpen || this.endOpen; }
  isOverlayOpen() { return this.pauseOpen || this.endOpen; }
  onRespawn() { this.el.deathcard.classList.add('hidden'); }
  onDeath() {
    this.closeBuy();
    const k = this.lastKillOnMe;
    if (k) {
      const w = KILL_NAMES[k.w] || (WEAPONS[k.w] ? WEAPONS[k.w].name : '');
      this.el.deathcard.innerHTML = k.k ? `<h3>YOU WERE KILLED</h3><p>by <b>${esc(this.game.nameOf(k.k))}</b>${w ? ' with ' + esc(w) : ''}</p>` : '<h3>YOU DIED</h3>';
    } else this.el.deathcard.innerHTML = '<h3>YOU DIED</h3>';
    this.el.deathcard.classList.remove('hidden');
    setTimeout(() => this.el.deathcard.classList.add('hidden'), 3200);
  }

  onSnapshot() { /* per-frame work happens in onFrame */ }

  // ------------------------------------------------------------------ network messages
  bindNet() {
    const n = this.net, g = this.game;
    n.on('round_start', (m) => {
      g.phase = m.phase; g.round = m.round; g.score = m.score; g.target = m.target;
      g.corpses.length = 0; g.fx.clearRound(); g.pings.length = 0; g.spotted.clear();
      this.lastKillOnMe = null;
      this.el.killfeed.innerHTML = '';
      this.closeEnd();
      if (m.mode === 'defuse') this.banner(`Round ${m.round}`, 'Buy your gear — <kbd>B</kbd> opens the shop', '', 2600);
      this.el.deathcard.classList.add('hidden');
      audio.roundStart();
    });
    n.on('live', () => { this.closeBuy(true); audio.roundStart(); });
    n.on('round_end', (m) => this.onRoundEnd(m));
    n.on('match_over', (m) => this.onMatchOver(m));
    n.on('swap', (m) => this.banner('Switching sides', m.overtime ? 'Overtime! Everyone gets $10,000' : 'Teams swap sides', '', 2800));
    n.on('bomb', (m) => this.onBomb(m));
    n.on('kill', (m) => this.onKill(m));
    n.on('chat', (m) => this.onChat(m));
    n.on('roster', (m) => { g.roster.clear(); for (const p of m.players) g.roster.set(p.id, p); g.hostId = m.host; this.rosterDirty = true; });
    n.on('ping', (m) => { g.pings.push({ id: m.id, x: m.x, y: m.y, team: m.team, t: performance.now() }); if (m.id !== g.you) audio.ping(); });
    n.on('toast', (m) => this.app.toast(m.text));
    n.on('bought', () => { this.refreshBuy(); });
  }

  onKill(m) {
    const g = this.game;
    if (m.v === g.you) this.lastKillOnMe = m;
    const kn = m.k ? g.nameOf(m.k) : '', vn = g.nameOf(m.v);
    const kt = m.k ? TEAM_CLS[g.teamOf(m.k)] : '', vt = TEAM_CLS[g.teamOf(m.v)];
    const w = KILL_NAMES[m.w] || (WEAPONS[m.w] ? WEAPONS[m.w].name : '');
    const div = document.createElement('div');
    div.className = 'kf' + (m.k === g.you ? ' me' : '') + (m.v === g.you ? ' dead' : '');
    div.innerHTML = `${m.k ? `<span class="${kt}">${esc(kn)}</span>` : ''}${m.a ? `<span class="as">+ ${esc(g.nameOf(m.a))}</span>` : ''}<span class="w">${esc(w || 'X')}</span><span class="${vt}">${esc(vn)}</span>${m.tk ? '<span class="as">(TK)</span>' : ''}`;
    this.el.killfeed.appendChild(div);
    while (this.el.killfeed.children.length > 6) this.el.killfeed.firstChild.remove();
    setTimeout(() => div.remove(), 7000);
  }

  onBomb(m) {
    const g = this.game;
    const site = m.site === 0 ? 'A' : 'B';
    if (m.ev === 'planted') this.banner('Bomb planted', `Site ${site} — Counter-Terrorists, defuse it!`, 't', 2600);
    else if (m.ev === 'defused') this.banner('Bomb defused', `${esc(g.nameOf(m.by))} saved the day`, 'ct', 2400);
    else if (m.ev === 'dropped') this.notice('The bomb has been dropped');
    else if (m.ev === 'pickup') this.notice(`${esc(g.nameOf(m.by))} picked up the bomb`);
  }

  onRoundEnd(m) {
    const g = this.game;
    g.phase = PHASE.POST; g.score = m.score;
    const mt = g.myTeam();
    const win = m.winner === T ? 't' : m.winner === CT ? 'ct' : '';
    const title = m.winner === T ? 'Terrorists win' : m.winner === CT ? 'Counter-Terrorists win' : 'Round draw';
    const mvp = m.mvp ? `MVP: ${esc(g.nameOf(m.mvp))}` : '';
    this.banner(title, `${REASONS[m.reason] || ''}${mvp ? ' · ' + mvp : ''}`, win, 4600);
    if (mt === m.winner) audio.roundWin(); else if (mt !== SPEC) audio.roundLose();
    this.showMoneyNote = true;
  }

  onMatchOver(m) {
    const g = this.game;
    g.phase = PHASE.OVER;
    this.endOpen = true;
    const winName = m.winner === T ? 'Terrorists' : m.winner === CT ? 'Counter-Terrorists' : 'Nobody';
    const cls = m.winner === T ? 't' : m.winner === CT ? 'ct' : '';
    const mine = g.myTeam();
    const won = m.winner === mine;
    setTimeout(() => {
      if (!this.endOpen) return;
      this.el.endgame.classList.remove('hidden');
      this.el.endgame.innerHTML = `<div class="inner card-panel end-box"><h1 style="color:var(--${cls || 'text'})">${m.winner < 0 ? 'Draw' : won ? 'Victory' : mine === SPEC ? winName + ' win' : 'Defeat'}</h1>
        <div class="sc">${winName} win the match &nbsp;·&nbsp; ${m.score[T]} : ${m.score[CT]}</div>
        ${this.scoreTables(true)}
        <p style="color:var(--dim);margin-top:8px">${this.app.isHost() ? 'Returning to the lobby in a few seconds…' : 'Returning to the lobby…'}</p>
        <div class="row" style="justify-content:center;margin-top:12px"><button class="btn" id="endLeave">Leave room</button></div></div>`;
      const b = $('endLeave'); if (b) b.onclick = () => this.app.leaveRoom();
    }, 2500);
    if (this.game.myTeam() === m.winner) audio.roundWin(); else audio.roundLose();
  }

  closeEnd() { this.endOpen = false; this.el.endgame.classList.add('hidden'); }

  onChat(m) {
    const g = this.game;
    const div = document.createElement('div');
    if (m.sys) { div.className = 'cl sys'; div.textContent = m.text; }
    else {
      div.className = 'cl';
      const tc = m.team >= 0 ? TEAM_CLS[g.teamOf(m.from)] || 's' : TEAM_CLS[g.teamOf(m.from)] || 's';
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
    setTimeout(() => this.el.chatInput.focus(), 0);
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
    if (this.buyOpen) { this.closeBuy(); return; }
    if (this.scoreOpen && !this.pauseOpen) { /* fall through to pause */ }
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
      <div style="color:var(--dim);font-size:13px">The match keeps running while you're in this menu.</div>
      <div><span class="label">Team</span><div class="seg" id="pauseTeam">
        <button data-t="0" class="${mt === T ? 'on' : ''}">Terrorists</button><button data-t="1" class="${mt === CT ? 'on' : ''}">Counter-Terrorists</button><button data-t="2" class="${mt === SPEC ? 'on' : ''}">Spectate</button></div></div>
      <div class="slider"><span>Volume</span><input type="range" id="volRange" min="0" max="100" value="${Math.round(audio.volume * 100)}" aria-label="Volume"></div>
      <div class="slider"><span>View size</span><input type="range" id="zoomRange" min="70" max="140" value="${Math.round(g.renderer.userZoom * 100)}" aria-label="View size"></div>
      <div class="ctrl-grid"><kbd>WASD</kbd><span>Move</span><kbd>Shift</kbd><span>Walk (silent)</span><kbd>LMB</kbd><span>Fire / throw</span><kbd>RMB</kbd><span>Scope (snipers)</span>
      <kbd>R</kbd><span>Reload</span><kbd>E</kbd><span>Plant / defuse / pick up</span><kbd>B</kbd><span>Buy menu</span><kbd>1-4</kbd><span>Weapons, grenades</span>
      <kbd>G</kbd><span>Drop weapon</span><kbd>Q</kbd><span>Last weapon</span><kbd>Tab</kbd><span>Scoreboard</span><kbd>M</kbd><span>Big map</span>
      <kbd>Enter</kbd><span>Team chat</span><kbd>Y</kbd><span>All chat</span><kbd>V</kbd><span>Ping location</span><kbd>X</kbd><span>Re-buy last loadout</span></div>
      <div class="row"><button class="btn primary" id="resumeBtn" style="flex:1">Resume</button>
      ${this.app.isHost() ? '<button class="btn" id="endMatchBtn">End match</button>' : ''}
      <button class="btn danger" id="leaveBtn">Leave</button></div></div>`;
    $('resumeBtn').onclick = () => this.closePause();
    $('leaveBtn').onclick = () => { this.closePause(); this.app.leaveRoom(); };
    const em = $('endMatchBtn'); if (em) em.onclick = () => { this.net.send({ t: 'lobby' }); this.closePause(); };
    $('volRange').oninput = (e) => audio.setVolume(e.target.value / 100);
    $('zoomRange').oninput = (e) => g.renderer.setZoom(e.target.value / 100);
    $('pauseTeam').onclick = (e) => { const b = e.target.closest('button'); if (b) { this.net.send({ t: 'team', team: Number(b.dataset.t) }); this.closePause(); } };
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
    const modeName = g.mode === 'dm' ? 'Team Deathmatch' : 'Bomb Defusal';
    this.el.score.innerHTML = `<div class="inner card-panel"><div class="sb-head"><h2>${esc(g.map ? g.map.name : '')} · ${modeName}</h2><small>Room <b>${esc(s.code || '')}</b> · Round ${g.round}</small></div>${this.scoreTables(false)}</div>`;
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
      const showMoney = team === mine || mine === SPEC;
      html += `<div class="sb-team ${TEAM_CLS[team]}"><h3><span>${TEAM_NAMES[team]}</span><span>${team === SPEC ? list.length : g.score[team]}</span></h3><table class="sb-table"><tr><th>Player</th>${team === SPEC ? '' : `<th>K</th><th>D</th><th>A</th><th>Score</th><th>DMG</th>${showMoney ? '<th>$</th>' : ''}`}<th>Ping</th></tr>`;
      for (const p of list) {
        html += `<tr class="${p.id === g.you ? 'me' : ''} ${p.al || team === SPEC || final ? '' : 'dead'}"><td>${esc(p.n)}${p.b ? '<span class="bot">BOT</span>' : ''}${p.id === g.hostId ? '<span class="bot">HOST</span>' : ''}${p.mv ? `<span class="mvp">★${p.mv}</span>` : ''}</td>`;
        if (team !== SPEC) html += `<td>${p.k}</td><td>${p.d}</td><td>${p.a}</td><td>${p.s}</td><td>${p.dm}</td>${showMoney ? `<td class="mo">${p.mo >= 0 ? '$' + p.mo : ''}</td>` : ''}`;
        html += `<td>${p.b ? '-' : p.dc ? 'DC' : p.pg}</td></tr>`;
      }
      html += '</table></div>';
    }
    return html;
  }

  // ------------------------------------------------------------------ buy menu
  toggleBuy() { this.buyOpen ? this.closeBuy() : this.openBuy(); }

  openBuy() {
    const g = this.game;
    if (!g.alive || this.pauseOpen || this.chatOpen || this.endOpen) return;
    if (g.mode === 'defuse' && !(g.phase === PHASE.FREEZE || g.phase === PHASE.LIVE)) return;
    this.buyOpen = true; this.buyCat = -1;
    this.el.buy.classList.remove('hidden');
    this.refreshBuy(true);
  }

  closeBuy() { this.buyOpen = false; this.el.buy.classList.add('hidden'); }

  refreshBuy(force) {
    if (!this.buyOpen) return;
    const g = this.game, me = g.me;
    if (!me) return;
    const team = g.myTeam();
    const canBuy = !!me.buy;
    const money = me.money ?? 0;
    const infinite = g.mode === 'dm';
    const owned = (id) => {
      if (id === 'kevlar') return me.ar >= 100;
      if (id === 'helmet') return me.hm && me.ar >= 100;
      if (id === 'kit') return !!me.kit;
      if (GRENADE[id]) return false;
      const w = WEAPONS[id];
      return w && (me.pri === w.idx || me.sec === w.idx);
    };
    const price = (id) => {
      if (id === 'helmet') return me.ar >= 100 ? armorCost.helmetUpgrade : armorCost.helmet;
      if (EQUIP[id]) return EQUIP[id].price;
      if (GRENADE[id]) return GRENADE[id].price;
      return WEAPONS[id].price;
    };
    const name = (id) => (EQUIP[id] ? EQUIP[id].name : GRENADE[id] ? GRENADE[id].name : WEAPONS[id].name);
    let html = `<div class="inner card-panel"><div class="buy-head"><h2>Buy menu</h2><span style="color:var(--dim);font-size:13px">${canBuy ? 'Click an item, or press a column number then an item number' : (g.mode === 'dm' ? 'Return to your spawn to buy' : 'Buying is only allowed in your spawn during the first seconds of a round')}</span><div class="cash">${infinite ? 'FREE' : '$' + money}</div></div><div class="buy-cols">`;
    BUY_COLS.forEach((col, ci) => {
      html += `<div class="buy-col ${this.buyCat === ci ? 'sel' : ''}"><h4><kbd>${ci + 1}</kbd>${col.key}</h4>`;
      let n = 0;
      for (const id of col.items(team)) {
        if (!id) continue;
        n++;
        const pr = price(id), isOwned = owned(id);
        const can = canBuy && !isOwned && (infinite || money >= pr) && (!GRENADE[id] || (me.gr[GREN_ORDER.indexOf(id)] < GRENADE[id].max && me.gr.reduce((a, b) => a + b, 0) < 4));
        const cnt = GRENADE[id] ? me.gr[GREN_ORDER.indexOf(id)] : 0;
        html += `<button class="buy-item ${isOwned ? 'owned' : ''}" data-item="${id}" ${can ? '' : 'disabled'}><span class="n">${n}</span><span>${esc(name(id))}${cnt ? ` <small style="color:var(--dim)">×${cnt}</small>` : ''}</span><span class="p">${isOwned ? 'OWNED' : infinite ? '' : '$' + pr}</span></button>`;
      }
      html += '</div>';
    });
    html += `</div><div class="buy-stats" id="buyStats"><div style="color:var(--dim);grid-column:1/-1;align-self:center">Hover an item to see its stats</div></div>
      <div class="buy-foot"><button class="btn small" id="rebuyBtn"><kbd>X</kbd> Re-buy last loadout</button><span><kbd>B</kbd> / <kbd>Esc</kbd> close</span></div></div>`;
    this.el.buy.innerHTML = html;
    const rb = $('rebuyBtn'); if (rb) rb.onclick = () => { this.net.send({ t: 'a', a: 'rebuy' }); setTimeout(() => this.refreshBuy(), 150); };
    if (this.lastHover) this.showStats(this.lastHover);
    void force;
  }

  showStats(id) {
    const box = $('buyStats');
    if (!box) return;
    this.lastHover = id;
    const w = WEAPONS[id];
    if (!w) {
      const d = EQUIP[id] || GRENADE[id];
      const info = { kevlar: 'Absorbs bullet damage. 100 armor.', helmet: 'Full armor with helmet.', kit: 'Halves the time it takes to defuse.', he: 'Explodes for up to 98 damage.', flash: 'Blinds anyone who looks at it.', smoke: 'Blocks line of sight for 16 s.', molo: 'Sets an area on fire for 7 s.' }[id];
      box.innerHTML = `<div class="bs" style="grid-column:1/-1"><div class="k">${esc(d.name)}</div><div class="v" style="font-size:14px;font-weight:600">${esc(info || '')}</div></div>`;
      return;
    }
    const bar = (v, max) => `<div class="bar"><i style="width:${Math.min(100, (v / max) * 100)}%"></i></div>`;
    const dmg = w.pellets > 1 ? `${w.dmg}×${w.pellets}` : w.dmg;
    box.innerHTML = `
      <div class="bs"><div class="k">Damage</div><div class="v">${dmg}</div>${bar(w.dmg * w.pellets, 130)}</div>
      <div class="bs"><div class="k">Fire rate</div><div class="v">${Math.round(w.rpm)} rpm</div>${bar(w.rpm, 900)}</div>
      <div class="bs"><div class="k">Magazine</div><div class="v">${w.mag}/${w.reserve}</div>${bar(w.mag, 50)}</div>
      <div class="bs"><div class="k">Armor pen.</div><div class="v">${Math.round(Math.min(1, w.ap) * 100)}%</div>${bar(w.ap, 1)}</div>
      <div class="bs"><div class="k">Move speed</div><div class="v">${Math.round(w.speed * 100)}%</div>${bar(w.speed, 1)}</div>`;
  }

  onBuyClick(e) {
    const b = e.target.closest('[data-item]');
    if (!b || b.disabled) return;
    this.net.send({ t: 'a', a: 'buy', item: b.dataset.item });
    audio.click();
  }

  onKeyBuy(e) {
    if (!this.buyOpen || this.game.input.isTyping()) return;
    if (!/^Digit[1-9]$/.test(e.code)) return;
    const n = Number(e.code.slice(5));
    const team = this.game.myTeam();
    if (this.buyCat < 0) { if (n >= 1 && n <= 6) { this.buyCat = n - 1; this.refreshBuy(); } return; }
    const items = BUY_COLS[this.buyCat].items(team).filter(Boolean);
    const id = items[n - 1];
    if (id) this.net.send({ t: 'a', a: 'buy', item: id });
    this.buyCat = -1;
    e.preventDefault();
    setTimeout(() => this.refreshBuy(), 120);
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

    // ---- top bar
    const modeDM = g.mode === 'dm';
    this.set('sT', g.score[T], (v) => { el.scoreT.textContent = v; });
    this.set('sCT', g.score[CT], (v) => { el.scoreCT.textContent = v; });
    let left = Math.max(0, g.timer - (now - g.timerRecv) / 1000);
    let label;
    const bb = g.bombInfo;
    if (bb && bb[0] === 3) { left = Math.max(0, bb[3] - (now - g.timerRecv) / 1000); label = 'BOMB'; }
    else if (modeDM) label = `First to ${g.target}`;
    else if (g.phase === PHASE.FREEZE) label = 'Buy time';
    else if (g.phase === PHASE.POST) label = 'Round over';
    else if (g.phase === PHASE.OVER) label = 'Match over';
    else label = `Round ${g.round}`;
    const t = Math.ceil(left);
    this.set('time', `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`, (v) => { el.roundTime.textContent = v; });
    this.set('tlow', (label === 'BOMB' || (g.phase === PHASE.LIVE && left < 10)) ? 1 : 0, (v) => el.roundTime.classList.toggle('low', !!v));
    this.set('label', label, (v) => { el.roundLabel.textContent = v; });
    if (g.phase === PHASE.FREEZE && t <= 3 && t > 0 && this.cache.cdT !== t) { this.cache.cdT = t; audio.countdown(); }
    const bs = el.bombStatus;
    const planted = bb && bb[0] === 3;
    this.set('planted', planted ? bb[5] : -1, (v) => { bs.classList.toggle('hidden', v < 0); bs.textContent = `Bomb planted · Site ${v === 0 ? 'A' : 'B'}${bb && bb[4] ? ' · Defusing…' : ''}`; });
    if (planted) bs.textContent = `Bomb planted · Site ${bb[5] === 0 ? 'A' : 'B'}${bb[4] ? ' · Defusing…' : ''}`;

    // ---- alive pips + mates list (5 Hz)
    if (slowTick) {
      const ros = [...g.roster.values()];
      const pips = (team) => ros.filter((p) => p.tm === team).map((p) => `<i class="${p.al ? '' : 'dead'}"></i>`).join('');
      const ah = pips(T) + '|' + pips(CT);
      if (ah !== this.lastAliveHtml) { this.lastAliveHtml = ah; el.aliveT.innerHTML = pips(T); el.aliveCT.innerHTML = pips(CT); }
      this.renderMates(g, ros);
      if (this.scoreOpen) this.renderScore();
      if (this.buyOpen) this.refreshBuy();
      const rtt = Math.round(this.net.rtt);
      el.netstat.textContent = `${g.stats.fps} fps · ${rtt} ms`;
    }

    // ---- money
    if (me && me.own && g.money !== undefined) {
      this.set('money', g.money, (v) => {
        const d = v - this.lastMoneyShown;
        el.money.textContent = v;
        if (this.lastMoneyShown !== undefined && d !== 0 && g.mode !== 'dm') {
          el.moneyDelta.textContent = (d > 0 ? '+' : '−') + '$' + Math.abs(d);
          el.moneyDelta.style.color = d > 0 ? '#b9f5c0' : '#ff9b93';
          el.moneyDelta.style.opacity = 1;
          clearTimeout(this.mdT); this.mdT = setTimeout(() => { el.moneyDelta.style.opacity = 0; }, 2200);
        }
        this.lastMoneyShown = v;
      });
    }
    el['left-col'].querySelector('#money-box').style.display = g.mode === 'dm' ? 'none' : '';

    // ---- own status
    const showStatus = !!me;
    if (me) {
      this.set('hp', me.hp, (v) => { el.hpNum.textContent = v; el.hpNum.parentElement.classList.toggle('low', v <= 25); el.hpNum.parentElement.classList.toggle('ok', v > 25); });
      this.set('ar', me.ar, (v) => { el.arNum.textContent = v; });
      this.set('hm', me.hm, (v) => { el.helmIcon.style.display = v ? '' : 'none'; });
      this.renderWeapon(g, me);
    }
    el.hud.querySelector('#statusbox').style.visibility = showStatus ? 'visible' : 'hidden';
    el.hud.querySelector('#weaponbox').style.visibility = showStatus && g.alive ? 'visible' : 'hidden';

    // ---- prompts / progress
    this.updatePrompt(g, me);

    // ---- spectate bar
    const spec = !g.alive && me;
    this.set('spec', spec ? me.id : 0, () => {
      el.specbar.classList.toggle('hidden', !spec);
      if (spec) el.specbar.innerHTML = `<small>SPECTATING</small><b>${esc(g.nameOf(me.id))}</b><small>Click or <kbd>Space</kbd> for next player${g.myTeam() === SPEC ? ' · <kbd>F</kbd> free camera' : ''}</small>`;
    });
    if (spec && this.cache.specName !== g.nameOf(me.id)) { this.cache.specName = g.nameOf(me.id); el.specbar.innerHTML = `<small>SPECTATING</small><b>${esc(g.nameOf(me.id))}</b><small>Click or <kbd>Space</kbd> for next player${g.myTeam() === SPEC ? ' · <kbd>F</kbd> free camera' : ''}</small>`; }
  }

  renderMates(g, ros) {
    if (g.mode === 'dm') { this.el.mates.innerHTML = ''; return; }
    const vt = g.me ? (g.roster.get(g.me.id) || {}).tm : g.myTeam();
    const team = vt === undefined || vt === SPEC ? -1 : vt;
    if (team < 0) { this.el.mates.innerHTML = ''; return; }
    const latest = g.snaps[g.snaps.length - 1];
    const rows = ros.filter((p) => p.tm === team).map((p) => {
      const tup = latest ? latest.players.get(p.id) : null;
      const hp = tup && p.al ? tup[4] : 0;
      return `<div class="mate ${team === T ? 't' : ''} ${p.al ? '' : 'dead'}"><span class="nm">${esc(p.n)}</span><span class="mo">${p.mo >= 0 && (g.phase === PHASE.FREEZE) ? '$' + p.mo : ''}</span><span class="hpbar"><i style="width:${hp}%"></i></span></div>`;
    }).join('');
    if (rows !== this.cache.matesHtml) { this.cache.matesHtml = rows; this.el.mates.innerHTML = rows; }
  }

  renderWeapon(g, me) {
    const w = me.held < HELD_GREN_BASE ? WEAPON_LIST[me.held] : null;
    const gi = me.held >= HELD_GREN_BASE && me.held < 120 ? me.held - HELD_GREN_BASE : -1;
    const clipTxt = w ? (w.kind === 'knife' ? '' : g.predictedClip()) : gi >= 0 ? me.gr[gi] : '';
    this.set('clip', clipTxt, (v) => { this.el.clip.textContent = v; this.el.clip.classList.toggle('low', w && w.kind !== 'knife' && v <= Math.ceil(w.mag * 0.25)); });
    this.set('res', w && w.kind !== 'knife' ? '/ ' + me.res : '', (v) => { this.el.reserve.textContent = v; });
    this.set('wn', gi >= 0 ? GRENADE[GREN_ORDER[gi]].name : w ? w.name : '', (v) => { this.el.weaponName.textContent = v; });
    const key = [me.pri, me.sec, me.sel, me.gr.join(','), me.gsel, me.bomb].join('|');
    this.set('slots', key, () => {
      const parts = [];
      if (me.pri >= 0) parts.push(`<div class="slot ${me.sel === 'primary' ? 'sel' : ''}"><kbd>1</kbd>${esc(WEAPON_LIST[me.pri].name)}</div>`);
      if (me.sec >= 0) parts.push(`<div class="slot ${me.sel === 'secondary' ? 'sel' : ''}"><kbd>2</kbd>${esc(WEAPON_LIST[me.sec].name)}</div>`);
      parts.push(`<div class="slot ${me.sel === 'knife' ? 'sel' : ''}"><kbd>3</kbd>Knife</div>`);
      const dots = GREN_ORDER.map((k, i) => Array.from({ length: me.gr[i] }, () => `<i style="background:${GREN_HEX[k]};${me.sel === 'grenade' && me.gsel === i ? 'outline:2px solid #fff' : ''}"></i>`).join('')).join('');
      if (dots) parts.push(`<div class="slot ${me.sel === 'grenade' ? 'sel' : ''}"><kbd>4</kbd><span class="gr">${dots}</span></div>`);
      if (me.bomb) parts.push('<div class="slot" style="color:#ff8a82">💣 C4</div>');
      if (me.kit) parts.push('<div class="slot" style="color:#7dbdff">Kit</div>');
      this.el.slots.innerHTML = parts.join('');
    });
  }

  updatePrompt(g, me) {
    const el = this.el;
    let text = '', prog = -1, plabel = '';
    if (me && me.own && g.alive) {
      const px = g.pred.x, py = g.pred.y;
      const site = g.map ? g.map.siteAt(px, py) : 0;
      const bb = g.bombInfo;
      if (me.pl > 0) { prog = me.pl; plabel = 'Planting…'; }
      else if (me.df > 0) { prog = me.df; plabel = 'Defusing…'; }
      else if (me.bomb && site && g.phase === PHASE.LIVE) text = 'Hold <kbd>E</kbd> to plant the bomb';
      else if (bb && bb[0] === 3 && g.myTeam() === CT && Math.hypot(px - bb[1], py - bb[2]) < 48) text = `Hold <kbd>E</kbd> to defuse${me.kit ? '' : ' (no kit: 10 s)'}`;
      else if (me.buy && g.phase === PHASE.FREEZE && !this.buyOpen && g.mode === 'defuse') text = 'Press <kbd>B</kbd> to open the buy menu';
      else {
        const near = g.ents.dr.find((d) => Math.hypot(d[2] - px, d[3] - py) < 34);
        if (near) text = `<kbd>E</kbd> pick up ${esc(WEAPON_LIST[near[1]].name)}`;
      }
      if (g.phase === PHASE.FREEZE && !text && g.mode === 'defuse') text = '';
    }
    this.set('prompt', text, (v) => { el.prompt.style.display = v ? 'block' : 'none'; el.prompt.innerHTML = v; });
    this.set('progVis', prog >= 0 ? plabel : '', (v) => { el.progress.classList.toggle('hidden', !v); el.progressLabel.textContent = v; });
    if (prog >= 0) el.progressFill.style.width = `${Math.round(prog * 100)}%`;
  }
}
