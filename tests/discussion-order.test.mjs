import test from 'node:test';
import assert from 'node:assert/strict';
import {changeRoom,roundId} from '../src/rooms.ts';
import {getPublicView} from '../src/index.ts';
import {fixture,action} from './helpers.mjs';
for(const n of [5,6,7,8,9,10])test(`${n} seats: captain speaks first, wraps seats, rejection starts with next captain`,()=>{
 const game=structuredClone(fixture(n));game.leaderIndex=n-1;
 let r={code:'TEST',config:game.config,configVersion:0,revision:0,hostId:'p1',members:game.players.map((p,i)=>({...p,session:p.id,seat:i+1,ready:true,confirmed:i!==0,...(i===n-1?{kind:'ai'}:{})})),status:'revealing',game,revealAt:0,createdAt:0,updatedAt:0,closedAt:null};
 r=changeRoom(r,'p1',{type:'confirm',requestId:'confirm'},1);
 assert.deepEqual(r.discussion.order,[`p${n}`,...game.players.slice(0,-1).map(p=>p.id)]);
 const previousRound=r.discussion.roundId;
 for(const id of r.discussion.order){const d=r.discussion;r=changeRoom(r,id,{type:'speak',requestId:`speech-${id}`,turnId:`${d.roundId}:${d.cursor}`,text:''},1);}
 const send=(id,payload)=>{const a=action(r.game,payload);r=changeRoom(r,id,{type:'action',requestId:a.requestId,roundId:roundId(r.game),action:a},1);};
 send(`p${n}`,{type:'propose_team',team:game.players.slice(0,getPublicView(r.game).teamSize).map(p=>p.id)});
 for(const p of game.players)send(p.id,{type:'vote',vote:'reject'});
 assert.equal(r.game.leaderIndex,0);assert.equal(r.game.questNumber,1);
 assert.notEqual(r.discussion.roundId,previousRound);assert.equal(r.discussion.cursor,0);
 assert.deepEqual(r.discussion.order,game.players.map(p=>p.id));
});
