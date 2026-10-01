// Deploy screen: pick a class, weapons and attachments, choose where to spawn on the tactical map.
import { defaultLoadout, sanitizeLoadout } from '../../shared/weapons.js';
import { T, CT, SPEC } from '../../shared/constants.js';
import { KitEditor } from './kit.js';
import { CLASSES, WEAPONS } from '../../shared/weapons.js';

const $ = (id) => document.getElementById(id);
const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

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
    this.game.input.reset();
    this.editOnly = editOnly;
    this.lo = this.load();          // the main menu may have changed it
    this.open = true;
    this.built = false; this.kitEditor = null;
    this.lastSpawns = '';
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
    const modeName = ({ conquest: 'Conquest', rush: 'Rush', tdm: 'Team Deathmatch' })[g.mode] || '';
    this.el.innerHTML = `<div class="dp ${this.editOnly ? 'editing' : ''}">
      <header class="dp-head"><div class="dp-title"><span class="eyebrow">${this.editOnly ? 'Field armory' : 'Deployment'}</span><h2>${esc(g.map ? g.map.name : 'Prepare for deployment')}</h2><div class="dp-meta">${esc(modeName)}<i></i><b class="${team === T ? 'vg' : 'bw'}">${team === T ? 'Vanguard' : team === CT ? 'Bulwark' : 'Spectator'}</b></div></div><div class="dp-state"><span class="timer" id="dpTimer"></span><span class="rev" id="dpRev"></span></div></header>
      <section class="dp-map"><div class="cap"><span><b>1</b> Choose where to deploy</span><span class="dp-live"><i></i> Live</span></div><div class="dp-spawns" id="dpSpawns" role="list"></div><div class="dp-map-view"><canvas id="dpMap" width="900" height="600" aria-label="Tactical map. Select an available spawn point."></canvas><div class="dp-map-north">N<span>↑</span></div><div class="dp-map-legend"><span><i class="friendly"></i> Friendly</span><span><i class="hostile"></i> Enemy</span><span><i class="selected"></i> Selected</span></div></div><div class="dp-map-caption"><span id="dpSel"></span><span>Pick a spawn from the list or click a marker on the map</span></div></section>
      <section class="dp-kit-card"><div class="kit-card-head"><span class="eyebrow"><b>2</b> Your loadout</span><span class="kit-saved">Saved automatically</span></div><div class="dp-kit" id="dpKit"></div></section>
      <footer class="dp-foot"><div class="dp-insertion"><span class="eyebrow">${this.editOnly ? 'Loadout' : 'Deploying to'}</span><strong id="dpDestination">Select a spawn point</strong><span class="info" id="dpInfo">${this.editOnly ? 'Changes apply the next time you spawn.' : ''}</span></div><div class="dp-kit-summary" id="dpSummary"></div>${this.editOnly ? '<button class="btn" id="dpClose">Back <kbd>L</kbd></button>' : ''}<button class="btn primary big" id="dpGo" ${this.editOnly ? '' : 'disabled'}><span>${this.editOnly ? 'Save loadout' : 'Deploy'}</span><span aria-hidden="true">↗</span></button></footer>
    </div>`;
    this.renderKit();
    this.built = true;
    this.mapCanvas = $('dpMap');
    this.mapCanvas.onclick = (e) => this.mapClick(e);
    this.hover = null;
    this.mapCanvas.onmousemove = (e) => { const o = this.pick(e); const k = o ? o.k + ':' + o.id : null; this.mapCanvas.style.cursor = o ? 'pointer' : 'default'; if (k !== this.hover) { this.hover = k; this.paint(); } };
    this.mapCanvas.onmouseleave = () => { if (this.hover) { this.hover = null; this.paint(); } };
    this.fitCanvas();
  }

  fitCanvas() {
    const c = this.mapCanvas; if (!c) return;
    const r = c.getBoundingClientRect(), d = this.dpr = Math.min(2, window.devicePixelRatio || 1);
    const w = Math.max(200, Math.floor(r.width * d)), h = Math.max(160, Math.floor(r.height * d));
    if (c.width !== w || c.height !== h) { c.width = w; c.height = h; }
  }

  renderKit() {
    if (!this.kitEditor) this.kitEditor = new KitEditor($('dpKit'), { focused: true, onChange: (lo) => { this.lo = lo; this.save(); this.updateSummary(); } });
    else this.kitEditor.root = $('dpKit');
    this.kitEditor.set(this.lo);
    this.updateSummary();
  }

  updateSummary() {
    const el = $('dpSummary');
    if (el) el.innerHTML = `<span class="eyebrow">Your kit</span><strong>${esc(CLASSES[this.lo.cls].name)} <span>/</span> ${esc(WEAPONS[this.lo.primary.id].name)}</strong>`;
  }

  onClick(e) {
    const t = e.target.closest('button, .sp-btn');
    if (!t) return;
    if (t.id === 'dpGo') return this.go();
    if (t.id === 'dpClose') return this.hide();
    if (t.dataset.spk) { const [k, id] = t.dataset.spk.split(':'); const o = this.game.spawnOpts.find((q) => q.k === k && String(q.id) === id); if (o && o.ok) this.selectSpawn(o); }
  }

  selectSpawn(o) {
    this.sel = { k: o.k, id: o.id };
    this.slow = 0;
    this.update(0);
  }

  /** the available spawn point under the pointer, in CSS pixels of the canvas */
  pick(e) {
    const c = this.mapCanvas, r = c.getBoundingClientRect();
    const x = e.clientX - r.left, y = e.clientY - r.top;
    let best = null, bd = 24;
    for (const o of this.game.spawnOpts) {
      const p = this.toCanvas(o.x, o.y);
      const d = Math.hypot(p.x - x, p.y - y);
      if (d < bd && o.ok) { bd = d; best = o; }
    }
    return best;
  }

  mapClick(e) {
    const best = this.pick(e);
    if (best) this.selectSpawn(best);
  }

  go() {
    if (this.editOnly) { this.hide(); return; }
    const g = this.game;
    if (g.respawnIn > 0) { this.app.toast('Wait for the respawn timer'); return; }
    const o = g.spawnOpts.find((q) => q.k === this.sel.k && q.id === this.sel.id && q.ok);
    if (!o) { this.app.toast('Selected spawn is unavailable. Choose another spawn point.'); return; }
    this.net.send({ t: 'a', a: 'deploy', k: o.k, id: o.id, lo: this.lo });
  }

  // ------------------------------------------------------------------ live parts
  tacticalMap() {
    const m = this.game.map, key = m.chars.join('');
    if (this.tacticalSource === m && this.tacticalKey === key) return this.tacticalCanvas;
    this.tacticalSource = m; this.tacticalKey = key;
    const c = this.tacticalCanvas = document.createElement('canvas'), s = 6;
    c.width = m.w * s; c.height = m.h * s;
    const ctx = c.getContext('2d');
    ctx.fillStyle = '#31433e'; ctx.fillRect(0, 0, c.width, c.height);
    const colors = { '~': '#254752', w: '#315964', _: '#586568', ';': '#59605b', ':': '#5a5b4c', '#': '#283735', B: '#8c8d79', G: '#8c8d79', M: '#738182', t: '#455e61', c: '#455e61', r: '#45514a', d: '#45514a', X: '#70715c', L: '#70715c', o: '#70715c' };
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      const ch = m.chars[y * m.w + x];
      if (ch === 'T') {
        ctx.fillStyle = '#41584a'; ctx.beginPath(); ctx.arc((x + .5) * s, (y + .5) * s, s * .48, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#4c6453'; ctx.lineWidth = .5; ctx.stroke();
      } else if (colors[ch]) { ctx.fillStyle = colors[ch]; ctx.fillRect(x * s, y * s, s, s); }
    }
    // Shaded relief and 2 m contours communicate high ground on the tactical map.
    for (let y = 0; y < m.h; y++) for (let x = 0; x < m.w; x++) {
      if (m.water[y * m.w + x]) continue;
      const gradient = m.gradientAt((x + .5) * 32, (y + .5) * 32), shade = (gradient.x + gradient.y) * .65;
      ctx.fillStyle = shade > 0 ? `rgba(0,0,0,${Math.min(.25, shade)})` : `rgba(223,235,191,${Math.min(.2, -shade)})`;
      ctx.fillRect(x * s, y * s, s, s);
      const z = [m.heightAt(x * 32, y * 32), m.heightAt((x + 1) * 32, y * 32), m.heightAt((x + 1) * 32, (y + 1) * 32), m.heightAt(x * 32, (y + 1) * 32)];
      const corners = [[x, y], [x + 1, y], [x + 1, y + 1], [x, y + 1]];
      ctx.strokeStyle = 'rgba(198,217,177,.22)'; ctx.lineWidth = .7;
      for (let level = Math.max(32, Math.ceil(Math.min(...z) / 32) * 32); level <= Math.max(...z); level += 32) {
        const cuts = [];
        for (let i = 0; i < 4; i++) {
          const j = (i + 1) % 4;
          if ((z[i] < level) === (z[j] < level)) continue;
          const t = (level - z[i]) / (z[j] - z[i]);
          cuts.push([(corners[i][0] + (corners[j][0] - corners[i][0]) * t) * s, (corners[i][1] + (corners[j][1] - corners[i][1]) * t) * s]);
        }
        for (let i = 0; i + 1 < cuts.length; i += 2) { ctx.beginPath(); ctx.moveTo(...cuts[i]); ctx.lineTo(...cuts[i + 1]); ctx.stroke(); }
      }
    }
    return c;
  }

  toCanvas(x, y) {
    const g = this.game, c = this.mapCanvas;
    const m = g.map;
    const cw = c.width / (this.dpr || 1), ch = c.height / (this.dpr || 1);
    const k = Math.min((cw - 56) / m.width, (ch - 72) / m.height);
    const ox = (cw - m.width * k) / 2, oy = (ch - m.height * k) / 2;
    return { x: ox + x * k, y: oy + y * k, k, ox, oy };
  }

  paint() {
    const g = this.game, c = this.mapCanvas;
    if (!c || !g.map || !g.terrain || !g.terrain.thumb) return;
    this.fitCanvas();
    const d = this.dpr || 1, cw = c.width / d, ch = c.height / d;
    const ctx = c.getContext('2d');
    ctx.setTransform(d, 0, 0, d, 0, 0);
    const m = g.map;
    const p0 = this.toCanvas(0, 0);
    const w = m.width * p0.k, h = m.height * p0.k;
    const bg = ctx.createRadialGradient(cw / 2, ch / 2, 0, cw / 2, ch / 2, cw);
    bg.addColorStop(0, '#1d2b2e'); bg.addColorStop(1, '#0f171b');
    ctx.fillStyle = bg; ctx.fillRect(0, 0, cw, ch);
    ctx.imageSmoothingEnabled = true;
    ctx.drawImage(this.tacticalMap(), p0.ox, p0.oy, w, h);
    for (const b of m.buildings || []) {
      if (!b.active) continue;
      const p = this.toCanvas(b.x0, b.y0);
      ctx.fillStyle = '#6b7163'; ctx.strokeStyle = '#b1b39c'; ctx.lineWidth = .7;
      ctx.fillRect(p.x, p.y, (b.x1 - b.x0) * p0.k, (b.y1 - b.y0) * p0.k);
      ctx.strokeRect(p.x, p.y, (b.x1 - b.x0) * p0.k, (b.y1 - b.y0) * p0.k);
      ctx.strokeStyle = 'rgba(202,205,179,.3)'; ctx.beginPath();
      if (b.axis === 'y') { ctx.moveTo(p.x, p.y + (b.y1 - b.y0) * p0.k / 2); ctx.lineTo(p.x + (b.x1 - b.x0) * p0.k, p.y + (b.y1 - b.y0) * p0.k / 2); }
      else { ctx.moveTo(p.x + (b.x1 - b.x0) * p0.k / 2, p.y); ctx.lineTo(p.x + (b.x1 - b.x0) * p0.k / 2, p.y + (b.y1 - b.y0) * p0.k); }
      ctx.stroke();
    }
    // Survey grid and coordinates stay quiet beneath live objective markers.
    ctx.strokeStyle = 'rgba(201,224,221,.1)'; ctx.lineWidth = 1;
    ctx.font = '600 12px ui-monospace, monospace'; ctx.fillStyle = '#9fb5b4';
    ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (let i = 0; i <= 6; i++) {
      const x = p0.ox + w * i / 6, y = p0.oy + h * i / 6;
      ctx.beginPath(); ctx.moveTo(x, p0.oy); ctx.lineTo(x, p0.oy + h); ctx.moveTo(p0.ox, y); ctx.lineTo(p0.ox + w, y); ctx.stroke();
      if (i < 6) { ctx.fillText(String.fromCharCode(65 + i), x + w / 12, p0.oy - 14); ctx.fillText(String(i + 1).padStart(2, '0'), p0.ox - 16, y + h / 12); }
    }
    ctx.strokeStyle = '#5c7270'; ctx.strokeRect(p0.ox, p0.oy, w, h);
    const labels = [];
    const marker = (x, y, label, color, selected, available, name) => {
      const p = this.toCanvas(x, y), hov = this.hover === name.key;
      ctx.globalAlpha = available ? 1 : .5;
      if (selected) {
        ctx.fillStyle = 'rgba(240,183,101,.14)'; ctx.beginPath(); ctx.arc(p.x, p.y, 28, 0, Math.PI * 2); ctx.fill();
        ctx.strokeStyle = '#f0b765'; ctx.lineWidth = 1.5; ctx.beginPath(); ctx.arc(p.x, p.y, 25, 0, Math.PI * 2); ctx.stroke();
      }
      ctx.fillStyle = selected ? '#f0b765' : hov ? '#27404a' : '#0f1b21'; ctx.strokeStyle = selected ? '#ffe2b8' : hov ? '#ffffff' : color; ctx.lineWidth = 2;
      ctx.beginPath(); ctx.roundRect(p.x - 15, p.y - 15, 30, 30, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = selected ? '#1b1407' : color; ctx.font = '700 13px ui-monospace, monospace'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle'; ctx.fillText(label, p.x, p.y + 1);
      ctx.globalAlpha = 1;
      if (selected || hov) labels.push([p.x, p.y, name.text, selected]);
    };
    for (const f of g.flagList()) {
      const o = g.spawnOpts.find((q) => q.k === 'flag' && q.id === f.id);
      marker(f.x, f.y, f.letter, g.pt(f.owner) === 0 ? '#ee9283' : g.pt(f.owner) === 1 ? '#8cc6ea' : '#cfd8d7', o?.k === this.sel.k && o.id === this.sel.id, !!o?.ok, { key: 'flag:' + f.id, text: f.name });
    }
    for (const mc of g.mcomList()) { if (mc.state !== 2) marker(mc.x, mc.y, 'M', '#f0b765', false, true, { key: 'mcom', text: 'M-COM station' }); }
    for (const p of g.soldiers()) {
      if (!p.mate) continue;
      const q = this.toCanvas(p.x, p.y);
      ctx.fillStyle = (g.roster.get(p.id) || {}).sq === g.mySquad() ? '#8fe0b8' : '#8cc6ea';
      ctx.beginPath(); ctx.arc(q.x, q.y, 3, 0, Math.PI * 2); ctx.fill();
    }
    for (const o of g.spawnOpts) {
      if (o.k === 'flag') continue;
      marker(o.x, o.y, o.k === 'squad' ? 'S' : o.k === 'beacon' ? 'B' : o.veh ? 'V' : 'HQ', o.k === 'squad' || o.k === 'beacon' ? '#8fe0b8' : '#8cc6ea', o.k === this.sel.k && o.id === this.sel.id, o.ok, { key: o.k + ':' + o.id, text: o.name });
    }
    // Name tags go on top so they never hide behind a neighbouring marker.
    ctx.font = '600 13px system-ui, sans-serif'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
    for (const [x, y, text, selected] of labels) {
      const tw = ctx.measureText(text).width + 18, ty = y + 32 + 12 > ch ? y - 32 : y + 32;
      ctx.fillStyle = 'rgba(8,13,16,.92)'; ctx.strokeStyle = selected ? '#f0b765' : 'rgba(255,255,255,.35)'; ctx.lineWidth = 1;
      ctx.beginPath(); ctx.roundRect(x - tw / 2, ty - 12, tw, 24, 6); ctx.fill(); ctx.stroke();
      ctx.fillStyle = '#f3f6f6'; ctx.fillText(text, x, ty + .5);
    }
  }

  update(dt) {
    if (!this.open || !this.built) return;
    const g = this.game;
    this.slow -= dt;
    if (this.slow > 0) { this.paintTimer(); return; }
    this.slow = 0.1;
    // Keep a contested selection visible and disabled until the player chooses another point.
    const opts = g.spawnOpts;
    if (!opts.find((q) => q.k === this.sel.k && q.id === this.sel.id)) {
      const first = opts.find((q) => q.ok);
      if (first) this.sel = { k: first.k, id: first.id };
    }
    const key = JSON.stringify(opts.map((o) => [o.k, o.id, o.ok, o.why])) + this.sel.k + this.sel.id + g.flagList().map((f) => f.owner).join('');
    if (key !== this.lastSpawns) {
      this.lastSpawns = key;
      $('dpSpawns').innerHTML = opts.map((o) => {
        const f = o.k === 'flag' ? g.flagList().find((q) => q.id === o.id) : null;
        const selected = o.k === this.sel.k && o.id === this.sel.id;
        const label = f ? f.name : o.name;
        const badge = f ? f.letter : o.k === 'squad' ? 'SQ' : o.k === 'beacon' ? 'B' : o.veh ? 'V' : 'HQ';
        const note = o.ok ? o.veh ? 'Vehicle insertion' : o.k === 'squad' ? 'Join your squad' : o.k === 'beacon' ? 'Spawn beacon' : o.k === 'base' ? 'Always safe' : 'Friendly flag' : o.why || 'Unavailable';
        return `<button class="sp-btn ${o.ok ? '' : 'off'} ${selected ? 'on' : ''}" role="listitem" data-spk="${o.k}:${o.id}" ${o.ok ? '' : 'disabled'} aria-pressed="${selected}"><span class="sp-icon">${esc(badge)}</span><span class="sp-copy"><b>${esc(label)}</b><small>${esc(note)}</small></span>${selected ? '<span class="sp-check" aria-hidden="true">✓</span>' : ''}</button>`;
      }).join('');
      const s = opts.find((o) => o.k === this.sel.k && o.id === this.sel.id);
      const label = s ? s.k === 'flag' ? this.flagLabel(s) : s.name : 'Awaiting insertion point';
      $('dpSel').textContent = label;
      $('dpDestination').textContent = this.editOnly ? 'Field configuration' : label;
      $('dpInfo').textContent = this.editOnly ? 'Changes apply the next time you spawn.' : s && !s.ok ? `${s.why || 'Unavailable'} — choose another spawn point.` : s?.veh ? 'Deploy directly into the selected vehicle.' : s?.k === 'squad' ? 'Join your squad on the battlefield.' : 'Confirm your kit and enter the battlefield.';
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
    const selected = g.spawnOpts.find((o) => o.k === this.sel.k && o.id === this.sel.id);
    const available = !!selected?.ok;
    t.textContent = g.respawnIn > 0 ? `Deploy in ${Math.max(1, Math.ceil(left))}` : available ? 'Ready to deploy' : selected?.why || 'Awaiting insertion';
    if (go) go.disabled = g.respawnIn > 0 || !available;
    const rev = $('dpRev');
    if (rev) rev.textContent = g.reviveLeft > 0 ? `A medic can still revive you (${Math.ceil(g.reviveLeft)}s)` : '';
  }
}
export { SPEC };
