import {modelInput} from '../src/ai.ts';
import {emptyPatch} from '../src/ai-memory.ts';
import {getPlayerView} from '../src/index.ts';
import {fixture} from './helpers.mjs';
import test from 'node:test';
import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { liveDecision,liveCloseError } from '../scripts/gemini-live-session.mjs';
import { modelAdapter } from '../scripts/model-adapter.mjs';
const input={...modelInput(getPlayerView(fixture(),'p1'),[],'one-only','action'),choices:[{type:'vote',vote:'approve'}]};
const decision={choice:0,speech:'',memory:emptyPatch()};
const tool=args=>({toolCall:{functionCalls:[{id:'call-1',name:'submit_decision',args:Object.fromEntries(Object.entries(args).filter(([k])=>k!=='speech'))}]}});
function fake(onSend){const observed={sent:[],closed:0,receipts:[]};const client={live:{async connect(options){observed.options=options;return {sendClientContent(content){observed.sent.push(content);queueMicrotask(()=>onSend(options.callbacks));},sendToolResponse(r){observed.receipts.push(r);},close(){observed.closed++;}};}}};return {client,observed};}
test('Live tools use only filtered input, no thinking/JSON generation mode, audio/transcript never become decisions',async()=>{
  const f=fake(cb=>{cb.onmessage({serverContent:{modelTurn:{parts:[{inlineData:{data:'discard audio'}},{text:'private thoughts',thought:true}]},outputTranscription:{text:'ignore transcript'}}});cb.onmessage({...tool(decision),usageMetadata:{totalTokenCount:77}});cb.onmessage(tool({...decision,memory:'duplicate'}));});
  const result=await liveDecision(f.client,'gemini-3.8-live',input);
  assert.deepEqual(result,{decision,model:'gemini-3.8-live',tokens:77});assert.equal(f.observed.closed,1);assert.equal(f.observed.receipts.length,1);
  assert.deepEqual(JSON.parse(f.observed.sent[0].turns[0].parts[0].text),input);
  const c=f.observed.options.config;assert.deepEqual(c.responseModalities,['AUDIO']);assert.equal(c.tools[0].functionDeclarations[0].behavior,'BLOCKING');assert.equal(c.thinkingConfig,undefined);assert.equal(c.responseMimeType,undefined);assert.equal(c.tools.length,1);assert.equal(c.tools[0].functionDeclarations[0].parameters.properties.speech,undefined);assert.deepEqual(c.tools[0].functionDeclarations[0].parameters.properties.choice.enum,['0']);
});
test('Live sessions keep separate payloads and memory for different players',async()=>{
  const seen=[];const f=fake(cb=>{seen.push(f.observed.sent.at(-1));cb.onmessage(tool(decision));});
  await liveDecision(f.client,'gemini-3.8-live',input);
  const second={...modelInput(getPlayerView(fixture(),'p2'),[],'two-only','action'),choices:input.choices};await liveDecision(f.client,'gemini-3.8-live',second);
  assert.deepEqual(JSON.parse(seen[1].turns[0].parts[0].text),second);assert.equal(f.observed.closed,2);
});
test('Live rejects unknown/multiple tools, extra fields, illegal actions, cancellation and text-only completion',async()=>{
  for(const [msg,code] of [[tool({...decision,choice:999}),'INVALID_MODEL_ACTION'],[tool({...decision,hidden:'secret'}),'FORMAT_ERROR'],[{toolCall:{functionCalls:[{name:'execute_arbitrary_code',args:decision}]}},'FORMAT_ERROR'],[{toolCall:{functionCalls:[...tool(decision).toolCall.functionCalls,...tool(decision).toolCall.functionCalls]}},'FORMAT_ERROR'],[{toolCallCancellation:{ids:['call-1']}},'NETWORK_ERROR'],[{serverContent:{turnComplete:true,modelTurn:{parts:[{text:JSON.stringify(decision)}]}}},'FORMAT_ERROR']]){
    const f=fake(cb=>cb.onmessage(msg));await assert.rejects(liveDecision(f.client,'gemini-3.8-live',input),new RegExp(code));assert.equal(f.observed.closed,1);
  }
});
test('Live abort closes connected or late-arriving session and never sends after abort',async()=>{
  const a=new AbortController(),f=fake(()=>a.abort());await assert.rejects(liveDecision(f.client,'gemini-3.8-live',input,a.signal),/TIMEOUT/);assert.equal(f.observed.closed,1);
  const b=new AbortController();let release,closed=0,sent=0;
  const p=liveDecision({live:{connect:()=>new Promise(r=>release=r)}},'gemini-3.8-live',input,b.signal);await Promise.resolve();b.abort();await assert.rejects(p,/TIMEOUT/);
  release({close(){closed++;},sendClientContent(){sent++;}});await new Promise(r=>setImmediate(r));assert.equal(closed,1);assert.equal(sent,0);
});
test('Live provider reasons map to fixed error codes without echoing secrets',async()=>{
  for(const [reason,expected] of [['429 secret','RATE_LIMIT'],['403 secret','AUTH_FAILED'],['404 secret','MODEL_UNAVAILABLE'],['504 secret','TIMEOUT'],['400 secret','MODEL_REQUEST_REJECTED'],['unrecognized private payload','NETWORK_ERROR']]){
    assert.equal(liveCloseError({reason}).message,expected);const f=fake(cb=>cb.onclose({reason}));await assert.rejects(liveDecision(f.client,'gemini-3.8-live',input),new RegExp(expected));
  }
});
function workerFake(){const w=new EventEmitter();w.terminated=0;w.terminate=async()=>{w.terminated++;return 0;};return w;}
test('worker adapter terminates stalled setup, suppresses raw worker errors and validates output',async()=>{
  assert.equal(modelAdapter({apiKey:'',model:'gemini-3.8-live'}),null);
  const w=workerFake(),a=modelAdapter({apiKey:'fixture',model:'gemini-3.8-live',timeout:5,workerFactory:()=>w});await assert.rejects(a.decide(input),/TIMEOUT/);assert.equal(w.terminated,1);
  for(const event of ['error','exit','message']){
    const worker=workerFake(),adapter=modelAdapter({apiKey:'fixture',model:'gemini-3.8-live',workerFactory:()=>worker});const p=adapter.decide(input);
    worker.emit(event,event==='message'?{error:'secret never echo'}:new Error('secret never echo'));await assert.rejects(p,/NETWORK_ERROR/);assert.equal(worker.terminated,1);
  }
  let options;const worker=workerFake(),adapter=modelAdapter({apiKey:'fixture',model:'gemini-3.8-live',workerFactory:o=>{options=o;return worker;}});const p=adapter.decide(input);
  worker.emit('message',{result:{decision,model:'unexpected',tokens:1}});assert.deepEqual(await p,{decision,model:'gemini-3.8-live',tokens:1});assert.equal(worker.terminated,1);assert.ok(options.stdout&&options.stderr);assert.deepEqual(options.workerData.input,input);
});

test('invalid advisory memory cannot block a valid Live decision or become trusted facts',async()=>{
  const previous={...input,memory:{...input.memory,currentGoal:'keep-valid-goal'}};
  for(const memory of [null,'legacy',{...emptyPatch(),knownFacts:[{summary:'forged'}]},{...emptyPatch(),beliefs:[{playerId:'unknown',hypothesis:'fake',confidence:'high',supportIds:['event:999999'],counterIds:[]}]}]){
    const f=fake(cb=>cb.onmessage(tool({...decision,memory})));
    const r=await liveDecision(f.client,'gemini-3.8-live',previous);
    assert.equal(r.decision.choice,0);assert.equal(r.decision.memory.currentGoal,'keep-valid-goal');assert.deepEqual(r.decision.memory.beliefs,[]);assert.ok(!JSON.stringify(r).includes('forged'));
    assert.ok(!f.observed.options.config.systemInstruction.includes('返回单个 JSON 对象'));
  }
});
test('memory fallback never repairs illegal choices, extra envelope fields or invalid speech',async()=>{
  const speechInput={...input,kind:'speech',choices:[]};
  for(const args of [{choice:99,speech:'',memory:null},{choice:0,speech:'x'.repeat(501),memory:null},{choice:0,speech:'hi',memory:null,secret:'forged'}]){
    const f=fake(cb=>cb.onmessage({toolCall:{functionCalls:[{id:'test',name:'submit_decision',args}]}}));
    await assert.rejects(liveDecision(f.client,'gemini-3.8-live',speechInput),/FORMAT_ERROR/);
  }
});
