// 下载“最小内置模型”到 ./llm：llama.cpp 的 llama-server + Qwen2.5-0.5B-Instruct (Q4_K_M, 约 0.4GB)
// 用法：node scripts/get-llm.js   （需联网，Node 18+，系统自带 tar；在要打包的目标系统上运行）
const fs=require('fs'),path=require('path'),{execFileSync}=require('child_process');
const OUT=path.join(__dirname,'..','llm'),MODEL_URL=process.env.MODEL_URL||'https://huggingface.co/Qwen/Qwen2.5-0.5B-Instruct-GGUF/resolve/main/qwen2.5-0.5b-instruct-q4_k_m.gguf';
const pat={win32:/bin-win-cpu-x64\.zip$/,darwin:process.arch==='arm64'?/bin-macos-arm64\.(zip|tar\.gz)$/:/bin-macos-x64\.(zip|tar\.gz)$/,linux:/bin-ubuntu-x64\.(zip|tar\.gz)$/}[process.platform];
const get=async(u,f)=>{const r=await fetch(u,{headers:{'User-Agent':'easycare'},redirect:'follow'});if(!r.ok)throw new Error(u+' -> '+r.status);const w=fs.createWriteStream(f);for await(const c of r.body)w.write(c);await new Promise(x=>w.end(x))};
const find=(d,n)=>{for(const e of fs.readdirSync(d,{withFileTypes:true})){const p=path.join(d,e.name);if(e.isDirectory()){const r=find(p,n);if(r)return r}else if(e.name===n)return p}};
(async()=>{fs.mkdirSync(OUT,{recursive:true});
 const rel=await(await fetch('https://api.github.com/repos/ggml-org/llama.cpp/releases/latest',{headers:{'User-Agent':'easycare'}})).json();
 const a=(rel.assets||[]).find(x=>pat&&pat.test(x.name));if(!a){console.error('未找到匹配的 llama.cpp 安装包，请手动下载 llama-server 放入 llm/bin，并把其路径写入 llm/server-path.txt。可用资源：\n'+(rel.assets||[]).map(x=>x.name).join('\n'));process.exit(1)}
 const z=path.join(OUT,a.name);console.log('下载',a.name);await get(a.browser_download_url,z);fs.mkdirSync(path.join(OUT,'bin'),{recursive:true});execFileSync('tar',['-xf',z,'-C',path.join(OUT,'bin')]);fs.unlinkSync(z);
 const exe=find(path.join(OUT,'bin'),process.platform==='win32'?'llama-server.exe':'llama-server');if(!exe)throw new Error('解压后没有找到 llama-server');
 if(process.platform!=='win32')fs.chmodSync(exe,0o755);fs.writeFileSync(path.join(OUT,'server-path.txt'),path.relative(OUT,exe));
 const m=path.join(OUT,'model.gguf');if(!fs.existsSync(m)){console.log('下载模型（约 0.4GB）');await get(MODEL_URL,m)}console.log('完成：',OUT)})().catch(e=>{console.error(e.message);process.exit(1)});
