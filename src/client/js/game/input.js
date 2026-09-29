// Keyboard + mouse state for the local player.
import { KEY } from '../../shared/constants.js';

export class Input {
  constructor(canvas) {
    this.canvas = canvas;
    this.down = new Set();
    this.mx = 0; this.my = 0;
    this.left = false; this.right = false;
    this.pending = 0;            // presses shorter than one tick still get delivered
    this.enabled = false;        // false while a menu / chat box is capturing input
    this.handlers = {};          // name -> fn (edge-triggered actions)
    this.bindings = {
      KeyR: 'reload', KeyE: 'use', KeyF: 'alt', KeyQ: 'spot', KeyX: 'last', KeyL: 'deploy',
      Digit1: 'slot1', Digit2: 'slot2', Digit3: 'slot3', Digit4: 'slot4', Digit5: 'slot5', Digit6: 'slot6',
      Tab: 'score', Enter: 'chatTeam', KeyY: 'chatAll', KeyU: 'chatTeam', KeyV: 'ping', KeyM: 'bigmap', Escape: 'menu',
      Space: 'next', KeyG: 'freecam', KeyN: 'togglefog',
    };
    window.addEventListener('keydown', (e) => this.onKey(e, true));
    window.addEventListener('keyup', (e) => this.onKey(e, false));
    window.addEventListener('mousemove', (e) => { this.mx = e.clientX; this.my = e.clientY; });
    window.addEventListener('mousedown', (e) => this.onMouse(e, true));
    window.addEventListener('mouseup', (e) => this.onMouse(e, false));
    window.addEventListener('contextmenu', (e) => { if (this.enabled) e.preventDefault(); });
    window.addEventListener('wheel', (e) => { if (this.enabled) { this.fire('wheel', e.deltaY > 0 ? 1 : -1); } }, { passive: true });
    window.addEventListener('blur', () => { this.down.clear(); this.left = this.right = false; });
  }

  on(name, fn) { this.handlers[name] = fn; }
  fire(name, arg) { const h = this.handlers[name]; if (h) h(arg); }

  isTyping() {
    const a = document.activeElement;
    return a && (a.tagName === 'INPUT' || a.tagName === 'TEXTAREA' || a.tagName === 'SELECT' || a.isContentEditable);
  }

  onKey(e, down) {
    if (this.isTyping()) return;
    const code = e.code;
    if (down) {
      if (e.repeat) { if (this.enabled && (code in this.bindings || code.startsWith('Arrow') || code === 'Tab')) e.preventDefault(); return; }
      this.down.add(code);
      if (code === 'KeyE') this.pending |= KEY.USE;
      const act = this.bindings[code];
      if (act === 'menu') { this.fire('menu'); e.preventDefault(); return; }
      if (act === 'score') { e.preventDefault(); this.fire('score', true); return; }
      if (!this.enabled) return;
      if (act) { e.preventDefault(); this.fire(act, e); }
      else if (code.startsWith('Arrow') || code === 'Space') e.preventDefault();
    } else {
      this.down.delete(code);
      if (this.bindings[code] === 'score') { this.fire('score', false); }
      if (this.bindings[code] === 'use') this.fire('useUp');
    }
  }

  onMouse(e, down) {
    if (e.target !== this.canvas && !(e.target.closest && e.target.closest('#hud'))) {
      if (!down) { if (e.button === 0) this.left = false; if (e.button === 2) this.right = false; }
      return;
    }
    if (e.button === 0) { this.left = down; if (down && this.enabled) { this.pending |= KEY.FIRE; this.fire('click'); } }
    else if (e.button === 2) { this.right = down; if (down && this.enabled) this.pending |= KEY.SCOPE; }
    else if (e.button === 1 && down && this.enabled) { e.preventDefault(); this.fire('ping'); }
  }

  /** Movement / action bits for this tick. */
  keys() {
    if (!this.enabled) return 0;
    const d = this.down;
    let k = 0;
    if (d.has('KeyW') || d.has('ArrowUp')) k |= KEY.UP;
    if (d.has('KeyS') || d.has('ArrowDown')) k |= KEY.DOWN;
    if (d.has('KeyA') || d.has('ArrowLeft')) k |= KEY.LEFT;
    if (d.has('KeyD') || d.has('ArrowRight')) k |= KEY.RIGHT;
    if (d.has('KeyC') || d.has('ControlLeft')) k |= KEY.WALK;
    if (d.has('ShiftLeft') || d.has('ShiftRight')) k |= KEY.SPRINT;
    if (d.has('Space')) k |= KEY.BRAKE;
    if (d.has('KeyE')) k |= KEY.USE;
    if (this.left) k |= KEY.FIRE;
    if (this.right) k |= KEY.SCOPE;
    k |= this.pending;
    this.pending = 0;
    return k;
  }
}
