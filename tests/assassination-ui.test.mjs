import test from 'node:test';
import assert from 'node:assert/strict';
import { createTestGame } from '../src/testing.ts';
import { getPlayerView, getPublicView } from '../src/index.ts';
import { players, playQuest, roleId } from './helpers.mjs';
import { assassinationTeammateIds } from '../web/ui.js';

for (const companion of ['morgana','minion']) test(`assassination ally badges use only private knowledge with ${companion}`,()=>{
  let g=createTestGame({playerCount:10,roles:['merlin','percival','loyal','loyal','loyal','loyal','assassin',companion,'mordred','oberon']},players(10),42);
  for(let i=0;i<3;i++)g=playQuest(g);
  assert.equal(g.phase,'assassination');
  for(const p of g.players){
    const view=getPlayerView(g,p.id), ids=assassinationTeammateIds(view);
    if(view.self.alignment==='good')assert.deepEqual(ids,[]);
    else {
      const expected=g.players.filter(other=>other.id!==p.id&&[roleId(g,'assassin'),roleId(g,companion),roleId(g,'mordred'),roleId(g,'oberon')].includes(other.id)).map(x=>x.id);
      assert.deepEqual(ids,expected);
      if(view.self.role!=='oberon')assert(ids.includes(roleId(g,'oberon')));
      if(view.self.role==='assassin')for(const id of ids)assert(!view.legalActions[0].candidateIds.includes(id));
    }
  }
  assert.deepEqual(assassinationTeammateIds(null),[]);
  assert(!('self' in getPublicView(g)));
});
test('ally badges are absent outside assassination',()=>{
  const g=createTestGame({playerCount:6},players(6),42);
  assert.deepEqual(assassinationTeammateIds(getPlayerView(g,roleId(g,'assassin'))),[]);
});

test('stage reveal house rule: good sees all, evil all allies including Oberon, public never reveals early',()=>{
  let g=createTestGame({playerCount:10,roles:['merlin','percival','loyal','loyal','loyal','loyal','assassin','morgana','mordred','oberon']},players(10),42);
  const checkHidden=()=>{for(const p of g.players){const v=getPlayerView(g,p.id);assert.equal(Object.hasOwn(v.self,'assassinationRoles'),false);if(v.self.role==='oberon')assert.deepEqual(v.self.knowledge.knownAlignments,[]);else if(v.self.role!=='merlin')assert(!v.self.knowledge.knownAlignments.some(x=>x.playerId===roleId(g,'oberon')));}};
  checkHidden();
  for(let i=0;i<2;i++){g=playQuest(g);checkHidden();}
  g=playQuest(g);
  for(const p of g.players){
    const v=getPlayerView(g,p.id), entries=v.self.assassinationRoles;
    const allowed=v.self.alignment==='good'?g.players.map(p=>p.id):g.players.filter(p=>p.id!==v.self.playerId&&['assassin','morgana','mordred','oberon'].includes(g.roles.find(r=>r.playerId===p.id).role)).map(p=>p.id);
    assert.deepEqual(entries,allowed.map(id=>({playerId:id,role:g.roles.find(r=>r.playerId===id).role,alignment:g.roles.find(r=>r.playerId===id).role==='merlin'||['percival','loyal'].includes(g.roles.find(r=>r.playerId===id).role)?'good':'evil'})));
    if(v.self.role==='oberon'){assert.equal(entries.length,3);assert.deepEqual(v.self.knowledge.knownAlignments,[]);}
    entries.push({playerId:'fake',role:'merlin',alignment:'good'});
    assert(!getPlayerView(g,p.id).self.assassinationRoles.some(r=>r.playerId==='fake'));
  }
  const publicView=getPublicView(g);
  assert.equal(Object.hasOwn(publicView,'revealedRoles'),false);
  assert(!JSON.stringify(publicView.events).includes('assassinationRoles'));
  // Swapping unknown Merlin/loyal roles cannot change the assassin's response.
  const assassin=roleId(g,'assassin'),before=getPlayerView(g,assassin),changed=structuredClone(g);
  const a=changed.roles.find(r=>r.role==='merlin'),b=changed.roles.find(r=>r.role==='loyal');
  [a.role,b.role]=[b.role,a.role];
  assert.deepEqual(getPlayerView(changed,assassin),before);
});
