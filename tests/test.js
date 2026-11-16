// EasyCare v1.3.0 tests: load the real web/index.html inline script in a
// stubbed browser environment and exercise its real functions.
// Run: npm test   (node tests/test.js)
const fs = require('fs');
const path = require('path');
const vm = require('vm');

const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
const m = html.match(/<script>([\s\S]*)<\/script>/);
if (!m) { console.error('FAIL: no inline script found'); process.exit(1); }

function makeEl() {
  const el = {
    classList: { add() {}, remove() {}, toggle() {} },
    style: { setProperty() {}, display: '' },
    dataset: {},
    textContent: '', innerHTML: '', value: '', checked: false,
    querySelector() { return makeEl(); },
    querySelectorAll() { return []; },
    addEventListener() {}, click() {}, focus() {},
    getContext() { return { drawImage() {}, getImageData() { return { data: new Uint8Array(64 * 48 * 4) }; } }; },
  };
  return el;
}
const store = {};
const fetchCalls = [];
const sandbox = {
  console, URL, URLSearchParams,
  setInterval: () => 0, setTimeout: (fn) => 0, clearInterval: () => {},
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; },
  },
  document: {
    body: { className: '' },
    documentElement: { style: { setProperty() {} } },
    querySelector: () => makeEl(),
    querySelectorAll: () => [],
    createElement: () => makeEl(),
    addEventListener: () => {},
  },
  navigator: { userAgent: 'node-test', onLine: false },
  location: { protocol: 'file:', origin: '', search: '?llm=http://127.0.0.1:18080/v1' },
  window: {},
  Notification: { permission: 'default', requestPermission() {} },
  speechSynthesis: { cancel() {}, speak() {}, speaking: false },
  crypto: { randomUUID: () => 'test-uuid-' + Math.random().toString(36).slice(2, 8) },
  alert: () => {},
  fetch: async (url, opts) => {
    fetchCalls.push({ url, opts });
    return {
      ok: true, status: 200,
      json: async () => ({ choices: [{ message: { content: '{"title":"吃药","time":"09:00","cat":"med","rep":"daily"}' } }] }),
    };
  },
};
sandbox.window = sandbox;
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
const code = m[1] + '\n;globalThis.__T={parseNL,due,clean,at,ds,ai,alertTextColor,getR:()=>R,getST:()=>ST};';
vm.runInContext(code, sandbox, { filename: 'index-inline.js' });
const T = sandbox.__T;

let pass = 0, fail = 0;
function eq(name, got, want) {
  const g = JSON.stringify(got), w = JSON.stringify(want);
  if (g === w) { pass++; console.log('ok  ', name); }
  else { fail++; console.log('FAIL', name, 'got', g, 'want', w); }
}
function ok(name, cond) {
  if (cond) { pass++; console.log('ok  ', name); }
  else { fail++; console.log('FAIL', name); }
}
const pad2 = (n) => String(n).padStart(2, '0');
const ds = (d) => d.getFullYear() + '-' + pad2(d.getMonth() + 1) + '-' + pad2(d.getDate());
const tomorrow = new Date(); tomorrow.setDate(tomorrow.getDate() + 1);

// --- Round 1: seed data on first run ---
const R = T.getR();
eq('seed: 5 reminders on first run', R.length, 5);
eq('seed: times', R.map((r) => r.time), ['08:00', '09:00', '10:00', '12:00', '21:00']);
eq('seed: titles', R.map((r) => r.title), ['吃早餐', '吃药', '散步活动', '午餐时间', '准备休息']);
ok('seed: med is important', R.find((r) => r.id === 'seed-med').imp === true);
ok('seed: flag stored', store.ec_seeded === '1');

// --- Round 3: offline NL parsing ---
let o = T.parseNL('明天早上八点提醒我去医院');
eq('nl: tomorrow 08:00', o && o.time, '08:00');
eq('nl: tomorrow date', o && o.date, ds(tomorrow));
ok('nl: tomorrow title has 医院', o && o.title.includes('医院'));
o = T.parseNL('每天九点吃药');
eq('nl: daily 09:00', o && o.time, '09:00');
eq('nl: daily rep', o && o.rep, 'daily');
eq('nl: daily cat med', o && o.cat, 'med');
o = T.parseNL('今天下午三点半散步');
eq('nl: today 15:30', o && o.time, '15:30');
eq('nl: today cat move', o && o.cat, 'move');
o = T.parseNL('下周一十点去医院');
eq('nl: next monday 10:00', o && o.time, '10:00');
ok('nl: next monday is a Monday', new Date(o.date + 'T00:00').getDay() === 1);
o = T.parseNL('提醒我喝水');
eq('nl: no time -> null', o, null);
o = T.parseNL('后天晚上八点吃药');
eq('nl: day-after-tomorrow 20:00', o && o.time, '20:00');

// --- due() repeat logic ---
const base = { id: 'x', title: 't', time: '09:00', start: '2026-11-16' };
const monday = new Date('2026-11-16T00:00'); // 2026-11-16 is a Monday
const tuesday = new Date('2026-11-17T00:00');
ok('due: daily', T.due({ ...base, rep: { t: 'daily' } }, monday));
ok('due: weekly Mon', T.due({ ...base, rep: { t: 'weekly', days: [1] } }, monday));
ok('due: weekly not Tue', !T.due({ ...base, rep: { t: 'weekly', days: [1] } }, tuesday));
ok('due: once on date', T.due({ ...base, rep: { t: 'once', date: '2026-11-16' } }, monday));
ok('due: once not other day', !T.due({ ...base, rep: { t: 'once', date: '2026-11-16' } }, tuesday));
ok('due: custom every 2 days, day 0', T.due({ ...base, rep: { t: 'custom', every: 2 } }, monday));
ok('due: custom every 2 days, day 1 no', !T.due({ ...base, rep: { t: 'custom', every: 2 } }, tuesday));

// --- clean() validation ---
ok('clean: bad time -> null', T.clean({ id: 'a', title: 'x', time: '9am' }) === null);
ok('clean: missing title -> null', T.clean({ id: 'a', title: '', time: '09:00' }) === null);
const c = T.clean({ id: 'a', title: '吃药', time: '09:00', cat: 'med', audio: 'https://evil/x.mp3' });
eq('clean: strips non-data audio', c.audio, '');
eq('clean: keeps cat', c.cat, 'med');

// --- local LLM (v1.2.0): keyless, ?llm= param, json mode ---
(async () => {
  const out = await T.ai([{ role: 'user', content: 'hi' }], 300, true);
  eq('llm: ai() returns model content', out, '{"title":"吃药","time":"09:00","cat":"med","rep":"daily"}');
  const last = fetchCalls[fetchCalls.length - 1];
  eq('llm: posts to local server', last.url, 'http://127.0.0.1:18080/v1/chat/completions');
  const body = JSON.parse(last.opts.body);
  eq('llm: json mode requests json_object', body.response_format, { type: 'json_object' });
  ok('llm: keyless sends no Authorization header', !('Authorization' in last.opts.headers));
  eq('llm: local model name', body.model, 'local');

  // --- v1.3.0: pre-reminder + AAC phrases ---
  eq('v13: clean pre capped at 60', T.clean({ id: 'a', title: 'x', time: '09:00', pre: 99 }).pre, 60);
  eq('v13: clean pre kept', T.clean({ id: 'a', title: 'x', time: '09:00', pre: 15 }).pre, 15);
  eq('v13: clean pre defaults 0', T.clean({ id: 'a', title: 'x', time: '09:00' }).pre, 0);
  ok('v13: AAC default phrases', T.getST().phr && T.getST().phr.length === 8 && T.getST().phr[0] === '我要喝水');
  ok('v13: seed still loads with AAC code present', T.getR().length === 5);

  // --- alert contrast (v1.2.0): light backgrounds get dark text ---
  eq('alert: orange meal -> dark text', T.alertTextColor('#FF9F0A'), '#1D1D1F');
  eq('alert: red med -> white text', T.alertTextColor('#FF3B30'), '#fff');
  eq('alert: blue move -> white text', T.alertTextColor('#007AFF'), '#fff');
  eq('alert: purple life -> white text', T.alertTextColor('#5856D6'), '#fff');

  // --- get-llm.js only talks to official hosts ---
  const getLlm = fs.readFileSync(path.join(__dirname, '..', 'scripts', 'get-llm.js'), 'utf8');
  const hosts = [...new Set([...getLlm.matchAll(/https:\/\/([a-z0-9.-]+)/gi)].map((x) => x[1]))];
  eq('llm: get-llm.js hosts are official only', hosts.sort(), ['api.github.com', 'huggingface.co']);

  // --- electron guards ---
  const em = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  ok('llm: electron rejects absolute/.. server-path', em.includes("path.isAbsolute(rel)") && em.includes("'..'"));
  ok('llm: electron binds 127.0.0.1 only', em.includes("'127.0.0.1'"));
  ok('llm: electron has no blanket CORS *', !em.includes("Access-Control-Allow-Origin"));
  ok('llm: llm/ is gitignored', fs.readFileSync(path.join(__dirname, '..', '.gitignore'), 'utf8').includes('llm/'));

  console.log(`\n${pass} passed, ${fail} failed`);
  process.exit(fail ? 1 : 0);
})();
