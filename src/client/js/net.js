// WebSocket wrapper with auto-reconnect and simple event emitter.
export class Net {
  constructor() {
    this.ws = null;
    this.handlers = new Map();
    this.open = false;
    this.rtt = 0;
    this.queue = [];
    this.token = null;
    this.wantReconnect = true;
    this.retry = 0;
    this._pingTimer = 0;
  }

  on(type, fn) { (this.handlers.get(type) || this.handlers.set(type, []).get(type)).push(fn); return this; }
  off(type, fn) { const a = this.handlers.get(type); if (a) { const i = a.indexOf(fn); if (i >= 0) a.splice(i, 1); } }
  emit(type, msg) { const a = this.handlers.get(type); if (a) for (const fn of a) fn(msg); }

  connect() {
    return new Promise((resolve, reject) => {
      const proto = location.protocol === 'https:' ? 'wss' : 'ws';
      const ws = new WebSocket(`${proto}://${location.host}/ws`);
      this.ws = ws;
      let settled = false;
      ws.onopen = () => {
        this.open = true; this.retry = 0;
        for (const m of this.queue) ws.send(m);
        this.queue.length = 0;
        clearInterval(this._pingTimer);
        this._pingTimer = setInterval(() => this.ping(), 2000);
        this.ping();
        this.emit('open', {});
        if (!settled) { settled = true; resolve(); }
      };
      ws.onmessage = (e) => {
        let m;
        try { m = JSON.parse(e.data); } catch { return; }
        if (m.t === 'pong') { this.rtt = performance.now() - m.ts; this.send({ t: 'rtt', ms: Math.round(this.rtt) }); this.emit('rtt', this.rtt); return; }
        this.emit(m.k || m.t, m);
        this.emit('*', m);
      };
      ws.onclose = () => {
        this.open = false;
        clearInterval(this._pingTimer);
        this.emit('close', {});
        if (!settled) { settled = true; reject(new Error('connect failed')); }
        if (this.wantReconnect) {
          const wait = Math.min(4000, 400 * 2 ** this.retry++);
          setTimeout(() => this.connect().catch(() => {}), wait);
        }
      };
      ws.onerror = () => {};
    });
  }

  ping() { this.send({ t: 'pong', ts: performance.now() }); }

  send(obj) {
    const s = JSON.stringify(obj);
    if (this.open && this.ws.readyState === 1) this.ws.send(s);
    else if (obj.t !== 'in' && obj.t !== 'pong' && obj.t !== 'rtt') this.queue.push(s);
  }
}
