// Main menu: 3D key art, PLAY / LOADOUT / CUSTOMIZE / SETTINGS / EXIT, profile, featured map, news.
import { WEAPON_LIST, ATTACH, ATTACH_SLOTS, ATTACH_SLOT_NAMES, GADGETS, sanitizeLoadout, defaultLoadout } from '../../shared/weapons.js';
import { getMap } from '../../shared/maps/index.js';
import { mapThumb } from '../game/terrain.js';
import { gunIcon, attachIcon } from '../game/viewmodel.js';
import { KitEditor, weaponRatings, statRow } from './kit.js';
import { settingsHTML, bindSettings, controlsHTML } from './settings.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const store = { get(k, d = '') { try { const v = localStorage.getItem(k); return v === null ? d : v; } catch { return d; } }, set(k, v) { try { localStorage.setItem(k, String(v)); } catch { /* ignore */ } } };

const LOGO_SVG = `<svg viewBox="0 0 64 72" class="mm-badge" aria-hidden="true"><path d="M32 2l28 9v26c0 17-11 28-28 33C15 65 4 54 4 37V11z" fill="#10151f" stroke="#ffb23a" stroke-width="3"/><rect x="14" y="16" width="16" height="16" fill="#3f86e8"/><rect x="34" y="16" width="16" height="16" fill="#e0523a"/><rect x="14" y="36" width="16" height="16" fill="#ffb23a"/><rect x="34" y="36" width="16" height="16" fill="#cfd6e0"/></svg>`;
const HEAD_SVG = `<svg viewBox="0 0 24 24" class="mm-avatar" aria-hidden="true"><rect width="24" height="24" fill="#2a3a55"/><rect x="6" y="5" width="12" height="4" fill="#3f5a3a"/><rect x="5" y="8" width="14" height="2" fill="#2f4a2c"/><rect x="7" y="10" width="10" height="9" fill="#e2b48c"/><rect x="9" y="12" width="2" height="2" fill="#20242c"/><rect x="13" y="12" width="2" height="2" fill="#20242c"/><rect x="9" y="16" width="6" height="1" fill="#9a6a52"/><rect x="4" y="19" width="16" height="5" fill="#3f5a3a"/></svg>`;

const NEWS = [
  ['Hold the line', 'Capture flags together. Hold the majority to drain enemy reinforcements.'],
  ['Stay with your squad', 'Deploy on teammates, share supplies, and revive fallen allies.'],
  ['Make your own route', 'Use vehicles and explosives to break through destructible cover.'],
];

export class Home {
  constructor(app) {
    this.app = app;
    this.el = $('home');
    this.rooms = [];
    this.timer = 0;
    this.view = 'main';
    this.render();
  }

  get name() {
    const v = ($('nameInput') && $('nameInput').value.trim()) || '';
    return v.slice(0, 16);
  }

  // ------------------------------------------------------------------ skeleton
  render() {
    const savedName = store.get('cs.name');
    const xp = Number(store.get('bf.xp', '0')) || 0;
    const lvl = Math.floor(Math.sqrt(xp / 120)) + 1, lo = (lvl - 1) ** 2 * 120, hi = lvl ** 2 * 120;
    const pct = Math.round(((xp - lo) / (hi - lo)) * 100);
    const rank = ['Recruit', 'Private', 'Corporal', 'Sergeant', 'Lieutenant', 'Captain', 'Major', 'Colonel'][Math.min(7, Math.floor((lvl - 1) / 3))];
    this.el.innerHTML = `
    <img class="mm-art" src="assets/art/river-crossing.png" alt="" fetchpriority="high">
    <div class="mm-shade"></div>
    <div class="mm">
      <div class="mm-left">
        <div class="mm-logo">${LOGO_SVG}<div class="mm-title"><span>VOXEL</span><span>FRONTLINE</span></div></div>
        <div class="mm-sub">Infantry. Armor. Air support.</div>
        <div class="mm-card profile">
          <div class="mm-h">Callsign</div>
          <div class="pf-row">${HEAD_SVG}<div class="pf-main"><input class="pf-name" id="nameInput" maxlength="16" placeholder="Enter a nickname" value="${esc(savedName)}" autocomplete="off" spellcheck="false" aria-label="Your name"><div class="pf-rank">${rank} · level ${lvl}</div></div></div>
          <div class="pf-xp" role="progressbar" aria-valuenow="${pct}" aria-valuemin="0" aria-valuemax="100"><i style="width:${pct}%"></i></div><div class="pf-xpt">${xp} XP · ${hi - xp} to level ${lvl + 1}</div>
        </div>
        <nav class="mm-nav" id="mmNav">
          <button class="mm-btn primary" data-go="play"><span>Play</span><i>▶</i></button>
          <button class="mm-btn" data-go="loadout"><span>Loadout</span></button>
          <button class="mm-btn" data-go="customize"><span>Customize</span></button>
          <button class="mm-btn" data-go="settings"><span>Settings</span></button>
          <button class="mm-btn" data-go="exit"><span>Exit</span></button>
        </nav>
        <div class="mm-controls"><span class="mm-h">In a match</span><div><kbd>WASD</kbd> Move <kbd>RMB</kbd> Aim</div><div><kbd>L</kbd> Loadout <kbd>Tab</kbd> Scores <kbd>Esc</kbd> Menu</div></div>
        <div class="mm-foot"><span class="status-dot" id="statusDot"></span><span id="statusText">Connecting…</span><span class="ver">v3.0</span></div>
      </div>
      <div class="mm-mid"><div class="mm-operation"><span>Featured operation / 01</span><h1>River Basin</h1><p>Fight for the crossing.</p><div>7 objectives <i></i> 32 players <i></i> Combined arms</div></div></div>
      <div class="mm-right">
        <div class="mm-card map">
          <div class="mm-h">Featured map</div>
          <div class="fm"><canvas id="fmThumb" width="300" height="170"></canvas><div class="fm-info"><b>River Basin</b><small>Conquest · up to 32 players<br>Tanks · helicopters · boats</small><button class="btn primary" id="fmPlay">Play now</button></div></div>
        </div>
        <div class="mm-card news"><div class="mm-h">Mission briefing</div>${NEWS.map(([h, t]) => `<div class="nw"><b>${esc(h)}</b><span>${esc(t)}</span></div>`).join('')}</div>
      </div>
    </div>
    <div class="mm-panel hidden" id="mmPanel"></div>`;
    const name = $('nameInput');
    name.addEventListener('input', () => store.set('cs.name', name.value));
    $('mmNav').onclick = (e) => { const b = e.target.closest('[data-go]'); if (b) this.go(b.dataset.go); };
    $('fmPlay').onclick = () => { if (this.requireName()) this.app.quickPlay(this.name); };
    const th = $('fmThumb'); try { th.getContext('2d').drawImage(mapThumb(getMap('riverside'), 300, 170), 0, 0); } catch { /* no thumbnail */ }
    if (this.app.inviteCode) setTimeout(() => this.go('play'), 0);
    if (!savedName) setTimeout(() => name.focus(), 50);
    this.setStatus(this.app.net.open);
  }

  requireName() {
    if (!this.name) { $('nameInput').focus(); this.app.toast('Pick a nickname first', true); return false; }
    return true;
  }

  // ------------------------------------------------------------------ views
  go(view) {
    if (view === 'exit') { location.href = '/'; return; }
    this.view = view;
    const p = $('mmPanel');
    this.el.classList.toggle('panel-open', view !== 'main');
    if (view === 'main') { p.classList.add('hidden'); p.innerHTML = ''; document.querySelectorAll('#mmNav .mm-btn').forEach((b) => b.classList.remove('on')); return; }
    p.classList.remove('hidden');
    p.dataset.view = view;
    const title = { play: 'Play', loadout: 'Loadout', customize: 'Arsenal', settings: 'Settings' }[view];
    const sub = { play: 'Jump into a match or host your own.', loadout: 'Pick a role, weapon and gear. It is used the next time you deploy.', customize: 'Every weapon and attachment, with its ratings.', settings: 'Audio, aiming, graphics and key bindings.' }[view];
    p.innerHTML = `<div class="mp-head"><div><h2>${title}</h2><p>${sub}</p></div><button class="btn" id="mpBack">← Back</button></div><div class="mp-body" id="mpBody"></div>`;
    $('mpBack').onclick = () => this.go('main');
    const body = $('mpBody');
    if (view === 'play') this.viewPlay(body);
    else if (view === 'loadout') this.viewLoadout(body);
    else if (view === 'customize') this.viewCustomize(body);
    else if (view === 'settings') this.viewSettings(body);
    document.querySelectorAll('#mmNav .mm-btn').forEach((b) => b.classList.toggle('on', b.dataset.go === view));
  }

  viewPlay(body) {
    const app = this.app, invite = app.inviteCode;
    body.innerHTML = `<div class="play-grid">
      <div class="pl-col">
        ${invite ? `<div class="join-banner"><div><span class="label">You're invited to room</span><b>${esc(invite)}</b></div><button class="btn primary" id="joinInvite">Join</button></div>` : ''}
        <button class="play-card primary" id="quickBtn"><span class="pc-ic" aria-hidden="true">▶</span><span class="pc-copy"><b>Quick play</b><small>Conquest on River Basin, 8 vs 8 with bots. Starts right away.</small></span></button>
        <button class="play-card" id="createBtn"><span class="pc-ic" aria-hidden="true">＋</span><span class="pc-copy"><b>Create a room</b><small>Pick the map, mode and rules, then invite friends with a link.</small></span></button>
        <div class="join-code"><label class="label" for="codeInput">Have a room code?</label>
          <div class="row"><input class="input code-input" id="codeInput" maxlength="4" placeholder="ABCD" autocomplete="off" spellcheck="false"><button class="btn" id="joinBtn">Join room</button></div></div>
        ${window.matchMedia && window.matchMedia('(pointer: coarse)').matches ? '<p class="footer-note"><b>Heads up:</b> this game needs a keyboard and mouse.</p>' : ''}
      </div>
      <div class="pl-col"><div class="pl-head"><h3>Public rooms</h3><span class="live-dot">Updates live</span></div><div class="rooms-list" id="roomsList"><div class="empty-note">Loading…</div></div></div></div>`;
    $('quickBtn').onclick = () => { if (this.requireName()) app.quickPlay(this.name); };
    $('createBtn').onclick = () => { if (this.requireName()) app.createRoom(this.name); };
    const join = () => { const c = $('codeInput').value.trim().toUpperCase(); if (c.length < 4) { app.toast('Enter the 4-letter room code'); return; } if (this.requireName()) app.joinRoom(c, this.name); };
    $('joinBtn').onclick = join;
    $('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
    $('codeInput').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
    if (invite) $('joinInvite').onclick = () => { if (this.requireName()) app.joinRoom(invite, this.name); };
    this.renderRooms();
  }

  viewLoadout(body) {
    let lo;
    try { lo = sanitizeLoadout(JSON.parse(store.get('bf.loadout', 'null'))); } catch { lo = defaultLoadout('assault'); }
    body.innerHTML = '<div class="kit-wrap" id="mpKit"></div>';
    const ed = new KitEditor($('mpKit'), { onChange: (l) => store.set('bf.loadout', JSON.stringify(l)) });
    ed.set(lo);
  }

  viewCustomize(body) {
    const weapons = [...WEAPON_LIST.filter((w) => w.slot === 'primary'), ...WEAPON_LIST.filter((w) => w.slot === 'secondary')];
    const cards = weapons.map((w) => `<div class="sheet-card"><div class="sc-head"><div class="sc-name">${esc(w.name)}</div><div class="sc-tag">${esc(w.tag)}</div></div><img src="${gunIcon(w.id, w.kind, null, 420, 170)}" alt=""><div class="kstats">${weaponRatings(w).map(statRow).join('')}</div></div>`);
    const rl = GADGETS.rpg;
    cards.push(`<div class="sheet-card"><div class="sc-head"><div class="sc-name">RL-80</div><div class="sc-tag">Rocket launcher</div></div><img src="${gunIcon('rpg', 'launcher', null, 420, 170)}" alt=""><div class="kstats">${[['Damage', 100, ''], ['Fire rate', 10, ''], ['Range', 60, ''], ['Accuracy', 55, ''], ['Mobility', 55, '']].map(statRow).join('')}</div><div class="sc-desc">${esc(rl.desc)}</div></div>`);
    const atts = [];
    for (const slot of ATTACH_SLOTS) for (const [id, a] of Object.entries(ATTACH[slot])) if (a.no) atts.push({ slot, id, a });
    atts.sort((x, y) => x.a.no - y.a.no);
    body.innerHTML = `<h3 class="sheet-h">Weapons</h3><div class="sheet weapons">${cards.join('')}</div>
      <h3 class="sheet-h">Attachments</h3><div class="sheet atts">${atts.map(({ slot, id, a }) => `<div class="sheet-card att"><img src="${attachIcon(slot, id, 300, 170)}" alt=""><div class="sc-head"><div class="sc-name">${esc(a.name)}</div><div class="sc-tag">${ATTACH_SLOT_NAMES[slot]}</div></div><div class="sc-desc">${esc(a.desc)}</div></div>`).join('')}</div>`;
  }

  viewSettings(body) {
    const g = this.app.game;
    body.innerHTML = `<div class="set-grid"><div class="set-col">${settingsHTML(g)}</div><div class="set-col"><h3 class="sheet-h">Controls</h3>${controlsHTML()}</div></div>`;
    bindSettings(body, g);
  }

  // ------------------------------------------------------------------ server-fed bits
  setStatus(online) {
    const d = $('statusDot'), t = $('statusText');
    if (!d) return;
    d.classList.toggle('on', online);
    t.textContent = online ? 'Connected to server' : 'Connecting…';
  }

  setRooms(list) { this.rooms = list; this.renderRooms(); }

  renderRooms() {
    const box = $('roomsList');
    if (!box) return;
    if (!this.rooms.length) { box.innerHTML = '<div class="empty-note"><b>No public rooms right now</b><span>Create a room and switch on “List in public rooms” to appear here, or use Quick play.</span></div>'; return; }
    const modes = { conquest: 'Conquest', rush: 'Rush', tdm: 'Deathmatch' };
    box.innerHTML = this.rooms.map((r) => `<button class="room-item" data-code="${esc(r.code)}"><span class="ri-main"><b>${esc(r.name)}</b><small>${esc(r.map)} · ${modes[r.mode] || r.mode} · ${r.humans} player${r.humans === 1 ? '' : 's'}${r.state === 'playing' ? ' · in match' : ''}</small></span><span class="code">${esc(r.code)}</span><span class="ri-join">Join</span></button>`).join('');
    box.querySelectorAll('.room-item').forEach((el) => { el.onclick = () => { if (this.name) this.app.joinRoom(el.dataset.code, this.name); else { $('nameInput').focus(); this.app.toast('Pick a nickname first', true); } }; });
  }

  show() {
    this.el.classList.remove('hidden');
    const keepName = this.name;
    this.render();
    if (keepName) $('nameInput').value = keepName;
    if (this.view !== 'main' && !this.app.inviteCode) this.go(this.view);
    this.app.net.send({ t: 'list' });
    clearInterval(this.timer);
    this.timer = setInterval(() => this.app.net.send({ t: 'list' }), 5000);
  }

  hide() {
    this.el.classList.add('hidden');
    clearInterval(this.timer);
  }
}
