// Sliders and toggles shared by the pause menu and the main menu's Settings screen.
import { audio } from '../audio.js';

const save = (k, v) => { try { localStorage.setItem(k, String(v)); } catch { /* ignore */ } };

export function settingsHTML(g) {
  return `
      <div class="slider"><span>Volume</span><input type="range" id="volRange" min="0" max="100" value="${Math.round(audio.volume * 100)}" aria-label="Volume"></div>
      <div class="slider"><span>Mouse sensitivity</span><input type="range" id="sensRange" min="4" max="60" value="${Math.round(g.sens * 10000)}" aria-label="Mouse sensitivity"></div>
      <div class="slider"><span>Field of view</span><input type="range" id="fovRange" min="70" max="120" value="${Math.round(g.fov)}" aria-label="Field of view"><b id="fovVal" style="min-width:34px;text-align:right">${Math.round(g.fov)}°</b></div>
      <div class="row" style="gap:16px"><label class="chk"><input type="checkbox" id="invY" ${g.invertY ? 'checked' : ''}> Invert Y</label><label class="chk"><input type="checkbox" id="adsT" ${g.input.adsToggle ? 'checked' : ''}> Toggle aim (RMB)</label></div>`;
}

export function bindSettings(root, g) {
  const $ = (id) => root.querySelector('#' + id);
  $('volRange').oninput = (e) => audio.setVolume(e.target.value / 100);
  $('sensRange').oninput = (e) => { g.sens = e.target.value / 10000; save('fl.sens', g.sens); };
  $('fovRange').oninput = (e) => { g.fov = Number(e.target.value); $('fovVal').textContent = g.fov + '°'; save('fl.fov', g.fov); };
  $('invY').onchange = (e) => { g.invertY = e.target.checked; save('fl.inv', g.invertY ? 1 : 0); };
  $('adsT').onchange = (e) => { g.input.adsToggle = e.target.checked; g.input.right = false; save('fl.adsT', g.input.adsToggle ? 1 : 0); };
}

export const CONTROLS = [
  ['WASD', 'Move'], ['Mouse', 'Look / aim'], ['LMB', 'Fire'], ['RMB', 'Aim down sights'], ['Shift', 'Sprint (forward)'], ['Space', 'Jump'], ['C', 'Crouch'], ['R', 'Reload'],
  ['E', 'Enter / exit vehicle, revive, arm M-COM'], ['G', 'Grenade'], ['X', 'Knife'], ['1-4', 'Weapons / gadgets'], ['Wheel', 'Cycle weapons'], ['Q', 'Spot enemy'],
  ['V', 'Ping'], ['L', 'Loadout'], ['M', 'Big map'], ['Tab', 'Scoreboard'], ['Enter', 'Team chat'], ['Esc', 'Menu'],
];
