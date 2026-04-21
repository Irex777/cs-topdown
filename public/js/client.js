// CS Top-Down — Client Entry Point
import { state } from './state.js';
import { initInput, toggleControls } from './input.js';
import { connect, joinTeam, startGame, addBots, reconnectGame } from './network.js';
import { escSwitchTeam, escDisconnect, escSpectate, escRestartGame, escRemoveBots, closeEscMenu, toggleBuyMenu, buyItem, sellItem, renderBuyMenu, updateScoreboard, showCenterMsg, cycleSpectateTarget } from './hud.js';
import { render, preRenderMap, initMenuParticles, updateMenuParticles } from './renderer.js';
import { SoundManager } from './audio.js';

// Wire up callbacks that cross module boundaries
state.preRenderMap = preRenderMap;
state.updateScoreboard = updateScoreboard;

// Expose to HTML onclick handlers
window.connect = connect;
window.joinTeam = function(t) { console.log('[DEBUG] joinTeam called, t:', t); return joinTeam(t); };
window.startGame = startGame;
window.addBots = addBots;
window.reconnectGame = reconnectGame;
window.toggleControls = toggleControls;
window.closeEscMenu = closeEscMenu;
window.escSwitchTeam = escSwitchTeam;
window.escSpectate = escSpectate;
window.escRestartGame = escRestartGame;
window.escRemoveBots = escRemoveBots;
window.escDisconnect = escDisconnect;
window.toggleBuyMenu = toggleBuyMenu;
window.buyItem = buyItem;
window.sellItem = sellItem;
window.cycleSpectateTarget = cycleSpectateTarget;
window.renderBuyMenu = renderBuyMenu;
window.__state = state;

// Init
document.getElementById('connect-btn').addEventListener('click', connect);
document.addEventListener('click', () => SoundManager.init(), { once: true });
document.addEventListener('keydown', () => SoundManager.init(), { once: true });
initInput();
initMenuParticles();
updateMenuParticles();
requestAnimationFrame(render);
