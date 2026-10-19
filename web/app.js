import { el, icon, avatar, button, assassinationTeammateIds } from './ui.js';
import { roleAssets } from './asset-map.js';
import { ringLayout } from './layout.js';
import { taskHistory } from './history.js';
const requestId=()=>Array.from(crypto.getRandomValues(new Uint8Array(16)),b=>b.toString(16).padStart(2,'0')).join('');
const isMultiplayer=document.body.dataset.multiplayer==='true';
let multiplayer;
const $ = id => document.getElementById(id);
const phaseNames = { proposal:'组建队伍', voting:'队伍投票', quest:'执行任务', assassination:'刺杀时刻', ended:'对局结束' };
const outcomes = { three_failed_quests:'三次任务失败，邪恶获胜。', five_rejections:'连续五次否决，邪恶获胜。', merlin_assassinated:'刺杀命中梅林，邪恶逆转获胜。', assassination_missed:'刺杀未命中梅林，正义获胜。' };
let state, me = null, busy = false, playing = false, timer, selection = [], selectionKey = '', panelKind = '', lastFocus, stageKey='';
$('identity-toggle').append(icon('eye')); $('identity-toggle').addEventListener('click',showIdentity); $('settings').append(icon('settings')); $('close-panel').append(icon('close')); $('disc-icon').append(icon('sword'));
const playerName = id => state?.view.players.find(p => p.id === id)?.name ?? '未知玩家';
const legal = () => me?.legalActions[0];
$('chat-history-entry').hidden=!isMultiplayer;
$('chat-history-entry').addEventListener('click',()=>multiplayer?.chatHistory());
$('history-entry').addEventListener('click',()=>showHistory(state?.view?.questNumber??1));
function pause() { playing = false; clearTimeout(timer); }
function openPanel(title, kind, content) {
  pause(); renderActions(); lastFocus = document.activeElement;
  panelKind = kind; $('panel').dataset.kind=kind; $('panel-title').textContent = title; $('panel-body').replaceChildren(content);
  if (!$('panel').open) $('panel').showModal();
  $('panel').scrollTop=0;
  $('close-panel').focus();
}
function closePanel() { $('panel').close(); }
$('close-panel').addEventListener('click', closePanel);
$('panel').addEventListener('close', () => { panelKind = ''; $('panel-body').replaceChildren(); lastFocus?.focus(); });
$('panel').addEventListener('click', e => { if (e.target === $('panel')) { const r=$('panel').getBoundingClientRect(); if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom) closePanel(); } });

function portrait(role) {
  const box=el('div','role-portrait'); const img=el('img');
  const fallback=el('div','image-fallback'); fallback.hidden=true; fallback.append(icon('shield'),el('span','','插画暂不可用'));
  img.alt=`${role.name}角色插画`; img.width=role.width; img.height=role.height; img.sizes='240px'; img.srcset=role.srcset; img.src=role.src;
  img.addEventListener('error',()=>{img.hidden=true;fallback.hidden=false;});
  box.append(img,fallback); return box;
}
function roleContent(id, personal = false) {
  const role=roleAssets[id]; const wrap=el('div','role-description');
  if(!role){wrap.append(el('p','','未取得合法角色信息。'));return wrap;}
  wrap.append(el('p','privacy-title',personal?'仅你可见 · 请留意身旁的屏幕':'公开角色图鉴 · 不代表本局任何玩家身份'),el('h3','',`${role.name} · ${role.alignment}`));
  if(personal){
    const info=me.self.knowledge;
    const knowledge=el('section','knowledge');knowledge.setAttribute('aria-label','可见玩家');
    const addGroup=(title,ids,note='')=>{
      knowledge.append(el('h3','',title));const list=el('ul','known-players');
      for(const p of state.view.players.filter(p=>ids.includes(p.id))){
        const index=state.view.players.findIndex(x=>x.id===p.id), item=el('li','known-player'), face=el('span','known-avatar');
        face.append(avatar(index));item.append(face,el('strong','',`${index+1}号 · ${p.name}`));list.append(item);
      }
      knowledge.append(list);if(note)knowledge.append(el('p','',note));
    };
    if(me.self.assassinationRoles){
      const entries=me.self.assassinationRoles;
      addGroup(me.self.alignment==='good'?'全员身份':'队友身份',entries.map(r=>r.playerId));
      for(const [index,item] of [...knowledge.querySelectorAll('.known-player')].entries()){
        const p=state.view.players.filter(p=>entries.some(r=>r.playerId===p.id))[index];
        item.append(el('small','',roleAssets[entries.find(r=>r.playerId===p.id).role].name));
      }
      if(!entries.length)knowledge.append(el('p','','没有可见队友。'));
    }else {
    if(info.knownAlignments.length)addGroup(me.self.role==='merlin'?'你看到的邪恶':'邪恶队友',info.knownAlignments.map(x=>x.playerId));
    for(const group of info.roleCandidates)addGroup(group.possibleRoles.length>1?'梅林候选':'梅林',group.playerIds,group.possibleRoles.length>1?'无法区分谁是梅林、谁是莫甘娜。':'本局没有莫甘娜，这位玩家是梅林。');
    if(!info.knownAlignments.length&&!info.roleCandidates.length)knowledge.append(el('p','','没有额外身份信息。'));
    }
    wrap.append(knowledge);
  }
  wrap.append(portrait(role),el('h3','','技能说明'),el('p','',role.skill),el('h3','','技能解析'),el('p','',role.analysis));
  if(!role.playable) wrap.append(el('p','panel-note','插画已接收；该扩展角色尚未加入当前规则内核与练习配置。'));
  return wrap;
}
function showIdentity() {
  if(!me)return;
  multiplayer?.openIdentity();
  openPanel('你的身份','identity',roleContent(me.self.role,true));
}
function showHistory(n) {
  const v=state.view, body=el('div');
  const items=taskHistory(v,n);
  body.className='history-panel';
  const summary=el('div','history-summary');summary.append(el('span','',`${state.rules.teamSizes[n-1]} 人任务`),el('span','',`${state.rules.failThresholds[n-1]} 张失败牌判负`),el('span','',`${items.length} 次组队`));body.append(summary);
  if(!items.length) body.append(el('p','history-empty',n>v.questNumber?'尚未开始这次任务':'等待第一位队长组队'));
  const seat=id=>v.players.findIndex(p=>p.id===id)+1;
  items.forEach((item,i)=>{
    const node=el('article','history-card'),header=el('header','history-card-header');
    const title=el('div');title.append(el('small','',`第 ${i+1} 次组队`),el('h3','',`${seat(item.leaderId)}号 · ${playerName(item.leaderId)} 开车`));
    header.append(title,el('span',`history-status ${item.vote?(item.vote.approved?'passed':'rejected'):'pending'}`,item.vote?(item.vote.approved?'队伍通过':'流局'):'投票中'));node.append(header);
    const team=el('div','history-team');team.append(el('span','history-label','上车队员'));
    for(const id of item.team)team.append(el('span','team-chip',`${seat(id)}号 · ${playerName(id)}`));node.append(team);
    if(!item.vote)node.append(el('p','history-empty','等待投票收齐'));
    else {
      const yes=item.vote.votes.filter(b=>b.vote==='approve').length,total=item.vote.votes.length;
      const tally=el('div','vote-tally');tally.append(el('strong','approve',`✓ ${yes} 赞成`),el('span','',yes*2===total?'平票':`${total} 人投票`),el('strong','reject',`${total-yes} 反对 ×`));node.append(tally);
      const bar=el('div','vote-bar');const fill=el('span');fill.style.width=`${yes/total*100}%`;bar.append(fill);bar.setAttribute('aria-hidden','true');node.append(bar);
      const votes=el('div','ballot-grid');
      for(const player of v.players){const vote=item.vote.votes.find(b=>b.playerId===player.id);if(!vote)continue;
        const card=el('div',`ballot ${vote.vote==='approve'?'approve':'reject'}`),face=el('span','ballot-avatar');face.append(avatar(seat(player.id)-1));
        const who=el('div','ballot-who');who.append(el('strong','',`${seat(player.id)}号 · ${player.name}`),el('small','',item.team.includes(player.id)?'上车':'未上车'));
        card.append(face,who,el('span','ballot-choice',vote.vote==='approve'?'✓ 赞成':'× 反对'));votes.append(card);
      }node.append(votes);
      const result=el('div',`history-result ${item.result?(item.result.succeeded?'passed':'failed'):''}`);
      if(item.result)result.append(el('strong','',item.result.succeeded?'任务成功':'任务失败'),el('span','',`${item.result.successCount} 成功牌 · ${item.result.failCount} 失败牌`));
      else result.append(el('strong','',item.vote.approved?'等待任务结果':'未执行任务'),el('span','',item.vote.approved?'任务牌收齐后结算':'否决不计任务失败'));
      node.append(result);
    }
    body.append(node);
  });
  if(v.outcome?.reason==='five_rejections'&&n===v.questNumber)body.append(el('p','knowledge',outcomes.five_rejections));
  const tabs=el('nav','history-tabs');
  for(let q=1;q<=5;q++){const b=button(`任务 ${q}`,()=>showHistory(q),q===n?'primary':'');b.setAttribute('aria-pressed',String(q===n));tabs.append(b);}
  body.prepend(tabs);
  openPanel(`第 ${n} 次任务 · 历史`,'history',body);
}
function makeSelect(label, options, value) {
  const wrap=el('label','field',label), select=el('select');
  for(const [v,t] of options){const opt=el('option','',t);opt.value=v;select.append(opt);}select.value=String(value); wrap.append(select);return {wrap,select};
}
function settings() {
  if(isMultiplayer){multiplayer?.settings();return;}
  const body=el('div','local-settings-body');body.append(el('p','panel-note','本地单人练习，其余席位由脚本操作。修改配置会开启新局，不改变当前对局。'));
  const count=makeSelect('参与人数',[5,6,7,8,9,10].map(n=>[String(n),`${n} 人`]),state.view.players.length);
  const mode=makeSelect('运行模式',[['practice','单人练习 · 操作自己的席位'],['public','公共演示 · 只看公开信息']],state.mode);
  const scenario=makeSelect('脚本路线',[['sabotage','任务破坏 · 邪恶脚本选择失败'],['assassination','通往刺杀 · 脚本任务选择成功'],['rejections','连续否决 · 脚本反对组队']],state.scenario);
  const group=el('fieldset','role-options');group.append(el('legend','','新局特殊角色'));
  const inputs=new Map();
  for(const id of ['merlin','percival','morgana','assassin','mordred','oberon']){
    const label=el('label','role-option'),input=el('input');input.type='checkbox';input.value=id;input.checked=state.view.config.roles.includes(id);input.disabled=['merlin','assassin'].includes(id);
    label.append(input,el('span','',roleAssets[id].name));group.append(label);inputs.set(id,input);
  }
  const summary=el('p','config-summary'),notes=el('p','panel-note');notes.setAttribute('aria-live','polite');
  const options=()=>state.configOptions.find(o=>o.rules.playerCount===Number(count.select.value));
  let deck=[];
  const save=button('应用并开始新局',async()=>{const config={revision:state.revision,playerCount:Number(count.select.value),mode:mode.select.value,scenario:scenario.select.value,roles:deck};closePanel();await update('/api/reset',config);},'primary');
  function refreshConfig(){
    const r=options().rules,selected=[...inputs].filter(([,input])=>input.checked).map(([id])=>id);
    const good=selected.filter(id=>roleAssets[id].alignment==='正义').length,evil=selected.length-good;
    const valid=good<=r.goodCount&&evil<=r.evilCount;
    deck=valid?[...selected,...Array(r.goodCount-good).fill('loyal'),...Array(r.evilCount-evil).fill('minion')]:[];
    save.disabled=!valid;summary.textContent=valid?`正义 ${r.goodCount} · 邪恶 ${r.evilCount} ｜ 忠臣 ×${r.goodCount-good} · 爪牙 ×${r.evilCount-evil}`:`邪恶角色过多：本局最多 ${r.evilCount} 人`;
    const messages=[];
    if(selected.includes('percival')&&!selected.includes('morgana'))messages.push('没有莫甘娜：派西维尔只看到梅林。');
    if(r.playerCount===5&&selected.includes('percival')&&!selected.includes('morgana')&&!selected.includes('mordred'))messages.push('五人平衡建议：加入莫甘娜或莫德雷德。');
    if(selected.includes('oberon'))messages.push('奥伯伦不参与邪恶互认，但梅林能看到他。');
    notes.textContent=messages.join(' ');
  }
  function recommend(){const deck=options().recommendedRoles;for(const [id,input] of inputs)input.checked=deck.includes(id);refreshConfig();}
  count.select.addEventListener('change',recommend);for(const input of inputs.values())input.addEventListener('change',refreshConfig);
  const presets=el('div','panel-buttons');presets.append(button('使用推荐配置',recommend),button('基础配置',()=>{for(const [id,input] of inputs)input.checked=['merlin','assassin'].includes(id);refreshConfig();}));
  body.append(count.wrap,group,presets,summary,notes,mode.wrap,scenario.wrap,save);
  const links=el('div','panel-buttons');links.append(button('查看规则',rulesPanel),button('角色图鉴',catalogue));body.append(links);
  refreshConfig();openPanel('设置与规则','settings',body);
}
function rulesPanel(){
  const body=el('div','role-description');
  for(const [h,t] of [
    ['组队与投票','队长选择规定人数，所有玩家投票。超过半数赞成才通过，平票否决。连续五次否决，邪恶获胜。'],
    ['执行任务','正义阵营只能选择成功，邪恶可选择成功或失败。所有队员提交后只公开匿名汇总。7–10人的第4次任务需要两张失败，其余任务一张失败即可。'],
    ['胜负与刺杀','三次任务失败，邪恶获胜；三次任务成功，进入刺杀。刺客命中梅林则邪恶获胜，否则正义获胜。'],
    ['刺杀亮牌（房规）','仅在刺杀阶段，正义玩家可查看全员角色，邪恶玩家可查看所有邪恶队友角色（含奥伯伦）；奥伯伦也可查看邪恶队友。终局后全员公开。'],
    ['信息边界','投票未收齐不公开票值；任务不公开谁出了什么牌。公共头像与真实角色无关。角色图鉴说明能力，不说明本局分配。'],
    ['当前范围','支持八种角色，当前模式必须有梅林和刺客。推荐搭配不限制其他合法组合。真人房间由服务器校验所有行动。'],
  ])body.append(el('h3','',h),el('p','',t));
  openPanel('游戏规则','rules',body);
}
function catalogue(){
  const grid=el('div','catalogue');
  for(const role of Object.values(roleAssets)){
    const card=el('article','catalogue-card');card.setAttribute('aria-label',role.name);
    const art=portrait(role);art.classList.add('catalogue-art');
    const text=el('div','catalogue-copy'),header=el('div','catalogue-heading');
    header.append(el('h3','',role.name),el('span',role.alignment==='正义'?'alignment-good':'alignment-evil',role.alignment));
    text.append(header,el('p','catalogue-skill',role.skill),el('p','catalogue-analysis',role.analysis));
    card.append(art,text);grid.append(card);
  }
  openPanel('角色图鉴','catalogue',grid);
}
$('settings').addEventListener('click',()=>{if(isMultiplayer||state)settings();});

function render() {
  if(!state?.view)return;
  const v=state.view;
  const special=v.phase==='assassination'||v.phase==='ended';
  const victory=v.outcome&&(me?me.self.alignment===v.outcome.winner:v.outcome.winner==='good');
  document.body.dataset.stage=v.phase==='assassination'?'assassination':v.phase==='ended'?(victory?'victory':'defeat'):'play';
  $('arena').hidden=special;$('stage-screen').hidden=!special;
  document.querySelector('.round-heading').hidden=special;$('identity-hint').hidden=special;
  $('identity-toggle').hidden=!me; $('identity-toggle').disabled=busy||!me;
  const key=`${v.gameId}:${v.phase}:${v.questNumber}:${v.leaderId}`;
  if(selectionKey!==key){selection=[];selectionKey=key;}
  $('mode-badge').textContent=isMultiplayer?`房间 ${state.room.code}`:state.mode==='practice'?'单人练习':'公共演示';
  $('session-label').textContent=isMultiplayer?'真人联机 · 服务器同步':state.mode==='practice'?'你的席位：1 · 其余为脚本玩家':'固定种子 · 合法动作脚本';
  $('quest-track').replaceChildren(...state.rules.teamSizes.map((size,i)=>{
    const result=v.quests.find(q=>q.questNumber===i+1);
    const b=button('',()=>showHistory(i+1),'quest-node'+(result?(result.succeeded?' success':' failed'):(v.phase!=='ended'&&i+1===v.questNumber?' current':'')));
    b.setAttribute('aria-label',`第${i+1}次任务历史：${result?(result.succeeded?'成功':'失败'):'未结算'}`);
    b.title=`${size}人 / ${state.rules.failThresholds[i]}张失败门槛`;
    const capacity=el('span','quest-capacity');capacity.append(el('span','quest-size',String(size)),el('small','','人'));b.append(capacity);
    if(result){const mark=el('span','quest-result');mark.append(icon(result.succeeded?'check':'close'));b.append(mark);}return b;
  }));
  $('round-title').replaceChildren('第 ',el('b','',String(v.questNumber)),' 轮 · 需要 ',el('b','',String(v.teamSize)),' 人');
  $('round-detail').textContent=`连续流局 ${v.rejectionCount} / 5 · ${v.score.good} 成功 / ${v.score.evil} 失败`;
  $('phase-title').textContent=v.outcome?(v.outcome.winner==='good'?'正义获胜':'邪恶获胜'):phaseNames[v.phase];
  $('phase-count').textContent=v.phase==='proposal'?`${selection.length} / ${v.teamSize}`:v.phase==='voting'?`${v.submissions.votes} / ${v.players.length}`:v.phase==='quest'?`${v.submissions.questCards} / ${v.teamSize}`:v.phase==='assassination'?'最后一剑':`${v.score.good} : ${v.score.evil}`;
  $('good-score').textContent=v.score.good;$('evil-score').textContent=v.score.evil;
  $('identity-hint').textContent='';
  $('notice').textContent=v.outcome?'':v.phase==='proposal'?`${v.rejectionCount?'上队被否决 · ':''}${playerName(v.leaderId)} 开车，选择 ${v.teamSize} 人出发`:
    v.phase==='voting'?`队伍投票 ${v.submissions.votes} / ${v.players.length}`:v.phase==='quest'?`任务出牌 ${v.submissions.questCards} / ${v.teamSize}`:legal()?.type==='assassinate'?'选出梅林':'等待刺客选择';
  const last=v.quests.at(-1);$('latest-public').textContent=last?`最近任务：第 ${last.questNumber} 次${last.succeeded?'成功':'失败'}，${last.successCount} 张成功 / ${last.failCount} 张失败。`:'暂无任务结果。点击上方任务节点，查看每次提案与投票。';
  renderSeats();renderStage();renderActions();
}
function renderSeats(){
  if(!state?.view||['assassination','ended'].includes(state.view.phase)){$('seats').replaceChildren();return;}
  const v=state.view, action=legal(), mine=me?.self.playerId;
  const layout=ringLayout(v.players.length,$('arena').clientWidth,mine?v.players.findIndex(p=>p.id===mine):0);
  $('arena').style.height=`${layout.height}px`;$('disc').style.top=`${layout.centerY}px`;$('disc').style.width=`${layout.discSize}px`;
  Object.assign($('orbit').style,{width:`${layout.rx*2}px`,height:`${layout.ry*2}px`,left:`${$('arena').clientWidth/2-layout.rx}px`,top:`${layout.centerY-layout.ry}px`});
  const vote=v.events.findLast(e=>e.type==='team_vote_resolved'), proposal=v.events.findLast(e=>e.type==='team_proposed');
  const showVote=vote&&vote.sequence>(proposal?.sequence??-1);
  $('seats').replaceChildren(...v.players.map((p,i)=>{
    const picking=action?.type==='propose_team'||action?.type==='assassinate';
    const chosen=picking?selection.includes(p.id):v.team.includes(p.id);
    const seat=el('div',`seat${p.id===mine?' self':''}${chosen?' chosen':''}`);seat.dataset.player=p.id;
    Object.assign(seat.style,{width:`${layout.seatWidth}px`,height:`${layout.seatHeight}px`,left:`${layout.points[i].x}px`,top:`${layout.points[i].y}px`});
    const face=button('',()=>{
      if(busy)return;
      if(!picking)return;
      if(!action.candidateIds.includes(p.id))return;
      selection=selection.includes(p.id)?selection.filter(id=>id!==p.id):action.type==='assassinate'?[p.id]:selection.length<action.teamSize?[...selection,p.id]:selection;
      render();
      $('seats').querySelector(`[data-player="${CSS.escape(p.id)}"] .avatar-button`)?.focus({preventScroll:true});
    },'avatar-button');
    face.disabled=!picking||busy||!action.candidateIds.includes(p.id);
    face.setAttribute('aria-label',picking?`${chosen?'取消选择':'选择'}${p.name}`:`${p.name} 中立头像`);
    if(picking)face.setAttribute('aria-pressed',String(chosen));
    face.style.width=face.style.height=`${layout.avatar}px`;face.append(avatar(i),el('span','seat-number',String(i+1)));
    if(p.id===v.leaderId){const crown=el('span','leader-icon');crown.title='队长';crown.append(icon('crown'));face.append(crown);}
    seat.append(face,el('span','seat-name',p.id===mine?`${i+1}号 · 你`:p.name+(isMultiplayer&&!state.room.members.find(m=>m.id===p.id)?.online?' · 离线':'')));
    if(picking&&chosen){const mark=el('span','selection-mark');mark.append(icon('check'));mark.setAttribute('aria-hidden','true');face.append(mark);}
    const ballot=!picking&&showVote?vote.votes.find(b=>b.playerId===p.id):null;
    seat.append(el('span',`seat-label${ballot?' vote-label':''}`,ballot?(ballot.vote==='approve'?'✓ 赞成':'× 反对'):(chosen?(action?.type==='assassinate'?'刺杀目标':picking?'已选上车':'远征成员'):'')));
    return seat;
  }));
}
function renderStage(){
  const v=state.view, box=$('stage-screen');
  const current=`${v.gameId}:${v.phase}`;
  if(!['assassination','ended'].includes(v.phase)){box.replaceChildren();stageKey=current;return;}
  box.replaceChildren();
  const hero=el('header','stage-hero'), emblem=el('div','stage-emblem');
  emblem.append(icon(v.phase==='assassination'?'sword':v.outcome.winner==='good'?'shield':'sword'));
  hero.append(emblem);
  if(v.phase==='assassination'){
    hero.append(el('h2','','刺杀时刻'));
    box.append(hero);
    const grid=el('div','assassination-grid'), a=legal(), teammates=new Set(assassinationTeammateIds(me));
    const roleReveals=new Map((me?.self.assassinationRoles??[]).map(r=>[r.playerId,r.role]));
    if(me)roleReveals.set(me.self.playerId,me.self.role);
    v.players.forEach((p,i)=>{
      const selected=selection.includes(p.id);
      const target=button('',()=>{
        if(busy||a?.type!=='assassinate'||!a.candidateIds.includes(p.id))return;
        selection=selected?[]:[p.id];render();
        $('stage-screen').querySelector(`[data-player="${CSS.escape(p.id)}"]`)?.focus({preventScroll:true});
      },`target-player${selected?' selected':''}`);
      target.dataset.player=p.id;target.disabled=busy||a?.type!=='assassinate'||!a.candidateIds.includes(p.id);
      target.setAttribute('aria-label',teammates.has(p.id)?`${p.name} · 邪恶队友`:`${selected?'取消目标':'选择目标'}${p.name}`);target.setAttribute('aria-pressed',String(selected));
      if(teammates.has(p.id))target.append(el('span','teammate-badge','队友'));
      const face=el('span','target-avatar');face.append(avatar(i));target.append(face,el('strong','',`${i+1}号 · ${p.name}`));if(roleReveals.has(p.id))target.append(el('small','target-role',roleAssets[roleReveals.get(p.id)].name));if(selected){const mark=el('span','target-check');mark.append(icon('check'));target.append(mark);}grid.append(target);
    });box.append(grid);
  }else{
    const won=me?me.self.alignment===v.outcome.winner:null;
    hero.append(el('h2','',won===null?(v.outcome.winner==='good'?'正义胜利':'邪恶胜利'):won?'你胜利了':'你失败了'),el('p','',outcomes[v.outcome.reason]));
    const assassination=v.events.findLast(e=>e.type==='assassination_resolved');
    if(assassination){
      const target=v.players.find(p=>p.id===assassination.targetId),role=v.revealedRoles?.find(r=>r.playerId===assassination.targetId);
      if(target){const summary=el('div','final-assassination');summary.append(el('strong','',`刺杀目标：${v.players.indexOf(target)+1}号 · ${target.name}`),el('span','',`${role?roleAssets[role.role].name+' · ':''}${v.outcome.reason==='merlin_assassinated'?'命中梅林':'未命中梅林'}`));hero.append(summary);}
    }
    box.append(hero,el('p','final-score',`任务结果：${v.score.good} 次成功 · ${v.score.evil} 次失败`),el('h3','reveal-title','全员身份'));
    const grid=el('div','revealed-grid');
    for(const r of v.revealedRoles??[]){
      const index=v.players.findIndex(p=>p.id===r.playerId);if(index<0||!roleAssets[r.role])continue;
      const item=el('article',`revealed-player ${r.alignment}`);item.append(el('h4','',`${index+1}号 · ${playerName(r.playerId)}${me?.self.playerId===r.playerId?' · 你':''}`),portrait(roleAssets[r.role]),el('strong','',roleAssets[r.role].name),el('p','',`${r.alignment==='good'?'正义':'邪恶'} · ${r.alignment===v.outcome.winner?'胜利':'失败'}`));grid.append(item);
    }
    box.append(grid);
    if(!v.revealedRoles)box.append(el('p','panel-note','当前服务未返回终局身份，请更新本地服务后开启新局。'));
  }
  if(stageKey!==current){stageKey=current;window.scrollTo({top:0,behavior:'instant'});}
}
function renderActions(){
  if(!state?.view)return;
  const box=$('actions');box.replaceChildren();const v=state.view,a=legal();
  $('action-help').textContent='';
  const add=(text,fn,cls='',disabled=false)=>{const b=button(text,fn,cls);b.disabled=busy||disabled;box.append(b);};
  if(isMultiplayer&&state.room.discussion?.active){
    const own=state.room.discussion.speakerId===state.room.selfId;
    $('action-help').textContent=state.room.aiProblem?multiplayer.aiMessage(state.room.aiProblem):own?'轮到你发言':`等待 ${playerName(state.room.discussion.speakerId)} 发言`;
    add(own?'发言 / 跳过':'查看讨论',()=>multiplayer.discussion(),'primary');add('房间设置',settings);return;
  }
  if(isMultiplayer&&state.room.aiProblem)$('action-help').textContent=multiplayer.aiMessage(state.room.aiProblem);
  if(v.phase==='ended'){const host=!isMultiplayer||state.room.selfId===state.room.hostId;add(host?'再来一局':'等待房主再来一局',isMultiplayer?()=>multiplayer.rematch():settings,'primary',!host);add('查看任务记录',()=>showHistory(v.questNumber));return;}
  if(a){
    if(a.type==='propose_team'){add(`确认队伍 ${selection.length} / ${a.teamSize}`,()=>act({type:a.type,team:selection}),'primary',selection.length!==a.teamSize);add('清空',()=>{selection=[];render();},'secondary');}
    if(a.type==='vote'){add('赞成队伍',()=>act({type:a.type,vote:'approve'}),'primary');add('反对队伍',()=>act({type:a.type,vote:'reject'}));}
    if(a.type==='quest_card'){add('任务成功',()=>act({type:a.type,card:'success'}),'primary');add(a.choices.includes('fail')?'任务失败':'正义只能成功',()=>act({type:a.type,card:'fail'}),'danger',!a.choices.includes('fail'));}
    if(a.type==='assassinate'){$('action-help').textContent=selection.length?`已选：${playerName(selection[0])}`:'';add('确认刺杀',()=>act({type:a.type,targetId:selection[0]}),'danger primary',selection.length!==1);add('清空目标',()=>{selection=[];render();});}
    return;
  }
  if(me)$('action-help').textContent=v.phase==='voting'&&me.self.ownVote?'已投票':v.phase==='quest'&&me.self.ownQuestCard?'已出牌':'等待其他玩家';
  if(isMultiplayer){
    const waiting=state.room.waitingIds.map(playerName);
    $('action-help').textContent=state.room.aiProblem?multiplayer.aiMessage(state.room.aiProblem):waiting.length?`等待 ${waiting.join('、')}`:v.phase==='assassination'?'等待刺客行动':'等待其他玩家';
    add('等待同步',()=>{},'primary',true);add('房间设置',settings);return;
  }
  add(state.mode==='practice'?'推进其他玩家':'下一步',step,'primary',playing);
  const play=button(playing?'暂停演示':'自动推进',()=>{if(playing){pause();renderActions();}else{playing=true;step();}});play.disabled=busy&&!playing;box.append(play);
}
async function request(path,body){
  const res=await fetch(path,{credentials:'same-origin',cache:'no-store',signal:AbortSignal.timeout(5000),...(body===undefined?{}:{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify(body)})});
  const data=await res.json();if(!res.ok)throw new Error(data.error??'REQUEST_FAILED');return data;
}
async function refreshPrivate(){
  me=null;
  if(state.mode==='practice'){
    const data=await request('/api/me');
    if(data.revision!==state.revision)throw new Error('STALE_REVISION');
    me=data.player;
  }
}
async function update(path,body){
  if(busy)return;busy=true;$('identity-toggle').disabled=true;$('settings').disabled=true;renderActions();$('error').hidden=true;
  try{
    state=await request(path,body);await refreshPrivate();
    if(legal()||state.view.phase==='ended')pause();
  }catch(e){
    pause();me=null;
    if(panelKind==='identity')closePanel();
    const texts={WAITING_FOR_YOU:'轮到你行动了。',STALE_REVISION:'状态已改变，已刷新。请确认后重新操作。',SESSION_REQUIRED:'练习会话已失效，已重新建立本地练习。'};
    $('error').textContent=texts[e.message]??`操作未成功（${e.message}）。请确认本地服务仍在运行后刷新。`;$('error').hidden=false;
    try{state=await request('/api/state');await refreshPrivate();}catch{state=undefined;}
  }finally{busy=false;$('settings').disabled=!state;if(state)render();else{$('stage-screen').replaceChildren();$('action-help').textContent='';$('identity-toggle').hidden=true;$('actions').replaceChildren();$('seats').replaceChildren();$('quest-track').replaceChildren();$('phase-title').textContent='连接已中断';$('phase-count').textContent='';$('identity-hint').textContent='刷新页面以重新连接';}}
}
async function act(payload){
  pause();const a=legal();if(!a||busy)return;
  if(isMultiplayer){const id=requestId();await multiplayer.command({type:'action',requestId:id,roundId:state.roundId,action:{...payload,gameId:a.gameId,expectedVersion:a.expectedVersion,requestId:id}});return;}
  await update('/api/action',{revision:state.revision,action:{...payload,gameId:a.gameId,expectedVersion:a.expectedVersion,requestId:requestId()}});
}
async function step(){
  if(busy||!state)return;
  await update('/api/step',{revision:state.revision});
  if(playing)timer=setTimeout(step,950);
}
let lastWidth=0;new ResizeObserver(entries=>{const width=entries[0].contentRect.width;if(Math.abs(width-lastWidth)>1){lastWidth=width;renderSeats();}}).observe($('arena'));
document.addEventListener('visibilitychange',()=>{if(document.hidden){pause();if(panelKind==='identity')closePanel();renderActions();}});
if(isMultiplayer){
  const {createMultiplayer}=await import('./multiplayer.js');
  document.querySelector('.scope').textContent='真人联机 · 单实例局域网';
  multiplayer=createMultiplayer({openPanel,closePanel,showIdentity,rulesPanel,catalogue,receive(snapshot){
    state=snapshot;me=snapshot?.player??null;
    if(!me&&panelKind==='identity')closePanel();
    if(snapshot?.room.status==='playing'||snapshot?.room.status==='finished'){render();}
    else {$('identity-toggle').hidden=!me;}
    if(panelKind==='identity'&&me)$('panel-body').replaceChildren(roleContent(me.self.role,true));
  }});
}else await update('/api/state');
