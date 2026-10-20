import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {createTestGame} from '../src/testing.ts';
import {validateConfig,getPublicView,getPlayerView} from '../src/index.ts';
import {players,propose,voteAll,act,playQuest} from './helpers.mjs';
import {RoomStore} from '../scripts/room-store.mjs';
import {changeRoom,roomSnapshot} from '../src/rooms.ts';
import {modelInput} from '../src/ai.ts';
import {loadStrategy} from '../scripts/avalon-strategy.mjs';
for(const n of [5,6,7,8,9,10])for(const mode of ['consecutive','cumulative'])test(`${n} ${mode}: reject, approve, next quest, fifth rejection and fresh game`,()=>{
 let g=createTestGame({playerCount:n,rejectionMode:mode},players(n),44);
 const reject=()=>{g=voteAll(propose(g),0);};
 reject();reject();assert.equal(g.rejectionCount,2);
 g=playQuest(g);assert.equal(g.rejectionCount,mode==='cumulative'?2:0);assert.equal(g.questNumber,2);
 for(let i=0;i<(mode==='cumulative'?3:5);i++)reject();
 assert.equal(g.outcome.reason,'five_rejections');assert.equal(g.quests.length,1);assert.equal(g.rejectionCount,5);
 const fresh=createTestGame(g.config,players(n),45);assert.equal(fresh.rejectionCount,0);
 const x=modelInput(getPlayerView(fresh,'p1'),[],'','speech');assert.equal(x.view.public.config.rejectionMode??'consecutive',mode);assert.match(loadStrategy(x).text,mode==='cumulative'?/队伍通过不清零/:/队伍通过清零/);
});
test('submission identities disclose progress only, never ballot/card values before collection',()=>{
 let g=voteAll(propose(createTestGame({playerCount:5},players(5),8)));
 const first=g.team[0];g=act(g,first,{type:'quest_card',card:'success'});
 const view=getPublicView(g);assert.deepEqual(view.submissionPlayers.quests,[first]);assert(!('questCards' in view));assert(!view.events.some(e=>e.type==='quest_resolved'));
 let v=propose(createTestGame({playerCount:5},players(5),8));v=act(v,'p1',{type:'vote',vote:'reject'});
 const publicView=getPublicView(v);assert.deepEqual(publicView.submissionPlayers.votes,['p1']);assert(!('votes' in publicView));assert(!publicView.events.some(e=>e.type==='team_vote_resolved'));
});
test('invalid nickname creates nothing; retry succeeds exactly once; config authority and rematch reset',()=>{
 const store=new RoomStore(':memory:');try{
 const user=store.session(store.newSession()),other=store.session(store.newSession());
 const id=randomUUID();assert.throws(()=>store.execute(user,null,{type:'create',requestId:id,name:'',config:{playerCount:5}}),/INVALID_NAME/);assert.equal(store.list(user).length,0);
 const request={type:'create',requestId:id,name:'test',config:{playerCount:5,rejectionMode:'cumulative'}};const {code}=store.execute(user,null,request);assert.equal(store.execute(user,null,request).replayed,true);assert.equal(store.list(user).length,1);
 store.execute(other,code,{type:'join',requestId:randomUUID(),name:'other'});let r=store.load(code);
 assert.throws(()=>store.execute(other,code,{type:'config',requestId:randomUUID(),expectedRevision:r.revision,config:{playerCount:5}}),/HOST_REQUIRED/);
 assert.throws(()=>validateConfig({playerCount:5,rejectionMode:'surprise'}),/INVALID_CONFIG/);
 r.status='playing';r.game=createTestGame(r.config,players(5),9);
 assert.throws(()=>changeRoom(r,user,{type:'config',requestId:randomUUID(),expectedRevision:r.revision,config:{playerCount:5}},1),/LOBBY_REQUIRED/);
 }finally{store.close();}
});
test('discussion shows spoken, explicit skip, waiting and failed without advancing failure; room chat is public',()=>{
 const g=createTestGame({playerCount:5},players(5),2),order=players(5).map(p=>p.id);
 const r={code:'TEST',config:g.config,configVersion:0,revision:0,hostId:'p1',members:g.players.map((p,i)=>({...p,session:p.id,seat:i+1,ready:true,confirmed:true,...(i===2?{kind:'ai'}:{})})),status:'playing',game:g,revealAt:0,createdAt:0,updatedAt:0,closedAt:null,discussion:{roundId:'speech',order,cursor:2},messages:[{playerId:'p1',text:'公开判断',turnId:'speech:0'},{playerId:'p2',text:'',turnId:'speech:1'}],aiProblem:'TIMEOUT'};
 const s=roomSnapshot(r,'p4',1,()=>true);assert.deepEqual(s.room.discussion.participants.map(p=>p.status),['spoken','skipped','failed','pending','pending']);assert.deepEqual(s.room.messages,r.messages);assert.equal(r.discussion.cursor,2);assert.equal(s.player.legalActions.length,0);
});
test('optional public explanation does not consume a turn; no assassination bypass',()=>{
 const g=createTestGame({playerCount:5},players(5),2);let r={code:'TEST',config:g.config,configVersion:0,revision:0,hostId:'p1',members:g.players.map((p,i)=>({...p,session:p.id,seat:i+1,ready:true,confirmed:true})),status:'playing',game:g,revealAt:0,createdAt:0,updatedAt:0,closedAt:null,discussion:{roundId:'test',order:['p1','p2','p3','p4','p5'],cursor:0}};
 r=changeRoom(r,'p2',{type:'chat',requestId:'optional-chat',text:'我愿意解释上一轮的反对票'},1);assert.equal(r.discussion.cursor,0);assert.equal(r.messages[0].text,'我愿意解释上一轮的反对票');assert.equal(roomSnapshot(r,'p3',1,()=>true).room.messages.length,1);
 r.game=playQuest(playQuest(playQuest(g)));assert.throws(()=>changeRoom(r,r.game.roles.find(p=>p.role==='merlin').playerId,{type:'chat',requestId:'bypass-chat',text:'不能绕过刺杀发言限制'},1),/NOT_YOUR_TURN/);
});
