// UI 集成测试：用 jsdom 加载真实 web/index.html，渲染全部页面并走一遍提醒流程。需要 jsdom：npm i -D jsdom；运行 npm run test:ui
const {JSDOM}=require('jsdom'),fs=require('fs');
const html=fs.readFileSync(require('path').join(__dirname,'..','web','index.html'),'utf8');
const errs=[];let now=Date.now();
const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'http://localhost/',beforeParse(w){
 w.addEventListener('error',e=>errs.push(e.message));
 w.speechSynthesis={cancel(){},speak(){},speaking:false};w.SpeechSynthesisUtterance=function(t){this.text=t};
 w.HTMLDialogElement&&(w.HTMLDialogElement.prototype.showModal=function(){this.open=true},w.HTMLDialogElement.prototype.close=function(){this.open=false});
 w.alert=()=>{};w.confirm=()=>true;w.Notification={permission:'denied'};w.fetch=async()=>({ok:false});
 w.navigator.vibrate=()=>{};
}});
const w=dom.window,d=w.document;
const ok=(n,c)=>console.log(c?'ok  ':'FAIL',n);
const sleep=ms=>new Promise(r=>setTimeout(r,ms));
(async()=>{
 await sleep(200);
 ok('no startup errors',errs.length===0||(console.log(errs),false));
 // render every view
 for(const v of ['today','aac','edit','more','family','log','set']){
  try{w.eval(`view='${v}';editId=null;render()`);ok('render '+v+' ('+d.querySelector('#app').innerHTML.length+' chars)',d.querySelector('#app').innerHTML.length>100)}catch(e){ok('render '+v+' '+e.message,false)}}
 w.eval("view='today';render()");
 ok('today shows countdown span',!!d.querySelector('#cd'));
 console.log('  countdown text:',d.querySelector('#cd')&&d.querySelector('#cd').textContent);
 // pause one reminder -> appears in paused section, not due
 w.eval("R[0].paused=true;render()");
 ok('paused section rendered',/已暂停的提醒/.test(d.querySelector('#app').innerHTML));
 w.eval("R[0].paused=false;render()");
 // alert flow: make a reminder due right now
 const t=new Date(),hhmm=String(t.getHours()).padStart(2,'0')+':'+String(t.getMinutes()).padStart(2,'0');
 w.eval(`R=[{id:'a1',title:'吃药',time:'${hhmm}',cat:'med',rep:{t:'daily'},start:ds(new Date()),upd:1,from:0,imp:true}];LG={};render();tick()`);
 ok('alert becomes active',w.eval('!!active')&&d.querySelector('#alert').classList.contains('on'));
 ok('alert shows title',d.querySelector('#alert .ti').textContent==='吃药');
 d.querySelector('#sn').click();
 ok('snooze logs snoozed',w.eval("Object.values(LG)[0].st")==='snoozed'&&!w.eval('active'));
 w.eval("Object.values(LG)[0].until=Date.now()-1;tick()");
 ok('snooze expiry re-fires',w.eval('!!active'));
 d.querySelector('#ok').click();
 ok('done logs done',w.eval("Object.values(LG)[0].st")==='done'&&!w.eval('active'));
 // timeout -> missed
 w.eval(`LG={};tick()`);w.eval("active.t0=Date.now()-16*6e4;tick()");
 ok('timeout logs missed',w.eval("Object.values(LG)[0].st")==='missed'&&!w.eval('active'));
 // from: just-created past reminder does not fire
 const p=new Date(Date.now()-36e5),ph=String(p.getHours()).padStart(2,'0')+':'+String(p.getMinutes()).padStart(2,'0');
 if(p.getDate()===t.getDate()){w.eval(`R=[{id:'a2',title:'新',time:'${ph}',cat:'life',rep:{t:'daily'},start:ds(new Date()),upd:1,from:Date.now()}];LG={};tick()`);ok('from: past time does not fire',!w.eval('active')&&Object.keys(w.eval('LG')).length===0)}
 // save form: open add page, fill, save
 w.eval("R=[];LG={};view='edit';editId=null;render()");
 d.querySelector('#f_title').value='测试提醒';d.querySelector('#f_time').value='23:59';
 d.querySelector('#f_save').click();await sleep(50);
 ok('save adds reminder',w.eval('R.length')===1&&w.eval('R[0].title')==='测试提醒'&&w.eval('R[0].from')>0);
 // NL fill uses offline parser
 w.eval("view='edit';editId=null;render()");d.querySelector('#nl').value='每周一三五早上八点散步';d.querySelector('#nl_go').click();await sleep(50);
 ok('NL fill sets weekly days',d.querySelector('#f_rt').value==='weekly'&&[...d.querySelectorAll('#f_days input')].filter(c=>c.checked).map(c=>c.value).join()==='1,3,5');
 // XSS id attempt
 w.eval(`R=[{id:'x" onmouseover="alert(1)',title:'t',time:'09:00',cat:'life',rep:{t:'daily'},start:ds(new Date()),upd:1}];view='today';render()`);
 ok('raw id never becomes attribute injection',!d.querySelector('[onmouseover]'));


 // --- v1.4.0 round 2: sweep / focus lock / backup restore ---
 {const old=new Date(Date.now()-10*864e5),rec=new Date(Date.now()-2*864e5),f=x=>x.getFullYear()+'-'+String(x.getMonth()+1).padStart(2,'0')+'-'+String(x.getDate()).padStart(2,'0');
  w.eval(`R=[{id:'o1',title:'旧',time:'09:00',cat:'life',rep:{t:'once',date:'${f(old)}'},start:'${f(old)}',upd:1},{id:'o2',title:'近',time:'09:00',cat:'life',rep:{t:'once',date:'${f(rec)}'},start:'${f(rec)}',upd:1},{id:'o3',title:'每天',time:'09:00',cat:'life',rep:{t:'daily'},start:'${f(old)}',upd:1}];DEL=[];`);
  const n=w.eval('sweep()');
  ok('sweep removes only once-reminders older than 7 days',n===1&&w.eval("R.map(r=>r.id).join()")==='o2,o3');
  ok('sweep leaves a delete marker for sync',w.eval("DEL.some(x=>x.id==='o1')"))}
 {const t=new Date(),hhmm=String(t.getHours()).padStart(2,'0')+':'+String(t.getMinutes()).padStart(2,'0');
  w.eval(`R=[{id:'f1',title:'吃药',time:'${hhmm}',cat:'med',rep:{t:'daily'},start:ds(new Date()),upd:1,from:0}];LG={};view='today';render();tick()`);
  ok('alert makes page behind it inert',w.eval("!!active")&&d.querySelector('#app').inert===true&&d.querySelector('nav').inert===true);
  ok('focus starts on the done button',d.activeElement===d.querySelector('#ok'));
  const tab=(sh)=>d.dispatchEvent(new w.KeyboardEvent('keydown',{key:'Tab',shiftKey:sh,bubbles:true,cancelable:true}));
  tab(false);ok('Tab moves to snooze',d.activeElement===d.querySelector('#sn'));
  tab(false);ok('Tab wraps back to done (focus trapped)',d.activeElement===d.querySelector('#ok'));
  tab(true);ok('Shift+Tab goes back to snooze',d.activeElement===d.querySelector('#sn'));
  d.querySelector('#ok').click();
  ok('closing alert restores the page',d.querySelector('#app').inert===false&&d.querySelector('nav').inert===false)}
 {w.eval(`R=[{id:'b1',title:'备份提醒',time:'09:00',cat:'med',rep:{t:'daily'},start:ds(new Date()),upd:1}];FM=[{id:'fm1',name:'女儿',phone:'123'}];LG={'b1@2026-11-16':{rid:'b1',title:'备份提醒',time:'09:00',date:'2026-11-16',st:'done',ts:5}};ST.vol=0.3;ST.pin='4321';ST.ai.url='http://x/v1';`);
  const bak=JSON.parse(w.eval("JSON.stringify({v:2,r:R,fam:FM,log:LG,del:DEL,set:ST})"));
  w.eval("R=[];FM=[];LG={};ST.vol=1;ST.pin='';ST.ai.url=''");
  const only=w.eval(`importData(${JSON.stringify(bak)},false)`);
  ok('plain import merges reminders but not settings',only.n===1&&!only.full&&w.eval("ST.vol")===1&&w.eval("ST.pin")==='');
  w.eval("R=[];FM=[];");
  const r2=w.eval(`importData(${JSON.stringify(bak)},true)`);
  ok('full restore brings back settings, log and family',r2.full&&w.eval("ST.vol")===0.3&&w.eval("ST.pin")==='4321'&&w.eval("ST.ai.url")==='http://x/v1'&&w.eval("Object.keys(LG).length")===1&&w.eval("FM.length")===1);
  const evil=w.eval(`importData(${JSON.stringify({v:2,r:[],set:{vol:'x',phr:'nope',ai:{url:{a:1}},sv:'str',__proto__:{polluted:1}}})},true)`);
  ok('hostile backup cannot put a string into a numeric setting',evil.full&&w.eval("typeof ST.vol")==='number');
  w.eval("ST.vol=0.5");w.eval(`importData(${JSON.stringify({v:2,r:[],set:{vol:99,gap:-5,qs:'25:99',role:'admin',pin:'12ab'}})},true)`);
  ok('numeric settings are clamped, bad strings ignored',w.eval("ST.vol")===1&&w.eval("ST.gap")===1&&w.eval("ST.qs")!=='25:99'&&w.eval("ST.role")!=='admin'&&w.eval("ST.pin")!=='12ab');
  ok('settings arrays stay arrays after hostile backup',w.eval("Array.isArray(ST.phr)&&typeof ST.ai.url==='string'&&typeof ST.sv.url==='string'"))}
 // --- camera race: alert dismissed before the permission prompt is answered ---
 {let stopped=0,resolveGum;w.navigator.mediaDevices={getUserMedia:()=>new Promise(r=>{resolveGum=()=>r({getTracks:()=>[{stop(){stopped++}}]})})};
  w.eval(`ST.cam=true;R=[{id:'c1',title:'t',time:'00:00',cat:'life',rep:{t:'daily'},start:ds(new Date()),upd:1}];LG={};camStart()`);
  w.eval(`active={r:R[0],k:'c1@x',t0:Date.now(),last:Date.now()}`);w.eval("close('done')");resolveGum();await sleep(20);
  ok('camera stream stopped when alert already closed',stopped===1&&w.eval('cam')===null)}
 ok('no runtime errors overall',errs.length===0||(console.log(errs),false));
 process.exit(0)})();
