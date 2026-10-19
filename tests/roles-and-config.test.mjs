import {test} from 'node:test';
import assert from 'node:assert/strict';
import {once} from 'node:events';
import {createGame, getPlayerView, getPublicView, getLegalActions, getRules, getRecommendedRoles, buildRoleConfig, validateConfig, getConfigNotes, alignmentOf} from '../src/index.ts';
import {createTestGame} from '../src/testing.ts';
import {createVisualDemo} from '../src/visual-demo.ts';
import {createDemoServer} from '../scripts/visual-server.mjs';
import {players,roleId,act,reject,propose,voteAll,playQuest} from './helpers.mjs';
import {runDemo} from '../scripts/demo.mjs';
const special=['merlin','percival','morgana','assassin','mordred','oberon'];
const full=()=>createTestGame(buildRoleConfig(10,special),players(10),22);
const knowledge=(g,id)=>getPlayerView(g,id).self.knowledge;
const ids=(g,...roles)=>g.players.filter(p=>roles.includes(g.roles.find(r=>r.playerId===p.id).role)).map(p=>p.id);
const swap=(g,a,b)=>{const copy=structuredClone(g);const x=copy.roles.find(r=>r.playerId===a),y=copy.roles.find(r=>r.playerId===b);[x.role,y.role]=[y.role,x.role];return copy;};

for(const n of [5,6,7,8,9,10])test(`${n} players: recommended setup and every fitting special-role subset complete a game`,()=>{
  const r=getRules(n),recommended=getRecommendedRoles(n);
  assert.equal(recommended.length,n);assert.equal(recommended.filter(x=>alignmentOf(x)==='good').length,r.goodCount);
  assert.equal(createGame({playerCount:n,roleSet:'recommended'},players(n)).roles.length,n);
  assert.ok(runDemo(n,42,'recommended').view.outcome);
  for(let mask=0;mask<16;mask++){
    const selected=['merlin','assassin',...['percival','morgana','mordred','oberon'].filter((_,i)=>mask&(1<<i))];
    if(selected.filter(x=>alignmentOf(x)==='evil').length>r.evilCount){assert.throws(()=>buildRoleConfig(n,selected),{code:'INVALID_CONFIG'});continue;}
    const config=buildRoleConfig(n,selected);let game=createTestGame(config,players(n),mask);
    for(let q=0;q<3;q++)game=playQuest(game,0);
    assert.equal(game.phase,'assassination');const assassin=roleId(game,'assassin');
    game=act(game,assassin,{type:'assassinate',targetId:roleId(game,'merlin')});
    assert.equal(game.outcome.winner,'evil');assert.equal(getPublicView(game).revealedRoles.length,n);
  }
});

test('eight role abilities match the matrix, with seat-ordered and detached knowledge',()=>{
  for(const excluded of ['oberon','mordred','morgana']){
    const g=createTestGame(buildRoleConfig(10,special.filter(x=>x!==excluded)),players(10),9);
    for(const p of g.players){
      const self=getPlayerView(g,p.id).self,role=g.roles.find(x=>x.playerId===p.id).role;
      assert.equal(self.role,role);assert.equal(self.alignment,alignmentOf(role));
      let expected=[];
      if(role==='merlin')expected=ids(g,'assassin','morgana','oberon','minion');
      else if(['assassin','morgana','mordred','minion'].includes(role))expected=ids(g,'assassin','morgana','mordred','minion').filter(id=>id!==p.id);
      assert.deepEqual(self.knowledge.knownAlignments,expected.map(playerId=>({playerId,alignment:'evil'})));
      assert.deepEqual(self.knowledge.roleCandidates,role==='percival'?[{kind:'merlin',playerIds:ids(g,'merlin','morgana'),possibleRoles:excluded==='morgana'?['merlin']:['merlin','morgana']}]:[]);
      self.knowledge.knownAlignments.push({playerId:'fake',alignment:'evil'});assert.ok(!JSON.stringify(knowledge(g,p.id)).includes('fake'));
    }
  }
  const g=full();assert.ok(ids(g,'oberon').every(id=>knowledge(g,roleId(g,'merlin')).knownAlignments.some(x=>x.playerId===id)));
  assert.ok(!knowledge(g,roleId(g,'merlin')).knownAlignments.some(x=>x.playerId===roleId(g,'mordred')));
  assert.deepEqual(knowledge(g,roleId(g,'oberon')),{knownAlignments:[],roleCandidates:[]});
});

test('Percival candidates stay ambiguous until the assassination house-rule reveal',()=>{
  let g=full();const p=roleId(g,'percival');
  for(let q=0;q<3;q++){
    const other=swap(g,roleId(g,'merlin'),roleId(g,'morgana'));
    assert.deepEqual(getPlayerView(g,p),getPlayerView(other,p));
    assert.deepEqual(getPublicView(g),getPublicView(other));g=playQuest(g,0);
  }
  const before=getPlayerView(g,p), after=getPlayerView(swap(g,roleId(g,'merlin'),roleId(g,'morgana')),p);
  assert.deepEqual(before.self.knowledge,after.self.knowledge);
  assert.deepEqual(before.public,after.public);
  assert.deepEqual(before.legalActions,after.legalActions);
  assert.notDeepEqual(before.self.assassinationRoles,after.self.assassinationRoles);
  assert.equal(before.self.assassinationRoles.length,10);
});

test('unseen identity swaps stay private before assassination; stage reveals include Oberon',()=>{
  let g=full();const observer=roleId(g,'loyal');
  assert.deepEqual(getPlayerView(g,observer),getPlayerView(swap(g,roleId(g,'mordred'),roleId(g,'oberon')),observer));
  const merlin=roleId(g,'merlin');assert.deepEqual(getPlayerView(g,merlin),getPlayerView(swap(g,roleId(g,'mordred'),observer),merlin));
  const oberon=roleId(g,'oberon');assert.deepEqual(getPlayerView(g,oberon),getPlayerView(swap(g,merlin,observer),oberon));
  for(let q=0;q<3;q++)g=playQuest(g,0);
  const assassin=roleId(g,'assassin'),other=swap(g,oberon,observer);
  assert.deepEqual(getPlayerView(g,assassin).self.knowledge,getPlayerView(other,assassin).self.knowledge);
  assert.notDeepEqual(getPlayerView(g,assassin).self.assassinationRoles,getPlayerView(other,assassin).self.assassinationRoles);
  assert.ok(!getLegalActions(g,assassin)[0].candidateIds.includes(oberon));
  reject(g,assassin,{type:'assassinate',targetId:oberon},'INVALID_TARGET');
  assert.equal(act(other,assassin,{type:'assassinate',targetId:oberon}).outcome.reason,'assassination_missed');
});

test('invalid counts, quotas, duplicate special roles, missing core roles and malformed config reject',()=>{
  const good=getRecommendedRoles(6);
  const invalid=[{playerCount:6,roleSet:null},{playerCount:4},{playerCount:11},{playerCount:6.5},{playerCount:6,roles:good.slice(1)},
    {playerCount:6,roles:good.map(x=>x==='morgana'?'loyal':x)},
    {playerCount:6,roles:good.map(x=>x==='loyal'?'percival':x)},
    {playerCount:6,roles:good.map(x=>x==='merlin'?'loyal':x)},
    {playerCount:6,roles:good.map(x=>x==='assassin'?'minion':x)},
    {playerCount:6,roles:good.map(x=>x==='morgana'?'unknown':x)},
    {playerCount:6,roles:Array(6)},{playerCount:6,roles:good,seed:1},{playerCount:6,roleSet:'base',roles:good}];
  for(const config of invalid)assert.throws(()=>createGame(config,players(6)),{code:'INVALID_CONFIG'});
  assert.throws(()=>buildRoleConfig(6,['merlin','assassin','assassin']),{code:'INVALID_CONFIG'});
  assert.throws(()=>buildRoleConfig(6,['merlin','assassin','loyal']),{code:'INVALID_CONFIG'});
  const base=buildRoleConfig(10,['merlin','assassin']);assert.equal(base.roles.filter(x=>x==='loyal').length,5);assert.equal(base.roles.filter(x=>x==='minion').length,3);
  const easy=buildRoleConfig(5,['merlin','assassin','percival']);assert.ok(createGame(easy,players(5)));assert.ok(getConfigNotes(easy).length>=2);
  const normalized=validateConfig({playerCount:10,roleSet:'recommended'});assert.deepEqual(validateConfig(normalized),normalized);
  const g=createGame(base,players(10));base.roles[0]='minion';assert.equal(g.config.roles[0],'merlin');assert.ok(Object.isFrozen(g.config.roles));
  reject(g,g.players[0].id,{type:'configure',roles:good},'INVALID_ACTION');
});

test('every expansion evil can fail, justice cannot, only assassin acts at assassination',()=>{
  const g=full();
  for(const p of g.players){let q=voteAll(propose(g,[p.id,...g.players.filter(x=>x.id!==p.id).slice(0,2).map(x=>x.id)]));
    const evil=getPlayerView(q,p.id).self.alignment==='evil';
    assert.deepEqual(getLegalActions(q,p.id)[0].choices,evil?['success','fail']:['success']);
    if(evil){q=act(q,p.id,{type:'quest_card',card:'fail'});assert.equal(q.questCards[0].card,'fail');}
    else reject(q,p.id,{type:'quest_card',card:'fail'},'INVALID_CARD');
  }
  let end=g;for(let i=0;i<3;i++)end=playQuest(end,0);
  for(const p of end.players)if(p.id!==roleId(end,'assassin'))reject(end,p.id,{type:'assassinate',targetId:roleId(end,'merlin')},'NOT_ALLOWED');
});

test('canonical setup is public, assignments and individual cards stay private until ended',()=>{
  let g=full();const reversed=createTestGame({playerCount:10,roles:[...g.config.roles].reverse()},players(10),22);
  assert.deepEqual(g,reversed);
  const pub=getPublicView(g);assert.deepEqual(pub.config.roles,g.config.roles);assert.equal('revealedRoles' in pub,false);
  assert.ok(!pub.events.some(e=>'roles' in e));
  const evil=roleId(g,'mordred');g=voteAll(propose(g,[evil,...g.players.filter(p=>p.id!==evil).slice(0,2).map(p=>p.id)]));
  const success=act(g,evil,{type:'quest_card',card:'success'}),fail=act(g,evil,{type:'quest_card',card:'fail'});
  assert.deepEqual(getPublicView(success),getPublicView(fail));
  for(const p of g.players)if(p.id!==evil)assert.deepEqual(getPlayerView(success,p.id),getPlayerView(fail,p.id));
  let ending=full();for(let i=0;i<3;i++)ending=playQuest(ending,0);assert.equal('revealedRoles' in getPublicView(ending),false);
  ending=act(ending,roleId(ending,'assassin'),{type:'assassinate',targetId:roleId(ending,'merlin')});
  assert.deepEqual(getPublicView(ending).revealedRoles.map(r=>r.role),ending.roles.map(r=>r.role));
});

test('local adapter rejects bad setup atomically and creates a distinct game for a valid change',()=>{
  const d=createVisualDemo('practice'),before=d.snapshot();
  assert.equal(d.change(before.revision,'assassination',6,'practice',['merlin']).error,'INVALID_CONFIG');assert.deepEqual(d.snapshot(),before);
  const next=d.change(before.revision,'assassination',10,'practice',getRecommendedRoles(10));assert.equal(next.ok,true);
  assert.notEqual(next.view.gameId,before.view.gameId);assert.equal(next.view.config.roles.length,10);
});

test('HTTP custom configuration is revalidated, and only p1 filtered expansion knowledge is returned',async t=>{
  const server=createDemoServer();server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`,initial=await fetch(base+'/api/state'),cookie=initial.headers.get('set-cookie').split(';')[0],state=await initial.json();
  const post=body=>fetch(base+'/api/reset',{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json'},body:JSON.stringify(body)});
  const setup={revision:state.revision,scenario:'assassination',playerCount:10,mode:'practice',roles:getRecommendedRoles(10)};
  assert.equal((await post({...setup,roles:['merlin']})).status,409);
  const next=await(await post(setup)).json();assert.equal(next.ok,true);
  const me=await(await fetch(base+'/api/me',{headers:{Cookie:cookie}})).json();assert.equal(me.player.self.playerId,'p1');assert.ok(me.player.self.knowledge);
  assert.equal('roles' in me.player,false);assert.equal('revealedRoles' in me.player.public,false);assert.equal(me.player.self.knownRoles,undefined);
  assert.equal((await post({...setup,revision:next.revision,playerId:'p2'})).status,400);
});
