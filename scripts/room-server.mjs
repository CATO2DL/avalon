import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { networkInterfaces } from 'node:os';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { existsSync } from 'node:fs';
import { AIRuntime } from './ai-runtime.mjs';
import { providerRegistry } from './ai-providers.mjs';
import { RoomStore } from './room-store.mjs';
import { RoomError, record, configOptions } from '../src/rooms.ts';
import { RuleError } from '../src/errors.ts';
import { roleAssetFiles } from '../web/asset-map.js';
const files=new Map([
  ['/', ['web/index.html','text/html; charset=utf-8']],
  ...['app.js','config-form.js','multiplayer.js','asset-map.js','ui.js','layout.js','history.js'].map(n=>[`/${n}`,[`web/${n}`,'text/javascript; charset=utf-8']]),
  ['/style.css',['web/style.css','text/css; charset=utf-8']],
  ...roleAssetFiles.map(n=>[`/assets/roles/${n}`,[`.local/web-assets/roles/${n}`,'image/webp']]),
]);
export function lanAddresses(){return Object.entries(networkInterfaces()).sort(([a],[b])=>(a==='en0'?-1:b==='en0'?1:a.localeCompare(b))).flatMap(([,items])=>items.filter(x=>x.family==='IPv4'&&!x.internal).map(x=>x.address));}
async function qrCode(url){
  const candidates=[new URL('../.local/toolchain/node_modules/qrcode/lib/index.js',import.meta.url)];
  const path=candidates.find(existsSync);if(!path)throw new RoomError('QR_DEPENDENCY_MISSING');
  const qr=(await import(path.href)).default;return qr.toString(url,{type:'svg',margin:4,errorCorrectionLevel:'M'});
}
export function createRoomServer({dbPath=fileURLToPath(new URL('../.local/multiplayer/rooms.sqlite',import.meta.url)),lan=false,publicOrigin=null,clock=Date.now,aiAdapter=null,aiOptions={}}={}){
  const store=new RoomStore(dbPath,clock);store.cleanup();
  const ai=new AIRuntime(store,aiAdapter,aiOptions);ai.start();
  const addresses=lanAddresses();const ips=['127.0.0.1','localhost',...(lan?addresses:[])];
  if(publicOrigin){const u=new URL(publicOrigin);if(!['http:','https:'].includes(u.protocol)||u.username||u.password||u.pathname!=='/'||u.search||u.hash)throw new Error('Invalid PUBLIC_ORIGIN');}
  const rates=new Map();const clean=setInterval(()=>{store.cleanup();rates.clear();},3600000);clean.unref();
  const server=createServer(async(req,res)=>{
    const send=(status,body,type='application/json; charset=utf-8')=>{
      res.writeHead(status,{'Content-Type':type,'Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'no-referrer','Cross-Origin-Resource-Policy':'same-origin',
        'Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'none'"});
      res.end(type.startsWith('application/json')?JSON.stringify(body):body);
    };
    try{
      const port=req.socket.localPort, origins=ips.map(ip=>`http://${ip}:${port}`);if(publicOrigin)origins.push(new URL(publicOrigin).origin);
      const origin=`http://${req.headers.host}`;
      if(!origins.includes(origin))return send(403,{error:'INVALID_HOST'});
      if((req.headers.origin&&req.headers.origin!==origin)||req.headers['sec-fetch-site']==='cross-site')return send(403,{error:'INVALID_ORIGIN'});
      const url=new URL(req.url,origin), path=url.pathname;
      if(req.method==='GET'&&files.has(path)){
        const [file,type]=files.get(path);let content;
        try{content=await readFile(new URL(`../${file}`,import.meta.url));}catch(e){if(e.code==='ENOENT')return send(404,{error:'ASSET_MISSING'});throw e;}
        if(path==='/')content=content.toString().replace('<body>','<body data-multiplayer="true">');
        return send(200,content,type);
      }
      const cookie=`avalon_room_${port}`,raw=req.headers.cookie?.split(';').map(x=>x.trim()).find(x=>x.startsWith(`${cookie}=`))?.slice(cookie.length+1);
      let session=store.session(raw);
      const inviteOrigin=(publicOrigin?new URL(publicOrigin).origin:lan&&addresses.length?`http://${addresses[0]}:${port}`:origin);
      if(req.method==='GET'&&path==='/api/session'){
        if(!session){
          const key=req.socket.remoteAddress,entry=rates.get(key)??{time:clock(),n:0};if(clock()-entry.time>60000){entry.time=clock();entry.n=0;}entry.n++;rates.set(key,entry);
          if(entry.n>100)return send(429,{error:'RATE_LIMIT'});
          const token=store.newSession();session=store.session(token);res.setHeader('Set-Cookie',`${cookie}=${token}; HttpOnly; SameSite=Strict; Path=/; Max-Age=31536000`);
        }
        store.touch(session);return send(200,{rooms:store.list(session),configOptions:configOptions(),inviteOrigin,lanEnabled:lan,aiAvailable:!!aiAdapter&&aiAdapter.available!==false,aiProfiles:aiAdapter?.profiles??[]});
      }
      const match=path.match(/^\/api\/rooms\/([A-F0-9]{10})(?:\/(public|qr))?$/);
      if(req.method==='GET'&&match?.[2]==='public')return send(200,store.snapshot(match[1],null));
      if(!session)return send(401,{error:'SESSION_REQUIRED'});
      if(req.method==='GET'&&match){
        const snapshot=store.snapshot(match[1],session);
        if(match[2]==='qr'&&!lan)return send(409,{error:'LAN_REQUIRED'});
        if(match[2]==='qr')return send(200,await qrCode(`${inviteOrigin}/?room=${match[1]}`),'image/svg+xml');
        return send(200,{...snapshot,inviteUrl:lan?`${inviteOrigin}/?room=${match[1]}`:null});
      }
      if(req.method!=='POST'||!(path==='/api/rooms'||(match&&!match[2])))return send(404,{error:'NOT_FOUND'});
      if(req.headers['content-type']!=='application/json')return send(415,{error:'JSON_REQUIRED'});
      let body='';for await(const chunk of req){body+=chunk;if(body.length>8192)return send(413,{error:'BODY_TOO_LARGE'});}
      let input;try{input=record(JSON.parse(body));}catch{return send(400,{error:'INVALID_REQUEST'});}
      if(path==='/api/rooms'&&input.type!=='create'||match&&input.type==='create')return send(400,{error:'INVALID_REQUEST'});
      const receipt=store.execute(session,match?.[1]??null,input);
      return send(200,{ok:true,...receipt});
    }catch(e){
      if(e instanceof RoomError||e instanceof RuleError)return send(['ROOM_ACCESS_DENIED','HOST_REQUIRED'].includes(e.message)?403:409,{error:e.message});
      // Do not include request body, cookies, SQLite rows or error internals in logs/responses.
      console.error('ROOM_SERVER_ERROR');return send(500,{error:'SERVER_ERROR'});
    }
  });
  server.requestTimeout=10000;server.headersTimeout=10000;
  server.on('close',()=>{clearInterval(clean);ai.close();store.close();});
  return server;
}
if(process.argv[1]&&import.meta.url===pathToFileURL(process.argv[1]).href){
  process.umask(0o077);
  const port=Number(process.env.PORT??4180),lan=process.argv.includes('--lan');
  if(!Number.isInteger(port)||port<1||port>65535)throw new Error('Invalid PORT');
  const server=createRoomServer({lan,aiAdapter:providerRegistry(),aiOptions:{maxCalls:process.env.AI_MAX_CALLS_PER_GAME,minInterval:process.env.AI_MIN_INTERVAL_MS},...(process.env.AVALON_DB?{dbPath:process.env.AVALON_DB}:{}),...(process.env.PUBLIC_ORIGIN?{publicOrigin:process.env.PUBLIC_ORIGIN}:{})});
  server.on('error',e=>{console.error(e.code??'LISTEN_FAILED');process.exitCode=1;});
  server.listen(port,lan?'0.0.0.0':'127.0.0.1',()=>{
    console.log(`阿瓦隆真人联机： http://127.0.0.1:${port}/`);
    console.log(lan?lanAddresses().map(ip=>`同一 Wi-Fi 的电脑/手机统一打开：http://${ip}:${port}/`).join('\n')||'未检测到局域网IPv4；连接Wi-Fi后重新启动。':'仅本机。手机联机请运行 npm run lan。');
    console.log('建房 → 分享房间二维码/邀请链接 → 各自认领座位并准备 → 房主开始。电脑房主也请使用同一局域网地址，避免更换域名丢失Cookie会话。');
  });
  for(const signal of ['SIGINT','SIGTERM'])process.on(signal,()=>{server.close();server.closeIdleConnections();});
}
