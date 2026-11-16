// EasyCare sync-server smoke test: starts server/server.js on a scratch
// port + scratch data file, exercises house creation, sync push/pull,
// wrong-code 401 and the notify allowlist. Run: node tests/server-test.js
const { spawn } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const PORT = 18788;
const dataFile = path.join(os.tmpdir(), 'easycare-server-test-' + process.pid + '.json');
const server = spawn(process.execPath, [path.join(__dirname, '..', 'server', 'server.js')], {
  env: { ...process.env, PORT: String(PORT), DATA_FILE: dataFile },
  stdio: ['ignore', 'pipe', 'pipe'],
});
let out = '';
server.stdout.on('data', (d) => { out += d; });
server.stderr.on('data', (d) => { out += d; });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
let pass = 0, fail = 0;
function check(name, cond, extra) {
  if (cond) { pass++; console.log('ok  ', name); }
  else { fail++; console.log('FAIL', name, extra || ''); }
}
async function main() {
  for (let i = 0; i < 50 && !out.includes('EasyCare server'); i++) await sleep(100);
  check('server starts', out.includes('EasyCare server on :' + PORT), out);
  const base = 'http://127.0.0.1:' + PORT;
  const get = await fetch(base + '/');
  check('GET / serves web', get.status === 200 && (await get.text()).includes('EasyCare'));
  const house = await (await fetch(base + '/api/house', { method: 'POST' })).json();
  check('house code issued', typeof house.code === 'string' && house.code.length === 12, JSON.stringify(house));
  const code = house.code;
  const push = await fetch(base + '/api/sync', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Code': code },
    body: JSON.stringify({ since: 0, r: [{ id: 't1', title: '吃药', time: '09:00', cat: 'med', rep: { t: 'daily' }, upd: 1, start: '2026-11-16' }], del: [], logs: {} }),
  });
  const pj = await push.json();
  check('sync push round-trips', pj.r && pj.r.some((r) => r.id === 't1'), JSON.stringify(pj));
  const wrong = await fetch(base + '/api/sync', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Code': 'WRONGCODE1234' },
    body: JSON.stringify({ since: 0 }),
  });
  check('wrong code -> 401', wrong.status === 401);
  const bad = await fetch(base + '/api/notify', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Code': code },
    body: JSON.stringify({ url: 'https://evil.example/x' }),
  });
  check('notify off-allowlist -> 400', bad.status === 400);
  const long = await fetch(base + '/api/sync', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Code': code },
    body: JSON.stringify({ since: 0, r: [{ id: 't2', title: '吃'.repeat(200), time: '10:00', cat: 'nope', note: 'n'.repeat(300), audio: 'https://evil/x.mp3', rep: { t: 'daily' }, upd: 2, start: '2026-11-16' }], del: [], logs: {} }),
  });
  const lj = await long.json();
  const t2 = (lj.r || []).find((r) => r.id === 't2');
  check('server truncates long title to 60', t2 && t2.title.length === 60, JSON.stringify(t2));
  check('server strips non-data audio', t2 && t2.audio === '');
  check('server fixes bad category to life', t2 && t2.cat === 'life');
  const help = await fetch(base + '/api/sync', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Code': code },
    body: JSON.stringify({ since: 0, r: [], del: [], logs: { 'help@1': { rid: 'help', title: '呼叫家人', time: '06:30', date: '2026-11-16', st: 'help', ts: Date.now() } } }),
  });
  const hj = await help.json();
  check('server keeps help call log', hj.logs && hj.logs['help@1'] && hj.logs['help@1'].st === 'help', JSON.stringify(hj.logs));
  const good = await fetch(base + '/api/notify', {
    method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Code': code },
    body: JSON.stringify({ url: 'https://ntfy.sh/easycare-test-topic' }),
  });
  check('notify ntfy -> ok', good.status === 200 && (await good.json()).ok === 1);
  console.log(`\n${pass} passed, ${fail} failed`);
  server.kill();
  try { fs.unlinkSync(dataFile); } catch {}
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('FAIL', e); server.kill(); process.exit(1); });
