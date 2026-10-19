import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {mkdtempSync,rmSync} from 'node:fs';
import {join} from 'node:path';
import {tmpdir} from 'node:os';
import {RoomStore} from '../scripts/room-store.mjs';
import {AIRuntime} from '../scripts/ai-runtime.mjs';
import {getPlayerView} from '../src/index.ts';

function fixture(t,n=5,{maxCalls=100,failOnce=false}={}){
  const dir=mkdtempSync(join(tmpdir(),'avalon-multi-ai-')),path=join(dir,'room.sqlite');let now=100000,store=new RoomStore(path,()=>now),ai,failed=false;const inputs=[];
  const adapter={model:'OFFLINE-MULTI',async decide(input){
    inputs.push(structuredClone(input));if(failOnce&&!failed){failed=true;throw new Error('fixture network failure');}
    const expected=`memory:${input.view.self.playerId}`;
    assert.ok(input.memory.legacyNote===''||input.memory.legacyNote===expected,'another AI memory leaked');
    assert.deepEqual(input.view.self,getPlayerView(store.load(code).game,input.view.self.playerId).self);
    return {model:'OFFLINE-MULTI',tokens:1,decision:{choice:0,speech:input.kind==='speech'?'看看这次队伍。':'',memory:expected}};
  }};
  ai=new AIRuntime(store,adapter,{maxCalls,minInterval:0});const host=store.session(store.newSession());
  const cmd=body=>store.execute(host,code,{requestId:randomUUID(),...body});
  const code=store.execute(host,null,{requestId:randomUUID(),type:'create',name:'真人',config:{playerCount:n,roleSet:'recommended'}}).code;
  for(let seat=2;seat<=n;seat++)cmd({type:'add_ai',seat,expectedRevision:store.load(code).revision});
  t.after(()=>{ai.close();store.close();rmSync(dir,{recursive:true,force:true});});
  return {get ai(){return ai;},get store(){return store;},host,code,inputs,cmd,snapshot:()=>store.snapshot(code,host),async start(){cmd({type:'ready',ready:true,configVersion:0});cmd({type:'start',expectedRevision:store.load(code).revision});now+=3100;await ai.tick();cmd({type:'confirm'});},restart(nextMax=maxCalls){maxCalls=nextMax;ai.close();store.close();store=new RoomStore(path,()=>now);ai=new AIRuntime(store,adapter,{maxCalls,minInterval:0});}};
}
async function step(f){
  const s=f.snapshot(),d=s.room.discussion,a=s.player?.legalActions[0];
  if(d?.active&&d.speakerId===s.room.selfId)f.cmd({type:'speak',turnId:d.turnId,text:''});
  else if(a){const requestId=randomUUID(),p=a.type==='propose_team'?{type:a.type,team:a.candidateIds.slice(0,a.teamSize)}:a.type==='vote'?{type:a.type,vote:'approve'}:a.type==='quest_card'?{type:a.type,card:'success'}:{type:a.type,targetId:a.candidateIds[0]};f.cmd({type:'action',requestId,roundId:s.roundId,action:{...p,requestId,gameId:a.gameId,expectedVersion:a.expectedVersion}});}
  await f.ai.tick();
}
for(const n of [5,6,7,8,9,10])test(`${n} seats: one human + ${n-1} independent AI complete game across restart`,async t=>{
  const f=fixture(t,n);await f.start();assert.ok(f.snapshot().room.members.every(p=>p.confirmed));
  let restarted=false;for(let i=0;i<200&&f.snapshot().room.status!=='finished';i++){await step(f);if(!restarted&&f.inputs.length>=n){f.restart();restarted=true;}}
  assert.equal(f.snapshot().room.status,'finished');assert.ok(restarted);assert.equal(new Set(f.inputs.map(x=>x.view.self.playerId)).size,n-1);
  const memories=f.store.db.prepare('SELECT actor,memory FROM ai_memory').all();assert.equal(memories.length,n-1);for(const m of memories)assert.equal(JSON.parse(m.memory).legacyNote,`memory:${m.actor}`);
  assert.ok(!JSON.stringify(f.store.snapshot(f.code,null)).includes('memory:'));assert.ok(!JSON.stringify(f.snapshot()).includes('memory:'));
  assert.equal(f.store.db.prepare("SELECT count(*) n FROM ai_jobs WHERE status!='done'").get().n,0);
  assert.equal(f.ai.calls(f.snapshot().view.gameId),f.inputs.length);
});
test('remove targets exactly one AI; ambiguous legacy removal and occupied seats are rejected',t=>{
  const f=fixture(t),before=f.snapshot(),ais=before.room.members.filter(p=>p.kind==='ai');
  assert.equal(new Set(ais.map(p=>p.name)).size,4);
  assert.throws(()=>f.cmd({type:'remove_ai',expectedRevision:before.revision}),/INVALID_TARGET/);
  assert.throws(()=>f.cmd({type:'remove_ai',targetId:before.room.selfId,expectedRevision:before.revision}),/INVALID_TARGET/);
  assert.throws(()=>f.cmd({type:'add_ai',seat:2,expectedRevision:before.revision}),/ROOM_FULL/);
  const requestId=randomUUID(),body={type:'remove_ai',targetId:ais[1].id,expectedRevision:before.revision,requestId};f.cmd(body);f.cmd(body);
  assert.deepEqual(f.snapshot().room.members.filter(p=>p.kind==='ai').map(p=>p.id),ais.filter(p=>p.id!==ais[1].id).map(p=>p.id));
  assert.ok(f.snapshot().room.members.filter(p=>p.kind==='ai').every(p=>p.ready));
  f.cmd({type:'add_ai',seat:3,expectedRevision:f.snapshot().revision});assert.notEqual(f.snapshot().room.members.find(p=>p.seat===3).id,ais[1].id);
});
test('one AI failure remains visible and pauses its room until host recovery; budget is shared',async t=>{
  const f=fixture(t,5,{maxCalls:2,failOnce:true});await f.start();await step(f);assert.equal(f.snapshot().room.aiProblem,'NETWORK_ERROR');
  const first=f.inputs[0].view.self.playerId;for(let i=0;i<3;i++)await step(f);assert.equal(f.inputs.length,1);assert.equal(f.snapshot().room.aiProblem,'NETWORK_ERROR');
  f.cmd({type:'ai_retry',expectedRevision:f.snapshot().revision});await step(f);assert.equal(f.inputs.length,2);assert.equal(f.inputs[1].view.self.playerId,first);
  await step(f);assert.equal(f.snapshot().room.aiProblem,'CALL_LIMIT');f.restart();await step(f);assert.equal(f.inputs.length,2);assert.equal(f.ai.calls(f.snapshot().view.gameId),2);
});

test('explicit zero call cap allows more than 40 decisions, preserves receipts and survives restart',async t=>{
  const f=fixture(t,10,{maxCalls:'0'});await f.start();assert.equal(f.ai.maxCalls,Infinity);
  let restarted=false;for(let i=0;i<250&&f.snapshot().room.status!=='finished';i++){await step(f);if(!restarted&&f.inputs.length>40){f.restart();restarted=true;}}
  assert.equal(f.snapshot().room.status,'finished');assert.ok(restarted);assert.ok(f.inputs.length>40);assert.equal(f.ai.calls(f.snapshot().view.gameId),f.inputs.length);
});


test('explicit cap removal releases only unsent budget-blocked work and preserves successful calls',async t=>{
  const f=fixture(t,5,{maxCalls:2});await f.start();for(let i=0;i<4;i++)await step(f);
  assert.equal(f.snapshot().room.aiProblem,'CALL_LIMIT');assert.equal(f.inputs.length,2);
  const done=f.store.db.prepare("SELECT id FROM ai_jobs WHERE status='done'").all().map(x=>x.id);
  f.restart(0);assert.equal(f.snapshot().room.aiProblem,null);await step(f);assert.equal(f.inputs.length,3);
  for(const id of done)assert.equal(f.store.db.prepare('SELECT attempts FROM ai_jobs WHERE id=?').get(id).attempts,1);
  assert.equal(f.ai.calls(f.snapshot().view.gameId),3);
});
test('cap removal does not silently recover an already attempted failed request',async t=>{
  const f=fixture(t,5,{maxCalls:2,failOnce:true});await f.start();await step(f);assert.equal(f.inputs.length,1);
  f.restart(0);await step(f);assert.equal(f.snapshot().room.aiProblem,'NETWORK_ERROR');assert.equal(f.inputs.length,1);
});
