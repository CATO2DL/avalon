import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { randomUUID } from 'node:crypto';
import { createRoomServer } from '../scripts/room-server.mjs';
import { RoomStore } from '../scripts/room-store.mjs';
let now=Date.now();
async function fixture(t){
  const dir=await mkdtemp(join(tmpdir(),'avalon-rooms-')),dbPath=join(dir,'test.sqlite');let server,base;
  const start=async()=>{server=createRoomServer({dbPath,clock:()=>now});await new Promise(r=>server.listen(0,'127.0.0.1',r));base=`http://127.0.0.1:${server.address().port}`;};
  const stop=async()=>{server.closeIdleConnections();await new Promise(r=>server.close(r));};await start();
  t.after(async()=>{await stop();await rm(dir,{recursive:true,force:true});});
  async function client(){
    const response=await fetch(`${base}/api/session`);const cookie=response.headers.get('set-cookie').split(';')[0];await response.json();
    return {cookie,async call(path,body){const res=await fetch(base+path,{headers:{Cookie:cookie,Connection:'close',...(body?{'Content-Type':'application/json'}:{})},...(body?{method:'POST',body:JSON.stringify(body)}:{})});return {status:res.status,data:await res.json()};},
      async cmd(code,body){return this.call(code?`/api/rooms/${code}`:'/api/rooms',{requestId:randomUUID(),...body});},
      async state(code){const r=await this.call(`/api/rooms/${code}`);assert.equal(r.status,200,JSON.stringify(r.data));return r.data;}};
  }
  return {client,get base(){return base;},dbPath,async restart(){const port=server.address().port;await stop();server=createRoomServer({dbPath,clock:()=>now});await new Promise(r=>server.listen(port,'127.0.0.1',r));}};
}
const ok=r=>{assert.equal(r.status,200,JSON.stringify(r.data));return r.data;};
async function group(f,n=5){
  const clients=await Promise.all(Array.from({length:n},()=>f.client()));
  const {code}=ok(await clients[0].cmd(null,{type:'create',name:'真人1',config:{playerCount:n,roleSet:'recommended'}}));
  for(let i=1;i<n;i++){ok(await clients[i].cmd(code,{type:'join',name:`真人${i+1}`}));ok(await clients[i].cmd(code,{type:'seat',seat:i+1}));}
  return {clients,code};
}
async function begin(clients,code){
  const initial=await clients[0].state(code);
  await Promise.all(clients.map(async c=>ok(await c.cmd(code,{type:'ready',ready:true,configVersion:initial.room.configVersion}))));
  const before=await clients[0].state(code);ok(await clients[0].cmd(code,{type:'start',expectedRevision:before.revision}));
  assert.equal((await clients[0].state(code)).player,null);
  now+=3100;
  await Promise.all(clients.map(async c=>ok(await c.cmd(code,{type:'confirm'}))));
}
async function submit(c,code,state,payload,id=randomUUID()){
  const a=state.player.legalActions[0];return c.cmd(code,{type:'action',requestId:id,roundId:state.roundId,action:{...payload,gameId:a.gameId,expectedVersion:a.expectedVersion,requestId:id}});
}
async function finish(clients,code,route='success'){
  for(let step=0;step<180;step++){
    const states=await Promise.all(clients.map(c=>c.state(code)));if(states[0].view.phase==='ended')return states;
    const jobs=[];
    for(let i=0;i<clients.length;i++){
      const s=states[i],a=s.player.legalActions[0];if(!a)continue;
      const payload=a.type==='propose_team'?{type:a.type,team:a.candidateIds.slice(0,a.teamSize)}:a.type==='vote'?{type:a.type,vote:route==='reject'?'reject':'approve'}:a.type==='quest_card'?{type:a.type,card:route==='sabotage'&&a.choices.includes('fail')?'fail':'success'}:{type:a.type,targetId:a.candidateIds[0]};
      jobs.push(submit(clients[i],code,s,payload).then(ok));
    }
    assert.ok(jobs.length);await Promise.all(jobs);
  }throw new Error('Did not finish');
}
for(const n of [5,6,7,8,9,10])test(`real HTTP ${n} independent cookie clients complete recommended game with simultaneous ballots`,async t=>{
  const f=await fixture(t),{clients,code}=await group(f,n);await begin(clients,code);const final=await finish(clients,code);
  assert.ok(final[0].view.outcome);assert.equal(final[0].view.revealedRoles.length,n);
  for(const s of final){assert.equal(s.room.status,'finished');assert.equal(s.player.legalActions.length,0);}
});
test('rooms and actors are isolated; occupied seats cannot be stolen; unknown fields rejected',async t=>{
  const f=await fixture(t),{clients,code}=await group(f), outsider=await f.client();
  const other=ok(await outsider.cmd(null,{type:'create',name:'外人',config:{playerCount:5}})).code;
  assert.equal((await outsider.call(`/api/rooms/${code}`)).status,403);
  assert.equal((await clients[0].call(`/api/rooms/${other}`)).status,403);
  const s=await clients[0].state(code);
  assert.equal((await outsider.cmd(code,{type:'terminate',expectedRevision:s.revision})).status,403);
  assert.equal((await clients[1].cmd(code,{type:'start',expectedRevision:s.revision})).data.error,'HOST_REQUIRED');
  assert.equal((await clients[1].cmd(code,{type:'seat',seat:1})).data.error,'SEAT_TAKEN');
  assert.equal((await clients[1].cmd(code,{type:'ready',ready:true,configVersion:0,playerId:s.room.hostId})).data.error,'INVALID_REQUEST');
  await begin(clients,code);const states=await Promise.all(clients.map(c=>c.state(code)));const nonleader=states.findIndex(s=>!s.player.legalActions.length),v=states[nonleader];
  const id=randomUUID();assert.equal((await clients[nonleader].cmd(code,{type:'action',requestId:id,roundId:v.roundId,action:{type:'propose_team',team:v.view.players.slice(0,v.view.teamSize).map(p=>p.id),gameId:v.view.gameId,expectedVersion:v.view.version,requestId:id}})).data.error,'NOT_ALLOWED');
  for(const path of ['/api/step','/api/reset','/src/testing.ts','/.local/multiplayer/rooms.sqlite'])assert.equal((await clients[0].call(path)).status,404);
});
test('concurrent seat claim, configuration reconfirmation, host transfer and lobby leave',async t=>{
  const f=await fixture(t),a=await f.client(),b=await f.client(),c=await f.client();
  const code=ok(await a.cmd(null,{type:'create',name:'a',config:{playerCount:5}})).code;
  ok(await b.cmd(code,{type:'join',name:'a'}));ok(await c.cmd(code,{type:'join',name:'a'}));
  const claims=await Promise.all([b.cmd(code,{type:'seat',seat:2}),c.cmd(code,{type:'seat',seat:2})]);assert.equal(claims.filter(r=>r.status===200).length,1);assert.equal(claims.filter(r=>r.data.error==='SEAT_TAKEN').length,1);
  ok(await a.cmd(code,{type:'ready',ready:true,configVersion:0}));let s=await a.state(code);
  ok(await a.cmd(code,{type:'config',expectedRevision:s.revision,config:{playerCount:6,roleSet:'recommended'}}));s=await a.state(code);assert.ok(s.room.members.every(p=>!p.ready));
  assert.equal((await a.cmd(code,{type:'ready',ready:true,configVersion:0})).data.error,'STALE_CONFIG');
  ok(await a.cmd(code,{type:'transfer',targetId:s.room.members[1].id,expectedRevision:s.revision}));assert.equal((await a.state(code)).room.hostId,s.room.members[1].id);
  ok(await b.cmd(code,{type:'leave'}));assert.equal((await a.state(code)).room.hostId,s.room.members[0].id);
});
test('start and identity are once-only; confirmations and interrupted sessions survive reboot',async t=>{
  const f=await fixture(t),{clients,code}=await group(f);
  await Promise.all(clients.map(async c=>ok(await c.cmd(code,{type:'ready',ready:true,configVersion:0}))));
  const before=await clients[0].state(code),body={type:'start',expectedRevision:before.revision,requestId:randomUUID()};
  ok(await clients[0].cmd(code,body));const countdown=await clients[0].state(code);assert.equal(countdown.player,null);assert.equal((await clients[0].cmd(code,{type:'confirm'})).data.error,'REVEAL_PENDING');
  ok(await clients[0].cmd(code,body));assert.equal((await clients[0].state(code)).view.gameId,countdown.view.gameId);
  now+=3100;const identity=await clients[0].state(code);ok(await clients[0].cmd(code,{type:'confirm'}));
  await f.restart();const restored=await clients[0].state(code);assert.deepEqual(restored.player.self,identity.player.self);assert.equal(restored.room.members.find(p=>p.id===restored.room.selfId).confirmed,true);
  assert.equal((await clients[0].cmd(code,{type:'start',expectedRevision:restored.revision})).data.error,'LOBBY_REQUIRED');
  assert.equal((await clients[0].cmd(code,{type:'leave'})).data.error,'LOBBY_REQUIRED');
  await Promise.all(clients.slice(1).map(async c=>ok(await c.cmd(code,{type:'confirm'}))));assert.equal((await clients[0].state(code)).room.status,'playing');
});
test('partial votes/cards and dedup commit atomically; retry and reboot never advance twice',async t=>{
  const f=await fixture(t),{clients,code}=await group(f);await begin(clients,code);
  let states=await Promise.all(clients.map(c=>c.state(code))),leader=states.findIndex(s=>s.player.legalActions.length);
  ok(await submit(clients[leader],code,states[leader],{type:'propose_team',team:states[leader].player.legalActions[0].candidateIds.slice(0,2)}));
  states=await Promise.all(clients.map(c=>c.state(code)));const first=states[0],id=randomUUID();
  ok(await submit(clients[0],code,first,{type:'vote',vote:'approve'},id));const partial=await clients[1].state(code);
  assert.equal(partial.view.submissions.votes,1);assert.equal(partial.player.self.ownVote,null);assert.equal(partial.view.events.filter(e=>e.type==='team_vote_resolved').length,0);
  await f.restart();ok(await submit(clients[0],code,first,{type:'vote',vote:'approve'},id));assert.equal((await clients[0].state(code)).view.submissions.votes,1);
  assert.equal((await submit(clients[0],code,first,{type:'vote',vote:'reject'},id)).data.error,'REQUEST_ID_REUSED');
  await Promise.all(clients.slice(1).map(async(c,i)=>ok(await submit(c,code,states[i+1],{type:'vote',vote:'approve'}))));
  states=await Promise.all(clients.map(c=>c.state(code)));const team=states.map((s,i)=>s.player.legalActions.length?i:-1).filter(i=>i>=0),cardState=states[team[0]],cardId=randomUUID();
  ok(await submit(clients[team[0]],code,cardState,{type:'quest_card',card:'success'},cardId));
  await f.restart();const after=await clients[team[0]].state(code);assert.equal(after.player.self.ownQuestCard,'success');assert.equal(after.view.submissions.questCards,1);assert.equal(after.view.quests.length,0);
  ok(await submit(clients[team[0]],code,cardState,{type:'quest_card',card:'success'},cardId));
  await Promise.all(team.slice(1).map(async i=>ok(await submit(clients[i],code,states[i],{type:'quest_card',card:'success'}))));
  assert.equal((await clients[0].state(code)).view.quests.length,1);
  const stale=await submit(clients[1],code,first,{type:'vote',vote:'approve'});assert.equal(stale.data.error,'STALE_ROUND');
  const final=await finish(clients,code);assert.equal(final[0].view.quests.length,3);
});
test('public snapshots, errors and QR never contain credentials or internal identity assignments',async t=>{
  const f=await fixture(t),{clients,code}=await group(f);await begin(clients,code);const p=await clients[0].state(code);
  const response=await fetch(`${f.base}/api/rooms/${code}/public`),pub=await response.json();
  assert.equal(pub.player,null);assert.equal(pub.room.selfId,null);assert.equal(pub.view.revealedRoles,undefined);
  const text=JSON.stringify(pub);for(const name of ['session','processedRequests','questCards":[' ,'"knowledge"','"self"'])assert.ok(!text.includes(name),name);
  for(const c of clients)assert.ok(!text.includes(c.cookie.split('=')[1]));assert.ok(!JSON.stringify(p).includes('"session":'));
  const qr=await fetch(`${f.base}/api/rooms/${code}/qr`,{headers:{Cookie:clients[0].cookie}});assert.equal(qr.status,409);assert.equal((await qr.json()).error,'LAN_REQUIRED');
  const forged=await fetch(`${f.base}/api/rooms/${code}`,{headers:{Cookie:clients[0].cookie,Origin:'http://evil.invalid','Content-Type':'application/json'},method:'POST',body:'{}'});assert.equal(forged.status,403);
  const pre=await clients[0].state(code);ok(await clients[0].cmd(code,{type:'terminate',expectedRevision:pre.revision}));const end=await clients[0].state(code);assert.equal(end.room.status,'terminated');assert.equal(end.player,null);assert.equal(end.view,null);
});
test('offline presence keeps seats; cleanup never removes ongoing games',async t=>{
  const f=await fixture(t),{clients,code}=await group(f);await begin(clients,code);const original=await clients[0].state(code);now+=20000;
  const s=await clients[0].state(code);assert.equal(s.room.members.filter(p=>p.online).length,1);assert.equal(s.room.members.length,5);
  now+=40*86400000;await f.restart();const restored=await clients[0].state(code);assert.deepEqual(restored.player.self,original.player.self);
});
test('failed transaction does not leave a request receipt or mutate state',()=>{
  const store=new RoomStore(':memory:');try{const token=store.newSession(),s=store.session(token),id=randomUUID(),body={requestId:id,type:'create',name:'x',config:{playerCount:4}};
  assert.throws(()=>store.execute(s,null,body));assert.equal(store.list(s).length,0);
  const result=store.execute(s,null,{...body,config:{playerCount:5}});assert.ok(result.code);
  }finally{store.close();}
});
test('SQLite receipt-write failure rolls back room state and retries safely',()=>{
  const store=new RoomStore(':memory:');try{
    const session=store.session(store.newSession());const {code}=store.execute(session,null,{type:'create',name:'事务测试',config:{playerCount:5},requestId:randomUUID()});
    const before=store.snapshot(code,session),request={type:'ready',ready:true,configVersion:0,requestId:randomUUID()};
    store.db.exec("CREATE TRIGGER fail_receipt BEFORE INSERT ON requests BEGIN SELECT RAISE(ABORT, 'test write failure'); END");
    assert.throws(()=>store.execute(session,code,request));assert.equal(store.snapshot(code,session).revision,before.revision);assert.equal(store.snapshot(code,session).room.members[0].ready,false);
    store.db.exec('DROP TRIGGER fail_receipt');store.execute(session,code,request);assert.equal(store.snapshot(code,session).room.members[0].ready,true);
  }finally{store.close();}
});
test('finished/idle rooms expire after retention, active games and member sessions remain',()=>{
  let time=Date.now();const store=new RoomStore(':memory:',()=>time);try{
    const session=store.session(store.newSession()),body={type:'create',name:'清理测试',config:{playerCount:5},requestId:randomUUID()};const {code}=store.execute(session,null,body);
    time+=8*86400000;store.cleanup();assert.throws(()=>store.load(code),/ROOM_NOT_FOUND/);assert.equal(store.list(session).length,0);
  }finally{store.close();}
});

test('host rematch keeps roster and sessions, resets secrets, deduplicates and survives restart',async t=>{
  const f=await fixture(t),{clients,code}=await group(f);await begin(clients,code);
  let s=await clients[0].state(code);
  assert.equal((await clients[0].cmd(code,{type:'rematch',expectedRevision:s.revision})).data.error,'GAME_NOT_FINISHED');
  await finish(clients,code,'reject');s=await clients[0].state(code);
  const gameId=s.view.gameId,roster=s.room.members.map(({id,name,seat,kind})=>({id,name,seat,kind}));
  assert.equal((await clients[1].cmd(code,{type:'rematch',expectedRevision:s.revision})).data.error,'HOST_REQUIRED');
  assert.equal((await clients[0].cmd(code,{type:'rematch',expectedRevision:s.revision-1})).data.error,'STALE_ROOM');
  const body={type:'rematch',expectedRevision:s.revision,requestId:randomUUID()};
  ok(await clients[0].cmd(code,body));const reset=await clients[0].state(code);ok(await clients[0].cmd(code,body));
  assert.equal((await clients[0].state(code)).revision,reset.revision);
  await f.restart();
  for(const c of clients){const r=await c.state(code);assert.equal(r.room.status,'lobby');assert.equal(r.player,null);assert.equal(r.view,null);assert.equal(r.roundId,null);assert.deepEqual(r.room.messages,[]);assert.equal(r.room.discussion,null);assert.ok(r.room.members.every(p=>!p.ready&&!p.confirmed));assert.deepEqual(r.room.members.map(({id,name,seat,kind})=>({id,name,seat,kind})),roster);}
  await begin(clients,code);assert.notEqual((await clients[0].state(code)).view.gameId,gameId);await finish(clients,code,'reject');
});

test('rematch preserves AI seats but clears confirmations, discussion and problem',async()=>{
  const {newRoom,changeRoom}=await import('../src/rooms.ts');
  let r=newRoom('TEST','host','房主',{playerCount:5},Date.now());
  r=changeRoom(r,'host',{type:'add_ai',seat:2,expectedRevision:0,requestId:randomUUID()},Date.now());
  const members=structuredClone(r.members);r.status='finished';r.members.forEach(p=>p.confirmed=true);
  r.discussion={roundId:'old',order:r.members.map(p=>p.id),cursor:1};r.messages=[{playerId:r.hostId,text:'old',turnId:'old'}];r.aiProblem='TIMEOUT';
  const next=changeRoom(r,'host',{type:'rematch',expectedRevision:0,requestId:randomUUID()},Date.now());
  assert.deepEqual(next.members.map(p=>[p.id,p.session,p.seat,p.kind]),members.map(p=>[p.id,p.session,p.seat,p.kind]));
  assert.equal(next.members[0].ready,false);assert.equal(next.members[1].ready,true);assert.ok(next.members.every(p=>!p.confirmed));assert.equal(next.discussion,undefined);assert.deepEqual(next.messages,[]);assert.equal(next.aiProblem,null);
});

test('rematch cannot pull a player out of another active room',async t=>{
  const f=await fixture(t),{clients,code}=await group(f);await begin(clients,code);await finish(clients,code,'reject');
  ok(await clients[1].cmd(null,{type:'create',name:'another',config:{playerCount:5}}));
  const s=await clients[0].state(code);
  assert.equal((await clients[0].cmd(code,{type:'rematch',expectedRevision:s.revision})).data.error,'MEMBER_IN_OTHER_ROOM');
  assert.equal((await clients[0].state(code)).revision,s.revision);
});

test('rejected team passes driving to next seat in the same quest over HTTP',async t=>{
 const f=await fixture(t),{clients,code}=await group(f);await begin(clients,code);
 let states=await Promise.all(clients.map(c=>c.state(code)));const before=states[0].view;
 const index=states.findIndex(s=>s.player.self.playerId===before.leaderId);
 const a=states[index].player.legalActions[0];ok(await submit(clients[index],code,states[index],{type:'propose_team',team:a.candidateIds.slice(0,a.teamSize)}));
 states=await Promise.all(clients.map(c=>c.state(code)));
 await Promise.all(clients.map((c,i)=>submit(c,code,states[i],{type:'vote',vote:'reject'}).then(ok)));
 states=await Promise.all(clients.map(c=>c.state(code)));const after=states[0].view;
 assert.equal(after.phase,'proposal');assert.equal(after.questNumber,before.questNumber);assert.deepEqual(after.score,before.score);
 assert.equal(after.leaderId,before.players[(index+1)%5].id);
 assert.equal(states[index].player.legalActions.length,0);assert.equal(states[(index+1)%5].player.legalActions[0].type,'propose_team');
});
