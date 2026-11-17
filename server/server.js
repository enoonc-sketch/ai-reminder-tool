// EasyCare 家庭同步服务：零依赖，Node 18+。node server/server.js
// v1.4.0：修复坏 URL 会让进程崩溃、已删除提醒被旧设备复活；补字段校验、通知节流、反代 IP、按需落盘。
const http = require('http'), fs = require('fs'), path = require('path'), crypto = require('crypto');
const PORT = process.env.PORT || 8787;
const FILE = process.env.DATA_FILE || path.join(__dirname, 'data.json');
const WEB = path.join(__dirname, '..', 'web');
const ALLOW = (process.env.NOTIFY_ALLOW || 'https://ntfy.sh/').split(',').map(s => s.trim()).filter(Boolean);
const TRUST_PROXY = process.env.TRUST_PROXY === '1'; // 放在反向代理后面时设为 1，用 X-Forwarded-For 区分来访者
const AL = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ', DAY = 864e5;
const MAX_REM = 500, MAX_LOGS = 3000, MAX_BODY = 8e6, NOTIFY_GAP = 60e3;

let D = {};
try { D = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch {}
let dirty = false;
const save = () => { fs.writeFileSync(FILE + '.tmp', JSON.stringify(D)); fs.renameSync(FILE + '.tmp', FILE); dirty = false; };
const flush = () => { if (dirty) try { save(); } catch {} };
process.on('SIGTERM', () => { flush(); process.exit(0); });
process.on('SIGINT', () => { flush(); process.exit(0); });

const gen = () => Array.from(crypto.randomBytes(12), b => AL[b % 32]).join('');
const cut = (v, n) => String(v ?? '').slice(0, n);
const hits = new Map();
setInterval(() => { const now = Date.now(); for (const [k, v] of hits) if (!v.some(t => now - t < 36e5)) hits.delete(k); }, 6e5).unref();

const AUDIO = /^data:audio\/[\w.+-]+(;[\w.=+-]+)*;base64,[A-Za-z0-9+/=]+$/;
// 清洗一条提醒：长度、类别、时间格式、重复规则、录音格式都在服务端再核一次
function capR(x) {
  x.id = cut(x.id, 64).replace(/[^\w.-]/g, '');
  x.title = cut(x.title, 60); x.note = cut(x.note, 120); x.say = cut(x.say, 120); x.who = cut(x.who, 20);
  x.pre = Math.min(60, Math.max(0, +x.pre || 0));
  x.time = /^([01]\d|2[0-3]):[0-5]\d$/.test(x.time) ? x.time : '';
  x.upd = +x.upd || 0; x.from = +x.from || 0; x.paused = !!x.paused; x.imp = !!x.imp;
  x.start = /^\d{4}-\d\d-\d\d$/.test(x.start) ? x.start : '';
  const p = x.rep && typeof x.rep === 'object' ? x.rep : {};
  x.rep = { t: ['daily', 'weekly', 'custom', 'once'].includes(p.t) ? p.t : 'daily',
    days: (Array.isArray(p.days) ? p.days : []).map(Number).filter(n => n >= 0 && n < 7).slice(0, 7),
    every: Math.min(365, Math.max(1, +p.every || 1)), date: /^\d{4}-\d\d-\d\d$/.test(p.date) ? p.date : '' };
  if (typeof x.audio !== 'string' || x.audio.length > 1.3e6 || !AUDIO.test(x.audio)) x.audio = '';
  if (!['med', 'meal', 'move', 'life'].includes(x.cat)) x.cat = 'life';
  return x;
}
function capG(g) {
  g.rid = cut(g.rid, 64); g.title = cut(g.title, 60); g.note = cut(g.note, 60); g.time = cut(g.time, 5); g.date = cut(g.date, 10);
  g.ts = +g.ts || 0; g.until = +g.until || 0;
  if (!['done', 'missed', 'snoozed', 'help'].includes(g.st)) g.st = 'missed';
  return g;
}

// 只允许 ntfy 等白名单：按“来源 + 路径前缀”比对，避免 https://ntfy.sh.evil.com 这类写法绕过
function allowed(url) {
  let u; try { u = new URL(String(url)); } catch { return false; }
  if (!/^https?:$/.test(u.protocol)) return false;
  return ALLOW.some(a => { try { const b = new URL(a); return u.origin === b.origin && u.pathname.startsWith(b.pathname); } catch { return false; } });
}
function notify(h, msg) {
  if (!h.notify) return;
  const now = Date.now(); if (now - (h.lastNotify || 0) < NOTIFY_GAP) return; // 同一家庭 1 分钟内最多推一次
  h.lastNotify = now;
  fetch(h.notify, { method: 'POST', body: msg, headers: { Title: '=?UTF-8?B?' + Buffer.from('安心提醒').toString('base64') + '?=' } }).catch(() => {});
}

function route(q, b, send) {
  const u = new URL(q.url, 'http://x'), code = String(q.headers['x-code'] || '').toUpperCase(), now = Date.now();
  if (q.method === 'POST' && u.pathname === '/api/house') {
    const ip = (TRUST_PROXY && String(q.headers['x-forwarded-for'] || '').split(',')[0].trim()) || q.socket.remoteAddress;
    const n = (hits.get(ip) || []).filter(t => now - t < 36e5);
    if (n.length >= 20) return send(429, { error: '创建过于频繁' });
    n.push(now); hits.set(ip, n);
    const c = gen(); D[c] = { r: {}, del: {}, logs: {}, notify: '' }; dirty = true; save(); return send(200, { code: c });
  }
  const h = D[code];
  if (!h) return send(401, { error: '家庭码无效' });
  if (q.method === 'POST' && u.pathname === '/api/notify') {
    const { url } = JSON.parse(b || '{}');
    if (url && !allowed(url)) return send(400, { error: '通知地址不在允许范围' });
    h.notify = url || ''; dirty = true; save(); return send(200, { ok: 1 });
  }
  if (q.method === 'POST' && u.pathname === '/api/sync') {
    const j = JSON.parse(b || '{}'), since = +j.since || 0;
    if (!Array.isArray(j.r || [])) return send(400, { error: '请求格式错误' });
    for (const x of j.r || []) {
      if (!x || typeof x !== 'object') continue;
      capR(x);
      if (!x.id || !x.title || !x.time) continue;
      const tomb = h.del[x.id];
      if (tomb && tomb.upd >= x.upd) continue;               // 已被更晚的删除覆盖：旧设备不能把它复活
      if (!h.r[x.id] && Object.keys(h.r).length >= MAX_REM) continue;
      if (!h.r[x.id] || (h.r[x.id].upd || 0) < x.upd) { x._s = now; h.r[x.id] = x; delete h.del[x.id]; dirty = true; }
    }
    for (const x of Array.isArray(j.del) ? j.del : []) {
      if (!x || !x.id) continue; const id = cut(x.id, 64).replace(/[^\w.-]/g, ''), upd = +x.upd || now;
      if (!h.r[id] || (h.r[id].upd || 0) <= upd) { delete h.r[id]; h.del[id] = { upd, s: now }; dirty = true; }
    }
    for (const [k, g0] of Object.entries(j.logs && typeof j.logs === 'object' ? j.logs : {})) {
      if (!g0 || typeof g0 !== 'object') continue;
      const o = h.logs[k], g = capG(g0);
      if ((!o || o.ts < g.ts) && Object.keys(h.logs).length < MAX_LOGS + 1) {
        g._s = now; h.logs[cut(k, 80)] = g; dirty = true;
        if (g.st === 'help' && !o && g.ts > now - 10 * 6e4) notify(h, `${g.time} 老人在呼叫求助，请尽快联系`);
        if (g.st === 'missed' && (!o || o.st !== 'missed')) { const r = h.r[g.rid]; if (r && r.imp) notify(h, `${g.time} ${g.title} 还没有确认`); }
      }
    }
    for (const [k, g] of Object.entries(h.logs)) if (g.ts < now - 90 * DAY) { delete h.logs[k]; dirty = true; }
    for (const [k, d] of Object.entries(h.del)) if (d.s < now - 90 * DAY) { delete h.del[k]; dirty = true; }
    if (dirty) save();
    return send(200, { ts: now, r: Object.values(h.r).filter(x => x._s > since),
      del: Object.entries(h.del).filter(([, d]) => d.s > since).map(([id, d]) => ({ id, upd: d.upd })),
      logs: Object.fromEntries(Object.entries(h.logs).filter(([, g]) => g._s > since)) });
  }
  send(404, { error: 'not found' });
}

const MIME = { '.html': 'text/html;charset=utf-8', '.js': 'text/javascript', '.json': 'application/json', '.svg': 'image/svg+xml', '.png': 'image/png' };
http.createServer((q, s) => {
  const send = (c, o) => {
    s.writeHead(c, { 'Content-Type': 'application/json', 'Access-Control-Allow-Origin': '*', 'Access-Control-Allow-Headers': 'Content-Type,X-Code', 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS' });
    s.end(JSON.stringify(o));
  };
  try {
    if (q.method === 'OPTIONS') return send(200, {});
    if (q.url === '/healthz') return send(200, { ok: 1 });
    if (!q.url.startsWith('/api/')) {
      let p; try { p = decodeURIComponent(new URL(q.url, 'http://x').pathname); } catch { s.writeHead(400); return s.end('Bad request'); }
      if (p === '/') p = '/index.html';
      const f = path.join(WEB, path.normalize(p));
      if (p.includes('\0') || !f.startsWith(WEB + path.sep) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { s.writeHead(404); return s.end('Not found'); }
      s.writeHead(200, { 'Content-Type': MIME[path.extname(f)] || 'application/octet-stream', 'X-Content-Type-Options': 'nosniff' });
      return fs.createReadStream(f).pipe(s);
    }
    let b = '', over = false;
    q.on('data', d => { b += d; if (b.length > MAX_BODY && !over) { over = true; send(413, { error: '内容太大' }); q.destroy(); } });
    q.on('end', () => { if (over) return; try { route(q, b, send); } catch { send(400, { error: '请求格式错误' }); } });
  } catch { try { send(500, { error: '服务器出错' }); } catch {} }
}).listen(PORT, () => console.log('EasyCare server on :' + PORT));
