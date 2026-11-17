// EasyCare v1.4.0 tests: load the real web/index.html inline script in a
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
  setInterval: () => 0, setTimeout: (fn) => 0, clearInterval: () => {}, clearTimeout: () => {}, AbortController,
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
const code = m[1] + '\n;globalThis.__T={parseNL,due,clean,at,ds,ai,alertTextColor,cnNum,jparse,normTime,week,getR:()=>R,getST:()=>ST,getLG:()=>LG,setR:v=>{R=v},setLG:v=>{LG=v}};';
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


// --- v1.4.0: parseNL regressions (these were real bugs in v1.3.0) ---
const dow = (d) => new Date(d + 'T00:00').getDay();
o = T.parseNL('每周一九点吃药');
eq('v14 nl: 每周一九点 -> weekly Mon 09:00', o && [o.rep, o.days, o.time], ['weekly', [1], '09:00']);
o = T.parseNL('每周一三五早上八点散步');
eq('v14 nl: 每周一三五 -> days 1,3,5', o && [o.rep, o.days, o.time], ['weekly', [1, 3, 5], '08:00']);
o = T.parseNL('下周三十点去医院');
ok('v14 nl: 下周三十点 -> a Wednesday 10:00', o && o.time === '10:00' && dow(o.date) === 3);
o = T.parseNL('下周一十点去医院');
ok('v14 nl: 下周一 title keeps 去医院', o && o.title === '去医院' && dow(o.date) === 1);
eq('v14 nl: 二十三点半 -> 23:30', (T.parseNL('二十三点半休息') || {}).time, '23:30');
eq('v14 nl: 八点三十 -> 08:30', (T.parseNL('八点三十吃药') || {}).time, '08:30');
eq('v14 nl: 两点 recognised', (T.parseNL('下午两点复诊') || {}).time, '14:00');
eq('v14 nl: 晚上十二点 -> 00:00', (T.parseNL('晚上十二点睡觉') || {}).time, '00:00');
eq('v14 nl: 一起 not turned into 1起', (T.parseNL('一起去散步八点') || {}).title, '一起去散步');
eq('v14 nl: 10:30 digits', (T.parseNL('10:30吃药') || {}).time, '10:30');
eq('v14 nl: 明晚七点 -> 19:00 tomorrow', (T.parseNL('明晚七点打电话给女儿') || {}).time, '19:00');
eq('v14 nl: 工作日 -> Mon-Fri', (T.parseNL('工作日早上七点半吃药') || {}).days, [1, 2, 3, 4, 5]);
{ const before = Date.now(), r1 = T.parseNL('十五分钟后吃药'), want = new Date(before + 15 * 6e4);
  ok('v14 nl: 十五分钟后 -> about now+15min', r1 && Math.abs((+r1.time.slice(0, 2) * 60 + +r1.time.slice(3)) - (want.getHours() * 60 + want.getMinutes())) <= 1); }
{ const r2 = T.parseNL('提醒我晚点吃饭'); eq('v14 nl: no clock time -> null', r2, null); }
{ const n = new Date(), past = new Date(n.getTime() - 3600e3), hh = past.getHours(), r3 = T.parseNL(hh + ':' + pad2(past.getMinutes()) + '吃药');
  eq('v14 nl: time already passed today -> tomorrow', r3 && r3.date, ds(new Date(n.getTime() + 864e5))); }
eq('v14 cnNum: 二十三', T.cnNum('二十三'), 23); eq('v14 cnNum: 十五', T.cnNum('十五'), 15); eq('v14 cnNum: 两', T.cnNum('两'), 2);

// --- v1.4.0: safety / validation ---
ok('v14 clean: id with quote/space stripped (no HTML injection)', T.clean({ id: 'a" onmouseover="x', title: 't', time: '09:00' }).id === 'aonmouseoverx');
eq('v14 clean: audio with quote rejected', T.clean({ id: 'a', title: 't', time: '09:00', audio: 'data:audio/webm;base64,AAAA" onerror="x' }).audio, '');
eq('v14 clean: real recording format kept', T.clean({ id: 'a', title: 't', time: '09:00', audio: 'data:audio/webm;codecs=opus;base64,AAAA' }).audio, 'data:audio/webm;codecs=opus;base64,AAAA');
ok('v14 clean: 24:30 rejected', T.clean({ id: 'a', title: 't', time: '24:30' }) === null);
eq('v14 clean: keeps paused + from', (() => { const c = T.clean({ id: 'a', title: 't', time: '09:00', paused: 1, from: 123 }); return [c.paused, c.from]; })(), [true, 123]);
ok('v14 due: paused reminder never due', !T.due({ ...base, rep: { t: 'daily' }, paused: true }, monday));
eq('v14 jparse: JSON wrapped in chatter', T.jparse('好的，结果如下：{"a":1} 希望有帮助'), { a: 1 });
eq('v14 normTime: 9:5 -> 09:05', T.normTime('9:5'), '09:05'); eq('v14 normTime: 25:00 -> empty', T.normTime('25:00'), '');
{ const R0 = T.getR(); // 新建时已过去的时间不补响 / 不计入“未确认”
  const n = new Date(), t0 = new Date(n.getTime() - 3600e3), hhmm = pad2(t0.getHours()) + ':' + pad2(t0.getMinutes());
  if (ds(t0) === ds(n)) {
    T.setR([{ id: 'late', title: '新建', time: hhmm, cat: 'life', rep: { t: 'daily' }, start: ds(n), from: Date.now(), upd: 1 }]);
    const wk = T.week(); eq('v14 from: today not counted as missed for a just-created reminder', wk[wk.length - 1].t, 0);
    T.setR([{ id: 'late', title: '新建', time: hhmm, cat: 'life', rep: { t: 'daily' }, start: ds(n), from: 0, upd: 1 }]);
    ok('v14 from: without from the same reminder is counted today', T.week()[6].t === 1);
  } else { pass += 2; console.log('ok   (skipped near midnight)'); }
  T.setR(R0);
}
{ const es = fs.readFileSync(path.join(__dirname, '..', 'electron', 'main.js'), 'utf8');
  ok('v14 electron: close hides to tray instead of quitting', es.includes("e.preventDefault();win.hide()") && !es.includes("window-all-closed"));
  ok('v14 electron: login item only when packaged', es.includes("if(app.isPackaged)app.setLoginItemSettings"));
  ok('v14 electron: navigation locked to file:', es.includes("setWindowOpenHandler") && es.includes("will-navigate"));
  ok('v14 electron: preload exists', fs.existsSync(path.join(__dirname, '..', 'electron', 'preload.js')));
  const sw = fs.readFileSync(path.join(__dirname, '..', 'web', 'sw.js'), 'utf8');
  ok('v14 sw: network-first + skips /api/', sw.includes("fetch(r).then") && sw.includes("/api/"));
  const html2 = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
  ok('v14 ui: local repeat-toggle no longer shadows network sync()', !/const sync=\(\)=>\{const t=\$\('#f_rt'\)/.test(html2) && html2.includes('togRep'));
  ok('v14 ui: camera closed if alert dismissed before permission granted', html2.includes('camBusy') && html2.includes('if(!active){st.getTracks()'));
}

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
