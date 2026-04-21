// CS Top-Down - HUD / UI Functions
import { state } from './state.js';
import { WEAPONS, WEAPON_ICONS, BUY_ITEMS } from './constants.js';
import { SoundManager } from './audio.js';

const canvas = document.getElementById('game-canvas');
const ctx = canvas.getContext('2d');

// ==================== HELPERS ====================
export function drawRoundRect(ctx, x, y, w, h, r) {
  if (w <= 0 || h <= 0) return;
  r = Math.min(r, w / 2, h / 2);
  ctx.moveTo(x + r, y);
  ctx.lineTo(x + w - r, y);
  ctx.quadraticCurveTo(x + w, y, x + w, y + r);
  ctx.lineTo(x + w, y + h - r);
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
  ctx.lineTo(x + r, y + h);
  ctx.quadraticCurveTo(x, y + h, x, y + h - r);
  ctx.lineTo(x, y + r);
  ctx.quadraticCurveTo(x, y, x + r, y);
  ctx.closePath();
}

// ==================== BOMB HUD ====================
export function drawBombHud() {
  if (!state.bomb || !state.bomb.planted) return;
  const alpha = Math.min(1, state.bombHudTimer / 0.5);
  if (state.bombHudTimer < 2) state.bombHudTimer += 1 / 60;

  ctx.save();
  ctx.globalAlpha = alpha;
  const x = canvas.width / 2;
  const y = canvas.height * 0.12;

  // Background
  ctx.fillStyle = 'rgba(0, 0, 0, 0.6)';
  const bw = 200, bh = 36;
  ctx.beginPath();
  drawRoundRect(ctx, x - bw / 2 - 2, y - bh / 2 - 2, bw + 4, bh + 4, 6);
  ctx.fill();

  // Border (red pulsing)
  const pulse = Math.sin(Date.now() / 150) * 0.3 + 0.7;
  ctx.strokeStyle = `rgba(255, 50, 30, ${pulse})`;
  ctx.lineWidth = 2;
  ctx.beginPath();
  drawRoundRect(ctx, x - bw / 2 - 2, y - bh / 2 - 2, bw + 4, bh + 4, 6);
  ctx.stroke();

  // Text
  ctx.font = 'bold 16px sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillStyle = state.bomb.timer < 10 ? '#ff0000' : '#ff4444';
  ctx.fillText('💣 BOMB PLANTED — SITE ' + (state.bomb.site || '?'), x, y - 5);

  ctx.font = 'bold 20px monospace';
  ctx.fillStyle = state.bomb.timer < 10 ? '#ff0000' : '#ff6644';
  ctx.fillText(Math.ceil(state.bomb.timer) + 's', x, y + 16);

  ctx.restore();
}

// ==================== ESC MENU ====================
export function closeEscMenu() {
  state.escMenuOpen = false;
  document.getElementById('esc-menu').classList.remove('show');
}

export function escSwitchTeam(team) {
  if (!state.socket) return;
  state.socket.emit('switch_team', team);
  closeEscMenu();
}

export function cycleSpectateTarget() {
  const alivePlayers = Object.entries(state.players).filter(([id, pl]) => pl.alive && pl.team !== 'SPEC');
  if (alivePlayers.length === 0) return;
  if (!state.spectateTarget) {
    state.spectateTarget = alivePlayers[0][0];
    state.spectateFreeCam = false;
    return;
  }
  const idx = alivePlayers.findIndex(([id]) => id === state.spectateTarget);
  const next = (idx + 1) % alivePlayers.length;
  state.spectateTarget = alivePlayers[next][0];
  state.spectateFreeCam = false;
}

export function escSpectate() {
  if (!state.socket) return;
  state.socket.emit('switch_team', 'SPEC');
  closeEscMenu();
}

export function escDisconnect() {
  if (state.socket) state.socket.disconnect();
  closeEscMenu();
  document.getElementById('hud').classList.add('hidden');
  document.getElementById('menu-screen').classList.remove('hidden');
  state.myPlayer = null;
  state.spectating = false;
}

export function escRestartGame() {
  if (!state.socket) return;
  state.socket.emit('restart_game');
  closeEscMenu();
}

export function escRemoveBots() {
  if (!state.socket) return;
  state.socket.emit('remove_bots');
  closeEscMenu();
}

// ==================== BUY MENU ====================
export function toggleBuyMenu() {
  state.showBuyMenu = !state.showBuyMenu;
  const m = document.getElementById('buy-menu');
  if (state.showBuyMenu) { renderBuyMenu(); m.classList.add('show'); } else m.classList.remove('show');
}

export function renderBuyMenu() {
  const c = document.getElementById('buy-content');
  const p = state.players[state.myId]; if (!p) return;
  // Update money display
  document.getElementById('buy-money').textContent = '$' + p.money;

  // Buy availability feedback
  const buyTimeLeft = 115 - state.roundTimer;
  const canBuy = state.gameState === 'freeze' || state.gameState === 'waiting' || state.gameState === 'round_end' || buyTimeLeft <= 4;
  const statusEl = document.querySelector('.buy-title');
  if (statusEl) {
    if (state.gameState === 'playing' && buyTimeLeft > 4) {
      statusEl.innerHTML = 'BUY MENU <span style="color:#ff4444;font-size:11px;">[BUY TIME EXPIRED]</span>';
    } else if (state.gameState === 'freeze') {
      statusEl.innerHTML = 'BUY MENU <span style="color:#4caf50;font-size:11px;">[FREEZE TIME]</span>';
    } else if (state.gameState === 'round_end') {
      statusEl.innerHTML = 'BUY MENU <span style="color:#ffaa00;font-size:11px;">[ROUND OVER]</span>';
    } else {
      statusEl.innerHTML = 'BUY MENU <span style="color:#4caf50;font-size:11px;">[' + Math.max(0, 4 - Math.floor(buyTimeLeft)) + 's left]</span>';
    }
  }
  // Show current loadout
  const loadoutEl = document.getElementById('buy-loadout-items');
  let loadoutHtml = '';
  if (p.weapons) {
    p.weapons.forEach((w, i) => {
      const wInfo = WEAPONS[w];
      const name = wInfo ? wInfo.name : w;
      const sellPrice = getSellPrice(w);
      loadoutHtml += `<div class="buy-loadout-item owned">${i+1}. ${name}<button class="sell-btn" onclick="sellItem('${w}')" title="Sell for $${sellPrice}">SELL $${sellPrice}</button></div>`;
    });
  }
  if (p.grenades) {
    if (p.grenades.he > 0) { const sp = getSellPrice('he_grenade'); loadoutHtml += `<div class="buy-loadout-item owned">HE Grenade x${p.grenades.he}<button class="sell-btn" onclick="sellItem('he_grenade')" title="Sell for $${sp}">SELL $${sp}</button></div>`; }
    if (p.grenades.flash > 0) { const sp = getSellPrice('flashbang'); loadoutHtml += `<div class="buy-loadout-item owned">Flashbang x${p.grenades.flash}<button class="sell-btn" onclick="sellItem('flashbang')" title="Sell for $${sp}">SELL $${sp}</button></div>`; }
    if (p.grenades.smoke > 0) { const sp = getSellPrice('smoke'); loadoutHtml += `<div class="buy-loadout-item owned">Smoke x${p.grenades.smoke}<button class="sell-btn" onclick="sellItem('smoke')" title="Sell for $${sp}">SELL $${sp}</button></div>`; }
  }
  if (p.hasDefuseKit) { const sp = getSellPrice('defuse_kit'); loadoutHtml += `<div class="buy-loadout-item owned">Defuse Kit<button class="sell-btn" onclick="sellItem('defuse_kit')" title="Sell for $${sp}">SELL $${sp}</button></div>`; }
  if (p.armor > 0) { const akey = p.helmet ? 'helmet' : 'kevlar'; const sp = getSellPrice(akey); loadoutHtml += `<div class="buy-loadout-item owned">Armor${p.helmet ? '+Helm' : ''}<button class="sell-btn" onclick="sellItem('${akey}')" title="Sell for $${sp}">SELL $${sp}</button></div>`; }
  loadoutEl.innerHTML = loadoutHtml;

  let h = '';
  let buyKeyIdx = 1;
  const buyKeys = [];
  for (const [sec, items] of Object.entries(BUY_ITEMS)) {
    h += '<div class="buy-section"><div class="buy-section-title">' + sec + '</div><div class="buy-grid">';
    for (const it of items) {
      const ca = p.money < it.price, wt = it.team && it.team !== p.team;
      const keyLabel = buyKeyIdx <= 9 ? buyKeyIdx : '';
      if (buyKeyIdx <= 9) buyKeys.push(it.key);
      buyKeyIdx++;
      // Build stats tooltip
      const wInfo = WEAPONS[it.key];
      let statsHtml = '';
      if (wInfo) {
        const dmgPct = Math.min(100, Math.round((wInfo.damage || 0) / 40 * 100));
        const ratePct = Math.min(100, Math.round((wInfo.fireRate || 0) / 12 * 100));
        const accVal = wInfo.spread ? Math.max(0, Math.round((1 - wInfo.spread) * 100)) : 70;
        statsHtml = '<div class="buy-item-stats">' +
          '<div class="buy-item-stats-row"><span>Damage</span><div class="buy-item-stats-bar"><div class="buy-item-stats-fill" style="width:'+dmgPct+'%;background:#ff4444"></div></div></div>' +
          '<div class="buy-item-stats-row"><span>Fire Rate</span><div class="buy-item-stats-bar"><div class="buy-item-stats-fill" style="width:'+ratePct+'%;background:#ffaa00"></div></div></div>' +
          '<div class="buy-item-stats-row"><span>Accuracy</span><div class="buy-item-stats-bar"><div class="buy-item-stats-fill" style="width:'+accVal+'%;background:#4caf50"></div></div></div>' +
          '</div>';
      }
      h += '<div class="buy-item '+(ca?'cant-afford':wt?'wrong-team':'')+'" onclick="buyItem(\''+it.key+'\')">';
      if (keyLabel) h += '<div class="buy-item-key">' + keyLabel + '</div>';
      h += '<div class="buy-item-name">'+it.name+'</div><div class="buy-item-price">$'+it.price+'</div>' + statsHtml + '</div>';
    }
    h += '</div></div>';
  }
  c.innerHTML = h;
  // Store buy keys for keyboard shortcuts
  window._buyKeys = buyKeys;
}

export function buyItem(k) { if (state.socket) state.socket.emit('buy', k); renderBuyMenu(); }
export function sellItem(k) { if (state.socket) state.socket.emit('sell', k); renderBuyMenu(); }

export function getSellPrice(key) {
  // Look up price from BUY_ITEMS, then compute 50% refund
  for (const items of Object.values(BUY_ITEMS)) {
    const item = items.find(it => it.key === key);
    if (item) return Math.floor((item.price || 0) * 0.5);
  }
  return 0;
}

// ==================== HUD ====================
export function updateHUD() {
  const p = state.players[state.myId]; if (!p) return;

  // Score
  document.getElementById('score-t').textContent = state.tScore;
  document.getElementById('score-ct').textContent = state.ctScore;
  document.getElementById('round-num').textContent = 'Round ' + state.roundNumber;

  // Round dots in score bar
  updateRoundDots();

  // Timer
  const time = state.gameState === 'waiting' ? 0 : Math.max(0, state.gameState === 'freeze' ? state.freezeTimer : state.roundTimer);
  const m = Math.floor(time/60), s = Math.floor(time%60);
  const timerEl = document.getElementById('round-timer');
  timerEl.textContent = m + ':' + s.toString().padStart(2, '0');
  if (time < 10) {
    timerEl.style.color = '#ff4444';
    timerEl.classList.add('timer-critical');
    timerEl.classList.remove('timer-warning');
  } else if (time < 30) {
    timerEl.style.color = '#ffaa00';
    timerEl.classList.remove('timer-critical');
    timerEl.classList.add('timer-warning');
  } else {
    timerEl.style.color = '#fff';
    timerEl.classList.remove('timer-critical', 'timer-warning');
  }

  // HP/Armor
  document.getElementById('hp-text').textContent = Math.ceil(p.hp);
  const hpPct = Math.max(0, p.hp);
  const hpFill = document.getElementById('hp-fill');
  hpFill.style.width = hpPct + '%';
  hpFill.className = 'bar-fill hp-fill' + (hpPct <= 25 ? ' low' : hpPct <= 50 ? ' mid' : '');
  document.getElementById('armor-fill').style.width = p.armor + '%';

  // Weapon & ammo
  if (p.weapons?.length && p.currentWeapon >= 0 && p.ammo) {
    const wk = p.weapons[p.currentWeapon], am = p.ammo[wk], w = WEAPONS[wk];
    document.getElementById('weapon-name').textContent = w ? w.name.toUpperCase() : wk;
    const ammoEl = document.getElementById('ammo-current');
    ammoEl.textContent = am ? am.mag : 0;
    // Low ammo warning: flash red when mag <= 25% of magSize
    if (w && w.magSize && am && am.mag <= Math.ceil(w.magSize * 0.25) && am.mag > 0) {
      ammoEl.classList.add('ammo-low');
      ammoEl.style.color = '#ff4444';
    } else if (am && am.mag === 0) {
      ammoEl.classList.remove('ammo-low');
      ammoEl.style.color = '#ff2222';
    } else {
      ammoEl.classList.remove('ammo-low');
      ammoEl.style.color = '';
    }
    document.getElementById('ammo-reserve').textContent = am ? am.reserve : 0;
  } else if (p.currentWeapon === -1) {
    document.getElementById('weapon-name').textContent = 'KNIFE';
    const ammoEl = document.getElementById('ammo-current');
    ammoEl.textContent = '\u221E';
    ammoEl.classList.remove('ammo-low');
    ammoEl.style.color = '';
    document.getElementById('ammo-reserve').textContent = '';
  }

  // Reload progress on weapon panel
  const reloadBar = document.getElementById('reload-bar');
  const reloadFill = document.getElementById('reload-fill');
  if (p.reloading && p.reloadTimer !== undefined) {
    reloadBar.style.display = 'block';
    const wk = p.currentWeapon >= 0 && p.weapons ? p.weapons[p.currentWeapon] : null;
    const reloadTimes = {pistol:2.2,glock:2.2,usp:2.2,deagle:2.2,mp9:3.1,mac10:3.1,p90:3.3,ak47:2.5,m4a4:3.1,galil:2.5,famas:3.1,awp:3.7,ssg08:3.7,nova:4.0};
    const maxReload = wk ? (reloadTimes[wk] || 2.5) : 2.5;
    const progress = 1 - Math.max(0, p.reloadTimer) / maxReload;
    reloadFill.style.width = (progress * 100) + '%';
  } else {
    reloadBar.style.display = 'none';
  }

  document.getElementById('money-amount').textContent = '$' + p.money;
  document.getElementById('grenade-he').textContent = p.grenades?.he || 0;
  document.getElementById('grenade-flash').textContent = p.grenades?.flash || 0;
  document.getElementById('grenade-smoke').textContent = p.grenades?.smoke || 0;

  // Weapon slots
  const slots = document.getElementById('weapon-slots');
  if (p.weapons) {
    let sh = '';
    p.weapons.forEach((w, i) => {
      sh += '<div class="weapon-slot '+(i===p.currentWeapon?'active':'')+'"><span class="slot-key">'+(i+1)+'</span>'+(WEAPONS[w]?.name||w)+'</div>';
    });
    slots.innerHTML = sh;
  }

  // Bomb indicator
  const bombInd = document.getElementById('bomb-indicator');
  if (state.bomb && state.bomb.planted) {
    bombInd.classList.remove('hidden');
    const siteLabel = document.getElementById('bomb-site-label');
    siteLabel.textContent = 'BOMB ' + (state.bomb.site || 'A');
    const timerEl2 = document.getElementById('bomb-timer');
    const bt = Math.ceil(state.bomb.timer);
    timerEl2.textContent = bt + 's';
    timerEl2.className = 'bomb-timer' + (bt <= 10 ? ' urgent' : '');
  } else {
    bombInd.classList.add('hidden');
  }

  // Action progress (plant/defuse)
  const actionEl = document.getElementById('action-progress');
  if (state.actionProgress.active) {
    actionEl.classList.add('show');
    document.getElementById('action-progress-label').textContent = state.actionProgress.type === 'planting' ? 'PLANTING...' : 'DEFUSING...';
    const fillEl = document.getElementById('action-progress-fill');
    fillEl.style.width = (state.actionProgress.progress * 100) + '%';
    fillEl.className = 'action-progress-fill ' + (state.actionProgress.type === 'planting' ? 'planting' : 'defusing');
  } else {
    actionEl.classList.remove('show');
  }

  // Flash
  document.getElementById('flash-overlay').style.opacity = Math.min(1, state.flashTimer);

  // Damage vignette
  if (p.hp < 100 && p.alive) {
    document.getElementById('damage-vignette').style.opacity = Math.max(0, (1 - p.hp/100) * 0.6);
  } else {
    document.getElementById('damage-vignette').style.opacity = 0;
  }

  // Alive counts on minimap
  let tAlive = 0, ctAlive = 0;
  for (const pl of Object.values(state.players)) {
    if (!pl.alive || pl.team === 'SPEC') continue;
    if (pl.team === 'T') tAlive++;
    else ctAlive++;
  }
  document.getElementById('minimap-t-alive').textContent = 'T: ' + tAlive;
  document.getElementById('minimap-ct-alive').textContent = 'CT: ' + ctAlive;
}

export function updateRoundDots() {
  const maxRounds = 16;
  const dotsT = document.getElementById('round-dots-t');
  const dotsCT = document.getElementById('round-dots-ct');
  let htmlT = '', htmlCT = '';
  for (let i = 0; i < Math.max(state.tScore, state.ctScore, 5); i++) {
    if (i < state.tScore) htmlT += '<div class="round-dot t"></div>';
    else htmlT += '<div class="round-dot empty"></div>';
    if (i < state.ctScore) htmlCT += '<div class="round-dot ct"></div>';
    else htmlCT += '<div class="round-dot empty"></div>';
  }
  dotsT.innerHTML = htmlT;
  dotsCT.innerHTML = htmlCT;
}

export function updateRoundHistory() {
  const container = document.getElementById('round-history');
  let html = '';
  for (const r of state.roundHistory) {
    const winner = typeof r === 'string' ? r : (r.winner || '');
    html += `<div class="round-history-dot ${winner.toLowerCase()}"></div>`;
  }
  container.innerHTML = html;
}

// ==================== ROUND RESULT & GAME OVER ====================
export function showRoundResultBanner(winner, color, reason, mvpText) {
  const banner = document.getElementById('round-result-banner');
  document.getElementById('round-result-winner').textContent = winner + ' WIN';
  document.getElementById('round-result-winner').style.color = color;
  document.getElementById('round-result-reason').textContent = reason || '';
  document.getElementById('round-result-mvp').textContent = mvpText || '';
  banner.classList.add('show');
  state.lastRoundEnd = Date.now();
}

export function hideRoundResult() {
  document.getElementById('round-result-banner').classList.remove('show');
  state.lastRoundEnd = null;
}

export function showGameOver(winner, mvpName) {
  const screen = document.getElementById('game-over-screen');
  const color = winner === 'T' ? '#d4a537' : '#4a90d9';
  const teamName = winner === 'T' ? 'TERRORISTS' : 'COUNTER-TERRORISTS';
  document.getElementById('game-over-title').textContent = teamName + ' WIN';
  document.getElementById('game-over-title').style.color = color;
  document.getElementById('game-over-score').textContent = state.tScore + ' — ' + state.ctScore;
  document.getElementById('game-over-score').innerHTML =
    `<span style="color:#d4a537">${state.tScore}</span> — <span style="color:#4a90d9">${state.ctScore}</span>`;
  document.getElementById('game-over-mvp').textContent = mvpName ? '⭐ MVP: ' + mvpName : '';
  screen.classList.add('show');
}

export function hideGameOver() {
  document.getElementById('game-over-screen').classList.remove('show');
}

// ==================== UI HELPERS ====================
export function showCenterMsg(text, color, subText, dur) {
  state.centerMessages.push({ text, color, subText: subText || '', timer: dur || 3, max: dur || 3, scale: 0 });
}

export function showHitMarker(kill) {
  const el = document.getElementById('hit-marker');
  el.className = kill ? 'show hm-kill' : 'show';
  setTimeout(() => { el.className = ''; }, 150);
}

export function addKillFeedEntry(d) {
  const feed = document.getElementById('kill-feed');
  // Max 5 entries
  while (feed.children.length >= 5) { feed.removeChild(feed.firstChild); }
  const e = document.createElement('div');
  e.className = 'kill-entry' + (d.headshot ? ' headshot' : '');
  const tc = team => team === 'T' ? '#d4a537' : '#4a90d9';
  const hs = d.headshot ? ' <span class="hs-icon">🎯 HS</span>' : '';
  const weaponIcon = WEAPON_ICONS[d.weapon] || '🔫';
  const weaponName = d.weapon || 'Unknown';
  e.innerHTML =
    `<span class="killer-name" style="color:${tc(state.players[d.killer]?.team)}">${d.killerName}</span>` +
    `<span class="kill-weapon">${weaponIcon} ${weaponName}</span>` +
    `<span class="victim-name" style="color:${tc(state.players[d.victim]?.team)}">${d.victimName}</span>` + hs;
  feed.appendChild(e);
  // Fade out after 5 seconds, remove after 5.5s
  setTimeout(() => { e.style.opacity = '0'; e.style.transform = 'translateX(20px)'; }, 5000);
  setTimeout(() => { if (e.parentNode) e.remove(); }, 5500);
}

export function addChatMessage(d) {
  const box = document.getElementById('chat-box');
  // Limit visible messages
  while (box.children.length >= 8) { box.removeChild(box.firstChild); }
  const msg = document.createElement('div');
  msg.className = 'chat-msg' + (d.teamOnly ? ' team-chat' : '');
  const teamPrefix = d.teamOnly ? '<span class="chat-prefix">[TEAM]</span>' : '';
  const nameClass = d.team || 'SPEC';
  msg.innerHTML = teamPrefix + '<span class="chat-name ' + nameClass + '">' + escapeHtml(d.name) + ':</span> ' + escapeHtml(d.message);
  box.insertBefore(msg, box.firstChild);
  // Remove after 7 seconds
  setTimeout(() => { if (msg.parentNode) msg.remove(); }, 7000);
}

export function escapeHtml(t) { const d = document.createElement('div'); d.textContent = t; return d.innerHTML; }

// ==================== DEFUSE PROGRESS ====================
export function showDefuseProgress(d) {
  const el = document.getElementById('action-progress');
  const label = document.getElementById('action-progress-label');
  const fill = document.getElementById('action-progress-fill');
  if (!el) return;
  label.textContent = 'DEFUSING';
  fill.className = 'action-progress-fill defusing';
  fill.style.width = (d.progress * 100) + '%';
  el.classList.add('show');
  if (state.defuseInterval) clearInterval(state.defuseInterval);
  state.defuseInterval = setInterval(() => {
    // Progress updates come from server, this just keeps the bar visible
  }, 200);
}

export function hideDefuseProgress() {
  const el = document.getElementById('action-progress');
  if (el) el.classList.remove('show');
  if (state.defuseInterval) { clearInterval(state.defuseInterval); state.defuseInterval = null; }
}

// ==================== SCOREBOARD ====================
export function updateScoreboard(list) {
  const c = document.getElementById('sb-content'); if (!c) return;
  document.getElementById('sb-t-score').textContent = state.tScore;
  document.getElementById('sb-ct-score').textContent = state.ctScore;

  // Score dots in scoreboard
  let dotsT = '', dotsCT = '';
  for (let i = 0; i < Math.max(state.tScore, state.ctScore, 5); i++) {
    dotsT += i < state.tScore ? '<div class="round-dot t"></div>' : '<div class="round-dot empty"></div>';
    dotsCT += i < state.ctScore ? '<div class="round-dot ct"></div>' : '<div class="round-dot empty"></div>';
  }
  document.getElementById('sb-t-dots').innerHTML = dotsT;
  document.getElementById('sb-ct-dots').innerHTML = dotsCT;

  let tP = [], ctP = [];
  for (const p of Object.values(list)) {
    if (p.team === 'T') tP.push(p); else if (p.team === 'CT') ctP.push(p);
  }
  // Sort by kills descending
  tP.sort((a, b) => (b.kills || 0) - (a.kills || 0));
  ctP.sort((a, b) => (b.kills || 0) - (a.kills || 0));

  let h = '<div style="display:flex;gap:24px;">';
  const makeTable = (arr, teamColor) => {
    let t = '<table class="sb-table"><tr><th></th><th>Player</th><th>K</th><th>A</th><th>D</th><th>$</th><th>Ping</th></tr>';
    for (const p of arr) {
      const isMe = p.id === state.myId;
      const isMvp = state.roundMvp && state.roundMvp.id === p.id;
      const ping = p.ping || 0;
      const pingClass = ping < 50 ? 'good' : ping < 100 ? 'mid' : 'bad';
      t += `<tr class="${p.alive?'':'dead'} ${isMe?'me':''}">`;
      t += `<td>${isMvp ? '<span class="mvp-star">⭐</span>' : ''}</td>`;
      t += `<td>${escapeHtml(p.name)}${p.isBot ? ' <span style="color:#555;font-size:10px;">BOT</span>' : ''}</td>`;
      t += `<td style="color:${teamColor};font-weight:700;">${p.kills||0}</td>`;
      t += `<td>${p.assists||0}</td>`;
      t += `<td>${p.deaths||0}</td>`;
      t += `<td style="color:#4caf50;">$${p.money}</td>`;
      t += `<td><span class="sb-ping ${pingClass}">${ping}ms</span></td>`;
      t += '</tr>';
    }
    return t + '</table>';
  };
  h += '<div style="flex:1">' + makeTable(tP, '#d4a537') + '</div>';
  h += '<div style="flex:1">' + makeTable(ctP, '#4a90d9') + '</div></div>';
  c.innerHTML = h;
}
