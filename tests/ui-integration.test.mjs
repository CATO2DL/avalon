import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { request as httpRequest } from 'node:http';
import { createVisualDemo } from '../src/visual-demo.ts';
import { createDemoServer } from '../scripts/visual-server.mjs';
import { ringLayout } from '../web/layout.js';
import { taskHistory } from '../web/history.js';
import { roleAssets, roleAssetFiles } from '../web/asset-map.js';

for (const count of [5,6,7,8,9,10]) {
  test(`${count} seats: phone/desktop geometry keeps touch targets, seats and central disc separate`, () => {
    for (const width of [296,336,351,366,406,530]) {
      const l=ringLayout(count,width);
      assert.ok(l.avatar>=44);
      assert.equal(l.points.length,count);
      for (const [i,p] of l.points.entries()) {
        assert.ok(p.x-l.seatWidth/2>=0 && p.x+l.seatWidth/2<=width);
        assert.ok(p.y-l.seatHeight/2>=0 && p.y+l.seatHeight/2<=l.height);
        for (const q of l.points.slice(i+1)) assert.ok(Math.abs(p.x-q.x)>=l.seatWidth || Math.abs(p.y-q.y)>=l.seatHeight);
        const discRadius=l.discSize/2;
        const dx=Math.max(0,Math.abs(p.x-width/2)-l.seatWidth/2);
        const dy=Math.max(0,Math.abs(p.y-l.centerY)-l.seatHeight/2);
        assert.ok(Math.hypot(dx,dy)>discRadius,`disc collision ${count}/${width}`);
      }
      assert.ok(l.points[0].y===Math.max(...l.points.map(p=>p.y)));
    }
  });
  test(`${count} players: all public script routes complete; rejection history never fabricates a failed quest`,()=>{
    for(const route of ['sabotage','assassination','rejections']){
      const demo=createVisualDemo();let s=demo.change(0,route,count,'public');let steps=0;
      while(s.view.phase!=='ended'){s=demo.change(s.revision);assert.equal(s.ok,true);assert.ok(++steps<150);}
      assert.equal(demo.privateView(),null);
      if(route==='rejections'){
        assert.equal(s.view.outcome.reason,'five_rejections');assert.equal(s.view.quests.length,0);
        const h=taskHistory(s.view,1);assert.equal(h.length,5);assert.ok(h.every(p=>p.vote.approved===false&&p.result===null));
      }
    }
  });
}

test('practice completes with human p1 legal actions; script never submits for p1; stale/forged actions preserve state',()=>{
  const d=createVisualDemo('practice');let s=d.snapshot(),steps=0;
  while(s.view.phase!=='ended'){
    const p=d.privateView(),a=p.legalActions[0];assert.equal(p.self.playerId,'p1');
    if(a){
      const payload=a.type==='propose_team'?{team:a.candidateIds.slice(0,a.teamSize)}:a.type==='vote'?{vote:'approve'}:a.type==='quest_card'?{card:'success'}:{targetId:a.candidateIds[0]};
      const action={type:a.type,...payload,gameId:a.gameId,expectedVersion:a.expectedVersion,requestId:`human-${steps}`};
      const old=d.snapshot();assert.equal(d.submit(s.revision,{...action,playerId:'p2'}).ok,false);assert.deepEqual(d.snapshot(),old);
      s=d.submit(s.revision,action);assert.equal(s.ok,true);
      assert.equal(d.submit(old.revision,action).error,'STALE_REVISION');
    }else{
      const old=d.privateView().self;s=d.change(s.revision);assert.equal(s.ok,true);
      // A completed phase clears a player's own ballot, but can never create one for p1.
      const next=d.privateView().self;
      if(next.ownVote!==null)assert.equal(next.ownVote,old.ownVote);
      if(next.ownQuestCard!==null)assert.equal(next.ownQuestCard,old.ownQuestCard);
    }
    assert.ok(++steps<150);
  }
  const oldId=s.view.gameId;s=d.change(s.revision,'sabotage',6,'practice');assert.notEqual(s.view.gameId,oldId);
});

test('history waits for collected votes/cards and exposes only anonymous quest totals',()=>{
  const d=createVisualDemo();let s=d.change(0);
  assert.equal(taskHistory(s.view,1)[0].vote,null);
  s=d.change(s.revision);assert.equal(taskHistory(s.view,1)[0].vote,null);
  while(s.view.phase!=='quest')s=d.change(s.revision);
  assert.equal(taskHistory(s.view,1)[0].result,null);
  s=d.change(s.revision);assert.equal(taskHistory(s.view,1)[0].result,null);
  while(s.view.phase==='quest')s=d.change(s.revision);
  assert.deepEqual(Object.keys(taskHistory(s.view,1)[0].result).sort(),['failCount','succeeded','successCount']);
  assert.deepEqual(taskHistory(s.view,5),[]);
});

test('HTTP capability isolates sessions and p1 view; public data/assets never expose arbitrary secrets',async t=>{
  const server=createDemoServer();server.listen(0,'127.0.0.1');await once(server,'listening');t.after(()=>new Promise(r=>server.close(r)));
  const base=`http://127.0.0.1:${server.address().port}`;
  const bootstrap=await fetch(base+'/api/state'),cookie=bootstrap.headers.get('set-cookie').split(';')[0];
  assert.match(bootstrap.headers.get('set-cookie'),/HttpOnly; SameSite=Strict/);
  const initial=await bootstrap.json();
  const get=path=>fetch(base+path,{headers:{Cookie:cookie}});
  const post=(path,body,extra={})=>fetch(base+path,{method:'POST',headers:{Cookie:cookie,'Content-Type':'application/json',...extra},body:JSON.stringify(body)});
  assert.deepEqual(Object.keys(initial).sort(),['configOptions','mode','revision','rules','scenario','view']);
  for(const key of ['roles','self','questCards','processedRequests'])assert.equal(key in initial.view,false);
  assert.equal((await fetch(base+'/api/me')).status,401);
  assert.equal((await fetch(base+'/api/me',{headers:{Cookie:'avalon_session=forged'}})).status,401);
  const mine=await(await get('/api/me')).json();assert.equal(mine.player.self.playerId,'p1');assert.equal('roles' in mine.player,false);
  const other=await(await fetch(base+'/api/state')).json();assert.notEqual(other.view.gameId,initial.view.gameId);
  for(const path of ['/src/engine.ts','/api/player/p2','/api/me?playerId=p2','/.local/web-assets/receipt.json','/assets/originals/roles/梅林.png','/assets/roles/unknown.webp','/package.json'])assert.equal((await get(path)).status,404);
  for(const path of ['/', '/app.js','/style.css','/asset-map.js',...roleAssetFiles.map(n=>`/assets/roles/${n}`)]){
    const r=await get(path);assert.equal(r.status,200,path);assert.equal(r.headers.get('cache-control'),'no-store');await r.arrayBuffer();
  }
  assert.equal(Object.keys(roleAssets).length,8);assert.equal(roleAssetFiles.length,16);
  assert.equal((await post('/api/step',{revision:0},{Origin:'https://example.com'})).status,403);
  assert.equal((await get('/api/me')).headers.get('cache-control'),'no-store');
  const wrongHostStatus=await new Promise((resolve,reject)=>{const req=httpRequest(base+'/api/state',{headers:{Host:'untrusted.invalid'}},res=>{res.resume();resolve(res.statusCode);});req.on('error',reject);req.end();});
  assert.equal(wrongHostStatus,403);
  assert.equal((await post('/api/step',{revision:0},{'Sec-Fetch-Site':'cross-site'})).status,403);
  assert.equal((await post('/api/step',{revision:0,playerId:'p2'})).status,400);
  assert.equal((await post('/api/reset',{revision:0,scenario:null,playerCount:6,mode:'public'})).status,400);
  assert.deepEqual(await(await get('/api/state')).json(),initial);
  let current=initial, privateState=mine;
  while(!privateState.player.legalActions.length){current=await(await post('/api/step',{revision:current.revision})).json();privateState=await(await get('/api/me')).json();}
  const a=privateState.player.legalActions[0];
  const payload=a.type==='propose_team'?{team:a.candidateIds.slice(0,a.teamSize)}:{vote:'approve'};
  const body={revision:current.revision,action:{type:a.type,...payload,gameId:a.gameId,expectedVersion:a.expectedVersion,requestId:'http-human'}};
  const [r1,r2]=await Promise.all([post('/api/action',body),post('/api/action',body)]);assert.deepEqual([r1.status,r2.status].sort(),[200,409]);
  let state=await(await get('/api/state')).json();assert.equal(state.view.version,current.view.version+1);
  const reset=await post('/api/reset',{revision:state.revision,scenario:'rejections',playerCount:10,mode:'public'});assert.equal(reset.status,200);state=await reset.json();
  assert.equal((await(await get('/api/me')).json()).player,null);
  assert.equal((await post('/api/action',{revision:state.revision,action:body.action})).status,409);
  assert.equal((await post('/api/step',{revision:0})).status,409);
});
