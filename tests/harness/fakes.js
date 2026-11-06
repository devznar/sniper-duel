// 브라우저 안에서 실행되는 가짜 환경 (page.addInitScript 로 페이지 스크립트보다 먼저 들어감).
// - 시간 가속(warp): performance.now / requestAnimationFrame / setTimeout 을 warp 배 빠르게
// - 가짜 PeerJS: 같은 브라우저 컨텍스트의 탭끼리 BroadcastChannel 로 연결 (실제 P2P 서버 X)
// - 가짜 Supabase: 점수 테이블은 localStorage, 열린 방(Presence)은 BroadcastChannel
// - 가짜 qrcode: QR에 들어간 주소를 window.__qrData 에 기록
// 이 함수는 직렬화되어 페이지로 전달되므로 바깥 변수를 참조하면 안 된다.
function installFakes(opts) {
  opts = opts || {};
  const W = opts.warp || 1;
  // 가짜들이 쓰는 타이머는 시간 가속의 영향을 받지 않는 원래 타이머
  const realSetTimeout = window.setTimeout.bind(window);
  const realClearTimeout = window.clearTimeout.bind(window);

  /* ---------------- 테스트 시작 시 localStorage 미리 채우기 (탭당 1회) ---------------- */
  if (opts.storage) {
    try {
      if (!sessionStorage.getItem('__sd_seeded')) {
        for (const [k, v] of Object.entries(opts.storage)) localStorage.setItem(k, JSON.stringify(v));
        sessionStorage.setItem('__sd_seeded', '1');
      }
    } catch (e) {}
  }

  /* ---------------- 시간 가속 ---------------- */
  if (W !== 1) {
    const realNow = performance.now.bind(performance);
    const base = realNow();
    performance.now = () => base + (realNow() - base) * W;
    const realRaf = window.requestAnimationFrame.bind(window);
    window.requestAnimationFrame = cb => realRaf(() => cb(performance.now()));
    window.setTimeout = (fn, ms, ...a) => realSetTimeout(fn, (ms || 0) / W, ...a);
  }

  /* ---------------- 대화상자 기록 (alert / confirm) ---------------- */
  window.__dialogs = [];
  window.alert = msg => { window.__dialogs.push({ type: 'alert', msg: String(msg) }); };
  window.confirm = msg => { window.__dialogs.push({ type: 'confirm', msg: String(msg) }); return opts.confirm !== false; };

  /* ---------------- 가짜 qrcode-generator ---------------- */
  if (opts.qr !== false) {
    window.__qrData = [];
    window.qrcode = function () {
      let data = '';
      return {
        addData(d) { data = d; },
        make() { window.__qrData.push(data); },
        createSvgTag() { return `<svg data-fake-qr="${encodeURIComponent(data)}" viewBox="0 0 10 10"></svg>`; },
      };
    };
  }

  /* ---------------- 가짜 PeerJS ---------------- */
  if (opts.peer !== false) {
    const BUS = 'fake-peerjs';
    const rid = () => Math.random().toString(36).slice(2, 10);
    const livePeers = new Set();
    class Emitter {
      constructor() { this._h = {}; }
      on(ev, fn) { (this._h[ev] = this._h[ev] || []).push(fn); return this; }
      _emit(ev, ...a) { for (const fn of (this._h[ev] || []).slice()) { try { fn(...a); } catch (e) { console.error(e); } } }
    }
    class FakeConn extends Emitter {
      constructor(owner, other, cid) { super(); this._owner = owner; this.peer = other; this._cid = cid; this.open = false; }
      send(data) {
        if (!this.open) return;
        this._owner._post({ k: 'data', to: this.peer, from: this._owner.id, cid: this._cid, data });
      }
      close() {
        if (!this.open) return;
        this.open = false;
        this._owner._post({ k: 'close', to: this.peer, from: this._owner.id, cid: this._cid });
        this._owner._conns.delete(this._cid);
        realSetTimeout(() => this._emit('close'), 0);
      }
      _remoteClosed() { if (!this.open) return; this.open = false; this._owner._conns.delete(this._cid); this._emit('close'); }
    }
    class FakePeer extends Emitter {
      constructor(id, options) {
        super();
        if (id && typeof id === 'object') { options = id; id = null; }
        this.id = id || ('peer-' + rid());
        this.open = false; this.destroyed = false; this.disconnected = false;
        this._conns = new Map();
        this._ch = new BroadcastChannel(BUS);
        this._ch.onmessage = e => this._onMsg(e.data);
        const nonce = rid();
        this._probe = nonce;
        this._post({ k: 'probe', id: this.id, nonce });
        // 같은 id 를 쓰는 탭이 없으면 open
        this._probeTimer = realSetTimeout(() => {
          if (this.destroyed) return;
          this._probe = null; this.open = true; livePeers.add(this);
          this._emit('open', this.id);
        }, 60);
      }
      _post(m) { if (!this.destroyed) this._ch.postMessage(m); }
      _onMsg(m) {
        if (this.destroyed || !m) return;
        if (m.k === 'probe') { if (this.open && m.id === this.id) this._post({ k: 'taken', nonce: m.nonce }); return; }
        if (m.k === 'taken') {
          if (m.nonce === this._probe) { realClearTimeout(this._probeTimer); this._probe = null; this._emit('error', { type: 'unavailable-id', message: 'ID taken' }); }
          return;
        }
        if (m.to !== this.id) return;
        if (m.k === 'connect') {
          if (!this.open) return;
          const conn = new FakeConn(this, m.from, m.cid);
          this._conns.set(m.cid, conn);
          this._emit('connection', conn);
          conn.open = true;
          this._post({ k: 'accept', to: m.from, from: this.id, cid: m.cid });
          realSetTimeout(() => conn._emit('open'), 0);
        } else if (m.k === 'accept') {
          const conn = this._conns.get(m.cid);
          if (!conn) return;
          realClearTimeout(conn._timer);
          conn.open = true; conn._emit('open');
        } else if (m.k === 'data') {
          const conn = this._conns.get(m.cid);
          if (conn && conn.open) conn._emit('data', m.data);
        } else if (m.k === 'close') {
          const conn = this._conns.get(m.cid);
          if (conn) conn._remoteClosed();
        }
      }
      connect(target) {
        const cid = rid();
        const conn = new FakeConn(this, target, cid);
        this._conns.set(cid, conn);
        this._post({ k: 'connect', to: target, from: this.id, cid });
        conn._timer = realSetTimeout(() => {
          if (conn.open || this.destroyed) return;
          this._conns.delete(cid);
          this._emit('error', { type: 'peer-unavailable', message: 'Could not connect to peer ' + target });
        }, 400);
        return conn;
      }
      reconnect() {}
      disconnect() { this.disconnected = true; }
      destroy() {
        if (this.destroyed) return;
        for (const c of Array.from(this._conns.values())) { try { c.close(); } catch (e) {} }
        this.destroyed = true; this.open = false; livePeers.delete(this);
        realClearTimeout(this._probeTimer);
        try { this._ch.close(); } catch (e) {}
      }
    }
    // 탭을 닫으면 상대에게 연결 끊김을 알림 (실제 PeerJS도 결국 close 이벤트가 옴)
    window.addEventListener('pagehide', () => { for (const p of Array.from(livePeers)) p.destroy(); });
    Object.defineProperty(window, 'Peer', { value: FakePeer, writable: true, configurable: true });
  }

  /* ---------------- 가짜 Supabase ---------------- */
  if (opts.supabase) {
    const sbOpts = opts.supabase === true ? {} : opts.supabase;
    const DB_KEY = '__fake_sb_scores';
    window.__sbCalls = [];
    const load = () => { try { return JSON.parse(localStorage.getItem(DB_KEY) || 'null'); } catch (e) { return null; } };
    const save = rows => localStorage.setItem(DB_KEY, JSON.stringify(rows));
    if (load() === null) {
      let id = 1;
      save((sbOpts.scores || []).map(r => Object.assign({ id: id++, hits: 0, fired: 0, heads: 0, best_streak: 0, mode: '', duration: 60, players: 1, created_at: '2026-01-02T03:04:05Z' }, r)));
    }
    const leaderboardTotal = () => {
      const m = new Map();
      for (const r of load()) {
        const a = m.get(r.name) || { name: r.name, total: 0, games: 0, best: 0, hits: 0, fired: 0 };
        a.total += r.score; a.games++; a.best = Math.max(a.best, r.score); a.hits += r.hits; a.fired += r.fired;
        m.set(r.name, a);
      }
      return Array.from(m.values());
    };
    const pick = (row, cols) => { if (!cols || cols === '*') return Object.assign({}, row); const o = {}; for (const c of cols.split(',')) o[c.trim()] = row[c.trim()]; return o; };
    class Query {
      constructor(table) { this.table = table; this.cols = '*'; this.ord = null; this.lim = null; this.ins = null; }
      select(cols) { this.cols = cols; return this; }
      order(col, o) { this.ord = { col, asc: !(o && o.ascending === false) }; return this; }
      limit(n) { this.lim = n; return this; }
      insert(row) { this.ins = row; return this; }
      _run() {
        window.__sbCalls.push({ table: this.table, op: this.ins ? 'insert' : 'select', row: this.ins, cols: this.cols });
        if (this.ins) {
          if (sbOpts.failInsert) return { data: null, error: { message: sbOpts.failInsert } };
          const rows = load(); const id = rows.reduce((a, r) => Math.max(a, r.id), 0) + 1;
          rows.push(Object.assign({ id, created_at: new Date().toISOString() }, this.ins)); save(rows);
          return { data: null, error: null };
        }
        if (sbOpts.failSelect) return { data: null, error: { message: sbOpts.failSelect } };
        let rows = this.table === 'leaderboard_total' ? leaderboardTotal() : load();
        if (this.ord) { const { col, asc } = this.ord; rows = rows.slice().sort((a, b) => (asc ? 1 : -1) * ((a[col] > b[col]) - (a[col] < b[col]))); }
        if (this.lim != null) rows = rows.slice(0, this.lim);
        return { data: rows.map(r => pick(r, this.cols)), error: null };
      }
      then(res, rej) { return new Promise(r => realSetTimeout(r, 5)).then(() => this._run()).then(res, rej); }
    }

    // Presence: 탭마다 key 하나, 같은 컨텍스트의 모든 탭이 BroadcastChannel 로 상태 공유
    const PBUS = 'fake-sb-presence';
    class FakeChannel {
      constructor(name, cfg) {
        this.name = name; this.key = (cfg && cfg.config && cfg.config.presence && cfg.config.presence.key) || Math.random().toString(36).slice(2);
        this.state = {}; this.syncFns = []; this.mine = null;
        this.bus = new BroadcastChannel(PBUS + ':' + name);
        this.bus.onmessage = e => this._onMsg(e.data);
        window.addEventListener('pagehide', () => { try { this.bus.postMessage({ k: 'leave', key: this.key }); } catch (e) {} });
      }
      on(type, filter, fn) { if (type === 'presence' && filter && filter.event === 'sync') this.syncFns.push(fn); return this; }
      subscribe(cb) {
        realSetTimeout(() => { this.bus.postMessage({ k: 'hello' }); cb && cb(sbOpts.presenceStatus || 'SUBSCRIBED'); }, 10);
        return this;
      }
      presenceState() { return JSON.parse(JSON.stringify(this.state)); }
      track(p) {
        window.__sbCalls.push({ op: 'track', payload: p });
        this.mine = p; this.state[this.key] = [p];
        this.bus.postMessage({ k: 'track', key: this.key, p });
        this._sync();
        return Promise.resolve('ok');
      }
      _onMsg(m) {
        if (m.k === 'hello') { if (this.mine) this.bus.postMessage({ k: 'track', key: this.key, p: this.mine }); return; }
        if (m.k === 'track') this.state[m.key] = [m.p];
        else if (m.k === 'leave') delete this.state[m.key];
        this._sync();
      }
      _sync() { realSetTimeout(() => { for (const fn of this.syncFns) fn(); }, 0); }
    }
    const client = { from: t => new Query(t), channel: (n, c) => new FakeChannel(n, c) };
    const lib = { createClient: (url, key, o) => { window.__sbCalls.push({ op: 'createClient', url, key }); return client; } };
    Object.defineProperty(window, 'supabase', { value: lib, writable: true, configurable: true });
  }
}

module.exports = { installFakes };
