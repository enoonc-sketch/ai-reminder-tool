// EasyCare 家庭同步服务：零依赖，Node 18+。node server/server.js
const http=require('http'),fs=require('fs'),path=require('path'),crypto=require('crypto');
const PORT=process.env.PORT||8787,F=process.env.DATA_FILE||path.join(__dirname,'data.json'),W=path.join(__dirname,'..','web'),
 ALLOW=(process.env.NOTIFY_ALLOW||'https://ntfy.sh/').split(','),AL='23456789ABCDEFGHJKLMNPQRSTUVWXYZ',DAY=864e5;
let D={};try{D=JSON.parse(fs.readFileSync(F,'utf8'))}catch{}
const save=()=>{fs.writeFileSync(F+'.tmp',JSON.stringify(D));fs.renameSync(F+'.tmp',F)};
const gen=()=>Array.from(crypto.randomBytes(12),b=>AL[b%32]).join(''),hits=new Map();
const cut=(v,n)=>String(v??'').slice(0,n);
function capR(x){x.id=cut(x.id,64);x.title=cut(x.title,60);x.note=cut(x.note,120);x.say=cut(x.say,120);x.who=cut(x.who,20);x.pre=Math.min(60,Math.max(0,+x.pre||0));if(typeof x.audio!=='string'||!x.audio.startsWith('data:audio'))x.audio='';if(!['med','meal','move','life'].includes(x.cat))x.cat='life';return x}
function capG(g){g.title=cut(g.title,60);g.note=cut(g.note,60);return g}
const MIME={'.html':'text/html;charset=utf-8','.js':'text/javascript','.json':'application/json','.svg':'image/svg+xml','.png':'image/png'};
function notify(h,msg){if(!h.notify)return;fetch(h.notify,{method:'POST',body:msg,headers:{Title:'=?UTF-8?B?'+Buffer.from('安心提醒').toString('base64')+'?='}}).catch(()=>{})}
function route(q,b,send){const u=new URL(q.url,'http://x'),code=String(q.headers['x-code']||'').toUpperCase(),now=Date.now();
 if(q.method==='POST'&&u.pathname==='/api/house'){const ip=q.socket.remoteAddress,n=(hits.get(ip)||[]).filter(t=>now-t<36e5);if(n.length>=20)return send(429,{error:'创建过于频繁'});n.push(now);hits.set(ip,n);
  const c=gen();D[c]={r:{},del:{},logs:{},notify:''};save();return send(200,{code:c})}
 const h=D[code];if(!h)return send(401,{error:'家庭码无效'});
 if(q.method==='POST'&&u.pathname==='/api/notify'){const{url}=JSON.parse(b||'{}');if(url&&!ALLOW.some(a=>String(url).startsWith(a)))return send(400,{error:'通知地址不在允许范围'});h.notify=url||'';save();return send(200,{ok:1})}
 if(q.method==='POST'&&u.pathname==='/api/sync'){const j=JSON.parse(b||'{}'),since=+j.since||0;
  for(const x of j.r||[]){if(x&&x.id&&x.title&&(!h.r[x.id]||(h.r[x.id].upd||0)<(+x.upd||0))){capR(x);x._s=now;h.r[x.id]=x;delete h.del[x.id]}}
  for(const x of j.del||[]){if(x&&x.id&&(!h.r[x.id]||(h.r[x.id].upd||0)<=(+x.upd||0))){delete h.r[x.id];h.del[x.id]={upd:+x.upd||now,s:now}}}
  for(const[k,g]of Object.entries(j.logs||{})){if(!g||typeof g!=='object')continue;const o=h.logs[k];if(!o||o.ts<g.ts){capG(g);g._s=now;h.logs[k]=g;
   if(g.st==='help'&&!o)notify(h,`${g.time} 老人在呼叫求助，请尽快联系`);
   if(g.st==='missed'&&(!o||o.st!=='missed')){const r=h.r[g.rid];if(r&&r.imp)notify(h,`${g.time} ${g.title} 还没有确认`)}}}
  for(const[k,g]of Object.entries(h.logs))if(g.ts<now-90*DAY)delete h.logs[k];save();
  return send(200,{ts:now,r:Object.values(h.r).filter(x=>x._s>since),del:Object.entries(h.del).filter(([,d])=>d.s>since).map(([id,d])=>({id,upd:d.upd})),logs:Object.fromEntries(Object.entries(h.logs).filter(([,g])=>g._s>since))})}
 send(404,{error:'not found'})}
http.createServer((q,s)=>{const send=(c,o)=>{s.writeHead(c,{'Content-Type':'application/json','Access-Control-Allow-Origin':'*','Access-Control-Allow-Headers':'Content-Type,X-Code','Access-Control-Allow-Methods':'GET,POST,OPTIONS'});s.end(JSON.stringify(o))};
 if(q.method==='OPTIONS')return send(200,{});
 if(!q.url.startsWith('/api/')){let p=decodeURIComponent(new URL(q.url,'http://x').pathname);if(p==='/')p='/index.html';const f=path.join(W,path.normalize(p));
  if(!f.startsWith(W+path.sep)||!fs.existsSync(f)||fs.statSync(f).isDirectory()){s.writeHead(404);return s.end('Not found')}s.writeHead(200,{'Content-Type':MIME[path.extname(f)]||'application/octet-stream'});return fs.createReadStream(f).pipe(s)}
 let b='';q.on('data',d=>{b+=d;if(b.length>8e6)q.destroy()});q.on('end',()=>{try{route(q,b,send)}catch{send(400,{error:'请求格式错误'})}})}).listen(PORT,()=>console.log('EasyCare server on :'+PORT));
