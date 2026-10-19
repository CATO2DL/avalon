import { el,button,avatar } from './ui.js';
import { roleAssets } from './asset-map.js';
export const requestId=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
const $=id=>document.getElementById(id);
const messages={GAME_NOT_FINISHED:'请先完成当前对局',MEMBER_IN_OTHER_ROOM:'有玩家已进入其他房间，请先让其离开该房间',AI_NOT_CONFIGURED:'尚未配置 Gemini 新密钥，请由房主在电脑 .env 填写并重启服务',AI_RETRY_LIMIT:'本次重试或本局调用额度已用完',DISCUSSION_PENDING:'请先完成本轮发言',NOT_YOUR_TURN:'还没轮到你发言',INVALID_SPEECH:'发言请控制在500字内',ROOM_FULL:'房间已满',ROOM_STARTED:'对局已经开始，不能加入',ROOM_NOT_FOUND:'找不到这个房间',ROOM_ACCESS_DENIED:'这个会话不属于该房间',HOST_REQUIRED:'只有房主可以操作',SEAT_TAKEN:'这个座位刚被占用，请选择其他座位',STALE_ROOM:'房间状态已变化，请重新确认',STALE_CONFIG:'配置已变化，请重新准备',NOT_ALL_READY:'请等所有玩家入座并准备',OCCUPIED_SEATS:'请先释放超出新人数的座位',INVALID_CONFIG:'角色配置不合法',INVALID_NAME:'昵称需为1–20个字符',ACTIVE_ROOM_EXISTS:'你已有进行中的房间，请返回原房间',REVEAL_PENDING:'请等待身份揭晓',STALE_ROUND:'阶段已变化，请确认当前操作',ALREADY_SUBMITTED:'你已提交过本轮行动',SESSION_REQUIRED:'会话已失效；无法凭昵称恢复原座位',ROOM_TERMINATED:'房间已终止',REQUEST_ID_REUSED:'请求编号冲突，请刷新',NOT_PLAYING:'当前还不能行动'};
export function createMultiplayer({receive,openPanel,closePanel,showIdentity,rulesPanel,catalogue}){
  const screen=el('section','room-screen');screen.id='room-screen';document.querySelector('.screen-layout').before(screen);
  let boot,current,code=new URLSearchParams(location.search).get('room')?.toUpperCase()??localStorage.getItem('avalon-last-room'),connected=false,pending=false,polling=false,signature='',identityOpened=false;
  let chatPanel=false,chatSignature='',chatDraft='';
  let joinTarget=null,recovered=false;const storageKey='avalon-pending-request';
  async function request(path,body){
    const response=await fetch(path,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(7000),...(body?{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)}:{})});
    const data=await response.json();if(!response.ok){const e=new Error(data.error);e.confirmed=true;throw e;}return data;
  }
  function error(e){$('error').hidden=false;$('error').textContent=messages[e.message]??(e.confirmed?`操作未成功：${e.message}`:'连接中断，正在重连；已提交操作会用原请求编号重试。');}
  function remember(next){code=next;joinTarget=null;localStorage.setItem('avalon-last-room',code);history.replaceState(null,'',`/?room=${code}`);signature='';}
  function home(){code=null;current=null;signature='';localStorage.removeItem('avalon-last-room');history.replaceState(null,'','/');receive(null);renderHome();}
  function lock(){for(const b of document.querySelectorAll('#actions button,#room-screen button'))b.disabled=true;}
  async function command(payload,path=code?`/api/rooms/${code}`:'/api/rooms'){
    if(pending)return;pending=true;lock();$('error').hidden=true;
    const body={...payload,requestId:payload.requestId??requestId()};
    const queued={path,body};sessionStorage.setItem(storageKey,JSON.stringify(queued));
    try{await sendPending(queued);}catch(e){error(e);}finally{pending=false;signature='';await poll();}
  }
  async function sendPending(queued){
    try{
      const result=await request(queued.path,queued.body);sessionStorage.removeItem(storageKey);
      if(queued.body.type==='leave'){home();boot=await request('/api/session');return;}
      remember(result.code);
    }catch(e){if(e.confirmed)sessionStorage.removeItem(storageKey);throw e;}
  }
  function rematch(){closePanel();return command({type:'rematch',expectedRevision:current.revision});}
  function configForm(initial,onSave){
    const box=el('div'),label=el('label','field','参与人数'),select=el('select');select.setAttribute('aria-label','参与人数');
    for(let n=5;n<=10;n++){const o=el('option','',`${n} 人`);o.value=n;select.append(o);}select.value=initial.playerCount;label.append(select);
    const group=el('fieldset','role-options');group.append(el('legend','','特殊角色'));const inputs=new Map();
    for(const id of ['merlin','percival','morgana','assassin','mordred','oberon']){const l=el('label','role-option'),i=el('input');i.type='checkbox';i.checked=initial.roles.includes(id);i.disabled=['merlin','assassin'].includes(id);l.append(i,el('span','',roleAssets[id].name));inputs.set(id,i);group.append(l);}
    const summary=el('p','config-summary'),note=el('p','panel-note');let config;
    const save=button('确认配置',()=>onSave(config),'primary');
    function refresh(){const n=Number(select.value),option=boot.configOptions.find(x=>x.rules.playerCount===n),chosen=[...inputs].filter(([,v])=>v.checked).map(([id])=>id),good=chosen.filter(id=>roleAssets[id].alignment==='正义').length,evil=chosen.length-good,valid=good<=option.rules.goodCount&&evil<=option.rules.evilCount;
      save.disabled=!valid;config=valid?{playerCount:n,roles:[...chosen,...Array(option.rules.goodCount-good).fill('loyal'),...Array(option.rules.evilCount-evil).fill('minion')]}:null;
      summary.textContent=valid?`正义 ${option.rules.goodCount} · 邪恶 ${option.rules.evilCount} ｜ 忠臣 ×${option.rules.goodCount-good} · 爪牙 ×${option.rules.evilCount-evil}`:'特殊角色超过阵营人数';
      note.textContent=chosen.includes('percival')&&!chosen.includes('morgana')?'没有莫甘娜：派西维尔只看到梅林。':'';
    }
    const recommend=()=>{const r=boot.configOptions.find(x=>x.rules.playerCount===Number(select.value)).recommendedRoles;for(const [id,i] of inputs)i.checked=r.includes(id);refresh();};
    select.addEventListener('change',recommend);for(const i of inputs.values())i.addEventListener('change',refresh);
    box.append(label,group,button('使用推荐配置',recommend),summary,note,save);refresh();return box;
  }
  function entryLabel(text){const wrap=el('label','field',text),input=el('input');input.maxLength=text==='昵称'?20:10;input.autocomplete='off';wrap.append(input);return {wrap,input};}
  function baseRoomUI(){screen.hidden=false;document.querySelector('.screen-layout').hidden=true;$('identity-toggle').hidden=true;$('mode-badge').textContent=current?`房间 ${current.room.code}`:'真人联机';document.body.dataset.stage='play';$('actions').replaceChildren();$('notice').textContent='';$('action-help').textContent='';}
  function renderHome(){baseRoomUI();screen.replaceChildren(el('h2','','围坐，开始一局'));
    if(boot?.inviteOrigin&&new URL(boot.inviteOrigin).hostname!==location.hostname){const link=el('a','panel-note','手机联机：请先在电脑也打开局域网地址');link.href=boot.inviteOrigin;screen.append(link);}
    const name=entryLabel('昵称'),roomCode=entryLabel('房间码');roomCode.input.value=code??joinTarget??'';
    screen.append(name.wrap,roomCode.wrap);
    screen.append(button('加入房间',()=>{const target=roomCode.input.value.trim().toUpperCase();if(!/^[A-F0-9]{10}$/.test(target)){error({message:'ROOM_NOT_FOUND',confirmed:true});return;}command({type:'join',name:name.input.value},`/api/rooms/${target}`);},'primary'));
    screen.append(button('创建房间',()=>{const option=boot.configOptions.find(x=>x.rules.playerCount===6);openPanel('创建房间','room-config',configForm({playerCount:6,roles:option.recommendedRoles},config=>{closePanel();command({type:'create',name:name.input.value,config},'/api/rooms');}));}));
    for(const r of boot?.rooms??[])screen.append(button(`返回 ${r.code} · ${r.status==='lobby'?'大厅':r.status==='finished'?'已结束':'原房间'}`,()=>{remember(r.code);poll();}));
    $('session-label').textContent='每人用自己的浏览器加入';
  }
  function share(){if(!boot.lanEnabled){const body=el('div','panel-note','当前只监听本机。手机加入请用 npm run lan 启动，再从局域网地址建房。');openPanel('局域网未开启','invite',body);return;}const body=el('div');body.append(el('h3','',`房间码 ${code}`));const link=el('a','invite-link',current.inviteUrl);link.href=current.inviteUrl;body.append(link);
    const img=el('img','invite-qr');img.alt='房间邀请二维码';img.src=`/api/rooms/${code}/qr`;img.addEventListener('error',()=>{img.hidden=true;body.append(el('p','','二维码加载失败，请使用上面的链接。'));});body.append(img);
    body.append(el('p','panel-note','所有设备连接同一 Wi-Fi。二维码仅含房间入口，不含座位凭证。'));openPanel('邀请朋友','invite',body);
  }
  function settings(){if(!current){rulesPanel();return;}const r=current.room,mine=r.members.find(p=>p.id===r.selfId),body=el('div');
    body.append(button('邀请朋友',share),button('查看规则',rulesPanel),button('角色图鉴',catalogue));
    if(r.members.some(p=>p.kind==='ai'))body.append(button('文字讨论',discussion));
    if(r.aiProblem){body.append(el('p','ai-problem',aiMessage(r.aiProblem)));if(r.selfId===r.hostId&&!['RATE_LIMIT','RATE_LIMIT_EXHAUSTED','CALL_LIMIT'].includes(r.aiProblem))body.append(button('重试 AI',()=>{closePanel();command({type:'ai_retry',expectedRevision:current.revision});}));}
    if(r.status==='lobby'){
      if(r.selfId===r.hostId){body.append(button('修改角色配置',()=>openPanel('修改配置 · 清除所有准备','room-config',configForm(r.config,config=>{closePanel();command({type:'config',expectedRevision:current.revision,config});}))));
        for(const p of r.members.filter(p=>p.id!==r.selfId&&p.kind!=='ai'))body.append(button(`转交房主给 ${p.name}`,()=>{closePanel();command({type:'transfer',targetId:p.id,expectedRevision:current.revision});}));}
      body.append(button('离开并释放座位',()=>{closePanel();command({type:'leave'});}));
    }
    if(r.selfId===r.hostId&&!['finished','terminated'].includes(r.status))body.append(button('终止房间…',()=>{
      const c=el('div');c.append(el('p','','终止后不判胜负，也不公开未结束的身份。无法继续这局。'),button('确认终止房间',()=>{closePanel();command({type:'terminate',expectedRevision:current.revision});},'danger'));openPanel('终止房间','terminate',c);
    },'danger'));
    if(r.status==='finished'&&r.selfId===r.hostId)body.append(button('再来一局',rematch,'primary'));
    if(['finished','terminated'].includes(r.status))body.append(button('返回首页',()=>{closePanel();home();}));
    const members=el('ul','room-presence');for(const p of r.members)members.append(el('li','',`${p.seat??'未入座'}号 · ${p.name} · ${p.online?'在线':'离线'}`));body.append(members);
    if(mine)body.append(el('p','panel-note',`你的座位：${mine.seat??'尚未认领'} · ${mine.name}`));openPanel('设置与规则','room-settings',body);
  }
  function renderRoom(){
    if(!current)return;const r=current.room,mine=r.members.find(p=>p.id===r.selfId);
    if(['playing','finished'].includes(r.status)){screen.hidden=true;document.querySelector('.screen-layout').hidden=false;return;}
    baseRoomUI();screen.replaceChildren();
    if(r.status==='terminated'){screen.append(el('h2','','房间已终止'),el('p','','本局不计胜负。'),button('返回首页',home));return;}
    if(r.status==='revealing'){
      const seconds=Math.max(0,Math.ceil((r.revealAt-current.serverNow)/1000));
      screen.append(el('h2','',seconds?'身份即将揭晓':'确认你的身份'),el('div','countdown',seconds?String(seconds):'✦'));
      if(!seconds){$('identity-toggle').hidden=false;screen.append(button('查看我的身份',()=>{identityOpened=true;showIdentity();}));const b=button(mine.confirmed?'已确认身份':'我已查看，确认身份',()=>command({type:'confirm'}),'primary');b.disabled=mine.confirmed||!identityOpened;screen.append(b);screen.append(el('p','',`已确认 ${r.members.filter(p=>p.confirmed).length} / ${r.members.length}`));}
      $('notice').textContent=mine.confirmed?'等待其他玩家确认身份':'所有人确认后进入第一轮';return;
    }
    screen.append(el('h2','',`房间 ${r.code}`),el('p','',`${r.members.length} / ${r.config.playerCount} 人 · 房主 ${r.members.find(p=>p.id===r.hostId)?.name}`));
    const seats=el('div','lobby-seats');
    for(let n=1;n<=r.config.playerCount;n++){
      const p=r.members.find(p=>p.seat===n),b=button('',()=>command({type:'seat',seat:n}),'lobby-seat'+(p?.id===r.selfId?' self':''));
      b.append(avatar(n-1),el('strong','',`${n}号 · ${p?.name??'点击入座'}`),el('span','',p?`${p.online?'在线':'离线'} · ${p.ready?'已准备':'未准备'}`:'空位'));b.disabled=!!p||pending;seats.append(b);
    }
    screen.append(seats);
    if(r.selfId===r.hostId){
      for(const ai of r.members.filter(p=>p.kind==='ai'))screen.append(button(`移除 AI · ${ai.seat}号`,()=>command({type:'remove_ai',targetId:ai.id,expectedRevision:current.revision})));
      if(r.members.length<r.config.playerCount){
        const label=el('label','field','添加 AI 到空座位'),select=el('select');select.setAttribute('aria-label','AI 座位');
        for(let n=1;n<=r.config.playerCount;n++)if(!r.members.some(p=>p.seat===n)){const o=el('option','',`${n}号`);o.value=n;select.append(o);}label.append(select);
        screen.append(label,button('添加 Gemini AI',()=>command({type:'add_ai',seat:Number(select.value),expectedRevision:current.revision})));
      }
    }
    if(r.members.some(p=>p.kind==='ai'))screen.append(el('p','panel-note',boot.aiAvailable?'含 AI 的房间：每次组队前轮流文字发言，可跳过。':'AI 等待配置：在电脑填写新密钥并重启，再开始游戏。'));

    const unseated=r.members.filter(p=>p.seat===null);if(unseated.length)screen.append(el('p','',`等待入座：${unseated.map(p=>p.name).join('、')}`));
    screen.append(el('p','config-summary',r.config.roles.map(id=>roleAssets[id].name).join(' · ')),button('邀请朋友',share));
    const ready=button(mine.ready?'取消准备':'准备',()=>command({type:'ready',ready:!mine.ready,configVersion:r.configVersion}),'primary');ready.disabled=mine.seat===null||pending;$('actions').append(ready);
    const start=button(r.selfId===r.hostId?'开始游戏':'等待房主开始',()=>command({type:'start',expectedRevision:current.revision}));start.disabled=pending||r.selfId!==r.hostId||r.members.length!==r.config.playerCount||r.members.some(p=>!p.ready)||(r.members.some(p=>p.kind==='ai')&&!boot.aiAvailable);$('actions').append(start);
    $('notice').textContent='配置变化后，所有玩家需要重新准备';
  }
  function aiMessage(code){return ({AI_NOT_CONFIGURED:'AI 等待配置，请房主填写新密钥并重启服务',RATE_LIMIT:'AI 暂时限流，30秒后自动重试一次',RATE_LIMIT_EXHAUSTED:'AI 配额不足，本次重试已用完',AUTH_FAILED:'AI 认证失败，请检查新密钥',MODEL_UNAVAILABLE:'配置的模型不可用',MODEL_REQUEST_REJECTED:'模型拒绝请求，请检查模型配置',TIMEOUT:'AI 请求超时，已暂停',NETWORK_ERROR:'AI 网络请求失败，已暂停',FORMAT_ERROR:'AI 返回格式错误，已暂停',INVALID_MODEL_ACTION:'AI 行动未通过校验，已暂停',CALL_LIMIT:'本局 AI 调用额度已用完',UNCERTAIN_REQUEST:'重启前的 AI 请求结果不确定，已暂停'})[code]??'AI 已暂停';}
  function discussion(){chatPanel=true;chatSignature='';openPanel('文字讨论','discussion',el('div'));refreshDiscussion();}
  function refreshDiscussion(){
    if(!chatPanel||!$('panel').open||document.getElementById('panel-title')?.textContent!=='文字讨论'){chatPanel=false;return;}
    const r=current?.room;if(!r)return;
    const sig=JSON.stringify([r.discussion,r.messages,r.aiProblem]);if(sig===chatSignature)return;chatSignature=sig;
    const body=el('div','discussion-body'),log=el('ol','discussion-log');
    for(const m of r.messages){const p=r.members.find(p=>p.id===m.playerId),item=el('li');item.append(el('strong','',`${p?.seat}号 ${p?.name}：`),el('span','',m.text||'跳过'));log.append(item);}
    if(!r.messages.length)body.append(el('p','panel-note','还没有发言'));body.append(log);
    const d=r.discussion,own=d?.active&&d.speakerId===r.selfId;
    if(d?.active){const speaker=r.members.find(p=>p.id===d.speakerId);body.append(el('p','',own?'轮到你发言':`等待 ${speaker?.name} 发言`));}
    if(own){const input=el('textarea','speech-input');input.maxLength=500;input.rows=3;input.placeholder='说说你的判断（最多500字）';input.setAttribute('aria-label','公开发言');input.value=chatDraft;input.addEventListener('input',()=>chatDraft=input.value);
      const send=text=>{chatDraft='';command({type:'speak',turnId:d.turnId,text});};
      body.append(input,button('发送发言',()=>send(input.value),'primary'),button('跳过发言',()=>send('')));
    }
    if(r.aiProblem){body.append(el('p','ai-problem',aiMessage(r.aiProblem)));if(r.selfId===r.hostId&&!['RATE_LIMIT','RATE_LIMIT_EXHAUSTED','CALL_LIMIT'].includes(r.aiProblem))body.append(button('重试 AI',()=>command({type:'ai_retry',expectedRevision:current.revision})));}
    $('panel-body').replaceChildren(body);log.scrollTop=log.scrollHeight;
  }
  async function poll(){
    if(pending||polling)return;polling=true;
    try{
      const queued=sessionStorage.getItem(storageKey);
      if(queued){pending=true;try{await sendPending(JSON.parse(queued));}finally{pending=false;}}
      if(!code){if(!recovered){renderHome();recovered=true;}return;}
      const snapshot=await request(`/api/rooms/${code}`);if(current?.room.code===snapshot.room.code&&snapshot.revision<current.revision)return;connected=true;$('error').hidden=true;
      if(current&&current.room.status!=='lobby'&&snapshot.room.status==='lobby'){identityOpened=false;chatDraft='';chatPanel=false;closePanel();}
      current=snapshot;
      const sig=JSON.stringify([snapshot.revision,snapshot.room.members.map(p=>p.online),snapshot.room.status==='revealing'?Math.max(0,Math.ceil((snapshot.room.revealAt-snapshot.serverNow)/1000)):null]);
      if(signature!==sig){signature=sig;receive(snapshot);renderRoom();refreshDiscussion();}
    }catch(e){connected=false;signature='';
      if(['ROOM_ACCESS_DENIED','ROOM_NOT_FOUND'].includes(e.message)){current=null;joinTarget=code;code=null;localStorage.removeItem('avalon-last-room');receive(null);renderHome();recovered=true;return;}
      error(e);lock();
    }finally{polling=false;}
  }
  const interval=setInterval(poll,1000);
  window.addEventListener('online',()=>{signature='';poll();});
  window.addEventListener('offline',()=>{connected=false;lock();$('error').hidden=false;$('error').textContent='连接已断开，座位与身份保留。恢复网络后自动同步。';});
  async function start(){try{boot=await request('/api/session');const active=boot.rooms.find(r=>!['finished','terminated'].includes(r.status));if(active)remember(active.code);await poll();if(!code||!current)renderHome();}catch(e){error(e);screen.append(button('重新连接',start));}}
  start();
  return {settings,command,rematch,share,discussion,aiMessage,get current(){return current;},get connected(){return connected;},openIdentity(){identityOpened=true;signature='';},stop:()=>clearInterval(interval)};
}
