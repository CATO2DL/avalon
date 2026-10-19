import test from 'node:test';
import assert from 'node:assert/strict';
import { getPublicView, getPlayerView, alignmentOf } from '../src/index.ts';
import { fixture, roleId, propose, voteAll, act } from './helpers.mjs';
import { createVisualDemo } from '../src/visual-demo.ts';

function hidden(game) {
  assert.equal(Object.hasOwn(getPublicView(game),'revealedRoles'),false);
  for(const p of game.players)assert.equal(Object.hasOwn(getPlayerView(game,p.id).public,'revealedRoles'),false);
}
function revealed(game) {
  assert.equal(game.phase,'ended');
  const view=getPublicView(game);
  assert.deepEqual(view.revealedRoles,game.players.map(p=>{const r=game.roles.find(r=>r.playerId===p.id);return {playerId:p.id,role:r.role,alignment:alignmentOf(r.role)};}));
  for(const forbidden of ['roles','questCards','votes','processedRequests'])assert.equal(Object.hasOwn(view,forbidden),false);
  for(const p of game.players)assert.deepEqual(getPlayerView(game,p.id).public.revealedRoles,view.revealedRoles);
  view.revealedRoles[0].role='invalid';assert.notEqual(getPublicView(game).revealedRoles[0].role,'invalid');
}
for(const n of [5,6,7,8,9,10])test(`${n} players: reveal only after all four terminal paths, never during assassination or pending inputs`,()=>{
  for(const hit of [false,true]){
    let g=fixture(n);hidden(g);
    for(let q=0;q<3;q++){g=propose(g);hidden(g);g=voteAll(g);hidden(g);for(const id of [...g.team]){g=act(g,id,{type:'quest_card',card:'success'});hidden(g);}}
    assert.equal(g.phase,'assassination');hidden(g);
    g=act(g,roleId(g,'assassin'),{type:'assassinate',targetId:roleId(g,hit?'merlin':'loyal')});revealed(g);
  }
  let g=fixture(n);
  for(let i=0;i<5;i++){g=propose(g);hidden(g);g=voteAll(g,0);if(i<4)hidden(g);}
  assert.equal(g.outcome.reason,'five_rejections');revealed(g);
  g=fixture(n);
  for(let i=0;i<3;i++){
    const size=getPublicView(g).teamSize;
    const evil=roleId(g,'assassin');const team=[evil,...g.players.filter(p=>p.id!==evil).slice(0,size-1).map(p=>p.id)];
    g=voteAll(propose(g,team));hidden(g);for(const id of team){g=act(g,id,{type:'quest_card',card:id===evil?'fail':'success'});if(g.phase!=='ended')hidden(g);}
  }
  assert.equal(g.outcome.reason,'three_failed_quests');revealed(g);
});
test('reset after an ended public session clears revealed identities from the next game',()=>{
  const d=createVisualDemo();let s=d.change(0,'rejections',6,'public');
  while(s.view.phase!=='ended'){assert.equal('revealedRoles' in s.view,false);s=d.change(s.revision);}
  assert.equal(s.view.revealedRoles.length,6);
  s=d.change(s.revision,'assassination',6,'public');assert.equal('revealedRoles' in s.view,false);
});
