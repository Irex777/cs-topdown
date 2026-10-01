// App bootstrap: connection, screen routing, room / match lifecycle.
import { Net } from './net.js';
import { audio } from './battlefield-audio.js';
import { ClientGame } from './game/game.js';
import { loadAssets } from './game/assets.js';
import { HUD } from './ui/hud.js';
import { Home } from './ui/home.js';
import { Lobby } from './ui/lobby.js';

const $ = (id) => document.getElementById(id);

class App {
  constructor() {
    loadAssets();          // high-fidelity models stream in while the menu is open (voxel fallbacks until then)
    this.net = new Net();
    this.room = null;
    this.maps = [];
    this.playing = false;
    this.inviteCode = (new URLSearchParams(location.search).get('room') || location.hash.replace('#', '')).toUpperCase().replace(/[^A-Z]/g, '').slice(0, 4);
    const dummyUI = {};
    try { this.game = new ClientGame($('game'), this.net, dummyUI); } catch (e) {
      document.body.innerHTML = '<div style="padding:40px;font:16px ui-monospace,monospace;color:#eef2f8;max-width:560px;margin:auto"><h2>3D graphics are not available</h2><p style="margin-top:12px;color:#9aa6b8">Voxel Frontline needs WebGL. Enable hardware acceleration in your browser settings (or try a different browser) and reload.</p><p style="margin-top:12px"><a href="/" style="color:#ffb23a">◀ Back to the game picker</a></p></div>';
      throw e;
    }
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
  /** a random map from the server's list (never the one just played), with a mode it supports and a team size that suits it */
  pickQuickMatch(forceMap = null) {
    const maps = this.maps || [];
    let m = forceMap ? maps.find((x) => x.id === forceMap) : null;
    if (!m && maps.length) {
      let last = ''; try { last = sessionStorage.getItem('bf.lastQuickMap') || ''; } catch { /* ignore */ }
      const pool = maps.length > 1 ? maps.filter((x) => x.id !== last) : maps;
      m = pool[Math.floor(Math.random() * pool.length)];
    }
    if (!m) return { map: 'riverside', mode: 'conquest', teamSize: 8 };
    try { sessionStorage.setItem('bf.lastQuickMap', m.id); } catch { /* ignore */ }
    const sizes = String(m.best).match(/\d+/g)?.map(Number) || [8];                  // "8v8 - 16v16", "3v3 - 5v5", "1v1 - 3v3"
    const teamSize = Math.max(Math.min(...sizes), Math.min(8, Math.max(...sizes)));       // 8 where it fits, else the map's own range
    return { map: m.id, mode: m.modes.includes('conquest') ? 'conquest' : m.modes[0], teamSize };
  }

  quickPlay(name, forceMap = null) {
    audio.unlock();
    const pick = this.pickQuickMatch(forceMap);
    this.net.send({ t: 'create', name, autostart: true, settings: { ...pick, bots: true, difficulty: 'normal', friendlyFire: false, public: false, vehicles: true, tickets: 250 } });
  }

  createRoom(name) {
    audio.unlock();
    this.net.send({ t: 'create', name, settings: { map: 'riverside', mode: 'conquest', teamSize: 8, bots: true, difficulty: 'normal', vehicles: true, tickets: 250 } });
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
    this.hud.closePause(); this.hud.deploy.hide(); this.hud.closeEnd(); this.hud.showScore(false);
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
    this.hud.minimap.setMap(this.game.map, this.game.terrain);
    this.hud.cache = {};
    this.hud.deploy.lastSpawns = '';
    this.hud.deathAt = 0;
    this.hud.closeEnd(); this.hud.closePause();
    this.hud.el.killfeed.innerHTML = ''; this.hud.el.chatlog.innerHTML = '';
  }

  onLobby() {
    if (!this.room) return;
    this.room.state = 'lobby';
    this.game.stop();
    this.playing = false;
    document.body.classList.remove('ingame', 'menu-open');
    $('hud').classList.add('hidden');
    this.hud.closePause(); this.hud.deploy.hide(); this.hud.closeEnd(); this.hud.showScore(false);
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
