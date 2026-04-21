// CS Top-Down - Input Handling
import { state } from './state.js';
import { ADS_ZOOM_LEVELS, WEAPONS } from './constants.js';

const canvas = document.getElementById('game-canvas');

// ==================== CONTROLS TOGGLE ====================
export function toggleControls() {
  const panel = document.getElementById('controls-panel');
  panel.classList.toggle('show');
  const toggle = document.querySelector('.controls-toggle');
  toggle.textContent = panel.classList.contains('show') ? 'HIDE CONTROLS' : 'SHOW CONTROLS';
}

// ==================== INPUT INIT ====================
// These functions are called from input handlers but live in other modules.
// They will be set via window globals or imported when those modules are created.
// For now, reference them through the window object to avoid circular deps.

function getPlayerWeaponType() {
  const p = state.players[state.myId];
  if (!p || !p.alive) return 'pistol';
  if (p.weaponType) return p.weaponType;
  const wIdx = p.currentWeapon;
  if (wIdx < 0 || !p.weapons || !p.weapons[wIdx]) return 'knife';
  const wKey = p.weapons[wIdx];
  if (WEAPONS[wKey]) return WEAPONS[wKey].type;
  return 'pistol';
}

export function initInput() {
  // ==================== KEYBOARD ====================
  document.addEventListener('keydown', (e) => {
    state.keys[e.code] = true;
    if (e.code === 'Escape' && state.chatOpen) {
      const inp = document.getElementById('chat-input');
      inp.value = ''; inp.classList.remove('show'); inp.classList.remove('team-chat-input');
      state.chatOpen = false; state.chatTeamOnly = false; return;
    }
    if (e.code === 'Escape' && state.showBuyMenu) {
      state.showBuyMenu = false;
      document.getElementById('buy-menu').classList.remove('show');
      return;
    }
    if (e.code === 'Escape') {
      state.escMenuOpen = !state.escMenuOpen;
      const escMenu = document.getElementById('esc-menu');
      if (state.escMenuOpen) escMenu.classList.add('show');
      else escMenu.classList.remove('show');
      return;
    }
    if (e.code === 'Enter' && !state.chatOpen && !state.escMenuOpen) {
      state.chatOpen = true; state.chatTeamOnly = false; const inp = document.getElementById('chat-input');
      inp.placeholder = 'Type message... (Enter to send)';
      inp.classList.add('show'); inp.classList.remove('team-chat-input'); inp.focus(); return;
    }
    if (e.code === 'KeyU' && !state.chatOpen && !state.escMenuOpen) {
      state.chatOpen = true; state.chatTeamOnly = true; const inp = document.getElementById('chat-input');
      inp.placeholder = 'Team chat... (Enter to send)';
      inp.classList.add('show'); inp.classList.add('team-chat-input'); inp.focus(); return;
    }
    if (e.code === 'Enter' && state.chatOpen) {
      const inp = document.getElementById('chat-input');
      if (inp.value.trim() && state.socket) state.socket.emit('chat_message', { message: inp.value.trim(), teamOnly: state.chatTeamOnly });
      inp.value = ''; inp.classList.remove('show'); inp.classList.remove('team-chat-input');
      state.chatOpen = false; state.chatTeamOnly = false; return;
    }
    if (state.chatOpen || state.escMenuOpen) return;

    // Spectator controls
    if (state.spectating) {
      if (e.code === 'Space') {
        e.preventDefault();
        window.cycleSpectateTarget?.();
        if (state.spectateTarget) state.socket?.emit('spectate_player', state.spectateTarget);
        return;
      }
    }

    if (e.code === 'KeyB') window.toggleBuyMenu?.();
    // Buy menu number shortcuts
    if (state.showBuyMenu && e.code.startsWith('Digit')) {
      const num = parseInt(e.code.replace('Digit', ''));
      if (num >= 1 && num <= 9 && window._buyKeys && window._buyKeys[num - 1]) {
        window.buyItem?.(window._buyKeys[num - 1]);
        return;
      }
    }
    if (e.code === 'Tab') { e.preventDefault(); document.getElementById('scoreboard').classList.add('show'); }
    if (!state.showBuyMenu) {
      if (e.code === 'Digit1') state.socket?.emit('switch_weapon', 0);
      if (e.code === 'Digit2') state.socket?.emit('switch_weapon', 1);
      if (e.code === 'Digit3') state.socket?.emit('switch_weapon', 2);
      if (e.code === 'Digit4') state.socket?.emit('switch_weapon', 3);
    }
    if (e.code === 'KeyR') state.socket?.emit('reload');
    if (e.code === 'KeyG') state.socket?.emit('throw_grenade', 'he');
    if (e.code === 'KeyF') state.socket?.emit('throw_grenade', 'flash');
    if (e.code === 'KeyC') state.socket?.emit('throw_grenade', 'smoke');
    if (e.code === 'KeyE') {
      if (state.myPlayer?.team === 'T') state.socket?.emit('plant_bomb');
      else if (state.myPlayer?.team === 'CT') state.socket?.emit('defuse_bomb');
    }
    // Cancel defuse when moving
    if ((e.code === 'KeyW' || e.code === 'KeyS' || e.code === 'KeyA' || e.code === 'KeyD') && state.myPlayer?.defusingBomb) {
      state.socket?.emit('cancel_defuse');
    }
  });

  document.addEventListener('keyup', (e) => {
    state.keys[e.code] = false;
    if (e.code === 'Tab') document.getElementById('scoreboard').classList.remove('show');
  });

  // ==================== MOUSE ====================
  canvas.addEventListener('mousemove', (e) => {
    state.mouse.x = e.clientX;
    state.mouse.y = e.clientY;
    // BUG FIX: Update crosshair position to follow mouse cursor
    const crosshairEl = document.getElementById('crosshair');
    if (crosshairEl && crosshairEl.style.display !== 'none') {
      crosshairEl.style.left = state.mouse.x + 'px';
      crosshairEl.style.top = state.mouse.y + 'px';
    }
  });

  canvas.addEventListener('mousedown', (e) => {
    if (e.button === 0) {
      state.mouse.down = true;
      // Spectator: click to select player
      if (state.spectating && !state.showBuyMenu && !state.escMenuOpen) {
        const worldX = (state.mouse.x - canvas.width / 2) / state.adsZoom + state.camera.x;
        const worldY = (state.mouse.y - canvas.height / 2) / state.adsZoom + state.camera.y;
        let closestId = null, closestDist = 40;
        for (const [id, pl] of Object.entries(state.players)) {
          if (!pl.alive || pl.team === 'SPEC') continue;
          const dx = pl.x - worldX, dy = pl.y - worldY;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist < closestDist) { closestDist = dist; closestId = id; }
        }
        if (closestId) {
          state.spectateTarget = closestId;
          state.spectateFreeCam = false;
          state.socket?.emit('spectate_player', closestId);
        }
      }
    }
    if (e.button === 2) {
      state.adsActive = true;
      const p = state.players[state.myId];
      if (p && p.alive) {
        const wepType = getPlayerWeaponType();
        state.adsTargetZoom = ADS_ZOOM_LEVELS[wepType] || 1.3;
      }
    }
  });

  canvas.addEventListener('mouseup', (e) => {
    if (e.button === 0) state.mouse.down = false;
    if (e.button === 2) {
      state.adsActive = false;
      state.adsTargetZoom = 1.0;
    }
  });

  canvas.addEventListener('contextmenu', (e) => e.preventDefault());

  canvas.addEventListener('wheel', (e) => {
    if (!state.socket || state.chatOpen || state.escMenuOpen) return;
    e.preventDefault();
    const dir = e.deltaY > 0 ? 1 : -1;
    state.socket.emit('scroll_weapon', dir);
  }, { passive: false });

  // ==================== INPUT SENDING (30Hz) ====================
  setInterval(() => {
    if (!state.socket || !state.myPlayer || state.chatOpen || state.escMenuOpen) return;

    // Spectator free camera
    if (state.spectating) {
      if (state.keys['KeyW']) state.freeCamPos.y -= state.freeCamSpeed * (1/30);
      if (state.keys['KeyS']) state.freeCamPos.y += state.freeCamSpeed * (1/30);
      if (state.keys['KeyA']) state.freeCamPos.x -= state.freeCamSpeed * (1/30);
      if (state.keys['KeyD']) state.freeCamPos.x += state.freeCamSpeed * (1/30);
      return;
    }

    const p = state.players[state.myId];
    if (!p || !p.alive) return;
    const wmx = (state.mouse.x - canvas.width / 2) / state.adsZoom;
    const wmy = (state.mouse.y - canvas.height / 2) / state.adsZoom;
    state.socket.emit('update_input', {
      up: state.keys['KeyW']||false, down: state.keys['KeyS']||false,
      left: state.keys['KeyA']||false, right: state.keys['KeyD']||false,
      shoot: state.mouse.down && !state.showBuyMenu,
      sprint: state.keys['ShiftLeft'] || state.keys['ShiftRight'] || false,
      crouch: state.keys['ControlLeft'] || state.keys['ControlRight'] || false,
      ads: state.adsActive,
    });
    state.socket.emit('update_angle', Math.atan2(wmy, wmx));
  }, 1000/30);
}
