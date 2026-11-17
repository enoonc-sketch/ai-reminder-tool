// 两台设备（老人 + 家人，各一个 jsdom 页面）通过真实同步服务器：家人建提醒→老人收到；家人删除→老人删除；老人求助/未确认→家人看到。
// 需要 jsdom：npm i -D jsdom；运行 npm run test:e2e
const {JSDOM}=require('jsdom'),fs=require('fs'),os=require('os'),path=require('path'),{spawn}=require('child_process');
const html=fs.readFileSync(path.join(__dirname,'..','web','index.html'),'utf8'),PORT=18799,base='http://127.0.0.1:'+PORT;
const dataFile=path.join(os.tmpdir(),'ec-e2e-'+process.pid+'.json');
const srv=spawn(process.execPath,[path.join(__dirname,'..','server','server.js')],{env:{...process.env,PORT:String(PORT),DATA_FILE:dataFile},stdio:'ignore'});
const sleep=ms=>new Promise(r=>setTimeout(r,ms));let pass=0,fail=0;
const ok=(n,c)=>{c?pass++:fail++;console.log(c?'ok  ':'FAIL',n)};
function device(role){const dom=new JSDOM(html,{runScripts:'dangerously',pretendToBeVisual:true,url:'http://localhost/',beforeParse(w){
  w.speechSynthesis={cancel(){},speak(){}};w.SpeechSynthesisUtterance=function(){};w.alert=()=>{};w.confirm=()=>true;w.Notification={permission:'denied'};w.fetch=fetch;w.navigator.vibrate=()=>{}}});
 const w=dom.window;w.eval(`ST.role='${role}';ST.sv={url:'${base}',code:'',ts:0}`);return w}
(async()=>{
 for(let i=0;i<50;i++){try{await fetch(base+'/healthz');break}catch{await sleep(100)}}
 const elder=device('elder'),fam=device('family');
 const code=(await (await fetch(base+'/api/house',{method:'POST'})).json()).code;
 for(const w of[elder,fam])w.eval(`ST.sv.code='${code}'`);
 elder.eval("R=[];LG={};DEL=[]");fam.eval("R=[];LG={};DEL=[]");
 // family creates a reminder
 fam.eval(`R.push({id:'e2e-1',title:'吃药',time:'09:00',cat:'med',rep:{t:'daily'},start:ds(new Date()),upd:Date.now(),imp:true,from:0,paused:false,who:'女儿'})`);
 ok('family sync ok',await fam.eval('sync()'));
 ok('elder sync ok',await elder.eval('sync()'));
 ok('elder received family reminder',elder.eval("R.some(r=>r.id==='e2e-1'&&r.who==='女儿'&&r.imp===true)"));
 // elder marks it missed -> family sees log
 elder.eval("LG['e2e-1@2026-11-17']={rid:'e2e-1',title:'吃药',time:'09:00',date:'2026-11-17',st:'missed',ts:Date.now()}");
 await elder.eval('sync()');await fam.eval('sync()');
 ok('family sees elder missed log',fam.eval("LG['e2e-1@2026-11-17']&&LG['e2e-1@2026-11-17'].st")==='missed');
 // elder help call -> family banner
 elder.eval("help()");await sleep(300);await fam.eval('sync()');
 ok('family sees help call',fam.eval("Object.values(LG).some(x=>x.st==='help')"));
 // family edits then deletes -> elder removes
 fam.eval("R[0].title='吃降压药';R[0].upd=Date.now()");await fam.eval('sync()');await elder.eval('sync()');
 ok('edit propagates',elder.eval("R.find(r=>r.id==='e2e-1').title")==='吃降压药');
 await sleep(5);fam.eval("DEL.push({id:'e2e-1',upd:Date.now()});R=R.filter(r=>r.id!=='e2e-1')");await fam.eval('sync()');await elder.eval('sync()');
 ok('delete propagates',!elder.eval("R.some(r=>r.id==='e2e-1')"));
 // stale offline device tries to resurrect with older edit
 const resp=await (await fetch(base+'/api/sync',{method:'POST',headers:{'Content-Type':'application/json','X-Code':code},body:JSON.stringify({since:0,r:[{id:'e2e-1',title:'旧',time:'09:00',upd:1,rep:{t:'daily'}}],del:[],logs:{}})})).json();
 ok('stale copy not resurrected',!(resp.r||[]).some(r=>r.id==='e2e-1'));
 console.log(`\n${pass} passed, ${fail} failed`);srv.kill();try{fs.unlinkSync(dataFile)}catch{}process.exit(fail?1:0)})();
