// Deploy screen: pick a class, weapons and attachments, choose where to spawn on the tactical map.
import {
  CLASSES, CLASS_ORDER, SIDEARMS, WEAPONS, ATTACH, ATTACH_SLOT_NAMES, GADGETS, attachOptions, defaultLoadout, sanitizeLoadout, resolveWeapon,
} from '../../../shared/weapons.js';
import { GRENADE, GREN_ORDER, T, CT, SPEC } from '../../../shared/constants.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const KIND_NAMES = { rifle: 'Assault rifle', smg: 'PDW / carbine', lmg: 'Light machine gun', sniper: 'Sniper rifle', dmr: 'Marksman rifle', shotgun: 'Shotgun', pistol: 'Pistol' };
const SLOT_ORDER = ['optic', 'barrel', 'under', 'mag'];

export class DeployScreen {
  constructor(app, game, net) {
    this.app = app; this.game = game; this.net = net;
    this.el = $('deploy');
    this.open = false;
    this.editOnly = false;
    this.sel = { k: 'base', id: 0 };
    this.tab = 'primary';
    this.lo = this.load();
    this.built = false;
    this.slow = 0;
    this.lastSpawns = '';
    this.el.addEventListener('click', (e) => this.onClick(e));
  }

  load() {
    try { const s = JSON.parse(localStorage.getItem('bf.loadout')); if (s) return sanitizeLoadout(s); } catch { /* ignore */ }
    return defaultLoadout('assault');
  }

  save() {
    this.lo = sanitizeLoadout(this.lo);
    try { localStorage.setItem('bf.loadout', JSON.stringify(this.lo)); } catch { /* ignore */ }
    this.net.send({ t: 'a', a: 'loadout', lo: this.lo });
  }

  show(editOnly = false) {
    this.editOnly = editOnly;
    this.open = true;
    this.built = false;
    this.el.classList.remove('hidden');
    document.body.classList.add('deploying');
    this.build();
    this.net.send({ t: 'a', a: 'loadout', lo: this.lo });
  }

  hide() {
    this.open = false;
    this.el.classList.add('hidden');
    document.body.classList.remove('deploying');
  }

  // ------------------------------------------------------------------ building the static parts
  build() {
    const g = this.game;
    const team = g.myTeam();
    this.el.innerHTML = `<div class="dp">
      <div class="dp-head"><h2>${this.editOnly ? 'Loadout' : 'Deploy'}</h2><span style="color:var(--dim);font-size:12px">${esc(g.map ? g.map.name : '')} · ${esc(({ conquest: 'Conquest', rush: 'Rush', tdm: 'Team Deathmatch' })[g.mode] || '')} · <b style="color:${team === T ? 'var(--t)' : 'var(--ct)'}">${team === T ? 'Crimson' : team === CT ? 'Azure' : ''}</b></span><span class="rev" id="dpRev"></span><span class="timer" id="dpTimer"></span></div>
      <div class="dp-map"><div class="cap"><span>Choose a spawn point</span><span id="dpSel" style="color:var(--accent)"></span></div><canvas id="dpMap" width="900" height="600"></canvas><div class="dp-spawns" id="dpSpawns"></div></div>
      <div class="dp-kit" id="dpKit"></div>
      <div class="dp-foot"><span class="info" id="dpInfo">${this.editOnly ? 'Changes apply the next time you spawn.' : ''}</span>${this.editOnly ? '<button class="btn" id="dpClose">Close <kbd>L</kbd></button>' : ''}<button class="btn green big" id="dpGo">${this.editOnly ? 'Save' : 'Deploy'}</button></div>
    </div>`;
    this.renderKit();
    this.built = true;
    this.mapCanvas = $('dpMap');
    this.mapCanvas.onclick = (e) => this.mapClick(e);
    this.fitCanvas();
  }

  fitCanvas() {
    const c = this.mapCanvas; if (!c) return;
    const r = c.getBoundingClientRect();
    const w = Math.max(200, Math.floor(r.width)), h = Math.max(160, Math.floor(r.height));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  weaponStats(w) {
    const bar = (v, max) => `<div class="bar"><i style="width:${Math.min(100, (v / max) * 100)}%"></i></div>`;
    const dmg = w.pellets > 1 ? `${Math.round(w.dmg)}×${w.pellets}` : Math.round(w.dmg);
    const range = Math.round(Math.pow(w.rangeMod, 800 / 345) * 100);
    return `<div class="stats">
      <div class="bs"><div class="k">Damage</div><div class="v">${dmg}</div>${bar(w.dmg * w.pellets, 130)}</div>
      <div class="bs"><div class="k">Rate</div><div class="v">${Math.round(w.rpm)}</div>${bar(w.rpm, 1000)}</div>
      <div class="bs"><div class="k">Magazine</div><div class="v">${w.mag}</div>${bar(w.mag, 100)}</div>
      <div class="bs"><div class="k">Range</div><div class="v">${range}%</div>${bar(range, 100)}</div>
      <div class="bs"><div class="k">Mobility</div><div class="v">${Math.round(w.speed * 100)}%</div>${bar(w.speed, 1)}</div></div>`;
  }

  attachRows(id, att, tab) {
    const w = WEAPONS[id];
    let html = '';
    for (const slot of SLOT_ORDER) {
      const opts = attachOptions(w, slot);
      if (opts.length <= 1) continue;
      html += `<div class="att-row"><div class="k">${ATTACH_SLOT_NAMES[slot]}</div><div class="chips">${opts.map((o) => `<button class="chip ${att[slot] === o ? 'on' : ''}" data-att="${tab}:${slot}:${o}" data-tip="${esc(ATTACH[slot][o].desc || '')}">${esc(ATTACH[slot][o].name)}</button>`).join('')}</div></div>`;
    }
    return html;
  }

  renderKit() {
    const lo = this.lo = sanitizeLoadout(this.lo);
    const c = CLASSES[lo.cls];
    const pw = resolveWeapon(lo.primary.id, lo.primary.att), sw = resolveWeapon(lo.secondary.id, lo.secondary.att);
    const cur = this.tab === 'secondary' ? sw : pw;
    const classes = CLASS_ORDER.map((k) => `<div class="cls ${lo.cls === k ? 'on' : ''}" data-cls="${k}"><div class="ic" style="background:${CLASSES[k].color}">${CLASSES[k].icon}</div><b>${CLASSES[k].name}</b><small>${esc(CLASSES[k].desc)}</small></div>`).join('');
    const gad = (slot) => c.gadgets[slot].map((id) => `<button class="chip ${lo.gadgets[slot] === id ? 'on' : ''}" data-gad="${slot}:${id}" data-tip="${esc(GADGETS[id].desc)}">${esc(GADGETS[id].name)}</button>`).join('');
    const gren = GREN_ORDER.map((k) => `<button class="chip ${lo.gren === k ? 'on' : ''}" data-gren="${k}">${esc(GRENADE[k].name)}</button>`).join('');
    const weaponChips = (list, key) => list.map((id) => `<button class="chip ${lo[key].id === id ? 'on' : ''}" data-wpn="${key}:${id}">${esc(WEAPONS[id].name)}</button>`).join('');
    $('dpKit').innerHTML = `
      <div class="dp-box"><h3>Class</h3><div class="classes">${classes}</div></div>
      <div class="dp-box"><h3><span style="flex:1">Weapons</span><span class="chips"><button class="chip ${this.tab === 'primary' ? 'on' : ''}" data-tab="primary">Primary</button><button class="chip ${this.tab === 'secondary' ? 'on' : ''}" data-tab="secondary">Sidearm</button></span></h3>
        <div class="chips">${this.tab === 'primary' ? weaponChips(c.primaries, 'primary') : weaponChips(SIDEARMS, 'secondary')}</div>
        <div class="att-desc" style="margin-top:6px"><b>${esc(cur.name)}</b> · ${esc(KIND_NAMES[cur.kind] || cur.kind)}${cur.alt ? ' · alt fire ' + (cur.alt === 'ugl' ? '40 mm grenade' : 'masterkey') : ''}${cur.suppressed ? ' · suppressed' : ''}${cur.scope ? ' · ' + [0, '4x', '8x', '12x'][cur.scope] + ' optic' : ''}</div>
        ${this.weaponStats(cur)}
        <div style="margin-top:8px">${this.attachRows(this.tab === 'primary' ? lo.primary.id : lo.secondary.id, this.tab === 'primary' ? lo.primary.att : lo.secondary.att, this.tab)}</div>
        <div class="att-desc" id="dpTip">Hover an attachment to see what it does.</div></div>
      <div class="dp-box"><h3>Gadgets</h3>
        <div class="att-row"><div class="k">Gadget 1 <kbd>3</kbd></div><div class="chips">${gad(0)}</div></div>
        <div class="att-row"><div class="k">Gadget 2 <kbd>4</kbd></div><div class="chips">${gad(1)}</div></div>
        <div class="att-row"><div class="k">Grenade <kbd>5</kbd></div><div class="chips">${gren}</div></div></div>`;
    $('dpKit').onmouseover = (e) => { const b = e.target.closest('[data-tip]'); if (b && $('dpTip')) $('dpTip').textContent = b.dataset.tip || ''; };
  }

  onClick(e) {
    const t = e.target.closest('button, .cls, .sp-btn');
    if (!t) return;
    if (t.id === 'dpGo') return this.go();
    if (t.id === 'dpClose') return this.hide();
    if (t.dataset.cls) { this.lo = defaultLoadout(t.dataset.cls); this.tab = 'primary'; this.save(); this.renderKit(); return; }
    if (t.dataset.tab) { this.tab = t.dataset.tab; this.renderKit(); return; }
    if (t.dataset.wpn) { const [key, id] = t.dataset.wpn.split(':'); this.lo[key] = { id, att: {} }; this.save(); this.renderKit(); return; }
    if (t.dataset.att) { const [tab, slot, id] = t.dataset.att.split(':'); const target = this.lo[tab === 'primary' ? 'primary' : 'secondary']; target.att = { ...target.att, [slot]: id }; this.save(); this.renderKit(); return; }
    if (t.dataset.gad) { const [slot, id] = t.dataset.gad.split(':'); this.lo.gadgets[Number(slot)] = id; this.save(); this.renderKit(); return; }
    if (t.dataset.gren) { this.lo.gren = t.dataset.gren; this.save(); this.renderKit(); return; }
    if (t.dataset.spk) { const [k, id] = t.dataset.spk.split(':'); const o = this.game.spawnOpts.find((q) => q.k === k && String(q.id) === id); if (o && o.ok) { this.sel = { k, id: o.id }; this.paint(); } }
  }

  mapClick(e) {
    const c = this.mapCanvas, r = c.getBoundingClientRect();
    const x = (e.clientX - r.left) * (c.width / r.width), y = (e.clientY - r.top) * (c.height / r.height);
    let best = null, bd = 30;
    for (const o of this.game.spawnOpts) {
      const p = this.toCanvas(o.x, o.y);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd && o.ok) { bd = d; best = o; }
    }
    if (best) { this.sel = { k: best.k, id: best.id }; this.paint(); }
  }

  go() {
    if (this.editOnly) { this.hide(); return; }
    const g = this.game;
    if (g.respawnIn > 0) { this.app.toast('Wait for the respawn timer'); return; }
    const o = g.spawnOpts.find((q) => q.k === this.sel.k && q.id === this.sel.id && q.ok) || g.spawnOpts.find((q) => q.ok);
    if (!o) { this.app.toast('No spawn point available'); return; }
    this.net.send({ t: 'a', a: 'deploy', k: o.k, id: o.id, lo: this.lo });
  }

  // ------------------------------------------------------------------ live parts
  toCanvas(x, y) {
    const g = this.game, c = this.mapCanvas;
    const m = g.map;
    const k = Math.min(c.width / m.width, c.height / m.height);
    const ox = (c.width - m.width * k) / 2, oy = (c.height - m.height * k) / 2;
    return { x: ox + x * k, y: oy + y * k, k, ox, oy };
  }

  paint() {
    const g = this.game, c = this.mapCanvas;
    if (!c || !g.map || !g.terrain || !g.terrain.thumb) return;
    this.fitCanvas();
    const ctx = c.getContext('2d');
    ctx.imageSmoothingEnabled = false;
    const m = g.map;
    const p0 = this.toCanvas(0, 0);
    ctx.fillStyle = '#05070b'; ctx.fillRect(0, 0, c.width, c.height);
    ctx.drawImage(g.terrain.thumb, p0.ox, p0.oy, m.width * p0.k, m.height * p0.k);
    ctx.fillStyle = 'rgba(0,0,0,0.25)'; ctx.fillRect(p0.ox, p0.oy, m.width * p0.k, m.height * p0.k);
    const myTeam = g.myTeam();
    // flags
    for (const f of g.flagList()) {
      const p = this.toCanvas(f.x, f.y);
      ctx.fillStyle = f.owner === 0 ? '#c4472f' : f.owner === 1 ? '#3f7fd8' : '#cfd3d8';
      ctx.fillRect(p.x - 10, p.y - 10, 20, 20);
      ctx.fillStyle = f.owner < 0 ? '#101418' : '#fff'; ctx.font = '900 13px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      ctx.fillText(f.letter, p.x, p.y + 1);
    }
    for (const mc of g.mcomList()) { if (mc.state === 2) continue; const p = this.toCanvas(mc.x, mc.y); ctx.fillStyle = '#ffb84a'; ctx.fillRect(p.x - 8, p.y - 8, 16, 16); ctx.fillStyle = '#101418'; ctx.font = '900 11px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('M', p.x, p.y + 1); }
    // teammates
    for (const p of g.soldiers()) {
      if (!p.mate) continue;
      const q = this.toCanvas(p.x, p.y);
      const sq = (g.roster.get(p.id) || {}).sq === g.mySquad();
      ctx.fillStyle = sq ? '#7dff9a' : (myTeam === T ? '#ff8a72' : '#7fb0ff'); ctx.fillRect(q.x - 3, q.y - 3, 6, 6);
    }
    // spawn options
    for (const o of g.spawnOpts) {
      const p = this.toCanvas(o.x, o.y);
      const on = o.k === this.sel.k && o.id === this.sel.id;
      ctx.globalAlpha = o.ok ? 1 : 0.35;
      if (o.k === 'squad') { ctx.fillStyle = '#7dff9a'; ctx.beginPath(); ctx.arc(p.x, p.y, 8, 0, 6.3); ctx.fill(); ctx.strokeStyle = '#0b0e14'; ctx.lineWidth = 2; ctx.stroke(); }
      else if (o.k === 'beacon') { ctx.fillStyle = '#7dff9a'; ctx.beginPath(); ctx.moveTo(p.x, p.y - 10); ctx.lineTo(p.x + 8, p.y + 6); ctx.lineTo(p.x - 8, p.y + 6); ctx.closePath(); ctx.fill(); }
      else if (o.k === 'base' || o.k === 'area') { ctx.fillStyle = myTeam === T ? '#c4472f' : '#3f7fd8'; ctx.fillRect(p.x - 12, p.y - 12, 24, 24); ctx.fillStyle = '#fff'; ctx.font = '900 12px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText('HQ', p.x, p.y + 1); }
      ctx.globalAlpha = 1;
      if (on) { ctx.strokeStyle = '#ffd95a'; ctx.lineWidth = 3; ctx.setLineDash([6, 4]); ctx.strokeRect(p.x - 17, p.y - 17, 34, 34); ctx.setLineDash([]); }
      else if (o.ok && (o.k === 'flag')) { ctx.strokeStyle = 'rgba(255,255,255,0.55)'; ctx.lineWidth = 2; ctx.strokeRect(p.x - 13, p.y - 13, 26, 26); }
    }
  }

  update(dt) {
    if (!this.open || !this.built) return;
    const g = this.game;
    this.slow -= dt;
    if (this.slow > 0) { this.paintTimer(); return; }
    this.slow = 0.1;
    // keep a valid selection
    const opts = g.spawnOpts;
    if (!opts.find((q) => q.k === this.sel.k && q.id === this.sel.id && q.ok)) {
      const first = opts.find((q) => q.ok && q.k !== 'base') && this.sel.k !== 'base' ? opts.find((q) => q.ok && q.k !== 'base') : opts.find((q) => q.ok);
      if (first) this.sel = { k: first.k, id: first.id };
    }
    const key = JSON.stringify(opts.map((o) => [o.k, o.id, o.ok, o.why])) + this.sel.k + this.sel.id + g.flagList().map((f) => f.owner).join('');
    if (key !== this.lastSpawns) {
      this.lastSpawns = key;
      $('dpSpawns').innerHTML = opts.map((o) => `<div class="sp-btn ${o.ok ? '' : 'off'} ${o.k === this.sel.k && o.id === this.sel.id ? 'on' : ''}" data-spk="${o.k}:${o.id}">${o.k === 'flag' ? '⚑' : o.k === 'squad' ? '☺' : o.k === 'beacon' ? '▲' : '■'} ${esc(o.k === 'flag' ? this.flagLabel(o) : o.name)}${o.veh ? ' (vehicle)' : ''}${o.ok ? '' : `<small>${esc(o.why)}</small>`}</div>`).join('');
      const s = opts.find((o) => o.k === this.sel.k && o.id === this.sel.id);
      $('dpSel').textContent = s ? `→ ${s.k === 'flag' ? this.flagLabel(s) : s.name}` : '';
    }
    this.paint();
    this.paintTimer();
  }

  flagLabel(o) { const f = this.game.flagList().find((q) => q.id === o.id); return f ? `${f.letter} · ${f.name}` : o.name; }

  paintTimer() {
    const g = this.game;
    const t = $('dpTimer'), go = $('dpGo');
    if (!t) return;
    if (this.editOnly) { t.textContent = ''; return; }
    const left = Math.max(0, g.respawnIn - (performance.now() - (g.timerRecv || 0)) / 1000);
    t.textContent = left > 0.05 ? `Deploy in ${Math.ceil(left)}` : 'Ready';
    if (go) go.disabled = left > 0.05;
    const rev = $('dpRev');
    if (rev) rev.textContent = g.reviveLeft > 0 ? `A medic can still revive you (${Math.ceil(g.reviveLeft)}s)` : '';
  }
}
export { SPEC };
