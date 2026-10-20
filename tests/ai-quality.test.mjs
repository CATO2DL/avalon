import test from 'node:test';
import assert from 'node:assert/strict';
import {decisionBrief} from '../src/ai-brief.ts';
import {modelInput} from '../src/ai.ts';
import {getPlayerView} from '../src/index.ts';
import {createTestGame} from '../src/testing.ts';
import {fixture,players,playQuest,propose,voteAll,evilIds} from './helpers.mjs';
import {withStrategy} from '../scripts/avalon-strategy.mjs';
import {memoryFor,commitMemory,emptyPatch} from '../src/ai-memory.ts';

test('brief preserves candidate ambiguity and derives only the supplied filtered view',()=>{
 const g=createTestGame({playerCount:6,roleSet:'recommended'},players(6),11),id=g.roles.find(r=>r.role==='percival').playerId;
 const view=getPlayerView(g,id),brief=decisionBrief(view,[]),swapped=structuredClone(g);
 const m=swapped.roles.find(r=>r.role==='merlin'),morgana=swapped.roles.find(r=>r.role==='morgana');[m.role,morgana.role]=[morgana.role,m.role];
 assert.deepEqual(decisionBrief(getPlayerView(swapped,id),[]),brief);assert.deepEqual(brief.knownEvilOnTeam,[]);assert.deepEqual(brief.excludedMerlinCandidates,[]);
});
test('decisive failure and rejection cues do not inspect hidden task cards',()=>{
 let g=playQuest(playQuest(fixture(5),1),1);const evil=evilIds(g)[0];g=voteAll(propose(g,[evil,...g.players.filter(p=>!evilIds(g).includes(p.id)).slice(0,1).map(p=>p.id)]));
 const brief=decisionBrief(getPlayerView(g,evil),[]);assert.equal(brief.failureWouldBeThird,true);assert.equal(brief.selfFailureAloneFailsQuest,true);
 const view=getPlayerView(g,evil);view.public.rejectionCount=4;view.public.config.rejectionMode='cumulative';const b=decisionBrief(view,[]);assert.equal(b.nextRejectionEndsGame,true);assert.equal(b.rejectionMode,'cumulative');assert.ok(!JSON.stringify(b).includes('ownQuestCard'));
});
test('two-failure threshold is not advertised as a solo winning failure',()=>{
 const view=getPlayerView(fixture(7),evilIds(fixture(7))[0]);view.public.phase='quest';view.public.failThreshold=2;view.public.score.evil=2;
 assert.equal(decisionBrief(view,[]).selfFailureAloneFailsQuest,false);
});
test('all public messages remain intact; claims are not facts and own stance stays isolated',()=>{
 const g=fixture(5),v=getPlayerView(g,'p1'),messages=Array.from({length:75},(_,i)=>({playerId:i%2?'p1':'p2',text:`claim ${i}`,turnId:String(i)}));
 const input=modelInput(v,messages,'','speech','r');assert.equal(input.publicMessages.length,75);assert.equal(input.context.brief.recentPublicClaims.length,8);assert.ok(input.context.brief.recentPublicClaims.every(x=>!x.verifiedFact));assert.ok(input.context.brief.ownPublicStance.every(x=>Number(x.reference.split(':')[1])%2));
 const stored=commitMemory(v,messages,'',{...emptyPatch(),currentGoal:'old plan'},'r');assert.equal(memoryFor(getPlayerView(g,'p2'),messages,stored,'r').currentGoal,'');assert.equal(memoryFor(v,messages,stored,'other-room').currentGoal,'');
 assert.ok(withStrategy(input).strategy.text.includes('不能因公开支持队伍就强迫邪恶交成功牌'));
});
test('assassination brief excludes only legitimately visible evil, never invents Merlin',()=>{
 const g=playQuest(playQuest(playQuest(fixture(5)))),id=evilIds(g)[0],v=getPlayerView(g,id),b=decisionBrief(v,[]);
 assert.deepEqual([...b.excludedMerlinCandidates].sort(),evilIds(g).sort());assert.equal(Object.hasOwn(b,'merlinId'),false);
});
