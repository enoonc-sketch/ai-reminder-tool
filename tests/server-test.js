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
  // --- v1.4.0 ---
  const post = (code, body) => fetch(base + '/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Code': code }, body: JSON.stringify(body) }).then((r) => r.json());
  // 坏的百分号编码以前会让整个进程崩溃
  const badUrl = await fetch(base + '/%E0%A4%A').catch(() => null);
  check('bad %-encoding -> 400, not a crash', badUrl && badUrl.status === 400);
  const alive = await fetch(base + '/healthz').catch(() => null);
  check('server still alive after bad URL (healthz)', alive && alive.status === 200);
  // 删除后，旧设备带着更早的修改上来，不能把提醒复活
  const c2 = (await (await fetch(base + '/api/house', { method: 'POST' })).json()).code;
  const rem = (upd) => ({ id: 'z1', title: '吃药', time: '09:00', cat: 'med', rep: { t: 'daily' }, upd, start: '2026-11-16' });
  await post(c2, { since: 0, r: [rem(100)], del: [], logs: {} });
  await post(c2, { since: 0, r: [], del: [{ id: 'z1', upd: 200 }], logs: {} });
  const back = await post(c2, { since: 0, r: [rem(150)], del: [], logs: {} });
  check('deleted reminder is not resurrected by an older edit', !(back.r || []).some((r) => r.id === 'z1'), JSON.stringify(back.r));
  const newer = await post(c2, { since: 0, r: [rem(300)], del: [], logs: {} });
  check('a genuinely newer edit still wins over the delete', (newer.r || []).some((r) => r.id === 'z1'));
  // 字段校验
  const junk = await post(c2, { since: 0, r: [{ id: 'q"x y', title: 'a', time: '99:99', rep: { t: 'weird', days: [1, 99, 'x'] }, upd: 5 }, { id: 'ok2', title: 'b', time: '10:00', rep: { t: 'weekly', days: [1, 99, 'x', 3] }, upd: 5, audio: 'data:audio/webm;base64,AAA"x' }], del: [], logs: {} });
  check('invalid time dropped', !(junk.r || []).some((r) => r.title === 'a'));
  const ok2 = (junk.r || []).find((r) => r.id === 'ok2');
  check('rep.days sanitised to valid weekdays', ok2 && JSON.stringify(ok2.rep.days) === '[1,3]', JSON.stringify(ok2 && ok2.rep));
  check('audio with quote stripped', ok2 && ok2.audio === '');
  const junkLog = await post(c2, { since: 0, r: [], del: [], logs: { 'k1': { rid: 'z1', title: 't', time: '09:00', date: '2026-11-16', st: '<script>', ts: Date.now() } } });
  check('unknown log status coerced to missed', junkLog.logs && junkLog.logs.k1 && junkLog.logs.k1.st === 'missed');
  const bypass = await fetch(base + '/api/notify', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Code': c2 }, body: JSON.stringify({ url: 'https://ntfy.sh.evil.example/x' }) });
  check('notify lookalike host rejected', bypass.status === 400);
  const notURL = await fetch(base + '/api/notify', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Code': c2 }, body: JSON.stringify({ url: 'not a url' }) });
  check('notify garbage rejected', notURL.status === 400);
  const arr = await fetch(base + '/api/sync', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Code': c2 }, body: JSON.stringify({ r: { a: 1 } }) });
  check('non-array r -> 400 (no crash)', arr.status === 400);
  console.log(`\n${pass} passed, ${fail} failed`);
  server.kill();
  try { fs.unlinkSync(dataFile); } catch {}
  process.exit(fail ? 1 : 0);
}
main().catch((e) => { console.error('FAIL', e); server.kill(); process.exit(1); });
