// Loadout editor: class, weapon cards, stat bars, attachment tiles, gadgets. Shared by the deploy screen and the main menu.
import {
  CLASSES, CLASS_ORDER, SIDEARMS, WEAPONS, ATTACH, ATTACH_SLOT_NAMES, GADGETS, attachOptions, defaultLoadout, sanitizeLoadout, resolveWeapon,
} from '../../shared/weapons.js';
import { GRENADE, GREN_ORDER } from '../../shared/constants.js';
import { gunIcon, attachIcon } from '../game/viewmodel.js';

const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const SLOT_ORDER = ['optic', 'barrel', 'under', 'mag'];
const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

/** the five rating bars of a weapon, each 0..100 */
export function weaponRatings(w) {
  const range = Math.pow(w.rangeMod, 800 / 345) * 100;
  return [
    ['Damage', clamp(w.dmg * w.pellets / 1.3, 6, 100), w.pellets > 1 ? `${Math.round(w.dmg)}×${w.pellets}` : Math.round(w.dmg)],
    ['Fire rate', clamp(w.rpm / 10, 4, 100), Math.round(w.rpm)],
    ['Range', clamp(range * 1.05, 8, 100), `${Math.round(range)}%`],
    ['Accuracy', clamp(100 - (w.spread * 14 + w.moveSpread * 3.2 + w.burst * 4), 12, 100), ''],
    ['Mobility', clamp((w.speed - 0.6) / 0.4 * 100, 8, 100), `${Math.round(w.speed * 100)}%`],
  ];
}

export class KitEditor {
  /** root: element to render into; opts.onChange(lo): the loadout changed; opts.compact: smaller weapon cards */
  constructor(root, opts = {}) {
    this.root = root; this.opts = opts;
    this.lo = defaultLoadout('assault');
    this.tab = 'primary';
    root.addEventListener('click', (e) => this.onClick(e));
  }

  set(lo) { this.lo = sanitizeLoadout(lo); this.render(); }

  changed() { this.lo = sanitizeLoadout(this.lo); if (this.opts.onChange) this.opts.onChange(this.lo); this.render(); }

  onClick(e) {
    const t = e.target.closest('[data-cls],[data-tab],[data-wpn],[data-att],[data-gad],[data-gren]');
    if (!t) return;
    const d = t.dataset;
    if (d.cls) { this.lo = defaultLoadout(d.cls); this.tab = 'primary'; this.changed(); }
    else if (d.tab) { this.tab = d.tab; this.render(); }
    else if (d.wpn) { const [key, id] = d.wpn.split(':'); this.lo[key] = { id, att: {} }; this.changed(); }
    else if (d.att) { const [tab, slot, id] = d.att.split(':'); const tg = this.lo[tab]; tg.att = { ...tg.att, [slot]: id }; this.changed(); }
    else if (d.gad) { const [slot, id] = d.gad.split(':'); this.lo.gadgets[Number(slot)] = id; this.changed(); }
    else if (d.gren) { this.lo.gren = d.gren; this.changed(); }
  }

  render() {
    const lo = this.lo = sanitizeLoadout(this.lo);
    const c = CLASSES[lo.cls];
    const key = this.tab === 'secondary' ? 'secondary' : 'primary';
    const cur = resolveWeapon(lo[key].id, lo[key].att);
    const base = WEAPONS[cur.id];
    const list = key === 'primary' ? c.primaries : SIDEARMS;

    const classes = CLASS_ORDER.map((k) => `<button class="kcls ${lo.cls === k ? 'on' : ''}" data-cls="${k}"><span class="ic" style="background:${CLASSES[k].color}">${CLASSES[k].icon}</span><b>${CLASSES[k].name}</b><small>${esc(CLASSES[k].desc)}</small></button>`).join('');
    const cards = list.map((id) => {
      const w = WEAPONS[id];
      const img = gunIcon(id, w.kind, {}, 320, 130);
      return `<button class="wcard ${lo[key].id === id ? 'on' : ''}" data-wpn="${key}:${id}"><img src="${img}" alt=""><b>${esc(w.name)}</b><small>${esc(w.tag || w.kind)}</small></button>`;
    }).join('');
    const bars = weaponRatings(cur).map(([k, v, txt]) => `<div class="bs"><div class="k"><span>${k}</span><em>${txt}</em></div><div class="bar"><i style="width:${Math.round(v)}%"></i></div></div>`).join('');
    const slots = SLOT_ORDER.map((slot) => {
      const opts = attachOptions(base, slot);
      if (opts.length <= 1) return '';
      const cur2 = lo[key].att[slot];
      const tiles = opts.map((o) => {
        const a = ATTACH[slot][o];
        const isDefault = !a.no;
        const icon = isDefault ? '' : `<img src="${attachIcon(slot, o, 240, 150)}" alt="">`;
        return `<button class="acard ${cur2 === o ? 'on' : ''} ${isDefault ? 'plain' : ''}" data-att="${key}:${slot}:${o}" title="${esc(a.desc || '')}">${a.no ? `<span class="no">${String(a.no).padStart(2, '0')}</span>` : ''}${icon}<b>${esc(a.name)}</b>${a.desc ? `<small>${esc(a.desc)}</small>` : ''}</button>`;
      }).join('');
      return `<div class="kslot"><h4>${ATTACH_SLOT_NAMES[slot]}</h4><div class="acards">${tiles}</div></div>`;
    }).join('');
    const gad = (slot) => c.gadgets[slot].map((id) => `<button class="chip ${lo.gadgets[slot] === id ? 'on' : ''}" data-gad="${slot}:${id}" title="${esc(GADGETS[id].desc)}">${esc(GADGETS[id].name)}</button>`).join('');
    const gren = GREN_ORDER.map((k) => `<button class="chip ${lo.gren === k ? 'on' : ''}" data-gren="${k}">${esc(GRENADE[k].name)}</button>`).join('');
    const extra = [cur.suppressed ? 'Suppressed' : '', cur.scope ? ['', '4X optic', 'Sniper optic', ''][cur.scope] : '', cur.light ? 'Flashlight' : ''].filter(Boolean).join(' · ');

    this.root.innerHTML = `
      <div class="kbox"><h3>Class</h3><div class="kclasses">${classes}</div></div>
      <div class="kbox"><h3><span style="flex:1">Weapons</span><span class="chips"><button class="chip ${key === 'primary' ? 'on' : ''}" data-tab="primary">Primary</button><button class="chip ${key === 'secondary' ? 'on' : ''}" data-tab="secondary">Sidearm</button></span></h3>
        <div class="wcards">${cards}</div>
        <div class="kdetail"><div class="kpic"><img src="${gunIcon(cur.id, cur.kind, cur.att, 520, 210)}" alt=""></div>
          <div class="kinfo"><div class="kname">${esc(cur.name)}</div><div class="ktag">${esc(cur.tag || cur.kind)} · ${esc(cur.mode || '')}${extra ? ' · ' + extra : ''}</div><div class="kstats">${bars}</div>
          <div class="kmag">${cur.mag} <small>rd mag</small> · ${cur.reserve} <small>reserve</small></div></div></div>
        ${slots}</div>
      <div class="kbox"><h3>Gadgets</h3>
        <div class="att-row"><div class="k">Gadget 1 <kbd>3</kbd></div><div class="chips">${gad(0)}</div></div>
        <div class="att-row"><div class="k">Gadget 2 <kbd>4</kbd></div><div class="chips">${gad(1)}</div></div>
        <div class="att-row"><div class="k">Grenade <kbd>G</kbd></div><div class="chips">${gren}</div></div></div>`;
  }
}
