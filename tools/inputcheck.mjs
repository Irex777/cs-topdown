// Regression checks for focus, overlays and short-lived input presses.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const listeners = new Map();
globalThis.window = { addEventListener(name, fn) { listeners.set(name, fn); } };
globalThis.document = { activeElement: null, addEventListener() {} };
// /bf/shared is an HTTP alias, so resolve that browser-only import for Node.
const source = (await readFile(new URL('../src/client/js/game/input.js', import.meta.url), 'utf8'))
  .replace("'../../shared/constants.js'", JSON.stringify(new URL('../src/shared/constants.js', import.meta.url).href));
const { Input } = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
const { KEY } = await import('../src/shared/constants.js');
const canvas = { requestPointerLock() {} };
const input = new Input(canvas);
input.enabled = true;
const key = (code) => ({ code, preventDefault() {}, repeat: false });
let reloads = 0;
input.on('reload', () => reloads++);

input.onKey(key('KeyW'), true);
assert.ok(input.keys() & KEY.UP);
document.activeElement = { tagName: 'INPUT' };
input.onKey(key('KeyW'), false);
document.activeElement = null;
assert.equal(input.keys(), 0, 'releasing movement while typing must stop movement');

input.onKey(key('KeyE'), true);
input.onKey(key('KeyE'), false);
assert.ok(input.keys() & KEY.USE, 'an interaction shorter than one tick must still arrive');
assert.equal(input.keys(), 0, 'short interaction must be consumed only once');

input.onKey(key('KeyE'), true);
input.left = input.right = true;
input.look.dx = 12;
listeners.get('blur')();
assert.equal(input.keys(), 0, 'blur must drop queued interactions and held buttons');
assert.deepEqual(input.takeLook(), { dx: 0, dy: 0 });

input.isBlocked = () => true;
input.onKey(key('KeyR'), true);
input.onKey(key('KeyE'), true);
input.onMouse({ target: canvas, button: 0 }, true);
listeners.get('wheel')({ deltaY: 1 });
assert.equal(reloads, 0, 'menus must suppress gameplay actions');
input.isBlocked = () => false;
assert.equal(input.keys(), 0, 'menu presses must not leak into the next gameplay tick');

input.adsToggle = true;
input.right = true;
input.reset();
assert.equal(input.right, false, 'opening an overlay must cancel toggle aim');

let captures = 0;
input.requestLock = () => captures++;
input.wantLock = () => true;
input.onMouse({ target: canvas, button: 0 }, true);
assert.equal(captures, 1);
assert.equal(input.keys() & KEY.FIRE, 0, 'capturing the mouse must not fire a shot');
input.locked = true;
input.onMouse({ target: canvas, button: 0 }, true);
input.onMouse({ target: canvas, button: 0 }, false);
assert.ok(input.keys() & KEY.FIRE, 'quick fire clicks must survive until a tick');
assert.equal(input.keys() & KEY.FIRE, 0);

console.log('Input focus, overlay, pointer capture and short-press regressions: ALL OK');
