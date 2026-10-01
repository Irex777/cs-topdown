// Settings and controls shared by the pause menu and the main menu's Settings screen.
import { audio } from '../battlefield-audio.js';

const save = (k, v) => { try { localStorage.setItem(k, String(v)); } catch { /* ignore */ } };

const field = (label, id, min, max, value, out, hint = '') => `<label class="field"><span class="fl">${label}${hint ? `<small>${hint}</small>` : ''}</span><input type="range" id="${id}" min="${min}" max="${max}" value="${value}" aria-label="${label}"><output id="${out.id}">${out.text}</output></label>`;

export function settingsHTML(g) {
  const q = g.renderer.quality;
  return `
    <section class="set-group"><h4>Audio</h4>
      ${field('Volume', 'volRange', 0, 100, Math.round(audio.volume * 100), { id: 'volVal', text: Math.round(audio.volume * 100) + '%' })}
    </section>
    <section class="set-group"><h4>Aiming &amp; view</h4>
      ${field('Mouse sensitivity', 'sensRange', 4, 60, Math.round(g.sens * 10000), { id: 'sensVal', text: String(Math.round(g.sens * 10000)) })}
      ${field('Field of view', 'fovRange', 70, 120, Math.round(g.fov), { id: 'fovVal', text: Math.round(g.fov) + '°' })}
      <div class="checks"><label class="check"><input type="checkbox" id="invY" ${g.invertY ? 'checked' : ''}><span>Invert vertical look</span></label>
      <label class="check"><input type="checkbox" id="adsT" ${g.input.adsToggle ? 'checked' : ''}><span>Toggle aim instead of holding right mouse</span></label></div>
    </section>
    <section class="set-group"><h4>Graphics</h4>
      <label class="field"><span class="fl">Quality<small>Low turns shadows and post effects off for a smoother frame rate.</small></span><select id="gfxQ" class="select" aria-label="Graphics quality"><option value="0" ${q === 0 ? 'selected' : ''}>Low — fastest, no shadows or effects</option><option value="1" ${q === 1 ? 'selected' : ''}>Medium — shadows, bloom, smoothing</option><option value="2" ${q === 2 ? 'selected' : ''}>High — full effects, sharpest</option></select></label>
    </section>`;
}

export function bindSettings(root, g) {
  const $ = (id) => root.querySelector('#' + id);
  $('volRange').oninput = (e) => { audio.setVolume(e.target.value / 100); $('volVal').textContent = e.target.value + '%'; };
  $('sensRange').oninput = (e) => { g.sens = e.target.value / 10000; $('sensVal').textContent = e.target.value; save('fl.sens', g.sens); };
  $('fovRange').oninput = (e) => { g.fov = Number(e.target.value); $('fovVal').textContent = g.fov + '°'; save('fl.fov', g.fov); };
  $('gfxQ').onchange = (e) => g.renderer.setQuality(Number(e.target.value), true);
  $('invY').onchange = (e) => { g.invertY = e.target.checked; save('fl.inv', g.invertY ? 1 : 0); };
  $('adsT').onchange = (e) => { g.input.adsToggle = e.target.checked; g.input.right = false; save('fl.adsT', g.input.adsToggle ? 1 : 0); };
}

export const CONTROL_GROUPS = [
  ['Movement', [['WASD', 'Move'], ['Shift', 'Sprint (forward)'], ['Space', 'Jump · brake in vehicles'], ['C', 'Crouch (hold)']]],
  ['Combat', [['LMB', 'Fire'], ['RMB', 'Aim down sights / scope'], ['R', 'Reload'], ['G', 'Grenade'], ['X', 'Knife'], ['1-4', 'Weapons and gadgets'], ['Wheel', 'Cycle weapons']]],
  ['Teamwork', [['E', 'Enter or exit vehicle, revive, arm M-COM'], ['Q', 'Spot enemy'], ['V', 'Ping'], ['Enter', 'Team chat'], ['Y', 'All chat']]],
  ['Vehicles', [['Shift / Ctrl', 'Helicopter climb / descend'], ['V', 'Switch vehicle camera'], ['RMB', 'Weapon zoom'], ['1-4', 'Change seat']]],
  ['Interface', [['L', 'Loadout'], ['M', 'Big map'], ['Tab', 'Scoreboard'], ['Esc', 'Menu']]],
];
export const CONTROLS = CONTROL_GROUPS.flatMap(([, rows]) => rows);

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function controlsHTML() {
  return `<div class="ctrl-groups">${CONTROL_GROUPS.map(([name, rows]) => `<section class="ctrl-group"><h4>${esc(name)}</h4>${rows.map(([k, d]) => `<div class="ctrl-row"><kbd>${esc(k)}</kbd><span>${esc(d)}</span></div>`).join('')}</section>`).join('')}</div>`;
}
