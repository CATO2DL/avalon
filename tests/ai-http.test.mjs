import test from 'node:test';
import assert from 'node:assert/strict';
import { createRoomServer } from '../scripts/room-server.mjs';
import { runAIMatch } from '../scripts/ai-match.mjs';
test('HTTP: four isolated sessions and a server-only mock AI complete a real room protocol game',async()=>{
  const calls=[],adapter={model:'MOCK-HTTP',async decide(input){calls.push(input);return {decision:{choice:0,speech:input.kind==='speech'?'本轮看看队伍表现。':'',memory:'SERVER_PRIVATE_MEMORY'},model:'MOCK-HTTP',tokens:1};}};
  const server=createRoomServer({dbPath:':memory:',aiAdapter:adapter,aiOptions:{minInterval:0}});await new Promise(r=>server.listen(0,'127.0.0.1',r));const base=`http://127.0.0.1:${server.address().port}`;
  try{
    const result=await runAIMatch(base,{delay:5,maxSteps:5000,onStep(s){assert.ok(!JSON.stringify(s).includes('SERVER_PRIVATE_MEMORY'));assert.ok(!JSON.stringify(s).includes('systemInstruction'));assert.ok(s.room.members.every(p=>!('session' in p)));}});
    assert.equal(result.players,5);assert.ok(result.outcome);assert.ok(calls.length>0);
    for(const path of ['/.env','/scripts/ai-runtime.mjs','/scripts/ai-match.mjs','/.local/ai/','/api/ai/debug'])assert.equal((await fetch(base+path)).status,401);
    const snapshot=await (await fetch(`${base}/api/rooms/${result.code}/public`)).json();assert.equal(snapshot.player,null);assert.ok(!JSON.stringify(snapshot).includes('SERVER_PRIVATE_MEMORY'));
  }finally{server.closeIdleConnections();await new Promise(r=>server.close(r));}
});
test('HTTP verification host can recover once from a paused model request without replacing AI or bypassing rules',async()=>{
  let calls=0;const adapter={model:'MOCK-RECOVERY',async decide(input){if(++calls===1)throw new Error('network fixture');return {decision:{choice:0,speech:input.kind==='speech'?'恢复后继续讨论。':'',memory:''},model:'MOCK-RECOVERY',tokens:1};}};
  const server=createRoomServer({dbPath:':memory:',aiAdapter:adapter,aiOptions:{minInterval:0}});await new Promise(r=>server.listen(0,'127.0.0.1',r));
  try{const recoveries=[];const result=await runAIMatch(`http://127.0.0.1:${server.address().port}`,{delay:5,maxSteps:5000,recoverAI:true,onRecovery:code=>recoveries.push(code)});assert.ok(result.outcome);assert.deepEqual(recoveries,['NETWORK_ERROR']);}
  finally{server.closeIdleConnections();await new Promise(r=>server.close(r));}
});
