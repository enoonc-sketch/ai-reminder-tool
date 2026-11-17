const {app,BrowserWindow,powerSaveBlocker,Tray,Menu,nativeImage,ipcMain}=require('electron'),path=require('path'),fs=require('fs'),{spawn}=require('child_process');
let llm=null,win=null,tray=null,quitting=false;const PORT=18080;
function startLLM(){const d=app.isPackaged?path.join(process.resourcesPath,'llm'):path.join(__dirname,'..','llm');
 try{const rel=fs.readFileSync(path.join(d,'server-path.txt'),'utf8').trim();
  if(path.isAbsolute(rel)||rel.split(path.sep).includes('..'))return false;
  const exe=path.join(d,rel),model=path.join(d,'model.gguf');
  if(!exe.startsWith(d+path.sep)||!fs.existsSync(exe)||!fs.existsSync(model))return false;
  llm=spawn(exe,['-m',model,'--host','127.0.0.1','--port',String(PORT),'-c','2048','-t','2'],{cwd:path.dirname(exe),stdio:'ignore',windowsHide:true});llm.on('error',()=>{llm=null});return true}catch{return false}}
app.on('quit',()=>{try{llm&&llm.kill()}catch{}});
app.commandLine.appendSwitch('autoplay-policy','no-user-gesture-required');
const showWin=()=>{if(!win)return;if(win.isMinimized())win.restore();win.show();win.focus()};
if(!app.requestSingleInstanceLock()){app.quit()}else{
 app.on('second-instance',showWin);
 app.on('before-quit',()=>{quitting=true});
 app.whenReady().then(()=>{powerSaveBlocker.start('prevent-app-suspension');
  win=new BrowserWindow({width:1120,height:800,minWidth:960,minHeight:640,title:'安心提醒 EasyCare',webPreferences:{backgroundThrottling:false,contextIsolation:true,sandbox:true,preload:path.join(__dirname,'preload.js')}});
  win.setMenuBarVisibility(false);
  win.loadFile(path.join(__dirname,'..','web','index.html'),startLLM()?{query:{llm:'http://127.0.0.1:'+PORT+'/v1'}}:{});
  // 本程序只加载本地页面：不允许跳转或新开窗口到别处
  win.webContents.setWindowOpenHandler(()=>({action:'deny'}));
  win.webContents.on('will-navigate',(e,url)=>{if(!url.startsWith('file:'))e.preventDefault()});
  win.webContents.session.setPermissionRequestHandler((_,p,cb)=>cb(['media','notifications'].includes(p)));
  // 关闭窗口只是收起到托盘：提醒软件一退出就不会响了。真正退出请用托盘菜单“退出”。
  win.on('close',e=>{if(!quitting){e.preventDefault();win.hide()}});
  try{tray=new Tray(nativeImage.createFromPath(path.join(__dirname,'..','web','icon-192.png')).resize({width:18,height:18}));
   tray.setToolTip('安心提醒（提醒在后台运行）');tray.on('click',showWin);
   tray.setContextMenu(Menu.buildFromTemplate([{label:'打开安心提醒',click:showWin},{label:'退出（退出后不再提醒）',click:()=>{quitting=true;app.quit()}}]))}catch{}
  ipcMain.on('ec-focus',showWin);
  app.on('activate',showWin);
  if(app.isPackaged)app.setLoginItemSettings({openAtLogin:true}); // 只有安装版才开机自启，开发时不往系统里登记
 });
}
