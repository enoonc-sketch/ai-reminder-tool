const {app,BrowserWindow,powerSaveBlocker}=require('electron'),path=require('path'),fs=require('fs'),{spawn}=require('child_process');
let llm=null;const PORT=18080;
function startLLM(){const d=app.isPackaged?path.join(process.resourcesPath,'llm'):path.join(__dirname,'..','llm');
 try{const rel=fs.readFileSync(path.join(d,'server-path.txt'),'utf8').trim();
  if(path.isAbsolute(rel)||rel.split(path.sep).includes('..'))return false;
  const exe=path.join(d,rel),model=path.join(d,'model.gguf');
  if(!exe.startsWith(d+path.sep)||!fs.existsSync(exe)||!fs.existsSync(model))return false;
  llm=spawn(exe,['-m',model,'--host','127.0.0.1','--port',String(PORT),'-c','2048','-t','2'],{cwd:path.dirname(exe),stdio:'ignore',windowsHide:true});llm.on('error',()=>{llm=null});return true}catch{return false}}
app.on('quit',()=>{try{llm&&llm.kill()}catch{}});
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
if(!app.requestSingleInstanceLock())app.quit();
app.whenReady().then(()=>{powerSaveBlocker.start('prevent-app-suspension');
 const w=new BrowserWindow({width:960,height:800,title:'安心提醒 EasyCare',webPreferences:{backgroundThrottling:false,contextIsolation:true}});
 w.setMenuBarVisibility(false);
 w.loadFile(path.join(__dirname,'..','web','index.html'),startLLM()?{query:{llm:'http://127.0.0.1:'+PORT+'/v1'}}:{});
 w.webContents.session.setPermissionRequestHandler((_,p,cb)=>cb(['media','notifications'].includes(p)));
 app.setLoginItemSettings({openAtLogin:true});});
app.on('window-all-closed',()=>app.quit());
