import test from 'node:test';
import assert from 'node:assert/strict';
import {randomUUID} from 'node:crypto';
import {chatCompatibleAdapter} from '../scripts/chat-compatible.mjs';
import {providerRegistry} from '../scripts/ai-providers.mjs';
import {modelInput} from '../src/ai.ts';
import {getPlayerView} from '../src/index.ts';
import {emptyPatch} from '../src/ai-memory.ts';
import {fixture} from './helpers.mjs';
import {RoomStore} from '../scripts/room-store.mjs';
import {AIRuntime} from '../scripts/ai-runtime.mjs';
import {loadStrategy} from '../scripts/avalon-strategy.mjs';
const input=()=>modelInput(getPlayerView(fixture(),'p1'),[],'','speech','test');
const decision={choice:0,speech:'先问2号，为什么想带3号？',memory:emptyPatch()};
test('compatible adapter sends only filtered context, no redirects, validated JSON and actual usage',async()=>{
 let request;
 const adapter=chatCompatibleAdapter({apiKey:'TEST_KEY',model:'test-model',baseURL:'https://example.com/v1',fetchImpl:async(url,options)=>{request={url,options};return {ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content:JSON.stringify(decision)}}],usage:{total_tokens:123}})};} });
 const x=input(),r=await adapter.decide(x);
 assert.equal(request.url,'https://example.com/v1/chat/completions');assert.equal(request.options.redirect,'error');
 const payload=JSON.parse(request.options.body);assert.deepEqual(JSON.parse(payload.messages[1].content),x);assert(!request.options.body.includes('TEST_KEY'));assert(!('roles' in x.view));assert.equal(r.tokens,123);assert.deepEqual(r.decision,decision);
});
test('compatible errors never leak response bodies and do not retry or accept truncated output',async()=>{
 for(const [status,expected] of [[401,'AUTH_FAILED'],[429,'RATE_LIMIT'],[404,'MODEL_UNAVAILABLE'],[400,'MODEL_REQUEST_REJECTED'],[504,'TIMEOUT']]){
 let calls=0;const a=chatCompatibleAdapter({apiKey:'test',model:'test',baseURL:'https://example.com',fetchImpl:async()=>{calls++;return {ok:false,status,json(){throw new Error('must not read secret error')}}}});
 await assert.rejects(a.decide(input()),new RegExp(expected));assert.equal(calls,1);
 }
 for(const content of [JSON.stringify({...decision,choice:10}),JSON.stringify({...decision,secret:'bad'}),'not json']){
 const a=chatCompatibleAdapter({apiKey:'test',model:'test',baseURL:'https://example.com',fetchImpl:async()=>({ok:true,json:async()=>({choices:[{finish_reason:'stop',message:{content}}]})})});await assert.rejects(a.decide(input()),/FORMAT_ERROR/);
 }
 assert.throws(()=>chatCompatibleAdapter({apiKey:'test',model:'test',baseURL:'http://example.com'}),/INVALID_AI_ENDPOINT/);
 assert.throws(()=>chatCompatibleAdapter({apiKey:'test',model:'test',baseURL:'https://example.com?key=test'}),/INVALID_AI_ENDPOINT/);
});
test('provider configuration stays server-only and legacy seats never silently switch provider',()=>{
 const r=providerRegistry({DEEPSEEK_API_KEY:'test-private',DEEPSEEK_MODEL:'test-model'});
 assert.equal(r.forProfile('gemini'),null);assert.equal(r.forProfile('deepseek').model,'test-model');assert.equal(r.forProfile('unknown'),null);
 assert(!JSON.stringify(r.profiles).includes('test-private'));assert.equal(r.profiles.filter(p=>p.available).length,1);
 assert.equal(providerRegistry({}).available,false);
});
test('different seats dispatch to selected providers with independent actor views and persistent profile ids',async t=>{
 let now=100000;const store=new RoomStore(':memory:',()=>now),seen=[];
 const make=id=>({model:id,async decide(x){seen.push({id,x});return {model:id,decision:{choice:0,speech:'先看选队。',memory:emptyPatch()},tokens:1};}});
 const registry={model:'multi',forProfile:id=>['deepseek','qwen'].includes(id)?make(id):null};const ai=new AIRuntime(store,registry,{minInterval:0});t.after(()=>{ai.close();store.close();});
 const user=store.session(store.newSession()),cmd=b=>store.execute(user,code,{requestId:randomUUID(),...b});
 const code=store.execute(user,null,{requestId:randomUUID(),type:'create',name:'host',config:{playerCount:5}}).code;
 assert.throws(()=>cmd({type:'add_ai',seat:2,aiProfile:'unknown',expectedRevision:store.load(code).revision}),/AI_NOT_CONFIGURED/);
 for(let seat=2;seat<=5;seat++)cmd({type:'add_ai',seat,aiProfile:seat%2?'qwen':'deepseek',expectedRevision:store.load(code).revision});
 cmd({type:'ready',ready:true,configVersion:0});cmd({type:'start',expectedRevision:store.load(code).revision});now+=3100;await ai.tick();cmd({type:'confirm'});
 while(store.snapshot(code,user).room.discussion.active){const d=store.snapshot(code,user).room.discussion;if(d.speakerId===store.snapshot(code,user).room.selfId)cmd({type:'speak',turnId:d.turnId,text:''});else await ai.tick();}
 assert.deepEqual(seen.map(x=>x.id).sort(),['deepseek','deepseek','qwen','qwen']);assert.equal(new Set(seen.map(x=>x.x.view.self.playerId)).size,4);
 assert.equal(store.db.prepare('SELECT count(*) n FROM ai_memory').get().n,4);
 assert.deepEqual(store.snapshot(code,user).room.members.filter(p=>p.kind==='ai').map(p=>p.aiProfile),['deepseek','qwen','deepseek','qwen']);
 assert.throws(()=>cmd({type:'add_ai',seat:2,aiProfile:'qwen',expectedRevision:store.load(code).revision}),/LOBBY_REQUIRED/);
});
test('speech coaching has factual guardrails and seat-based style, not secret-based public personality',()=>{
 const x=input(),s=loadStrategy(x);assert.match(s.text,/还未正式提名/);assert.match(s.text,/不能认证车上全是正义/);assert.match(s.text,/不要精准点名多个邪恶/);assert.match(s.text,/风格与身份无关/);
});
