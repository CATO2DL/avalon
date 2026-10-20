import test from 'node:test';
import assert from 'node:assert/strict';
import {fixture,playQuest,propose,voteAll,act,action} from './helpers.mjs';
import {createTestGame} from '../src/testing.ts';
import {players} from './helpers.mjs';
import {alignmentOf} from '../src/index.ts';
import {changeRoom,roundId,roomSnapshot} from '../src/rooms.ts';
for(const n of [5,10])test(`assassination discussion ${n}: evil speak freely, justice read only, assassin never waits`,()=>{
 const initial=n===10?createTestGame({playerCount:10,roles:['merlin','percival','loyal','loyal','loyal','loyal','assassin','morgana','mordred','oberon']},players(10),42):fixture(n);
 let g=playQuest(playQuest(initial));g=voteAll(propose(g));
 for(const id of g.team.slice(0,-1))g=act(g,id,{type:'quest_card',card:'success'});
 let r={code:'TEST',config:g.config,configVersion:0,revision:0,hostId:'p1',members:g.players.map((p,i)=>({...p,session:p.id,seat:i+1,ready:true,confirmed:true})),status:'playing',game:g,revealAt:0,createdAt:0,updatedAt:0,closedAt:null};
 const a=action(g,{type:'quest_card',card:'success'});
 r=changeRoom(r,g.team.at(-1),{type:'action',requestId:a.requestId,roundId:roundId(g),action:a},1);
 assert.equal(r.game.phase,'assassination');
 const evil=r.game.roles.filter(x=>alignmentOf(x.role)==='evil').map(x=>x.playerId),good=r.game.roles.find(x=>alignmentOf(x.role)==='good').playerId;
 r.discussion={roundId:roundId(r.game),order:[good,...evil],cursor:0}; // Legacy saved discussion must not block the new mode.
 const assassin=r.game.roles.find(x=>x.role==='assassin').playerId;
 const before=JSON.stringify(r),d=r.discussion;
 assert.throws(()=>changeRoom(r,good,{type:'speak',requestId:'forged',turnId:`${d.roundId}:0`,text:'bad'},1),/NOT_YOUR_TURN/);assert.equal(JSON.stringify(r),before);
 const strike=action(r.game,{type:'assassinate',targetId:good});
 assert.equal(changeRoom(r,assassin,{type:'action',requestId:strike.requestId,roundId:roundId(r.game),action:strike},1).status,'finished');
 for(const id of [...evil].reverse()){r=changeRoom(r,id,{type:'chat',requestId:`s-${id}`,text:'考虑2号'},1);}
 r=changeRoom(r,evil[0],{type:'chat',requestId:'again',text:'补充一个判断'},1);
 assert.throws(()=>changeRoom(r,good,{type:'chat',requestId:'good-chat',text:'不允许'},1),/NOT_YOUR_TURN/);
 const snapshot=roomSnapshot(r,good,1,()=>true);assert.equal(snapshot.room.messages.length,evil.length+1);assert.equal(snapshot.room.discussion,null);assert.equal(snapshot.player.legalActions.length,0);
 assert.equal(roomSnapshot(r,assassin,1,()=>true).player.legalActions[0].type,'assassinate');
});

test('AI assassination task ignores legacy speech order; allies may speak once without blocking assassin',async()=>{
 const {AIRuntime}=await import('../scripts/ai-runtime.mjs');
 const g=playQuest(playQuest(playQuest(fixture(5))));
 const assassin=g.roles.find(p=>p.role==='assassin').playerId,ally=g.roles.find(p=>p.role==='minion').playerId;
 const runtime={db:{prepare:()=>({get:()=>undefined})}};
 const r={status:'playing',code:'TEST',game:g,messages:[],discussion:{roundId:'legacy',order:['someone-else'],cursor:0}};
 const strike=AIRuntime.prototype.task.call(runtime,r,{id:assassin});assert.equal(strike.input.kind,'action');assert.equal(strike.input.choices[0].type,'assassinate');
 const speech=AIRuntime.prototype.task.call(runtime,r,{id:ally});assert.equal(speech.input.kind,'speech');
 r.messages.push({playerId:ally,phase:'assassination',text:'我的判断'});assert.equal(AIRuntime.prototype.task.call(runtime,r,{id:ally}),null);
});
