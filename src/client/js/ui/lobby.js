// Room lobby: settings (host), team columns, chat, invite link.
import { getMap } from '../../../shared/maps/index.js';
import { mapThumb } from '../game/terrain.js';
import { T, CT, SPEC, MODES, RULES } from '../../../shared/constants.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class Lobby {
  constructor(app) {
    this.app = app;
    this.el = $('lobby');
    this.roster = [];
    this.thumbs = new Map();
    this.chat = [];
    this.built = false;
  }

  show() { this.el.classList.remove('hidden'); this.build(); this.update(); }
  hide() { this.el.classList.add('hidden'); }

  inviteLink() { return `${location.origin}/?room=${this.app.room.code}`; }

  build() {
    const app = this.app;
    const r = app.room;
    this.el.innerHTML = `
    <div class="lobby-wrap">
      <div class="lobby-head">
        <div class="room-code"><div><small>Room code</small><b>${esc(r.code)}</b></div></div>
        <button class="btn" id="copyLink">Copy invite link</button>
        <span style="color:var(--dim);font-size:12px" id="linkHint">Send this link to your friends — they join in one click.</span>
        <div class="spacer"></div>
        <button class="btn danger" id="leaveLobby">Leave room</button>
      </div>
      <div class="card-panel panel" id="settingsPanel"></div>
      <div class="card-panel panel" id="teamsPanel"></div>
      <div class="card-panel panel chat-panel"><h3>Chat</h3><div class="chat-lines" id="lobbyChat"></div>
        <form class="chat-form" id="lobbyChatForm"><input class="input" id="lobbyChatInput" maxlength="160" placeholder="Say something…" autocomplete="off" aria-label="Chat message"><button class="btn" type="submit">Send</button></form></div>
    </div>`;
    $('copyLink').onclick = async () => {
      const link = this.inviteLink();
      try { await navigator.clipboard.writeText(link); app.toast('Invite link copied!'); }
      catch { const ta = document.createElement('textarea'); ta.value = link; document.body.appendChild(ta); ta.select(); try { document.execCommand('copy'); app.toast('Invite link copied!'); } catch { app.toast(link); } ta.remove(); }
    };
    $('leaveLobby').onclick = () => app.leaveRoom();
    $('lobbyChatForm').onsubmit = (e) => {
      e.preventDefault();
      const inp = $('lobbyChatInput');
      const text = inp.value.trim();
      if (text) app.net.send({ t: 'chat', text, team: 0 });
      inp.value = '';
    };
    this.renderChat();
    this.built = true;
  }

  thumb(id) {
    if (!this.thumbs.has(id)) this.thumbs.set(id, mapThumb(getMap(id), 192, 136));
    return this.thumbs.get(id);
  }

  update() {
    if (!this.built) return;
    this.renderSettings();
    this.renderTeams();
  }

  set(patch) {
    const s = { ...this.app.room.settings, ...patch };
    this.app.net.send({ t: 'settings', settings: s });
  }

  renderSettings() {
    const app = this.app, r = app.room, s = r.settings, host = app.isHost();
    const seg = (key, opts, cur) => `<div class="seg" data-key="${key}" data-disabled="${host ? 0 : 1}">${opts.map(([v, l]) => `<button data-v="${esc(String(v))}" class="${String(cur) === String(v) ? 'on' : ''}">${esc(l)}</button>`).join('')}</div>`;
    const tog = (key, label, on) => `<div class="toggle"><span>${label}</span><button class="switch ${on ? 'on' : ''}" data-tog="${key}" ${host ? '' : 'disabled'} role="switch" aria-checked="${on}" aria-label="${label}"></button></div>`;
    const maps = app.maps || [];
    const p = $('settingsPanel');
    const focused = document.activeElement && document.activeElement.id === 'roomName';
    if (focused) return;
    const modeNames = { conquest: 'Conquest', rush: 'Rush', tdm: 'Team DM' };
    p.innerHTML = `<h3>Match settings ${host ? '' : '<span style="text-transform:none;letter-spacing:0;color:var(--dim)">(host only)</span>'}</h3>
      <div class="setting"><span class="label">Mode</span>${seg('mode', Object.keys(MODES).map((m) => [m, modeNames[m]]), s.mode)}
        <div style="color:var(--dim);font-size:11px;margin-top:6px;line-height:1.4">${esc(MODES[s.mode].desc)}</div></div>
      <div class="setting"><span class="label">Map</span><div class="map-cards" data-disabled="${host ? 0 : 1}">${maps.map((m) => `<button class="map-card ${s.map === m.id ? 'on' : ''}" data-map="${m.id}"><canvas width="192" height="136"></canvas><div><b>${esc(m.name)}</b><small>${esc(m.desc)}</small><small style="color:var(--accent)">${esc(m.size)} · ${esc(m.best)} · ${m.modes.map((x) => modeNames[x]).join(' / ')}</small></div></button>`).join('')}</div></div>
      <div class="setting"><span class="label">Players per team</span>${seg('teamSize', [1, 2, 4, 6, 8, 12, 16].map((n) => [n, n]), s.teamSize)}</div>
      ${s.mode !== 'tdm' ? `<div class="setting"><span class="label">${s.mode === 'rush' ? 'Attacker reinforcements' : 'Tickets'}</span>${seg('tickets', RULES.ticketOptions.map((n) => [n, s.mode === 'rush' ? Math.round(n * 0.32) : n]), s.tickets)}</div>` : ''}
      ${tog('vehicles', 'Vehicles (jeeps, tanks, helis, boats)', s.vehicles)}
      ${tog('bots', 'Fill empty slots with bots', s.bots)}
      ${s.bots ? `<div class="setting"><span class="label">Bot skill</span>${seg('difficulty', [['easy', 'Easy'], ['normal', 'Normal'], ['hard', 'Hard'], ['expert', 'Expert']], s.difficulty)}</div>` : ''}
      ${tog('friendlyFire', 'Friendly fire', s.friendlyFire)}
      ${tog('public', 'List in public rooms', s.public)}
      <div class="setting" style="margin-top:8px"><label class="label" for="roomName">Room name</label><input class="input" id="roomName" maxlength="24" value="${esc(s.name)}" placeholder="Optional" ${host ? '' : 'disabled'} style="min-height:38px;padding:7px 10px;font-size:13px"></div>`;
    p.querySelectorAll('.map-card').forEach((b) => {
      const c = b.querySelector('canvas');
      c.getContext('2d').drawImage(this.thumb(b.dataset.map), 0, 0);
      b.onclick = () => host && this.set({ map: b.dataset.map });
    });
    p.querySelectorAll('.seg').forEach((sg) => {
      sg.onclick = (e) => {
        const b = e.target.closest('button'); if (!b || !host) return;
        const key = sg.dataset.key; let v = b.dataset.v;
        if (key === 'teamSize' || key === 'tickets') v = Number(v);
        this.set({ [key]: v });
      };
    });
    p.querySelectorAll('.switch').forEach((sw) => { sw.onclick = () => host && this.set({ [sw.dataset.tog]: !s[sw.dataset.tog] }); });
    const rn = $('roomName');
    if (rn) rn.onchange = () => host && this.set({ name: rn.value });
  }

  renderTeams() {
    const app = this.app, r = app.room, s = r.settings, host = app.isHost();
    const you = app.game.you;
    const byTeam = (t) => this.roster.filter((p) => p.tm === t);
    const member = (p) => `<div class="member ${p.id === you ? 'me' : ''}"><span>${esc(p.n)}</span>${p.id === r.host ? '<span class="tag host">HOST</span>' : ''}${p.b ? '<span class="tag">BOT</span>' : ''}${p.dc ? '<span class="tag">DC</span>' : ''}<span class="ping">${p.b ? '' : p.pg + ' ms'}</span>${host && !p.b && p.id !== you ? `<button class="kick" data-kick="${p.id}" title="Kick" aria-label="Kick ${esc(p.n)}">✕</button>` : ''}</div>`;
    const col = (t, cls, title) => {
      const list = byTeam(t);
      const empties = Math.min(12, Math.max(0, s.teamSize - list.length));
      return `<div class="team-col ${cls}"><h4><span>${title}</span><small>${list.length}/${s.teamSize}</small></h4>${list.map(member).join('')}${Array.from({ length: empties }, () => '<div class="slot-empty">Open slot</div>').join('')}<div style="flex:1"></div><button class="btn small" data-team="${t}">Join ${title.split(' ')[0]}</button></div>`;
    };
    const specs = byTeam(SPEC);
    const playing = r.state === 'playing';
    const p = $('teamsPanel');
    p.innerHTML = `<h3>Teams</h3><div class="teams">${col(T, 't', 'Crimson Army')}${col(CT, 'ct', 'Azure Legion')}</div>
      <div class="spec-row"><button class="btn small" data-team="2">Spectate</button><div class="members">${specs.map((m) => `<span class="member" style="padding:4px 10px">${esc(m.n)}</span>`).join('') || '<span style="color:var(--dim);font-size:12px">No spectators</span>'}</div></div>
      <div class="lobby-actions">${host ? `<button class="btn green big" id="startBtn">${playing ? 'Back to match' : '▶ Start match'}</button><button class="btn" id="shuffleBtn" title="Randomly split the players into two even teams">Shuffle teams</button>` : '<span class="hint">Waiting for the host to start the match…</span>'}<span class="hint">${s.bots ? 'Empty slots are filled with bots.' : 'Bots are off — only humans will play.'}</span></div>`;
    p.querySelectorAll('[data-team]').forEach((b) => { b.onclick = () => app.net.send({ t: 'team', team: Number(b.dataset.team) }); });
    p.querySelectorAll('[data-kick]').forEach((b) => { b.onclick = () => app.net.send({ t: 'kick', id: Number(b.dataset.kick) }); });
    const sb = $('startBtn'); if (sb) sb.onclick = () => app.net.send({ t: 'start' });
    const sh = $('shuffleBtn'); if (sh) sh.onclick = () => app.net.send({ t: 'shuffle' });
  }

  setRoster(list) { this.roster = list; if (this.built) this.renderTeams(); }

  addChat(m) {
    this.chat.push(m);
    if (this.chat.length > 80) this.chat.shift();
    if (this.built) this.renderChat();
  }

  renderChat() {
    const box = $('lobbyChat');
    if (!box) return;
    const cls = ['t', 'ct', 's'];
    box.innerHTML = this.chat.map((m) => (m.sys ? `<div class="sys">${esc(m.text)}</div>` : `<div><b class="${cls[(this.roster.find((p) => p.id === m.from) || { tm: 2 }).tm] || 's'}">${esc(m.name)}</b>: ${esc(m.text)}</div>`)).join('');
    box.scrollTop = box.scrollHeight;
  }
}
