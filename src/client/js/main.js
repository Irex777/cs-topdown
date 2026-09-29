// App bootstrap: connection, screen routing, room / match lifecycle.
import { Net } from './net.js';
import { audio } from './audio.js';
import { ClientGame } from './game/game.js';
import { HUD } from './ui/hud.js';
import { Home } from './ui/home.js';
import { Lobby } from './ui/lobby.js';

const $ = (id) => document.getElementById(id);

class App {
  constructor() {
    this.net = new Net();
    this.room = null;
    this.maps = [];
    this.playing = false;
    this.inviteCode = (new URLSearchParams(location.search).get('room') || location.hash.replace('#', '')).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    const dummyUI = {};
    this.game = new ClientGame($('game'), this.net, dummyUI);
    this.hud = new HUD(this.game, this.net, this);
    this.home = new Home(this);
    this.lobby = new Lobby(this);
    this.bind();
    this.connect();
    const unlock = () => audio.unlock();
    window.addEventListener('pointerdown', unlock);
    window.addEventListener('keydown', unlock);
    window.addEventListener('pointerdown', (e) => { if (e.target.closest && e.target.closest('button, .room-item, .map-card')) audio.click(); }, true);
  }

  isHost() { return !!this.room && this.room.host === this.game.you; }

  toast(text, err) {
    const el = document.createElement('div');
    el.className = 'toast' + (err ? ' err' : '');
    el.textContent = text;
    $('toasts').appendChild(el);
    setTimeout(() => el.remove(), 3600);
  }

  // ------------------------------------------------------------------ connection
  connect() {
    const net = this.net;
    net.on('open', () => {
      $('conn').classList.add('hidden');
      this.home.setStatus(true);
      let token = null;
      try { token = sessionStorage.getItem('cs.token'); } catch { /* ignore */ }
      net.send({ t: 'hello', name: this.home.name || '', token });
    });
    net.on('close', () => {
      $('conn').classList.remove('hidden');
      this.home.setStatus(false);
    });
    net.on('welcome', (m) => {
      try { sessionStorage.setItem('cs.token', m.token); } catch { /* ignore */ }
      this.maps = m.maps;
      if (!m.resumed && this.room) {
        // connection dropped and the server no longer knows us: go back to the start
        this.toRoot('Connection lost — the room is gone');
      }
    });
    net.on('rooms', (m) => this.home.setRooms(m.rooms));
    net.on('error', (m) => {
      this.toast(m.text, true);
      if (m.code === 'noroom') { this.inviteCode = ''; history.replaceState(null, '', location.pathname); if (!this.room) this.home.show(); }
    });
    net.on('room', (m) => this.onRoom(m));
    net.on('settings', (m) => { if (this.room) { this.room.settings = m.settings; this.lobby.update(); } });
    net.on('host', (m) => { if (this.room) { this.room.host = m.host; this.lobby.update(); } });
    net.on('roster', (m) => { if (this.room) this.room.host = m.host; this.lobby.setRoster(m.players); if (this.room && !$('lobby').classList.contains('hidden')) this.lobby.update(); });
    net.on('chat', (m) => { this.lobby.addChat(m); });
    net.on('match', (m) => this.onMatch(m));
    net.on('lobby', (m) => this.onLobby(m));
    net.on('kicked', () => { this.toast('You were removed from the room', true); this.toRoot(); });
    net.on('s', (m) => { if (this.playing) this.game.onSnapshot(m); });
    net.connect().catch(() => { $('conn').classList.remove('hidden'); });
  }

  // ------------------------------------------------------------------ actions
  quickPlay(name) {
    audio.unlock();
    this.net.send({ t: 'create', name, autostart: true, settings: { mode: 'defuse', map: 'dust', teamSize: 5, bots: true, difficulty: 'normal', rounds: 16, friendlyFire: false, public: false } });
  }

  createRoom(name) {
    audio.unlock();
    this.net.send({ t: 'create', name, settings: { map: 'dust', mode: 'defuse', teamSize: 5, bots: true, difficulty: 'normal', rounds: 16 } });
  }

  joinRoom(code, name) {
    audio.unlock();
    this.net.send({ t: 'join', code, name });
  }

  leaveRoom() {
    this.net.send({ t: 'leave' });
    this.toRoot();
  }

  toRoot(msg) {
    this.game.stop();
    this.playing = false;
    this.room = null;
    this.game.you = 0;
    document.body.classList.remove('ingame', 'menu-open');
    $('hud').classList.add('hidden');
    this.hud.closePause(); this.hud.closeBuy(); this.hud.closeEnd(); this.hud.showScore(false);
    this.lobby.hide();
    this.inviteCode = '';
    history.replaceState(null, '', location.pathname);
    this.home.show();
    if (msg) this.toast(msg, true);
  }

  // ------------------------------------------------------------------ server events
  onRoom(m) {
    this.room = { code: m.code, settings: m.settings, host: m.host, state: m.state };
    this.game.you = m.you;
    this.lobby.chat = [];
    this.lobby.built = false;
    history.replaceState(null, '', `${location.pathname}?room=${m.code}`);
    this.home.hide();
    if (m.state === 'lobby') { this.playing = false; this.lobby.show(); }
    else this.lobby.hide();
  }

  onMatch(m) {
    if (!this.room) return;
    this.room.settings = m.settings || this.room.settings;
    this.room.state = 'playing';
    this.home.hide(); this.lobby.hide();
    this.playing = true;
    document.body.classList.add('ingame');
    $('hud').classList.remove('hidden');
    this.game.startMatch(m);
    this.hud.minimap.setMap(this.game.map);
    this.hud.cache = {};
    this.hud.closeEnd(); this.hud.closePause();
    this.hud.el.killfeed.innerHTML = ''; this.hud.el.chatlog.innerHTML = '';
    if (m.round === 0) this.toast('Match starting — good luck!');
    else this.toast('Joined a match in progress. Press Esc to pick a team.');
  }

  onLobby() {
    if (!this.room) return;
    this.room.state = 'lobby';
    this.game.stop();
    this.playing = false;
    document.body.classList.remove('ingame', 'menu-open');
    $('hud').classList.add('hidden');
    this.hud.closePause(); this.hud.closeBuy(); this.hud.closeEnd(); this.hud.showScore(false);
    this.lobby.built = false;
    this.lobby.show();
  }

  bind() {
    window.addEventListener('resize', () => this.hud.minimap.layout(this.game.bigmap));
    // prevent accidental page zoom / scroll gestures while playing
    window.addEventListener('wheel', (e) => { if (this.playing && e.ctrlKey) e.preventDefault(); }, { passive: false });
    window.addEventListener('beforeunload', (e) => { if (this.playing) { e.preventDefault(); e.returnValue = ''; } });
  }
}

window.app = new App();
