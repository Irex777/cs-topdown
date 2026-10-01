// Loadout editor: role, weapon, attachments and gear. Shared by the deploy screen (narrow: Weapons / Gear tabs) and the main menu (wide: everything visible).
import {
  CLASSES, CLASS_ORDER, SIDEARMS, WEAPONS, ATTACH, ATTACH_SLOT_NAMES, GADGETS, attachOptions, defaultLoadout, sanitizeLoadout, resolveWeapon,
} from '../../shared/weapons.js';
import { GRENADE, GREN_ORDER } from '../../shared/constants.js';
import { gunIcon, attachIcon } from '../game/viewmodel.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SLOT_ORDER = ['optic', 'barrel', 'under', 'mag'];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
const ROLE_ICONS = {
  assault: '<path d="M12 5v14M5 12h14"/><path d="m5 5 3-2m8 0 3 2m0 14-3 2m-8 0-3-2"/>',
  engineer: '<path d="m5 19 9-9m1-6a5 5 0 0 0-5 6l4 4a5 5 0 0 0 6-5l-4 1-3-3z"/><circle cx="5" cy="19" r="2"/>',
  support: '<path d="M4 18V8l2-3 2 3v10zm6 0V8l2-3 2 3v10zm6 0V8l2-3 2 3v10zM3 21h18"/>',
  recon: '<circle cx="12" cy="12" r="6"/><path d="M12 2v6m0 8v6M2 12h6m8 0h6"/><circle cx="12" cy="12" r="1"/>',
};

/** the five rating bars of a weapon: [label, 0..100, number shown next to the bar] */
export function weaponRatings(w) {
  const range = Math.pow(w.rangeMod, 800 / 345) * 100;
  const accuracy = clamp(100 - (w.spread * 14 + w.moveSpread * 3.2 + w.burst * 4), 12, 100);
  return [
    ['Damage', clamp(w.dmg * w.pellets / 1.3, 6, 100), w.pellets > 1 ? `${Math.round(w.dmg)}×${w.pellets}` : Math.round(w.dmg)],
    ['Fire rate', clamp(w.rpm / 10, 4, 100), Math.round(w.rpm)],
    ['Range', clamp(range * 1.05, 8, 100), `${Math.round(range)}%`],
    ['Accuracy', accuracy, `${Math.round(accuracy)}%`],
    ['Mobility', clamp((w.speed - 0.6) / 0.4 * 100, 8, 100), `${Math.round(w.speed * 100)}%`],
  ];
}

/** one labelled rating bar; shared with the arsenal sheet on the main menu */
export const statRow = ([k, v, txt]) => `<div class="stat"><span class="k">${k}</span><span class="bar"><i style="width:${Math.round(v)}%"></i></span><em>${txt === '' ? Math.round(v) : txt}</em></div>`;

export class KitEditor {
  /** root: element to render into; opts.onChange(lo): the loadout changed */
  constructor(root, opts = {}) {
    this.root = root; this.opts = opts;
    this.lo = defaultLoadout('assault');
    this.tab = 'primary';
    this.section = 'weapons'; this.slot = 'optic';
    root.addEventListener('click', (e) => this.onClick(e));
  }

  set(lo) { this.lo = sanitizeLoadout(lo); this.render(); }

  changed() { this.lo = sanitizeLoadout(this.lo); if (this.opts.onChange) this.opts.onChange(this.lo); this.render(); }

  onClick(e) {
    const t = e.target.closest('[data-cls],[data-tab],[data-wpn],[data-att],[data-gad],[data-gren],[data-section],[data-slot]');
    if (!t) return;
    const d = t.dataset;
    if (d.section) { this.section = d.section; this.render(); }
    else if (d.slot) { this.slot = d.slot; this.render(); }
    else if (d.cls) { this.lo = defaultLoadout(d.cls); this.tab = 'primary'; this.changed(); }
    else if (d.tab) { this.tab = d.tab; this.render(); }
    else if (d.wpn) { const [key, id] = d.wpn.split(':'); this.lo[key] = { id, att: {} }; this.changed(); }
    else if (d.att) { const [tab, slot, id] = d.att.split(':'); const tg = this.lo[tab]; tg.att = { ...tg.att, [slot]: id }; this.changed(); }
    else if (d.gad) { const [slot, id] = d.gad.split(':'); this.lo.gadgets[Number(slot)] = id; this.changed(); }
    else if (d.gren) { this.lo.gren = d.gren; this.changed(); }
  }

  render() {
    const prev = this.root.querySelector('.kit-body');
    const scroll = prev ? prev.scrollTop : 0;
    const lo = this.lo = sanitizeLoadout(this.lo);
    const c = CLASSES[lo.cls];
    const key = this.tab === 'secondary' ? 'secondary' : 'primary';
    const cur = resolveWeapon(lo[key].id, lo[key].att);
    const base = WEAPONS[cur.id];
    const list = key === 'primary' ? c.primaries : SIDEARMS;
    const on = (b) => (b ? 'on' : '');

    const classes = CLASS_ORDER.map((k) => `<button class="kcls ${on(lo.cls === k)}" data-cls="${k}" aria-pressed="${lo.cls === k}" title="${esc(CLASSES[k].desc)}"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ROLE_ICONS[k]}</svg><b>${CLASSES[k].name}</b></button>`).join('');
    const cards = list.map((id) => {
      const w = WEAPONS[id];
      return `<button class="wcard ${on(lo[key].id === id)}" data-wpn="${key}:${id}" aria-pressed="${lo[key].id === id}"><img src="${gunIcon(id, w.kind, {}, 320, 130)}" alt=""><b>${esc(w.name)}</b><small>${esc(w.tag || w.kind)}</small></button>`;
    }).join('');
    const bars = weaponRatings(cur).map(statRow).join('');
    const availableSlots = SLOT_ORDER.filter((slot) => attachOptions(base, slot).length > 1);
    if (!availableSlots.includes(this.slot)) this.slot = availableSlots[0];
    const slotTabs = availableSlots.map((slot) => `<button data-slot="${slot}" class="${on(this.slot === slot)}" aria-pressed="${this.slot === slot}"><span>${ATTACH_SLOT_NAMES[slot]}</span><b>${esc(ATTACH[slot][lo[key].att[slot]]?.name || 'Standard')}</b></button>`).join('');
    const tiles = availableSlots.length ? attachOptions(base, this.slot).map((o) => {
      const a = ATTACH[this.slot][o];
      const isDefault = !a.no;
      const icon = isDefault ? '' : `<img src="${attachIcon(this.slot, o, 240, 150)}" alt="">`;
      const picked = lo[key].att[this.slot] === o;
      return `<button class="acard ${on(picked)} ${isDefault ? 'plain' : ''}" data-att="${key}:${this.slot}:${o}" aria-pressed="${picked}" title="${esc(a.desc || '')}">${icon}<b>${esc(a.name)}</b>${a.desc ? `<small>${esc(a.desc)}</small>` : ''}</button>`;
    }).join('') : '';
    const gad = (slot) => c.gadgets[slot].map((id) => `<button class="chip ${on(lo.gadgets[slot] === id)}" data-gad="${slot}:${id}" aria-pressed="${lo.gadgets[slot] === id}">${esc(GADGETS[id].name)}</button>`).join('');
    const gren = GREN_ORDER.map((k) => `<button class="chip ${on(lo.gren === k)}" data-gren="${k}" aria-pressed="${lo.gren === k}">${esc(GRENADE[k].name)}</button>`).join('');
    const gadRow = (title, hotkey, chips, desc) => `<div class="gear-row"><div class="gear-name"><b>${title}</b><kbd>${hotkey}</kbd></div><div class="chips">${chips}</div><p>${esc(desc || '')}</p></div>`;
    const extra = [cur.suppressed ? 'Suppressed' : '', cur.scope ? ['', '4X optic', 'Sniper optic', ''][cur.scope] : '', cur.light ? 'Flashlight' : ''].filter(Boolean).join(' · ');

    const tabBtn = (k, l) => `<button data-section="${k}" class="${on(this.section === k)}" aria-pressed="${this.section === k}">${l}</button>`;
    const stats = `<div class="kstats">${bars}</div>`;
    this.root.innerHTML = `<div class="kit" data-section="${this.section}">
      <div class="kit-top">
        <section class="kit-role"><h3>Combat role</h3><div class="kclasses">${classes}</div><p class="kit-note">${esc(c.desc)}</p></section>
        <div class="kit-nav" role="tablist" aria-label="Loadout sections">${tabBtn('weapons', 'Weapon')}${tabBtn('attachments', 'Attachments')}${tabBtn('equipment', 'Gear')}</div>
      </div>
      <div class="kit-body">
        <div class="kit-col">
          <section class="kit-sec kit-weapon"><div class="kit-sec-head"><h3>Weapon</h3><div class="chips"><button class="chip ${on(key === 'primary')}" data-tab="primary">Primary</button><button class="chip ${on(key === 'secondary')}" data-tab="secondary">Sidearm</button></div></div>
            <div class="wcards">${cards}</div>
            <div class="kdetail"><div class="kpic"><img src="${gunIcon(cur.id, cur.kind, cur.att, 720, 270)}" alt="${esc(cur.name)}"></div>
              <div class="kinfo"><div class="kname">${esc(cur.name)}</div><div class="ktag">${esc(cur.tag || cur.kind)}${cur.mode ? ' · ' + esc(cur.mode) : ''}</div>
              <div class="kmag"><b>${cur.mag}</b> rounds <i></i> <b>${cur.reserve}</b> reserve</div>${extra ? `<div class="kextra">${esc(extra)}</div>` : ''}</div>
              ${stats}</div></section>
        </div>
        <div class="kit-col">
          <section class="kit-sec kit-attachments"><div class="kit-sec-head"><h3>Attachments</h3><span class="kit-note">${esc(cur.name)} · ${esc(ATTACH_SLOT_NAMES[this.slot] || '')}</span></div>
            <div class="kit-preview" aria-label="Current weapon ratings">${weaponRatings(cur).map(([k, v, t]) => `<span>${k}<b>${t === '' ? Math.round(v) : t}</b></span>`).join('')}</div>
            ${availableSlots.length ? `<div class="kit-slot-tabs">${slotTabs}</div><div class="acards">${tiles}</div>` : '<p class="kit-note">This weapon has no attachment slots.</p>'}</section>
          <section class="kit-sec kit-gear"><h3>Field gear</h3>
            ${gadRow('Gadget 1', 3, gad(0), GADGETS[lo.gadgets[0]]?.desc)}${gadRow('Gadget 2', 4, gad(1), GADGETS[lo.gadgets[1]]?.desc)}${gadRow('Grenade', 'G', gren, GRENADE[lo.gren]?.desc)}</section>
        </div>
      </div></div>`;
    const body = this.root.querySelector('.kit-body');
    if (body) body.scrollTop = scroll;
  }
}
