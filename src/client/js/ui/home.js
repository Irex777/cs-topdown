// Landing screen: name, quick play, create / join a room, public room list.
const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

export class Home {
  constructor(app) {
    this.app = app;
    this.el = $('home');
    this.rooms = [];
    this.timer = 0;
    this.render();
  }

  get name() {
    const v = ($('nameInput') && $('nameInput').value.trim()) || '';
    return v.slice(0, 16);
  }

  render() {
    const app = this.app;
    const savedName = (() => { try { return localStorage.getItem('cs.name') || ''; } catch { return ''; } })();
    const invite = app.inviteCode;
    this.el.innerHTML = `
    <div class="home-wrap">
      <div class="hero">
        <div class="logo"><small>Combined arms warfare</small><span>Frontline</span><span>Voxel Warfare</span></div>
        <div class="cubes"><i></i><i></i><i></i><i></i><i></i></div>
        <p class="tagline">Big maps, real destruction and combined arms in a chunky 2.5D voxel world. Capture flags in Conquest, blow up M-COMs in Rush, drive tanks and fly helicopters, revive your squad and level every wall you can find.</p>
        <div class="features">
          <div>Conquest, Rush &amp; Team Deathmatch</div><div>4 classes with gadgets</div>
          <div>Weapon attachments &amp; optics</div><div>Fully destructible terrain</div>
          <div>Jeeps, APCs, tanks, helis, boats</div><div>Squads, spotting, revives</div>
          <div>Line-of-sight fog of war</div><div>Smart bots fill any empty slot</div>
        </div>
        <div class="controls-mini"><span><kbd>WASD</kbd> move <kbd>Shift</kbd> sprint <kbd>Mouse</kbd> aim</span><span><kbd>E</kbd> vehicles &amp; objectives <kbd>Q</kbd> spot <kbd>L</kbd> loadout</span></div>
      </div>
      <div class="card-panel play-card">
        ${invite ? `<div class="join-banner"><div style="flex:1"><span class="label" style="margin:0">You're invited to room</span><b>${esc(invite)}</b></div><button class="btn primary" id="joinInvite">Join</button></div>` : ''}
        <div><label class="label" for="nameInput">Your name</label><input class="input" id="nameInput" maxlength="16" placeholder="Enter a nickname" value="${esc(savedName)}" autocomplete="off" spellcheck="false"></div>
        <button class="btn primary big" id="quickBtn">▶ Quick play (Conquest vs bots)</button>
        <div class="row"><button class="btn big" id="createBtn" style="flex:1">Create room</button></div>
        <div><label class="label" for="codeInput">Join with a room code</label>
          <div class="row"><input class="input code-input" id="codeInput" maxlength="4" placeholder="ABCD" autocomplete="off" spellcheck="false"><button class="btn" id="joinBtn">Join</button></div></div>
        <div><span class="label">Public rooms</span><div class="rooms-list" id="roomsList"><div class="empty-note">Loading…</div></div></div>
        <div class="footer-note"><span class="status-dot" id="statusDot"></span><span id="statusText">Connecting…</span>${window.matchMedia && window.matchMedia('(pointer: coarse)').matches ? '<br><b style="color:var(--accent2)">Heads up:</b> this game needs a keyboard and mouse.' : ''}</div>
      </div>
    </div>`;
    const name = $('nameInput');
    name.addEventListener('input', () => { try { localStorage.setItem('cs.name', name.value); } catch { /* ignore */ } });
    const requireName = () => { if (!this.name) { name.focus(); app.toast('Pick a nickname first'); return false; } return true; };
    $('quickBtn').onclick = () => { if (requireName()) app.quickPlay(this.name); };
    $('createBtn').onclick = () => { if (requireName()) app.createRoom(this.name); };
    const join = () => { const c = $('codeInput').value.trim().toUpperCase(); if (c.length < 4) { app.toast('Enter the 4-letter room code'); return; } if (requireName()) app.joinRoom(c, this.name); };
    $('joinBtn').onclick = join;
    $('codeInput').addEventListener('keydown', (e) => { if (e.key === 'Enter') join(); });
    $('codeInput').addEventListener('input', (e) => { e.target.value = e.target.value.toUpperCase().replace(/[^A-Z]/g, ''); });
    if (invite) $('joinInvite').onclick = () => { if (requireName()) app.joinRoom(invite, this.name); };
    if (!savedName) setTimeout(() => name.focus(), 50);
    this.renderRooms();
    this.setStatus(app.net.open);
  }

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
    if (!this.rooms.length) { box.innerHTML = '<div class="empty-note">No public rooms right now. Create one and tick “Public”.</div>'; return; }
    box.innerHTML = this.rooms.map((r) => `<div class="room-item" data-code="${esc(r.code)}"><div><b>${esc(r.name)}</b><br><small>${esc(r.map)} · ${({ conquest: 'Conquest', rush: 'Rush', tdm: 'Deathmatch' })[r.mode] || r.mode} · ${r.humans} player${r.humans === 1 ? '' : 's'}${r.state === 'playing' ? ' · in match' : ''}</small></div><span class="code">${esc(r.code)}</span></div>`).join('');
    box.querySelectorAll('.room-item').forEach((el) => { el.onclick = () => { if (this.name) this.app.joinRoom(el.dataset.code, this.name); else { $('nameInput').focus(); this.app.toast('Pick a nickname first'); } }; });
  }

  show() {
    this.el.classList.remove('hidden');
    this.render();
    this.app.net.send({ t: 'list' });
    clearInterval(this.timer);
    this.timer = setInterval(() => this.app.net.send({ t: 'list' }), 5000);
  }

  hide() { this.el.classList.add('hidden'); clearInterval(this.timer); }
}
